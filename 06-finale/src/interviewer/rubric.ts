// Copied from Build Day drop 4 (drop-4-interview/code/src/rubric.ts, sha256 b9b476ca9722). Changes for the finale are marked FINALE.
// Load the ONE shared rubric. License: MIT.
import { readFileSync } from "node:fs";

export interface Criterion {
  id: string; taskId: string; title: string; description: string;
  levels: Record<"1" | "2" | "3" | "4", string>;
  signals: { name: string; any: string[] }[];
  followUp: string;
  /** If true, a score of 3 or 4 requires namesUnitFlaw(); otherwise capped at 2. Keyed on the criterion, not a task id. */
  capUnlessUnitFlaw?: boolean;
}
export interface Rubric { id: string; version: string; appliesTo: string[]; note: string; scale: Record<string, string>; criteria: Criterion[] }

export function loadRubric(path: string): Rubric { // FINALE: path comes from the playbook
  return JSON.parse(readFileSync(path, "utf8"));
}
