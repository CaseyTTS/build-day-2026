// Shared types for the interview harness. License: MIT.
export type CandidateKind = "human" | "bot" | "team";

export interface Task {
  id: string;
  criterion: string; // rubric criterion id this task produces evidence for
  title: string;
  prompt: string;
}

/** One thing one participant said, before it gets a sequence number. */
export interface TurnDraft {
  speaker: string;
  speakerKind: "human" | "bot";
  text: string;
}

export interface Turn extends TurnDraft {
  seq: number;
  taskId: string;
}

export interface ConsentRecord {
  who: string;
  how: string; // e.g. "typed yes" or "operator ran the bot after the notice was shown"
}

/** The one adapter interface. A person, a bot, and a team all implement it. */
export interface Candidate {
  id: string;
  kind: CandidateKind;
  label: string;
  /** Show the notice. Return consent records, or null if anyone declines. */
  consent(notice: string): Promise<ConsentRecord[] | null>;
  /** Answer one task. A team returns one turn per member, in order. */
  respond(task: Task, priorTurns: TurnDraft[]): Promise<TurnDraft[]>;
  members?: { id: string; kind: "human" | "bot" }[];
}

export interface Transcript {
  schema: "interview-transcript/v1";
  interviewId: string;
  startedAt: string;
  finishedAt: string;
  candidate: { id: string; kind: CandidateKind; label: string; members?: { id: string; kind: string }[] };
  consent: { noticeShown: true; notice: string; acknowledged: ConsentRecord[] };
  rubric: { id: string; version: string; sameForEveryCandidateType: true };
  tasks: Task[];
  turns: Turn[];
}

export interface Score {
  criterion: string;
  title: string;
  taskId: string;
  score: 1 | 2 | 3 | 4;
  level: string;
  signalsFound: string[];
  evidence: { quote: string; speaker: string; turnSeq: number };
  note?: string;
}

export interface Scorecard {
  schema: "interview-scorecard/v1";
  interviewId: string;
  rubricId: string;
  scorer: string;
  candidate: Transcript["candidate"];
  scores: Score[];
  openQuestions: string[];
  recommendedFollowUp: string;
}
