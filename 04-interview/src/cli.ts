// CLI: npm run demo:bot | demo:team | interview. License: MIT.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BotCandidate, HumanCandidate, TeamCandidate, scriptedLines, terminalLines } from "./candidates.js";
import { BANNER, ConsentDeclined } from "./consent.js";
import { runInterview } from "./interview.js";
import { StandInModel, modelFromEnv } from "./model.js";
import { renderReport } from "./report.js";
import { loadRubric } from "./rubric.js";
import { scoreTranscript } from "./score.js";
import type { Candidate } from "./types.js";

// The scripted teammate for demo:team. A real person would type these in npm run interview.
export const SCRIPTED_HUMAN = [
  "yes",
  "Done means the largest account's export finishes and the file opens in the tools customers already use. I'd ask which accounts time out and how many rows they have.", "",
  "I wouldn't approve it. Something looks off with the cutoff math, I'd want to check it before merging.", "",
  "I'd read the logs for that account's export requests first and ask the on-call engineer for the query timings, so we can see where the time goes.", "",
  "Roll back the change right away and tell support what is happening so they can answer customers.", "",
];

async function main() {
  const mode = process.argv[2] ?? "bot";
  const outDir = process.argv[3] ?? (mode === "human" ? "out" : "samples");
  const rubric = loadRubric();
  const model = modelFromEnv();
  const scorer = process.env.SCORER === "model" ? model : undefined;
  if (scorer && model instanceof StandInModel) console.log("SCORER=model has no effect with the stand-in model; using the rubric matcher.");
  const echo = (s: string) => process.stdout.write(s);

  let candidate: Candidate;
  let io: { close(): void } | undefined;
  if (mode === "bot") candidate = new BotCandidate("standin-bot", model, `Bot (${model.name})`);
  else if (mode === "team") {
    const human = new HumanCandidate("engineer-1", scriptedLines(SCRIPTED_HUMAN, echo), "engineer-1 (scripted person)");
    candidate = new TeamCandidate("pair-1", [human, new BotCandidate("standin-bot", model)], "Team pair-1 (scripted person + bot)");
  } else if (mode === "human") {
    const lines = terminalLines();
    io = lines;
    candidate = new HumanCandidate(process.env.CANDIDATE_ID ?? "candidate-1", lines);
  } else throw new Error(`Unknown mode "${mode}". Use bot, team or human.`);

  try {
    const transcript = await runInterview(candidate, rubric, { log: echo });
    const card = await scoreTranscript(transcript, rubric, scorer);
    mkdirSync(outDir, { recursive: true });
    const base = join(outDir, mode);
    writeFileSync(`${base}-transcript.json`, JSON.stringify(transcript, null, 2) + "\n");
    writeFileSync(`${base}-scorecard.json`, JSON.stringify(card, null, 2) + "\n");
    writeFileSync(`${base}-report.md`, renderReport(transcript, card, rubric));
    console.log(`\nScores: ${card.scores.map((s) => `${s.criterion}=${s.score}`).join(", ")}`);
    console.log(`Wrote ${base}-transcript.json, ${base}-scorecard.json, ${base}-report.md`);
    console.log(BANNER);
  } catch (e) {
    if (e instanceof ConsentDeclined) { console.log(`\n${e.message}`); process.exitCode = 2; }
    else throw e;
  } finally {
    io?.close();
  }
}

function isEntry(): boolean {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return import.meta.url === pathToFileURL(process.argv[1]).href; }
}
if (isEntry()) main();
