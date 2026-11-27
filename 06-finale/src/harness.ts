// Stage 3: the harness. A TypeScript port of Build Day drop 3 (harness.py). License: MIT.
//   proposed call -> permission check -> human approval gate -> sandboxed tool -> audit log
// Same rules as drop 3: the harness, not the model, decides. Unknown tools are denied. Default
// approval is "deny" (every "ask" is refused). Every node writes to the audit log.
// Changes from drop 3: the policy is per tool and comes from the playbook (anything not listed is
// denied); the tools are local stubs that only write files inside this run's outputs folder.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, relative, resolve } from "node:path";
import type { Decision, ToolCall } from "./playbook.js";

export type Risk = "read" | "write" | "privileged" | "external" | "destructive";
export type ApproveMode = "deny" | "yes" | "cli";

export interface Sandbox { root: string }
type ToolFn = (sb: Sandbox, args: Record<string, string>) => string;

function inside(sb: Sandbox, p: string): string {
  const root = resolve(sb.root);
  const path = resolve(root, p);
  const rel = relative(root, path);
  if (rel.startsWith("..") || resolve(rel) === rel) throw new SandboxEscape(`${p} is outside the sandbox`);
  return path;
}
export class SandboxEscape extends Error {}

function writeIn(sb: Sandbox, p: string, content: string, append = false): string {
  const path = inside(sb, p);
  mkdirSync(dirname(path), { recursive: true });
  if (append) appendFileSync(path, content); else writeFileSync(path, content);
  return p;
}
const req = (args: Record<string, string>, k: string) => {
  const v = args[k];
  if (typeof v !== "string") throw new Error(`missing argument "${k}"`);
  return v;
};

/** The tool registry. Each tool declares its risk. All are stubs: nothing leaves this folder. */
export const TOOLS: Record<string, { risk: Risk; fn: ToolFn; about: string }> = {
  route_to_queue: { risk: "write", about: "append the item to a local queue file",
    fn: (sb, a) => `queued in ${writeIn(sb, `queues/${req(a, "queue")}.jsonl`, JSON.stringify({ id: req(a, "id"), note: a.note ?? "" }) + "\n", true)}` },
  save_draft: { risk: "write", about: "save a draft reply or post for a person to read",
    fn: (sb, a) => { const p = req(a, "path"); if (!/^drafts\/[A-Za-z0-9._-]+\.md$/.test(p)) throw new SandboxEscape(`${p}: save_draft only writes drafts/<name>.md`); return `draft saved to ${writeIn(sb, p, req(a, "content"))}`; } },
  share_scorecard: { risk: "write", about: "put an interview report in the reviewer's local folder",
    fn: (sb, a) => `report shared to ${writeIn(sb, `review/${req(a, "id")}.md`, req(a, "content"))}` },
  send_reply: { risk: "external", about: "STUB: records the reply locally; sends nothing",
    fn: (sb, a) => `STUB, nothing sent. Recorded in ${writeIn(sb, "outbox-stub.jsonl", JSON.stringify({ id: req(a, "id"), to: a.to ?? "", body: req(a, "content") }) + "\n", true)}` },
  grant_access: { risk: "privileged", about: "STUB: records an access change locally; touches no directory",
    fn: (sb, a) => `STUB, no directory touched. Recorded in ${writeIn(sb, "access-changes-stub.jsonl", JSON.stringify({ id: req(a, "id"), change: req(a, "change") }) + "\n", true)}` },
  publish: { risk: "external", about: "STUB: a no-op. Nothing can be published from this repo",
    fn: (sb, a) => `STUB, nothing was published. Recorded in ${writeIn(sb, "publish-stub.jsonl", JSON.stringify({ id: req(a, "id"), channel: a.channel ?? "", would_publish: req(a, "path") }) + "\n", true)}` },
  send_invite: { risk: "external", about: "STUB: records an interview invite locally; sends nothing, books nothing",
    fn: (sb, a) => `STUB, nothing sent. Recorded in ${writeIn(sb, "invites-stub.jsonl", JSON.stringify({ id: req(a, "id"), to: a.to ?? "", invite: req(a, "content") }) + "\n", true)}` },
  update_candidate_status: { risk: "privileged", about: "STUB: would change a candidate's status. Recruiting denies it: people decide",
    fn: (sb, a) => `STUB. Recorded in ${writeIn(sb, "status-stub.jsonl", JSON.stringify(a) + "\n", true)}` },
  delete_record: { risk: "destructive", about: "STUB: would delete a record",
    fn: (_sb, a) => `STUB, nothing deleted (${req(a, "id")})` },
};

