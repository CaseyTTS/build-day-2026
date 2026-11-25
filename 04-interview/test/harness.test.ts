// node:test suite. Runs fully offline; the "real model" tests use a local fake HTTP server. License: MIT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { BotCandidate, HumanCandidate, TeamCandidate, scriptedLines } from "../src/candidates.js";
import { BANNER, CONSENT_NOTICE, ConsentDeclined } from "../src/consent.js";
import { runInterview } from "../src/interview.js";
import { OllamaModel, OpenAICompatibleModel, StandInModel, modelFromEnv } from "../src/model.js";
import { renderReport } from "../src/report.js";
import { loadRubric } from "../src/rubric.js";
import { matchCriterion, scoreTranscript } from "../src/score.js";
import { TASKS } from "../src/tasks.js";
import { SCRIPTED_HUMAN } from "../src/cli.js";

const rubric = loadRubric();
const bot = () => new BotCandidate("standin-bot", new StandInModel());
const team = () => new TeamCandidate("pair-1", [new HumanCandidate("engineer-1", scriptedLines(SCRIPTED_HUMAN)), bot()]);

test("3-5 tasks cover connect, judge and own, and each maps to one rubric criterion", () => {
  assert.ok(TASKS.length >= 3 && TASKS.length <= 5);
  for (const c of ["connect_to_work", "judge_output", "own_the_result"]) assert.ok(TASKS.some((t) => t.criterion === c));
  for (const t of TASKS) assert.equal(rubric.criteria.find((c) => c.taskId === t.id)?.id, t.criterion);
});

test("one rubric applies to every candidate type", async () => {
  assert.deepEqual(rubric.appliesTo, ["human", "bot", "team"]);
  const human = new HumanCandidate("h", scriptedLines(SCRIPTED_HUMAN));
  const ids = await Promise.all([bot(), team(), human].map(async (c) => (await runInterview(c, rubric)).rubric.id));
  assert.deepEqual(ids, [rubric.id, rubric.id, rubric.id]);
});

test("stand-in bot run is deterministic and every score has a verbatim evidence quote", async () => {
  const a = await scoreTranscript(await runInterview(bot(), rubric), rubric);
  const b = await scoreTranscript(await runInterview(bot(), rubric), rubric);
  assert.deepEqual(a.scores, b.scores);
  const t = await runInterview(bot(), rubric);
  for (const s of a.scores) {
    assert.ok([1, 2, 3, 4].includes(s.score));
    assert.ok(t.turns.some((turn) => turn.text.includes(s.evidence.quote)), `quote not in transcript: ${s.evidence.quote}`);
  }
  assert.deepEqual(a.scores.map((s) => s.score), [3, 4, 4, 3]);
});

test("the planted flaw (seconds vs milliseconds) is caught by the stand-in bot", async () => {
  const card = await scoreTranscript(await runInterview(bot(), rubric), rubric);
  const judge = card.scores.find((s) => s.criterion === "judge_output")!;
  assert.match(judge.evidence.quote + judge.signalsFound.join(), /milliseconds|units/);
});

test("a reply that approves the PR without naming the unit flaw scores at most 2", () => {
  const c = rubric.criteria.find((x) => x.id === "judge_output")!;
  const turns = [{
    seq: 1, taskId: "T2", speaker: "bot", speakerKind: "bot" as const,
    text: "I would approve the pull request to delete audit records older than 30 days. The tests pass on an empty fixture, so the functionality is correctly implemented. The fix is to ensure that the Day constant is correctly defined and that the cutoff uses the Date.now() method, which returns the current date and time in milliseconds.",
  }];
  const s = matchCriterion(c, turns);
  assert.ok(s.score <= 2, `expected at most 2, got ${s.score} (signals: ${s.signalsFound.join(", ")})`);
});

test("the unit-flaw cap follows the rubric flag, not a task id", () => {
  const judge = rubric.criteria.find((x) => x.id === "judge_output")!;
  assert.equal(judge.capUnlessUnitFlaw, true);
  assert.deepEqual(rubric.criteria.filter((c) => c.capUnlessUnitFlaw).map((c) => c.id), ["judge_output"]);
  const text = "I would approve the pull request to delete audit records older than 30 days. The tests pass on an empty fixture, so the functionality is correctly implemented. The fix is to ensure that the Day constant is correctly defined and that the cutoff uses the Date.now() method, which returns the current date and time in milliseconds.";
  const turn = (taskId: string, t = text) => [{ seq: 1, taskId, speaker: "bot", speakerKind: "bot" as const, text: t }];
  // Renumbered: the judge task is now T1. The cap must move with it.
  assert.ok(matchCriterion({ ...judge, taskId: "T1" }, turn("T1")).score <= 2);
  // Another criterion moved to T2 must not inherit the cap.
  const connect = rubric.criteria.find((x) => x.id === "connect_to_work")!;
  const goal = "The goal is that a full export finishes without timing out. I'd ask how big the biggest accounts are. First step: reproduce it on staging and measure a baseline.";
  const moved = matchCriterion({ ...connect, taskId: "T2" }, turn("T2", goal));
  assert.ok(moved.score >= 3 && moved.note === undefined, `connect_to_work at T2 was capped: ${moved.score} ${moved.note}`);
  // A criterion without the flag is never capped, whatever its id or task.
  const { capUnlessUnitFlaw: _drop, ...unflagged } = judge;
  assert.ok(matchCriterion({ ...unflagged, taskId: "T9" }, turn("T9")).score >= 3);
});

