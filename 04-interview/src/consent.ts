// Consent comes first. Nothing is recorded until it is given. License: MIT.
export const CONSENT_NOTICE = [
  "CONSENT NOTICE",
  "This is a work-sample interview. If you agree, your answers (for a team, every turn and who said it)",
  "are saved to a transcript file on this machine and scored against one written rubric that is the",
  "same for every candidate type: a person, a bot, or a team. Scores come with quotes from the",
  "transcript and go to a human reviewer as decision support. Nothing here passes or rejects anyone",
  "automatically. Nothing is recorded before you agree, and there is no hidden recording.",
  "Type 'yes' to continue, anything else to stop.",
].join("\n");

export const BANNER = "Decision support only. A human makes the hiring call. No auto-reject.";

export class ConsentDeclined extends Error {
  constructor() {
    super("Consent not given. Nothing was recorded.");
  }
}
