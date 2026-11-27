import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPlaybook, loadPlaybook, PlaybookError, type Playbook } from "../src/playbook.js";
import { triage } from "../src/triage.js";
import { answer, buildIndex, retrieve, IDK } from "../src/rag.js";
import { Harness } from "../src/harness.js";
import { modelFromEnv, StandInModel, type ChatModel } from "../src/model.js";
import { runPlaybook } from "../src/system.js";
import { matchCriterion, scoreTranscript } from "../src/interviewer/score.js";
import { loadRubric } from "../src/interviewer/rubric.js";
import type { Transcript, Turn } from "../src/interviewer/types.js";
import type { Criterion } from "../src/interviewer/rubric.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = join(ROOT, "test/fixtures");
const standin = new StandInModel();
const tmp = () => mkdtempSync(join(tmpdir(), "bd6-"));
const PLAYBOOKS = ["helpdesk", "recruiting", "marketing", "scheduling"];

// ---------- the ports match the Python drops ----------
test("triage port matches drop 1 (triage.py) on drop 1's own samples", async () => {
  const expected = JSON.parse(readFileSync(join(FIX, "parity/expected-from-python.json"), "utf8")) as { triage: { id: string; queue: string; label: string; confidence: number; priority: string; route: string; review: string | null }[] };
  const queues = JSON.parse(readFileSync(join(FIX, "parity/drop1-queues.json"), "utf8")) as Record<string, { labels: Record<string, string[]>; routes: Record<string, string>; urgent_terms: string[]; always_human_labels?: string[]; always_human?: boolean }>;
  const samples = readFileSync(join(FIX, "parity/drop1-samples.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; queue: string; text: string });
  for (const s of samples) {
    const q = queues[s.queue]!;
    const pb = { triage: { ...q, always_human_labels: q.always_human_labels ?? [], review_below: 0.7 } } as unknown as Playbook;
    const got = await triage(pb, { id: s.id, text: s.text }, standin);
    const want = expected.triage.find((e) => e.id === s.id)!;
    assert.equal(got.label, want.label, s.id);
    assert.ok(Math.abs(got.confidence - want.confidence) < 1e-9, s.id);
    assert.equal(got.priority, want.priority, s.id);
    assert.equal(got.route, want.route, s.id);
    assert.equal(got.review?.replace("playbook is", "queue is") ?? null, want.review, s.id);
  }
});

test("RAG port matches drop 2 (rag.py): same hits, same scores, same answers, permission filter first", async () => {
  const expected = JSON.parse(readFileSync(join(FIX, "parity/expected-from-python.json"), "utf8")) as { rag: { q: string; groups: string[]; hits: [number, string][]; answer: string }[] };
  const index = buildIndex(join(FIX, "parity/drop2-docs"));
  for (const e of expected.rag) {
    const hits = retrieve(index, e.q, e.groups);
    assert.deepEqual(hits.map((h) => [h.score, h.chunk.source]), e.hits, e.q);
    assert.equal((await answer(e.q, hits, standin)).text, e.answer, e.q);
  }
});

test("RAG: a doc the reader's groups cannot see never reaches ranking, and the answer is I don't know", async () => {
  const index = buildIndex(join(ROOT, "playbooks/helpdesk/docs"));
  const q = "Where is the break-glass admin login procedure for the domain?";
  assert.ok(retrieve(index, q, ["everyone"]).every((h) => h.chunk.source !== "break-glass.md"));
  assert.equal((await answer(q, retrieve(index, q, ["everyone"]), standin)).text, IDK);
  assert.equal(retrieve(index, q, ["security"])[0]?.chunk.source, "break-glass.md");
});

// ---------- harness ----------
test("harness: default deny, unknown and unlisted tools denied, ask needs a person, sandbox escape denied", async () => {
  const dir = tmp();
  const h = new Harness({ save_draft: "allow", grant_access: "ask", delete_record: "deny" }, { root: dir }, "deny", join(dir, "audit.jsonl"));
  assert.equal((await h.run("x", { tool: "run_shell", args: { cmd: "rm -rf /" } })).decision, "deny");
  assert.equal((await h.run("x", { tool: "publish", args: { id: "x", path: "a" } })).decision, "deny", "registered but not listed in the policy");
  assert.equal((await h.run("x", { tool: "delete_record", args: { id: "x" } })).decision, "deny");
  assert.equal((await h.run("x", { tool: "grant_access", args: { id: "x", change: "admin" } })).decision, "not-approved");
  assert.equal((await h.run("x", { tool: "save_draft", args: { path: "../../escape.md", content: "x" } })).decision, "deny");
  assert.equal((await h.run("x", { tool: "save_draft", args: { path: "drafts/ok.md", content: "x" } })).decision, "allow");
  assert.equal(existsSync(join(dir, "access-changes-stub.jsonl")), false, "not-approved means the tool never ran");
  const audit = readFileSync(join(dir, "audit.jsonl"), "utf8").trim().split("\n");
  assert.equal(audit.length, 6, "every call is in the audit log");
  const approved = new Harness({ grant_access: "ask" }, { root: dir }, "yes", join(dir, "audit2.jsonl"));
  assert.equal((await approved.run("x", { tool: "grant_access", args: { id: "x", change: "read" } })).decision, "allow");
  assert.match(readFileSync(join(dir, "access-changes-stub.jsonl"), "utf8"), /"change":"read"/);
});

// ---------- playbooks: config, not code ----------
test("schema: the shipped playbooks pass", () => {
  for (const p of PLAYBOOKS) assert.equal(loadPlaybook(p).name, p);
});

test("schema: a malformed playbook fails fast and lists every problem", () => {
  assert.throws(() => loadPlaybook(join(FIX, "bad-playbook")), (e: unknown) => {
    assert.ok(e instanceof PlaybookError);
    const all = e.problems.join("\n");
    for (const want of [/inbox file "inbox.jsonl" not found/, /label "other" needs a non-empty list/, /"other" has no route/, /route "ghost" is not a triage label/,
      /unknown label "missing"/, /rag docs folder "no-such-folder" not found/, /default_groups/, /"rag.mode"/, /tool "publish" is external; it can be "ask" or "deny", never "allow"/,
      /unknown tool "teleport"/, /"save_draft" must be allow, ask or deny/, /actions has unknown triage label "ghost"/, /proposes "send_reply", which harness.policy does not mention/])
      assert.match(all, want);
    return true;
  });
  assert.deepEqual(checkPlaybook([], "."), ["top level must be a JSON object"]);
});

test("schema: the CLI exits non-zero before doing any work on a malformed playbook", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "dist/src/cli.js"), "--playbook", join(FIX, "bad-playbook"), "--out", tmp()], { encoding: "utf8" });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /is malformed/);
});

