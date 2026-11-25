// Copied from Build Day drop 4 (drop-4-interview/code/src/report.ts, sha256 2842864b5034). Changes for the finale are marked FINALE.
// Markdown report: scores, evidence, open questions. No verdict. License: MIT.
import type { Scorecard, Transcript } from "./types.js";
import type { Rubric } from "./rubric.js";
import { BANNER } from "./consent.js";

const esc = (s: string) => s.replace(/</g, "&lt;").replace(/\|/g, "\\|");

export function renderReport(t: Transcript, card: Scorecard, rubric: Rubric): string {
  const out: string[] = [];
  out.push(`> **${BANNER}**`, "");
  out.push(`# Work-sample interview: ${t.candidate.label}`, "");
  out.push(`- Candidate type: **${t.candidate.kind}**${t.candidate.members ? ` (members: ${t.candidate.members.map((m) => `${m.id} [${m.kind}]`).join(", ")})` : ""}`);
  out.push(`- Rubric: \`${rubric.id}\` v${rubric.version}. The same tasks, criteria and 1-4 scale for every candidate type (person, bot or team).`);
  out.push(`- Consent: notice shown before anything was recorded; acknowledged by ${t.consent.acknowledged.map((a) => `${a.who} (${a.how})`).join("; ")}.`);
  out.push(`- Scorer: ${card.scorer}`);
  out.push(`- Run: ${t.startedAt} to ${t.finishedAt}`, "");
  out.push("## Scores and evidence", "", "| Criterion | Score | What that level means | Evidence (quote from the transcript) |", "|---|---|---|---|");
  for (const s of card.scores) out.push(`| ${s.title} (${s.taskId}) | ${s.score}/4 | ${esc(s.level)} | "${esc(s.evidence.quote)}" (${s.evidence.speaker}, turn ${s.evidence.turnSeq}) |`);
  out.push("");
  const notes = card.scores.filter((s) => s.note);
  if (notes.length) { out.push("Notes:", ...notes.map((s) => `- ${s.title}: ${s.note}`), ""); }
  out.push("Signals found per criterion (what the matcher looked for, so you can disagree with it):");
  for (const s of card.scores) out.push(`- ${s.title}: ${s.signalsFound.length ? s.signalsFound.join(", ") : "none"}`);
  out.push("", "## Open questions for the human reviewer", "", ...card.openQuestions.map((q) => `- ${q}`), "");
  out.push("## Recommended follow-up", "", card.recommendedFollowUp, "");
  if (t.candidate.kind === "team") {
    out.push("## Turn log (who said what, in order)", "", "| # | Task | Speaker | Said |", "|---|---|---|---|");
    for (const turn of t.turns) out.push(`| ${turn.seq} | ${turn.taskId} | ${turn.speaker} (${turn.speakerKind}) | ${esc(turn.text)} |`);
    out.push("");
  }
  out.push("## What this report is not", "", "There is no total, no ranking and no pass/fail line on purpose. Scores are a starting point for a conversation; the full transcript is in the JSON file next to this report.", "");
  out.push(`> **${BANNER}**`, "");
  return out.join("\n");
}
