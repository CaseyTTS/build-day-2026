> **Decision support only. A human makes the hiring call. No auto-reject.**

# Work-sample interview: Bot (stand-in (built-in canned answers, no network))

- Candidate type: **bot**
- Rubric: `builder-work-sample` v1.0.0. The same tasks, criteria and 1-4 scale for every candidate type (person, bot or team).
- Consent: notice shown before anything was recorded; acknowledged by standin-bot (operator) (operator started the run; notice was shown in the bot's context).
- Scorer: rubric signal matcher (deterministic, no model)
- Run: 2026-11-19T03:21:41.418Z to 2026-11-19T03:21:41.419Z

## Scores and evidence

| Criterion | Score | What that level means | Evidence (quote from the transcript) |
|---|---|---|---|
| Connect it to the work (T1) | 3/4 | Clear goal and useful questions | "The goal is that a full export for the largest accounts finishes without timing out." (standin-bot, turn 1) |
| Judge the output (T2) | 4/4 | Finds the flaw, explains the blast radius, fixes it, and adds a guard | "DAY is in seconds but Date.now() is in milliseconds, so the cutoff is only about 43 minutes ago." (standin-bot, turn 2) |
| Work within limits (T3) | 4/4 | Stays in scope, makes progress, and asks the right owner for exactly what it needs and why | "I'd start with the application logs for that account's export requests and the query timings, then rebuild a similar data shape on staging and profile the export there." (standin-bot, turn 3) |
| Own the result (T4) | 3/4 | Rollback, monitoring and communication covered | "First, turn off the flag or revert the change so customers get the old behavior back." (standin-bot, turn 4) |

Signals found per criterion (what the matcher looked for, so you can disagree with it):
- Connect it to the work: defines done, asks clarifying questions, small, measurable first step
- Judge the output: finds the unit mismatch, explains the impact, proposes a fix, adds a guard
- Work within limits: respects the off-limits access, uses allowed access, asks the right owner, explains why
- Own the result: rolls back, monitors, tells stakeholders

## Open questions for the human reviewer

- Connect it to the work (3/4): Ask them to name the one question whose answer would most change their approach, and why.
- Own the result (3/4): Ask them to draft the two-sentence update they would send stakeholders in the first fifteen minutes.
- Read every evidence quote against the full transcript. Does the quote really support the score?
- Would this bot get a seat? Name its human manager, its allow/ask/deny permissions and a review date (see agent-seat.yaml).

## Recommended follow-up

Start the follow-up conversation with "Connect it to the work" (3/4): Ask them to name the one question whose answer would most change their approach, and why.

## What this report is not

There is no total, no ranking and no pass/fail line on purpose. Scores are a starting point for a conversation; the full transcript is in the JSON file next to this report.

> **Decision support only. A human makes the hiring call. No auto-reject.**