test("schema: publish can never be set to allow in any shipped playbook", () => {
  for (const p of PLAYBOOKS) assert.notEqual(loadPlaybook(p).harness.policy.publish, "allow");
});

// ---------- end to end ----------
for (const p of PLAYBOOKS) {
  test(`end to end (${p}): denied run lets nothing past an 'ask', approved run lets asks through, deny stays deny`, async () => {
    const out = tmp();
    const pb = loadPlaybook(p);
    const denied = await runPlaybook(pb, { model: standin, approve: "deny", outRoot: out });
    const approved = await runPlaybook(pb, { model: standin, approve: "yes", outRoot: out });
    const calls = (r: typeof denied) => r.items.flatMap((i) => i.calls);
    // "skipped" (nothing to share or send) and "deny" (an item-level rule refused it first) never reached the tool either.
    for (const c of calls(denied)) if (pb.harness.policy[c.tool] === "ask") assert.ok(["not-approved", "skipped", "deny"].includes(c.decision), `${p} ${c.tool}: ${c.decision}`);
    assert.ok(calls(denied).some((c) => pb.harness.policy[c.tool] === "ask" && c.decision === "not-approved"), `${p}: the denied run should refuse at least one ask`);
    assert.ok(calls(approved).some((c) => pb.harness.policy[c.tool] === "ask" && c.decision === "allow"), `${p}: approved run should let an ask through`);
    for (const c of [...calls(denied), ...calls(approved)]) if ((pb.harness.policy[c.tool] ?? "deny") === "deny") assert.notEqual(c.decision, "allow", `${p} ${c.tool}`);
    for (const r of [denied, approved]) {
      assert.ok(existsSync(join(r.outDir, "audit.jsonl")) && existsSync(join(r.outDir, "summary.md")));
      assert.ok(r.items.every((i) => i.triage.label && i.rag.text), "every item was triaged and answered or refused");
      assert.ok(r.items.some((i) => !i.rag.grounded), `${p}: at least one honest "I don't know"`);
    }
  });
}