/** What a person sees at the y/n gate. For a tool that would reach outside (external), the whole content is shown, never a preview. */
/** Control (C0, C1), bidi and zero-width characters, which can move a terminal cursor or reorder what a person reads. */
const UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
/** Show each unsafe character as \u{..} so untrusted text cannot move the cursor or hide itself. Newlines are kept. */
export const escapeForTerminal = (s: string): string => s.replace(UNSAFE, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);

export function approvalPrompt(call: ToolCall): string {
  const args = call.args ?? {};
  const tool = escapeForTerminal(String(call.tool));
  if (TOOLS[call.tool]?.risk === "external") {
    const { content, ...rest } = args;
    // Untrusted text reaches a terminal here: escape it, and prefix every line with "| " so content cannot forge the end marker.
    const shown = escapeForTerminal(String(content ?? "")).split("\n").map((l) => `| ${l}`).join("\n");
    return `\nAPPROVE ${tool}(${escapeForTerminal(JSON.stringify(rest))})? Full content below.\n----- begin content -----\n${shown}\n----- end content -----\n[y/N] `;
  }
  return `\nAPPROVE ${tool}(${escapeForTerminal(JSON.stringify(args).slice(0, 160))})? [y/N] `;
}

export interface GateOutcome { tool: string; args: Record<string, string>; decision: "allow" | "deny" | "not-approved" | "error" | "skipped"; result?: string; why?: string }

export class Harness {
  private rl?: ReturnType<typeof createInterface>;
  constructor(private policy: Record<string, Decision>, private sb: Sandbox, private approve: ApproveMode, private auditFile: string) {
    mkdirSync(dirname(auditFile), { recursive: true });
  }

  log(event: Record<string, unknown>): void {
    appendFileSync(this.auditFile, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
  }

  /** Policy lookup. Unknown tools, and tools the playbook does not list, are denied. */
  permission(call: ToolCall): Decision {
    // typeof + own-property checks: a non-string tool (["send_invite"]) or a prototype key ("constructor") is denied.
    if (typeof call.tool !== "string" || !Object.hasOwn(TOOLS, call.tool)) return "deny";
    return Object.hasOwn(this.policy, call.tool) ? this.policy[call.tool]! : "deny";
  }

  private async gate(call: ToolCall): Promise<boolean> {
    if (this.approve === "yes") return true; // a person approved this run up front (--approve)
    if (this.approve === "cli") {
      this.rl ??= createInterface({ input: process.stdin, output: process.stdout });
      return (await this.rl.question(approvalPrompt(call))).trim().toLowerCase() === "y";
    }
    return false;
  }

  async run(itemId: string, call: ToolCall): Promise<GateOutcome> {
    const args = call.args ?? {};
    let decision: GateOutcome["decision"];
    const policy = this.permission(call);
    if (policy === "ask") decision = (await this.gate(call)) ? "allow" : "not-approved";
    else decision = policy;
    const out: GateOutcome = { tool: call.tool, args, decision, ...(call.why ? { why: call.why } : {}) };
    if (decision === "allow") {
      try { out.result = TOOLS[call.tool]!.fn(this.sb, args); } catch (e) {
        if (e instanceof SandboxEscape) { out.decision = "deny"; out.result = e.message; } // an escape is a denial, not a bug
        else { out.decision = "error"; out.result = `${(e as Error).name}: ${(e as Error).message}`; }
      }
    }
    this.log({ node: "tool_call", item: itemId, tool: call.tool, policy, decision: out.decision, approver: policy === "ask" ? this.approve : undefined,
      args_preview: JSON.stringify(args).slice(0, 120), result_preview: (out.result ?? "").slice(0, 120) });
    return out;
  }

  close(): void { this.rl?.close(); }
}
