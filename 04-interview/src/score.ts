// Score a transcript against the shared rubric, with an evidence quote for every score. License: MIT.
// Default scorer: deterministic signal matcher (no model). SCORER=model uses the configured model,
// but its quote must appear verbatim in the transcript or we fall back to the matcher.
import type { Score, Scorecard, Transcript, Turn } from "./types.js";
import type { Criterion, Rubric } from "./rubric.js";
import type { ChatModel } from "./model.js";

function sentences(turn: Turn): { quote: string; turn: Turn }[] {
  return turn.text.split(/(?<=[.!?])\s+/).map((s) => ({ quote: s.trim(), turn })).filter((s) => s.quote);
}
const hits = (text: string, c: Criterion) =>
  c.signals.filter((g) => g.any.some((k) => text.toLowerCase().includes(k.toLowerCase()))).map((g) => g.name);

/** True if the answer mentions the planted unit flaw, not merely the word "milliseconds". */
export function namesUnitFlaw(text: string): boolean {
  const t = text.toLowerCase();
  const hasSeconds = /\bseconds?\b/.test(t);
  const hasMs = /\bms\b/.test(t) || t.includes("millisecond") || /\b1000\b/.test(t);
  const hasUnits = /\bunits?\b/.test(t) || t.includes("unit mismatch");
  return (hasSeconds && hasMs) || hasUnits || t.includes("* 1000") || t.includes("x 1000");
}

/** True when the answer approves the PR (and does not say it would not). A stray "units" must not lift the cap in that case. */
export function approves(text: string): boolean {
  return /\b(i('d| would)?|we('d| would)?) approve\b|\blgtm\b|\bapproved\b|\bship it\b|\bi'?ll approve\b/i.test(text) && !/\b(not|n't|wouldn't|won't) approve\b/i.test(text);
}

function shouldCapUnitFlaw(c: Criterion, text: string, score: number): boolean {
  return c.capUnlessUnitFlaw === true && score >= 3 && (!namesUnitFlaw(text) || approves(text));
}

export function matchCriterion(c: Criterion, turns: Turn[]): Score {
  const mine = turns.filter((t) => t.taskId === c.taskId && t.text !== "(no answer)");
  const all = mine.map((t) => t.text).join(" ");
  const found = hits(all, c);
  // 0 signals -> 1, 1 -> 2, 2-3 -> 3, all 4 -> 4 (a 4 needs every signal).
  let score = (found.length === 0 ? 1 : found.length === 1 ? 2 : found.length < c.signals.length ? 3 : 4) as Score["score"];
  let capNote: string | undefined;
  // Only criteria that opt in via rubric.json ("capUnlessUnitFlaw": true). Renumbering tasks
  // or reusing the criterion id elsewhere cannot move or drop the cap. Approving the PR
  // still caps the score, even if a stray "units" or "seconds" is present.
  if (shouldCapUnitFlaw(c, all, score)) {
    score = 2;
    capNote = "Capped at 2: the answer did not identify the seconds/milliseconds flaw.";
  }
  // Evidence = the sentence that carries the most signals (earliest wins ties).
  const cands = mine.flatMap(sentences);
  let best = cands[0];
  let bestN = -1;
  for (const s of cands) { const n = hits(s.quote, c).length; if (n > bestN) { best = s; bestN = n; } }
  if (!best) return { criterion: c.id, title: c.title, taskId: c.taskId, score: 1, level: c.levels["1"], signalsFound: [], evidence: { quote: "(no answer given)", speaker: "-", turnSeq: 0 }, note: "No answer for this task." };
  const note = capNote ?? (bestN <= 0 ? "No rubric signal found; quote shows what was said." : undefined);
  return {
    criterion: c.id, title: c.title, taskId: c.taskId, score, level: c.levels[String(score) as "1"], signalsFound: found,
    evidence: { quote: best.quote, speaker: best.turn.speaker, turnSeq: best.turn.seq },
    ...(note ? { note } : {}),
  };
}