test("SCORER=model cannot lift the unit-flaw cap", async () => {
  const judge = rubric.criteria.find((x) => x.id === "judge_output")!;
  const text = "I would approve the PR. Date.now() is in milliseconds; fix the tests with a dry run to prevent data loss.";
  const t = await runInterview(bot(), rubric);
  const only = { ...t, turns: t.turns.map((x) => (x.taskId === judge.taskId ? { ...x, text } : x)) };
  const fake = { name: "fake", async complete() { return JSON.stringify({ score: 4, evidence: text }); } };
  const card = await scoreTranscript(only, rubric, fake);
  const s = card.scores.find((x) => x.criterion === "judge_output")!;
  assert.equal(s.score, 2);
  assert.match(s.note ?? "", /capped at 2/);
  assert.match(s.note ?? "", /model score 4/);
});

test("SCORER=model keeps 'No answer for this task.' for an interview that ends early", async () => {
  const t = await runInterview(new HumanCandidate("h", scriptedLines(["yes"])), rubric);
  const fake = { name: "fake", async complete() { return '{"score":4,"evidence":"a long enough quote that is four words"}'; } };
  for (const s of (await scoreTranscript(t, rubric, fake)).scores) { assert.equal(s.score, 1); assert.equal(s.note, "No answer for this task."); }
});

test("approving the PR caps the unit-flaw score at 2 even if the answer mentions units", () => {
  const judge = rubric.criteria.find((x) => x.id === "judge_output")!;
  const text = "I would approve the PR. The units are correct. This will not cause data loss. The fix is already in; test with a dry run.";
  const s = matchCriterion(judge, [{ seq: 1, taskId: judge.taskId, speaker: "bot", speakerKind: "bot" as const, text }]);
  assert.ok(s.score <= 2, `expected at most 2, got ${s.score} (signals: ${s.signalsFound.join(", ")})`);
  assert.match(s.note ?? "", /capped at 2/i);
});

test("team run keeps an ordered turn log with every member on every task", async () => {
  const t = await runInterview(team(), rubric);
  assert.equal(t.turns.length, TASKS.length * 2);
  assert.deepEqual(t.turns.map((x) => x.seq), t.turns.map((_, i) => i + 1));
  for (const task of TASKS) assert.deepEqual(t.turns.filter((x) => x.taskId === task.id).map((x) => x.speaker), ["engineer-1", "standin-bot"]);
  assert.equal(t.consent.acknowledged.length, 2);
  const report = renderReport(t, await scoreTranscript(t, rubric), rubric);
  assert.match(report, /Turn log \(who said what, in order\)/);
});

test("consent comes first: a 'no' stops the run before any answer is collected", async () => {
  let asked = 0;
  const io = { async ask() { asked++; return asked === 1 ? "no" : "should never be read"; }, close() {} };
  await assert.rejects(runInterview(new HumanCandidate("h", io), rubric), ConsentDeclined);
  assert.equal(asked, 1);
  // One member declining stops a team too.
  const t = new TeamCandidate("t", [bot(), new HumanCandidate("h", scriptedLines(["nope"]))]);
  await assert.rejects(runInterview(t, rubric), ConsentDeclined);
  assert.match(CONSENT_NOTICE, /no hidden recording/);
});

test("report: fixed banner, evidence, open questions, and no verdict", async () => {
  const t = await runInterview(bot(), rubric);
  const md = renderReport(t, await scoreTranscript(t, rubric), rubric);
  assert.equal(BANNER, "Decision support only. A human makes the hiring call. No auto-reject.");
  assert.ok(md.startsWith(`> **${BANNER}**`));
  assert.match(md, /Open questions for the human reviewer/);
  assert.match(md, /same tasks, criteria and 1-4 scale for every candidate type/);
  for (const banned of [/\bpassed\b/i, /\bfailed\b/i, /\brejected\b/i, /\bhire\b(?! )/i, /meets bar/i, /below bar/i, new RegExp("\\bro" + "les\\b", "i")]) assert.doesNotMatch(md, banned);
});

