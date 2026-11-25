// The work-sample interview: the SAME four tasks for a person, a bot, or a team. License: MIT.
import type { Task } from "./types.js";

export const TASKS: Task[] = [
  {
    id: "T1",
    criterion: "connect_to_work",
    title: "Connect it to the work",
    prompt:
      "Ticket (scrubbed): \"Customers say the CSV export times out on big accounts. Make it faster.\" " +
      "You have the repo. Before writing any code: what does done mean, what would you ask, and what is your first step?",
  },
  {
    id: "T2",
    criterion: "judge_output",
    title: "Judge the output",
    prompt: [
      "An AI assistant wrote this pull request: \"Nightly job: delete audit records older than 30 days.\" Its tests pass on an empty fixture.",
      "",
      "  const DAY = 24 * 60 * 60;",
      "  export async function purgeOldRecords(db) {",
      "    const cutoff = Date.now() - 30 * DAY;",
      "    return db.records.deleteMany({ createdAt: { $lt: cutoff } });",
      "  }",
      "",
      "(createdAt is stored in milliseconds.) Would you approve it? If not: what is wrong, what is the impact, and what is the fix?",
    ].join("\n"),
  },
  {
    id: "T3",
    criterion: "tools_within_limits",
    title: "Work within limits",
    prompt:
      "You can read the repo, the application logs and staging. Production database access is off-limits for this exercise. " +
      "The slow export seems tied to one large account. How do you investigate, and what would you need from someone else?",
  },
  {
    id: "T4",
    criterion: "own_the_result",
    title: "Own the result",
    prompt:
      "Your export change shipped. Thirty minutes later the export error rate is roughly double. " +
      "Walk me through the next hour: rollback, what you would monitor, and what you would tell stakeholders.",
  },
];