async function modelCriterion(model: ChatModel, c: Criterion, turns: Turn[]): Promise<Score> {
  const fallback = matchCriterion(c, turns);
  if (fallback.note === "No answer for this task.") return fallback; // never let a model score an empty task
  const mine = turns.filter((t) => t.taskId === c.taskId);
  const answer = mine.map((t) => `[${t.speaker}] ${t.text}`).join("\n");
  const levels = Object.entries(c.levels).map(([k, v]) => `${k} = ${v}`).join("\n");
  try {
    const raw = await model.complete(
      "You score interview answers against a rubric. Reply with JSON only: {\"score\": 1-4, \"evidence\": \"<exact quote copied from the answer>\"}.",
      `Criterion: ${c.title}. ${c.description}\nLevels:\n${levels}\n\nAnswer:\n${answer}`,
    );
    const j = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? "{}");
    const quote = String(j.evidence ?? "").trim();
    const turn = quote.length >= 20 && quote.split(/\s+/).length >= 4 ? mine.find((t) => t.text.includes(quote)) : undefined;
    if (![1, 2, 3, 4].includes(j.score) || !turn) return { ...fallback, note: "Model score rejected (bad score or quote not verbatim); used the rubric matcher." };
    if (shouldCapUnitFlaw(c, mine.map((t) => t.text).join(" "), j.score)) {
      return { ...fallback, score: 2, level: c.levels["2"], evidence: { quote, speaker: turn.speaker, turnSeq: turn.seq }, note: `Scored by ${model.name} (model score ${j.score}); capped at 2: the answer did not identify the seconds/milliseconds flaw.` };
    }
    return { ...fallback, score: j.score, level: c.levels[String(j.score) as "1"], evidence: { quote, speaker: turn.speaker, turnSeq: turn.seq }, note: `Scored by ${model.name} (model score ${j.score}).` };
  } catch (e) {
    return { ...fallback, note: `Model scorer failed (${(e as Error).message.slice(0, 80)}); used the rubric matcher.` };
  }
}

export async function scoreTranscript(t: Transcript, rubric: Rubric, model?: ChatModel): Promise<Scorecard> {
  if (t.rubric.id !== rubric.id) throw new Error("Transcript was run against a different rubric.");
  const scores: Score[] = [];
  for (const c of rubric.criteria) scores.push(model ? await modelCriterion(model, c, t.turns) : matchCriterion(c, t.turns));

  const openQuestions = scores.filter((s) => s.score <= 3).map((s) => `${s.title} (${s.score}/4): ${rubric.criteria.find((c) => c.id === s.criterion)!.followUp}`);
  openQuestions.push("Read every evidence quote against the full transcript. Does the quote really support the score?");
  if (t.candidate.kind === "team") openQuestions.push("Use the turn log: who moved the work forward on each task, and who only agreed?");
  if (t.candidate.kind === "bot") openQuestions.push("Would this bot get a seat? Name its human manager, its allow/ask/deny permissions and a review date (see agent-seat.yaml).");

  let scorerLabel = "rubric signal matcher (deterministic, no model)";
  if (model) {
    const byModel = scores.filter((s) => s.note?.startsWith("Scored by")).length;
    scorerLabel = byModel === scores.length
      ? `model (${model.name}) with verbatim-quote check`
      : byModel === 0
        ? `rubric signal matcher (SCORER=model requested, but every model score fell back to the matcher)`
        : `model (${model.name}) for ${byModel} of ${scores.length} criteria; the rest fell back to the rubric matcher`;
  }
  const low = [...scores].sort((a, b) => a.score - b.score)[0];
  return {
    schema: "interview-scorecard/v1",
    interviewId: t.interviewId,
    rubricId: rubric.id,
    scorer: scorerLabel,
    candidate: t.candidate,
    scores,
    openQuestions,
    recommendedFollowUp: `Start the follow-up conversation with "${low.title}" (${low.score}/4): ${rubric.criteria.find((c) => c.id === low.criterion)!.followUp}`,
  };
}
