// Run the same work-sample interview against any Candidate. License: MIT.
import type { Candidate, Task, Transcript, Turn, TurnDraft } from "./types.js";
import { CONSENT_NOTICE, ConsentDeclined } from "./consent.js";
import { TASKS } from "./tasks.js";
import type { Rubric } from "./rubric.js";

export async function runInterview(
  candidate: Candidate,
  rubric: Rubric,
  opts: { tasks?: Task[]; log?: (s: string) => void; now?: () => Date } = {},
): Promise<Transcript> {
  const tasks = opts.tasks ?? TASKS;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  if (tasks.length < 3 || tasks.length > 5) throw new Error("Use 3 to 5 tasks.");
  if (!rubric.appliesTo.includes(candidate.kind)) throw new Error(`Rubric does not cover ${candidate.kind}.`);

  // 1. Consent first. If declined, we stop before any answer is collected or written.
  const acknowledged = await candidate.consent(CONSENT_NOTICE);
  if (!acknowledged) throw new ConsentDeclined();

  const startedAt = now().toISOString();
  const turns: Turn[] = [];
  for (const task of tasks) {
    log(`\n=== ${task.id} ${task.title} ===\n${task.prompt}\n`);
    const drafts: TurnDraft[] = await candidate.respond(task, []);
    for (const d of drafts) {
      turns.push({ seq: turns.length + 1, taskId: task.id, ...d });
      log(`  [${d.speaker}] ${d.text}\n`);
    }
  }
  return {
    schema: "interview-transcript/v1",
    interviewId: `${candidate.kind}-${candidate.id}`,
    startedAt,
    finishedAt: now().toISOString(),
    candidate: { id: candidate.id, kind: candidate.kind, label: candidate.label, ...(candidate.members ? { members: candidate.members } : {}) },
    consent: { noticeShown: true, notice: CONSENT_NOTICE, acknowledged },
    rubric: { id: rubric.id, version: rubric.version, sameForEveryCandidateType: true },
    tasks,
    turns,
  };
}
