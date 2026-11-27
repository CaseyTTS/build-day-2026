// The assembled system: inbox -> triage -> RAG -> harness gate -> interviewer -> a human. License: MIT.
// Nothing in here knows which job it is doing. Everything job-specific comes from the playbook.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { PlaybookError, ITEM_ID, type Playbook, type ToolCall } from "./playbook.js";
import { StandInModel, type Canned, type ChatModel } from "./model.js";
import { triage, intake, type InboxItem, type TriageResult } from "./triage.js";
import { answer, buildIndex, retrieve } from "./rag.js";
import { Harness, type ApproveMode, type GateOutcome } from "./harness.js";
import { BotCandidate, HumanCandidate, TeamCandidate, scriptedLines } from "./interviewer/candidates.js";
import { BANNER, ConsentDeclined } from "./interviewer/consent.js";
import { runInterview } from "./interviewer/interview.js";
import { renderReport } from "./interviewer/report.js";
import { loadRubric } from "./interviewer/rubric.js";
import { scoreTranscript } from "./interviewer/score.js";
import type { Candidate, Task } from "./interviewer/types.js";
import { draftInvite, findSlots, loadCalendars, type InterviewRequest, type Slot } from "./scheduler.js";

interface CandidateSpec { kind: "human" | "bot" | "team"; id: string; answers?: string[]; members?: CandidateSpec[] }
interface PlaybookTask extends Task { standin?: { solo: string; team: string } }

export interface ItemResult {
  id: string; triage: TriageResult; rag: { text: string; sources: string[]; grounded: boolean; groups: string[] };
  interview?: { scores: string; report: string } | { declined: true };
  schedule?: { slots: Slot[]; problems: string[]; invite?: string };
  calls: GateOutcome[]; humanDecisions: string[];
}
export interface RunResult { playbook: string; approve: ApproveMode; outDir: string; model: string; items: ItemResult[] }

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

export function readInbox(pb: Playbook): InboxItem[] {
  const seen = new Set<string>();
  return readFileSync(join(pb.dir, pb.inbox), "utf8").split("\n").filter((l) => l.trim()).map((l, n) => {
    let raw: InboxItem;
    const bad = (msg: string) => new PlaybookError(join(pb.dir, pb.inbox), [`${pb.inbox} line ${n + 1}: ${msg}`]);
    try { raw = JSON.parse(l) as InboxItem; } catch { throw bad("not valid JSON"); }
    // The id names output files, so it must not be able to climb out of outputs/ (untrusted input).
    if (typeof raw.id !== "string" || !ITEM_ID.test(raw.id)) throw bad(`"id" must be letters, digits, . _ or - (got ${JSON.stringify(raw.id)})`);
    if (/-invite$/i.test(raw.id)) throw bad(`"id" may not end in -invite; that name is reserved for invite drafts`);
    if (seen.has(raw.id.toLowerCase())) throw bad(`duplicate id "${raw.id}"`);
    seen.add(raw.id.toLowerCase());
    // A resume can live in its own file; its text is what gets triaged and grounded. Only files inside the playbook folder.
    if (typeof raw.attachment === "string") {
      let att: string;
      try { att = realpathSync(resolve(pb.dir, raw.attachment)); }
      catch { throw bad("attachment not found"); }
      const rel = relative(realpathSync(pb.dir), att);
      if (rel.startsWith("..") || isAbsolute(rel)) throw bad("attachment must be inside the playbook folder");
      try { raw = { ...raw, text: `${raw.text ?? ""}\n${readFileSync(att, "utf8")}` }; }
      catch { throw bad("attachment not found"); }
    }
    return intake(raw);
  });
}

function buildCandidate(spec: CandidateSpec, model: ChatModel): Candidate {
  if (spec.kind === "human") return new HumanCandidate(spec.id, scriptedLines(spec.answers ?? []), `${spec.id} (scripted person)`);
  if (spec.kind === "bot") return new BotCandidate(spec.id, model, `${spec.id} (bot, ${model.name})`);
  if (spec.kind === "team") return new TeamCandidate(spec.id, (spec.members ?? []).map((m) => buildCandidate(m, model)), `${spec.id} (team)`);
  throw new Error(`unknown candidate kind "${(spec as { kind: string }).kind}"`);
}