test("recruiting: a person makes every decision; status changes are denied even in the approved run", async () => {
  const out = tmp();
  const r = await runPlaybook(loadPlaybook("recruiting"), { model: standin, approve: "yes", outRoot: out });
  assert.ok(r.items.every((i) => i.triage.review), "every item goes to a person");
  const status = r.items.flatMap((i) => i.calls).filter((c) => c.tool === "update_candidate_status");
  assert.ok(status.length > 0 && status.every((c) => c.decision === "deny"));
  const kinds = r.items.filter((i) => i.interview && "scores" in i.interview).map((i) => JSON.parse(readFileSync(join(r.outDir, `interviews/${i.id}-transcript.json`), "utf8")).candidate.kind as string);
  assert.deepEqual([...new Set(kinds)].sort(), ["bot", "human", "team"]);
});

test("recruiting: declined consent records nothing for that candidate", async () => {
  const out = tmp();
  const r = await runPlaybook(loadPlaybook("recruiting"), { model: standin, approve: "deny", outRoot: out });
  const declined = r.items.find((i) => i.id === "R-202")!;
  assert.deepEqual(declined.interview, { declined: true });
  assert.ok(!readdirSync(join(r.outDir, "interviews")).some((f) => f.startsWith("R-202")));
  assert.equal(declined.calls.find((c) => c.tool === "share_scorecard")?.decision, "skipped");
});

test("interview reports: banner, evidence quotes copied verbatim from the transcript, no verdict", async () => {
  const out = tmp();
  for (const p of PLAYBOOKS) {
    const r = await runPlaybook(loadPlaybook(p), { model: standin, approve: "deny", outRoot: out });
    for (const i of r.items.filter((x) => x.interview && "scores" in x.interview)) {
      const t = JSON.parse(readFileSync(join(r.outDir, `interviews/${i.id}-transcript.json`), "utf8")) as Transcript;
      const card = JSON.parse(readFileSync(join(r.outDir, `interviews/${i.id}-scorecard.json`), "utf8")) as { scores: { evidence: { quote: string } }[] };
      for (const s of card.scores) assert.ok(t.turns.some((tu) => tu.text.includes(s.evidence.quote)), `${i.id}: ${s.evidence.quote}`);
      const md = readFileSync(join(r.outDir, `interviews/${i.id}-report.md`), "utf8");
      assert.match(md, /Decision support only\. A human makes the call\. No auto-reject\./);
      assert.doesNotMatch(md, /\b(pass|fail|reject(ed)?|hire|no hire)\b\s*(:|verdict)/i);
    }
  }
});

test("marketing: publish is a stub; even approved, nothing leaves the outputs folder", async () => {
  const out = tmp();
  const r = await runPlaybook(loadPlaybook("marketing"), { model: standin, approve: "yes", outRoot: out });
  const pubs = r.items.flatMap((i) => i.calls).filter((c) => c.tool === "publish" && c.decision === "allow");
  assert.ok(pubs.length > 0 && pubs.every((c) => /^STUB, nothing was published/.test(c.result ?? "")));
  assert.equal(r.items.flatMap((i) => i.calls).find((c) => c.tool === "delete_record")?.decision, "deny");
});

// ---------- the interviewer rules re-synced from drop 4 ----------
test("model scorer: a short quote is rejected and the scorer label stays honest", async () => {
  const fake: ChatModel = { name: "fake", standin: false, complete: () => Promise.resolve('{"score":4,"evidence":"Roll back."}') };
  const rubric = loadRubric(join(ROOT, "playbooks/recruiting/rubric.json"));
  const r = await runPlaybook(loadPlaybook("recruiting"), { model: standin, approve: "deny", outRoot: tmp() });
  const t = JSON.parse(readFileSync(join(r.outDir, "interviews/R-201-transcript.json"), "utf8")) as Transcript;
  const card = await scoreTranscript(t, rubric, fake);
  assert.ok(card.scores.every((s) => s.note?.includes("fell back") || s.note?.includes("rejected")));
  assert.match(card.scorer, /fell back/);
});

