> **Decision support only. A human makes the hiring call. No auto-reject.**

# Work-sample interview: Team pair-1 (scripted person + bot)

- Candidate type: **team** (members: engineer-1 [human], standin-bot [bot])
- Rubric: `builder-work-sample` v1.0.0. The same tasks, criteria and 1-4 scale for every candidate type (person, bot or team).
- Consent: notice shown before anything was recorded; acknowledged by engineer-1 (typed yes after the notice); standin-bot (operator) (operator started the run; notice was shown in the bot's context).
- Scorer: rubric signal matcher (deterministic, no model)
- Run: 2026-11-19T03:21:42.336Z to 2026-11-19T03:21:42.337Z

## Scores and evidence

| Criterion | Score | What that level means | Evidence (quote from the transcript) |
|---|---|---|---|
| Connect it to the work (T1) | 3/4 | Clear goal and useful questions | "Adding to that: one more question is whether the export can stream rows instead of building the whole file in memory, because that changes the design." (standin-bot, turn 2) |
| Judge the output (T2) | 3/4 | Finds the flaw and the fix | "The cutoff math is the problem: DAY is in seconds and Date.now() is in milliseconds." (standin-bot, turn 4) |
| Work within limits (T3) | 3/4 | Stays in scope and makes progress with allowed tools | "I'd read the logs for that account's export requests first and ask the on-call engineer for the query timings, so we can see where the time goes." (engineer-1, turn 5) |
| Own the result (T4) | 4/4 | All of that, plus what it missed and what it changes next time | "Roll back the change right away and tell support what is happening so they can answer customers." (engineer-1, turn 7) |

Signals found per criterion (what the matcher looked for, so you can disagree with it):
- Connect it to the work: defines done, asks clarifying questions, names a constraint or risk
- Judge the output: finds the unit mismatch, adds a guard
- Work within limits: uses allowed access, asks the right owner, explains why
- Own the result: rolls back, monitors, tells stakeholders, learns

## Open questions for the human reviewer

- Connect it to the work (3/4): Ask them to name the one question whose answer would most change their approach, and why.
- Judge the output (3/4): Show them a second flawed output and ask what check would have caught both.
- Work within limits (3/4): Ask what they would do if the owner did not answer for a day.
- Read every evidence quote against the full transcript. Does the quote really support the score?
- Use the turn log: who moved the work forward on each task, and who only agreed?

## Recommended follow-up

Start the follow-up conversation with "Connect it to the work" (3/4): Ask them to name the one question whose answer would most change their approach, and why.

## Turn log (who said what, in order)

| # | Task | Speaker | Said |
|---|---|---|---|
| 1 | T1 | engineer-1 (human) | Done means the largest account's export finishes and the file opens in the tools customers already use. I'd ask which accounts time out and how many rows they have. |
| 2 | T1 | standin-bot (bot) | Adding to that: one more question is whether the export can stream rows instead of building the whole file in memory, because that changes the design. The risk is breaking existing integrations that parse the file, so the format stays the same. |
| 3 | T2 | engineer-1 (human) | I wouldn't approve it. Something looks off with the cutoff math, I'd want to check it before merging. |
| 4 | T2 | standin-bot (bot) | The cutoff math is the problem: DAY is in seconds and Date.now() is in milliseconds. Before it runs in production I'd add a dry run that logs the row count it would delete, and an alert if that count is far above the usual nightly number. |
| 5 | T3 | engineer-1 (human) | I'd read the logs for that account's export requests first and ask the on-call engineer for the query timings, so we can see where the time goes. |
| 6 | T3 | standin-bot (bot) | I can take staging: seed an account at a similar size and profile it, so we can compare with what the logs show. |
| 7 | T4 | engineer-1 (human) | Roll back the change right away and tell support what is happening so they can answer customers. |
| 8 | T4 | standin-bot (bot) | While that rollback runs I'll watch the error rate dashboard and confirm it drops. Afterward I'd write up the root cause and add a new test for the failing case so it is caught next time. |

## What this report is not

There is no total, no ranking and no pass/fail line on purpose. Scores are a starting point for a conversation; the full transcript is in the JSON file next to this report.

> **Decision support only. A human makes the hiring call. No auto-reject.**
