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

export function loadRubric(path = new URL("../../rubric.json", import.meta.url)): Rubric {
  return JSON.parse(readFileSync(path, "utf8"));
}
