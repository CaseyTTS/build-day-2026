// npm run start -- --playbook <name> [--approve | --approve-cli] [--out outputs]   License: MIT.
// npm run start -- --check <name|path>   (schema check only)
import { loadPlaybook, PlaybookError } from "./playbook.js";
import { modelFromEnv } from "./model.js";
import { runPlaybook } from "./system.js";
import type { ApproveMode } from "./harness.js";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseArgs(argv: string[]): { playbook: string; approve: ApproveMode; out: string; checkOnly: boolean } {
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const check = get("--check");
  const env = (process.env.HARNESS_APPROVE ?? "deny").toLowerCase();
  const approve: ApproveMode = argv.includes("--approve") ? "yes" : argv.includes("--approve-cli") ? "cli" : env === "yes" || env === "cli" ? env : "deny";
  return { playbook: check ?? get("--playbook") ?? "", approve, out: get("--out") ?? "outputs", checkOnly: check !== undefined };
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (!a.playbook) { console.error("Usage: npm run start -- --playbook helpdesk|recruiting|marketing|scheduling [--approve]"); process.exitCode = 2; return; }
  try {
    const pb = loadPlaybook(a.playbook);
    if (a.checkOnly) { console.log(`OK: playbook "${pb.name}" passed the schema check.`); return; }
    await runPlaybook(pb, { model: modelFromEnv(), approve: a.approve, outRoot: a.out, print: (s) => console.log(s) });
  } catch (e) {
    if (e instanceof PlaybookError) { console.error(e.message); process.exitCode = 3; return; }
    throw e;
  }
}

// Same entry check as drop 4: compare URLs, so Windows paths and paths with spaces match.
function isEntry(): boolean {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return import.meta.url === pathToFileURL(process.argv[1]).href; }
}
if (isEntry()) void main();