// ---------- model switch ----------
test("env switch: standin by default, clear errors when a real provider is half-configured", () => {
  assert.equal(modelFromEnv({}).standin, true);
  assert.throws(() => modelFromEnv({ MODEL_PROVIDER: "ollama" }), /needs MODEL/);
  assert.throws(() => modelFromEnv({ MODEL_PROVIDER: "openai", MODEL: "m" }), /needs OPENAI_API_KEY/);
  assert.throws(() => modelFromEnv({ MODEL_PROVIDER: "other", MODEL: "m" }), /Unknown MODEL_PROVIDER/);
});

test("real-model path: Ollama and OpenAI-compatible wire formats drive triage, against a local fake server", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => {
      seen.push(`${req.url} ${req.headers.authorization ?? "-"}`);
      const content = '{"label": "network", "confidence": 0.9}';
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.url === "/api/chat" ? { message: { content } } : { choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  try {
    const pb = loadPlaybook("helpdesk");
    for (const env of [{ MODEL_PROVIDER: "ollama", MODEL: "m", OLLAMA_HOST: `http://127.0.0.1:${port}` },
      { MODEL_PROVIDER: "openai", MODEL: "m", OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`, OPENAI_API_KEY: "test-key" }]) {
      const r = await triage(pb, { id: "t", text: "printer jam" }, modelFromEnv(env));
      assert.equal(r.label, "network");
      assert.equal(r.confidence, 0.9);
    }
    assert.deepEqual(seen, ["/api/chat -", "/v1/chat/completions Bearer test-key"]);
  } finally { server.close(); }
});

// ---------- copy rules ----------
test("publishable files never use the banned word", () => {
  const banned = new RegExp("\\bro" + "les?\\b", "i");
  const skip = new Set(["node_modules", "dist", "outputs"]);
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return skip.has(e.name) || p === join(FIX, "parity") ? [] : walk(p);
    return e.isFile() && /\.(md|json|jsonl|ts)$/.test(e.name) ? [p] : [];
  });
  const files = walk(ROOT);
  assert.ok(files.length > 0);
  // "role" alone is the chat API field name ({ role: "system" }), so only the plural is checked.
  const plural = new RegExp("\\bro" + "les\\b", "i");
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), plural, f);
  assert.ok(banned.test("ro" + "les"));
});

test("triage: always_human_terms send an item to a person even when a model picks a harmless label", async () => {
  const wrong: ChatModel = { name: "fake", standin: false, complete: () => Promise.resolve('{"label": "software", "confidence": 0.99}') };
  const r = await triage(loadPlaybook("helpdesk"), { id: "t", text: "Please give me admin access to the payroll share" }, wrong);
  assert.equal(r.label, "software");
  assert.match(r.review ?? "", /always gets a person/);
});

test("drop 4's seconds/milliseconds cap is opted into by the rubric (capUnlessUnitFlaw), never inherited by task id", async () => {
  const r = await runPlaybook(loadPlaybook("helpdesk"), { model: standin, approve: "deny", outRoot: tmp() });
  const card = JSON.parse(readFileSync(join(r.outDir, "interviews/HD-106-scorecard.json"), "utf8")) as { scores: { criterion: string; score: number; note?: string }[] };
  const j = card.scores.find((s) => s.criterion === "judge_output")!;
  assert.equal(j.score, 3);
  assert.doesNotMatch(j.note ?? "", /Capped/);
  // A copy of the recruiting rubric: same T2 criterion, with and without the flag. Answer hits every signal but not the unit flaw.
  const rub = loadRubric(join(ROOT, "playbooks/recruiting/rubric.json"));
  const t2 = rub.criteria.find((c) => c.taskId === "T2")!;
  assert.equal(t2.capUnlessUnitFlaw, true, "recruiting's planted-bug criterion opts in");
  const turns: Turn[] = [{ seq: 1, taskId: "T2", speaker: "p", speakerKind: "human", text: "I would not approve it, it deletes almost everything. The fix should be a smaller window, and I'd add a dry run first." }];
  assert.equal(matchCriterion(t2, turns).score, 2);
  const copy: Criterion = { ...t2, capUnlessUnitFlaw: undefined };
  assert.equal(matchCriterion(copy, turns).score, 3, "a copied rubric without the flag is not capped (3 of 4 signals)");
  const renumbered: Criterion = { ...t2, taskId: "T3" };
  assert.equal(matchCriterion(renumbered, turns.map((x) => ({ ...x, taskId: "T3" }))).score, 2, "renumbering the task keeps the cap");
});

// ---------- untrusted inbox input (reviewer B1, M1, M2, L4) ----------
const copyPlaybook = (name: string, inbox: string): string => {
  const dir = join(tmp(), name);
  cpSync(join(ROOT, "playbooks", name), dir, { recursive: true });
  writeFileSync(join(dir, "inbox.jsonl"), inbox + "\n");
  return dir;
};

test("security: an inbox id like ../../.. is rejected before anything is written", async () => {
  const escape = join(tmp(), "bd6_escape");
  const dir = copyPlaybook("recruiting", JSON.stringify({ id: `../../../../../../..${escape}`, text: "aws terraform", candidate: { kind: "bot", id: "b" } }));
  assert.throws(() => loadPlaybook(dir), (e: unknown) => e instanceof PlaybookError && /"id" must be letters/.test(e.problems.join()));
  // Even if the loader were skipped, the pipeline refuses the item.
  const good = loadPlaybook("recruiting");
  const out = tmp();
  await assert.rejects(runPlaybook({ ...good, dir }, { model: standin, approve: "deny", outRoot: out }), PlaybookError);
  assert.ok(!readdirSync(dirname(escape)).some((f) => f.startsWith("bd6_escape")), "nothing written at the escape target");
});

test("security: an attachment outside the playbook folder is rejected", async () => {
  const canary = join(tmp(), "canary.md");
  writeFileSync(canary, "CANARY-SECRET");
  const dir = copyPlaybook("recruiting", JSON.stringify({ id: "R-299", text: "resume", attachment: canary }));
  assert.throws(() => loadPlaybook(dir), (e: unknown) => e instanceof PlaybookError && /attachment must be inside the playbook folder/.test(e.problems.join()));
  await assert.rejects(runPlaybook({ ...loadPlaybook("recruiting"), dir }, { model: standin, approve: "yes", outRoot: tmp() }), /attachment must be inside/);
});

test("security: save_draft cannot overwrite audit.jsonl; the audit log keeps its start line", async () => {
  const dir = copyPlaybook("marketing", JSON.stringify({ id: "M-399", text: "blog article", requests: [{ tool: "save_draft", args: { path: "audit.jsonl", content: "{\"note\":\"audit wiped\"}\n" } }] }));
  const r = await runPlaybook(loadPlaybook(dir), { model: standin, approve: "yes", outRoot: tmp() });
  const asked = r.items[0]!.calls.find((c) => c.args.path === "audit.jsonl")!;
  assert.equal(asked.decision, "deny");
  const audit = readFileSync(join(r.outDir, "audit.jsonl"), "utf8");
  assert.match(audit.split("\n")[0]!, /"node":"start"/);
  const lines = audit.trim().split("\n");
  assert.ok(lines.length > 3 && lines.every((l) => /^\{"ts":/.test(l)), "every audit line is a harness event; none was overwritten");
});

test("schema: playbook paths outside the playbook folder are rejected", () => {
  const dir = copyPlaybook("helpdesk", "");
  const pb = JSON.parse(readFileSync(join(dir, "playbook.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dir, "playbook.json"), JSON.stringify({ ...pb, inbox: "../../../../../etc/hostname" }));
  assert.throws(() => loadPlaybook(dir), (e: unknown) => e instanceof PlaybookError && /"inbox" must be inside the playbook folder/.test(e.problems.join()));
});

test("schema: a malformed inbox line exits 3 cleanly, with no stack trace", () => {
  const dir = copyPlaybook("helpdesk", '{"id": "HD-1", "text": "vpn"}\n{not json');
  const r = spawnSync(process.execPath, [join(ROOT, "dist/src/cli.js"), "--playbook", dir, "--out", tmp()], { encoding: "utf8" });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /inbox line 2 is not valid JSON/);
  assert.doesNotMatch(r.stderr, /\bat .+\.js:\d+/);
});

test("security: an item cannot overwrite another item's draft via save_draft", async () => {
  const inbox = [
    JSON.stringify({ id: "M-301", text: "blog article" }),
    JSON.stringify({ id: "M-399", text: "blog article", requests: [{ tool: "save_draft", args: { path: "drafts/M-301.md", content: "OVERWRITE" } }] }),
  ].join("\n");
  const dir = copyPlaybook("marketing", inbox);
  const r = await runPlaybook(loadPlaybook(dir), { model: standin, approve: "yes", outRoot: tmp() });
  const asked = r.items.find((i) => i.id === "M-399")!.calls.find((c) => c.args.path === "drafts/M-301.md")!;
  assert.equal(asked.decision, "deny");
  assert.match(asked.why ?? "", /another item's draft/);
  const draft = readFileSync(join(r.outDir, "drafts/M-301.md"), "utf8");
  assert.doesNotMatch(draft, /OVERWRITE/);
});

test("schema: a missing attachment exits 3 cleanly, with no stack trace", () => {
  const dir = copyPlaybook("recruiting", JSON.stringify({ id: "R-299", text: "resume", attachment: "resumes/does-not-exist.md" }));
  const r = spawnSync(process.execPath, [join(ROOT, "dist/src/cli.js"), "--playbook", dir, "--out", tmp()], { encoding: "utf8" });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /attachment not found/);
  assert.doesNotMatch(r.stderr, /\bat .+\.js:\d+/);
});

test("security: a symlink attachment that points outside the playbook folder is rejected", async (t) => {
  const canary = join(tmp(), "canary.md");
  writeFileSync(canary, "CANARY-SECRET");
  const dir = copyPlaybook("recruiting", JSON.stringify({ id: "R-298", text: "resume", attachment: "resumes/sneak.md" }));
  mkdirSync(join(dir, "resumes"), { recursive: true });
  try { symlinkSync(canary, join(dir, "resumes", "sneak.md")); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
    t.skip("this OS user cannot create symlinks (EPERM; on Windows enable Developer Mode or run as admin)");
    return;
  }
  assert.throws(() => loadPlaybook(dir), (e: unknown) => e instanceof PlaybookError && /attachment must be inside the playbook folder/.test(e.problems.join()));
  await assert.rejects(runPlaybook({ ...loadPlaybook("recruiting"), dir }, { model: standin, approve: "yes", outRoot: tmp() }), /attachment must be inside/);
});


// ---------- portability (regression guard for the Windows / space-in-path fix) ----------
const portableCopy = () => {
  const where = join(mkdtempSync(join(tmpdir(), "bd6 sp%20ace #é-")), "finale copy");
  for (const d of ["dist", "playbooks", "package.json"]) cpSync(join(ROOT, d), join(where, d), { recursive: true });
  return where;
};

test("portability: the CLI runs and finds its playbooks from a path with spaces, %, # and unicode", () => {
  const where = portableCopy();
  const r = spawnSync(process.execPath, [join(where, "dist/src/cli.js"), "--check", "helpdesk"], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK: playbook "helpdesk" passed/);
});

test("portability: the CLI runs when launched through a symlink", (t) => {
  const where = portableCopy();
  const link = join(mkdtempSync(join(tmpdir(), "bd6 link-")), "finale cli.js");
  try { symlinkSync(join(where, "dist/src/cli.js"), link); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
    t.skip("this OS user cannot create symlinks (EPERM; on Windows enable Developer Mode or run as admin)");
    return;
  }
  const r = spawnSync(process.execPath, [link, "--check", "helpdesk"], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK: playbook "helpdesk" passed/);
});