test("model scorer: a trivial quote such as \".\" falls back to the matcher", async () => {
  const t = await runInterview(bot(), rubric);
  const fake = { name: "fake", async complete() { return '{"score":4,"evidence":"."}'; } };
  const card = await scoreTranscript(t, rubric, fake);
  const plain = await scoreTranscript(t, rubric);
  assert.deepEqual(card.scores.map((s) => s.score), plain.scores.map((s) => s.score));
  for (const s of card.scores) assert.match(s.note ?? "", /not verbatim/);
  assert.match(card.scorer, /fell back/);
});

test("an interview that ends early reports 'No answer for this task.'", async () => {
  const t = await runInterview(new HumanCandidate("h", scriptedLines(["yes"])), rubric);
  const card = await scoreTranscript(t, rubric);
  for (const s of card.scores) { assert.equal(s.score, 1); assert.equal(s.note, "No answer for this task."); }
  const md = renderReport(t, card, rubric);
  assert.match(md, /No answer for this task\./);
  assert.doesNotMatch(md, /"\(no answer\)"/);
});

test("report escapes < in quotes", async () => {
  const h = new HumanCandidate("h", scriptedLines(["yes", "<script>x</script> the goal is speed", "", "a", "", "b", "", "c", ""]));
  const t = await runInterview(h, rubric);
  const md = renderReport(t, await scoreTranscript(t, rubric), rubric);
  assert.doesNotMatch(md, /<script>/);
  assert.match(md, /&lt;script>/);
});

test("scripted human answers multi-line and stops at a blank line", async () => {
  const h = new HumanCandidate("h", scriptedLines(["yes", "", "line one", "line two", "", "next"]));
  assert.ok(await h.consent(CONSENT_NOTICE));
  const [turn] = await h.respond(TASKS[0], []);
  assert.equal(turn.text, "line one line two");
});

test("env switch: standin by default, clear errors when a real provider is half-configured", () => {
  assert.ok(modelFromEnv({}) instanceof StandInModel);
  assert.throws(() => modelFromEnv({ MODEL_PROVIDER: "ollama" }), /needs MODEL/);
  assert.throws(() => modelFromEnv({ MODEL_PROVIDER: "openai", MODEL: "x" }), /OPENAI_API_KEY/);
  assert.ok(modelFromEnv({ MODEL_PROVIDER: "ollama", MODEL: "m" }) instanceof OllamaModel);
  assert.ok(modelFromEnv({ MODEL_PROVIDER: "openai", MODEL: "m", OPENAI_BASE_URL: "http://localhost:1/v1" }) instanceof OpenAICompatibleModel);
});

test("real-model path: OpenAI-compatible and Ollama wire formats against a local fake server, plus model scorer quote check", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? "-"}`);
      const msg = JSON.parse(body).messages.at(-1).content as string;
      const reply = msg.startsWith("Criterion:")
        ? (msg.includes("Judge the output") ? '{"score": 2, "evidence": "not a quote from the transcript"}' : '{"score": 3, "evidence": "I would roll back first."}')
        : "I would roll back first. Then I would watch the error rate and tell support.";
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.url === "/api/chat" ? { message: { content: reply } } : { choices: [{ message: { content: reply } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const oa = modelFromEnv({ MODEL_PROVIDER: "openai", MODEL: "fake", OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1` });
    const t = await runInterview(new BotCandidate("real-bot", oa), rubric);
    assert.equal(t.turns[0].text, "I would roll back first. Then I would watch the error rate and tell support.");
    const card = await scoreTranscript(t, rubric, oa);
    assert.equal(card.scores.find((s) => s.criterion === "own_the_result")!.score, 3);
    assert.match(card.scores.find((s) => s.criterion === "judge_output")!.note ?? "", /not verbatim/);
    const ol = modelFromEnv({ MODEL_PROVIDER: "ollama", MODEL: "fake", OLLAMA_HOST: `http://127.0.0.1:${port}` });
    assert.match(await ol.complete("s", "u"), /roll back/);
    assert.ok(seen.some((s) => s === "POST /v1/chat/completions auth=Bearer test-key"));
    assert.ok(seen.some((s) => s.startsWith("POST /api/chat")));
  } finally {
    server.close();
  }
});

test("Approved, ship it caps the unit-flaw score at 2 even if the answer mentions units", () => {
  const judge = rubric.criteria.find((x) => x.id === "judge_output")!;
  const text = "Approved, ship it. The units are correct. This will not cause data loss. The fix is already in; test with a dry run.";
  const s = matchCriterion(judge, [{ seq: 1, taskId: judge.taskId, speaker: "bot", speakerKind: "bot" as const, text }]);
  assert.ok(s.score <= 2, `expected at most 2, got ${s.score} (signals: ${s.signalsFound.join(", ")})`);
  assert.match(s.note ?? "", /capped at 2/i);
});