export async function runPlaybook(pb: Playbook, opts: { model: ChatModel; approve: ApproveMode; outRoot: string; print?: (s: string) => void }): Promise<RunResult> {
  const print = opts.print ?? (() => {});
  const outDir = join(opts.outRoot, pb.name, opts.approve === "deny" ? "denied" : "approved");
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const harness = new Harness(pb.harness.policy, { root: outDir }, opts.approve, join(outDir, "audit.jsonl"));
  const index = buildIndex(join(pb.dir, pb.rag.docs));
  harness.log({ node: "start", playbook: pb.name, model: opts.model.name, approve: opts.approve, docs: new Set(index.map((c) => c.source)).size, chunks: index.length });

  let tasks: PlaybookTask[] = [];
  let interviewModel = opts.model;
  if (pb.interviewer) {
    tasks = JSON.parse(readFileSync(join(pb.dir, pb.interviewer.tasks), "utf8")) as PlaybookTask[];
    const canned: Canned = Object.fromEntries(tasks.filter((t) => t.standin).map((t) => [t.id, t.standin!]));
    if (opts.model instanceof StandInModel) interviewModel = opts.model.withCanned(canned);
  }

  const calendars = pb.scheduler ? loadCalendars(join(pb.dir, pb.scheduler.calendars)) : undefined;
  print(`Playbook: ${pb.name}  (${pb.title})\nModel: ${opts.model.name}\nApproval gate: ${opts.approve === "deny" ? "deny (default: every 'ask' is refused)" : opts.approve === "yes" ? "approved up front with --approve" : "a person types y/n"}\nDocs: ${pb.rag.docs} (${index.length} chunks)\n`);
  const items: ItemResult[] = [];
  for (const item of readInbox(pb)) {
    harness.log({ node: "item", item: item.id, from: item.from ?? "" });
    // 1. TRIAGE
    const tr = await triage(pb, item, opts.model);
    harness.log({ node: "triage", item: item.id, label: tr.label, confidence: tr.confidence, priority: tr.priority, route: tr.route, review: tr.review });
    // 2. RAG: only docs the sender's groups may read, then rank; "I don't know" below the threshold
    const groups = Array.isArray(item.groups) ? item.groups : pb.rag.default_groups;
    const question = typeof item.question === "string" ? item.question : item.text;
    const rag = { ...(await answer(question, retrieve(index, question, groups), opts.model, pb.rag.min_score ?? 0.12,
      pb.rag.mode === "draft" ? "Write a short draft in the brand voice described in the context." : "")), groups };
    harness.log({ node: "rag", item: item.id, groups, grounded: rag.grounded, sources: rag.sources });
    const head = pb.rag.mode === "draft" ? "DRAFT for human review. Not published." : "Suggested answer for a person to check before it is sent.";
    const draftPath = `drafts/${item.id}.md`;
    const draft = `${head}\n\nRequest (${item.id}): ${item.text}\n\n${rag.text}\n\nSources: ${rag.sources.join(", ") || "none (no doc this sender may read was relevant)"}\n`;
    const result: ItemResult = { id: item.id, triage: tr, rag, calls: [], humanDecisions: [] };

    // 3. INTERVIEWER (only where the playbook uses it)
    let reportText = "";
    if (pb.interviewer && pb.interviewer.labels.includes(tr.label) && item.candidate) {
      const rubric = loadRubric(join(pb.dir, pb.interviewer.rubric));
      try {
        const t = await runInterview(buildCandidate(item.candidate as CandidateSpec, interviewModel), rubric, { tasks });
        const card = await scoreTranscript(t, rubric);
        reportText = `> Seat: ${pb.interviewer.seat_note}\n\n` + renderReport(t, card, rubric);
        mkdirSync(join(outDir, "interviews"), { recursive: true });
        writeFileSync(join(outDir, "interviews", `${item.id}-transcript.json`), JSON.stringify(t, null, 2) + "\n");
        writeFileSync(join(outDir, "interviews", `${item.id}-scorecard.json`), JSON.stringify(card, null, 2) + "\n");
        writeFileSync(join(outDir, "interviews", `${item.id}-report.md`), reportText);
        result.interview = { scores: card.scores.map((s) => `${s.criterion}=${s.score}`).join(", "), report: `interviews/${item.id}-report.md` };
        harness.log({ node: "interview", item: item.id, kind: t.candidate.kind, turns: t.turns.length, scores: result.interview.scores });
        result.humanDecisions.push(`${item.id}: read the ${t.candidate.kind} interview report and decide. The scores are decision support; nothing was passed or rejected.`);
      } catch (e) {
        if (!(e instanceof ConsentDeclined)) throw e;
        result.interview = { declined: true };
        harness.log({ node: "interview", item: item.id, consent: "declined", recorded: false });
        result.humanDecisions.push(`${item.id}: consent was declined, so nothing was recorded. A person follows up.`);
      }
    }

    // 3b. SCHEDULER (only where the playbook uses it): open slots from the calendars, then an invite DRAFT
    let inviteText = "";
    const invitePath = `drafts/${item.id}-invite.md`;
    if (pb.scheduler && pb.scheduler.labels.includes(tr.label)) {
      const req = item.interview as InterviewRequest | undefined;
      const sr = req && typeof req === "object" ? findSlots(calendars!, req, pb.scheduler.proposals ?? 3) : { slots: [], problems: ["the request has no interview details (candidate, panel, dates)"], checked: 0 };
      result.schedule = { slots: sr.slots, problems: sr.problems };
      if (sr.slots.length) {
        inviteText = draftInvite(calendars!, req!, sr.slots, item.id);
        result.schedule.invite = invitePath;
        result.humanDecisions.push(`${item.id}: a recruiter picks one of ${sr.slots.length} proposed times and approves the invite. Nothing was sent.`);
      } else {
        const why = sr.problems.length ? sr.problems.join("; ") : `no time where everyone is free in their working hours, ${req!.from} to ${req!.to}`;
        result.humanDecisions.push(`${item.id}: no slot proposed (${why}). A recruiter finds a time with the people involved.`);
      }
      harness.log({ node: "schedule", item: item.id, slots: sr.slots.map((x) => x.start), problems: sr.problems, checked: sr.checked });
    }

    // 4. HARNESS GATE: the playbook's calls for this label, plus anything the sender asked for (untrusted)
    const vars = { id: item.id, text: item.text, label: tr.label, route: tr.route, draft_path: draftPath, draft, report: reportText, invite_path: invitePath, invite: inviteText, from: String(item.from ?? "") };
    const template = pb.actions[tr.label] ?? [{ tool: "route_to_queue", args: { queue: "triage-humans", id: "{id}" } }];
    // A call that shares an interview report is skipped when there is no report (no candidate, or consent declined);
    // a call that carries an invite is skipped when no slot was found (there is nothing to send).
    const missing = (c: ToolCall): string | null => {
      const vals = Object.values(c.args ?? {});
      if (!reportText && vals.some((v) => v.includes("{report}"))) return "no interview report to share";
      if (!inviteText && vals.some((v) => v.includes("{invite}"))) return "no open slot, so no invite";
      return null;
    };
    for (const c of template) {
      const why = missing(c);
      if (!why) continue;
      harness.log({ node: "skipped", item: item.id, tool: c.tool, why });
      result.calls.push({ tool: c.tool, args: {}, decision: "skipped", why });
    }
    const planned: ToolCall[] = template.filter((c) => !missing(c))
      .map((c) => ({ tool: c.tool, args: Object.fromEntries(Object.entries(c.args ?? {}).map(([k, v]) => [k, fill(v, vars)])), why: c.why ?? `playbook action for "${tr.label}"` }));
    // A non-string tool name is renamed to an invalid tool, so no later check can be fooled by JS key coercion.
    const asked = (Array.isArray(item.requests) ? item.requests as ToolCall[] : []).map((c) => ({ ...c, tool: typeof c?.tool === "string" ? c.tool : `invalid-tool:${JSON.stringify(c?.tool)}`, why: "asked for inside the item (untrusted)" }));
    const fromItem: Set<ToolCall> = new Set(asked);
    for (const call of [...planned, ...asked]) {
      // An item may only save its own draft; it cannot overwrite another item's file.
      if (fromItem.has(call) && call.tool === "save_draft" && call.args?.path !== `drafts/${item.id}.md`) {
        const o = { tool: call.tool, args: call.args ?? {}, decision: "deny" as const, why: "item cannot overwrite another item's draft" };
        harness.log({ node: "tool_call", tool: o.tool, args: o.args, decision: "deny", why: o.why });
        result.calls.push(o);
        continue;
      }
      // An item cannot write its own invite: invites come only from the scheduler's draft, and a recruiter approves them.
      if (fromItem.has(call) && call.tool === "send_invite") {
        const o = { tool: call.tool, args: call.args ?? {}, decision: "deny" as const, why: "an item cannot send its own invite; only the scheduler's draft goes to a recruiter" };
        harness.log({ node: "tool_call", tool: o.tool, args: o.args, decision: "deny", why: o.why });
        result.calls.push(o);
        continue;
      }
      const o = await harness.run(item.id, call);
      result.calls.push(o);
      if (o.decision === "not-approved") result.humanDecisions.push(`${item.id}: ${call.tool} is waiting on a person's approval.`);
    }
    if (tr.review) result.humanDecisions.push(`${item.id}: triage sent this to a person (${tr.review}).`);
    items.push(result);

    // console line
    print(`${item.id.padEnd(8)} ${tr.label.padEnd(16)} ${tr.confidence.toFixed(2)} ${tr.priority} -> ${tr.route.padEnd(18)} ${tr.review ? "REVIEW: " + tr.review : "auto"}`);
    print(`         rag[${groups.join(",")}]: ${rag.grounded ? rag.text.slice(0, 96) + (rag.text.length > 96 ? "..." : "") : rag.text}`);
    if (result.interview) print(`         interview: ${"declined" in result.interview ? "consent declined, nothing recorded" : result.interview.scores + "  (decision support only)"}`);
    if (result.schedule) print(result.schedule.slots.length ? result.schedule.slots.map((x, n) => `         slot ${n + 1}: ${Object.values(x.local).join(" | ")}`).join("\n") : `         schedule: no slot proposed (${result.schedule.problems.length ? result.schedule.problems.join("; ") : "no time when everyone is free in their own working hours"})`);
    for (const c of result.calls) print(`         gate: ${c.tool.padEnd(24)} ${c.decision.padEnd(13)} ${(c.result ?? c.why ?? "").slice(0, 70)}`);
  }
  harness.log({ node: "result", items: items.length, calls: items.reduce((a, i) => a + i.calls.length, 0), ran: items.reduce((a, i) => a + i.calls.filter((c) => c.decision === "allow").length, 0) });
  harness.close();

  const summary = [
    `# ${pb.title}: run summary`, "", `> ${BANNER}`, "",
    `- Playbook: \`${pb.name}\`  - Model: ${opts.model.name}  - Approval gate: ${opts.approve}`, "",
    "| Item | Label | Conf. | Priority | Route | Review | Grounded | Gate decisions |", "|---|---|---|---|---|---|---|---|",
    ...items.map((i) => `| ${i.id} | ${i.triage.label} | ${i.triage.confidence.toFixed(2)} | ${i.triage.priority} | ${i.triage.route} | ${i.triage.review ?? "auto"} | ${i.rag.grounded ? "yes" : "I don't know"} | ${i.calls.map((c) => `${c.tool}: ${c.decision}`).join("; ")} |`),
    "", "## Waiting on a person", "", ...items.flatMap((i) => i.humanDecisions).map((d) => `- ${d}`), "",
  ].join("\n");
  writeFileSync(join(outDir, "summary.md"), summary);
  writeFileSync(join(outDir, "results.json"), JSON.stringify(items, null, 2) + "\n");
  const counts = (d: string) => items.reduce((a, i) => a + i.calls.filter((c) => c.decision === d).length, 0);
  print(`\n${items.length} items | gate: ${counts("allow")} allowed, ${counts("not-approved")} not approved, ${counts("deny")} denied, ${counts("error")} errors | ${items.flatMap((i) => i.humanDecisions).length} decisions waiting on a person`);
  print(`Wrote ${outDir}/summary.md, results.json, audit.jsonl`);
  print(BANNER);
  return { playbook: pb.name, approve: opts.approve, outDir, model: opts.model.name, items };
}
