# Builder interview harness (Build Day drop 4/6)

Built by the CornerStone AI Research Lab at CornerStone Technology Talent Services.

**Scope:** a starter interview harness that runs one work-sample interview against a person, a bot, or a team and drafts an evidence-backed scorecard, not a hiring system.

> **Decision support only. A human makes the hiring call. No auto-reject.**

## What it does
- **One adapter interface, three candidate types** (`src/candidates.ts`):
  - `HumanCandidate`: answers typed in the terminal (readline), or scripted lines for tests and demos.
  - `BotCandidate`: any model or agent behind a chat endpoint. Default is a built-in stand-in model with fixed answers (no key, no network).
  - `TeamCandidate`: people and/or bots take turns on the same task, each seeing the turns before theirs, with an ordered turn log.
- **The same four work tasks for everyone** (`src/tasks.ts`): connect it to the work (a vague ticket), judge the output (an AI-written PR with a planted bug), work within limits (one access is off-limits), own the result (it broke after shipping: rollback, monitoring, telling stakeholders).
- **One shared rubric** (`rubric.json`, readable version in `scorecard.md`): 4 criteria, a 1-4 scale, and an evidence quote from the transcript for every score.
- **Outputs:** a transcript JSON, a scorecard JSON and a markdown report with scores, evidence, open questions for the reviewer and a recommended follow-up. No total, no ranking, no pass/fail.

## Ethics, built in
- A consent notice is shown before anything is recorded. If the person (or any team member) does not type `yes`, the run stops and nothing is written.
- No hidden recording: only the answers given after the notice go into the transcript.
- No auto-reject and no verdict. The report carries a fixed banner: "Decision support only. A human makes the hiring call. No auto-reject."
- The rubric is the same for every candidate type. The transcript records which rubric and version were used.
- A bot cannot consent for itself; the transcript records that its operator ran it after the notice was shown.

## Run it
Node 22 or newer.
```bash
npm ci              # or: npm install
npm test            # builds with tsc, then runs the node:test suite (offline)
npm run demo:bot    # stand-in bot  -> samples/bot-transcript.json, bot-scorecard.json, bot-report.md
npm run demo:team   # scripted person + stand-in bot -> samples/team-*.json, team-report.md
npm run interview   # interactive: you answer in the terminal -> out/human-*.json, human-report.md
```
In `npm run interview`, type `yes` at the consent notice, then end each answer with a blank line. Set `CANDIDATE_ID` to label the run.

## Use a real model
Copy `.env.example` and set the variables in your shell (this project does not auto-load `.env`):
```bash
# Local, via Ollama (pull a model first)
MODEL_PROVIDER=ollama MODEL=<model you pulled> npm run demo:bot
# OpenAI or any OpenAI-compatible API
MODEL_PROVIDER=openai OPENAI_API_KEY=... MODEL=<model> npm run demo:bot
# Optional: let the model score too. Its quote must appear word for word in the transcript,
# or that score falls back to the deterministic rubric matcher.
SCORER=model MODEL_PROVIDER=ollama MODEL=<model> npm run demo:bot
```
A candidate's answer is sent to the scoring model as-is, so an answer can try to talk the model into a higher score. The quote check limits this but cannot stop it; read every model score against the transcript.

The quote check: a model quote must be at least 20 characters and 4 words, and appear word for word in that task's answers, or the score falls back to the rubric matcher. `SCORER=model` has no effect with the stand-in model.

## How scoring works (and its limits)
The default scorer is a deterministic signal matcher: each criterion lists four signals (phrases that show the behavior). 0 signals = 1, 1 signal = 2, 2-3 signals = 3, all 4 = 4. The evidence is the sentence carrying the most signals. It is a starting point a person can check and disagree with, not a judgment of quality: a strong answer in unexpected words can score low (the scripted person's vague answer to the planted bug scores 1). A criterion with `"capUnlessUnitFlaw": true` in rubric.json (only judge_output ships with it) needs the answer to mention the seconds/milliseconds flaw before it can score 3 or 4, with either scorer. Approving the PR still scores at most 2, even if a stray word such as "units" is present. The flag sits on the criterion, so renumbering tasks cannot move it. The report lists the signals it found so the reviewer can see why.

## Make it yours
- Swap the tasks in `src/tasks.ts` for a scrubbed ticket from your own backlog. Keep 3 to 5.
- Edit `rubric.json` signals and follow-up questions to match what "good" means on your team.
- For agents you plan to keep, pair the scorecard with `agent-seat.yaml`: a named human manager, allow/ask/deny permissions, a review date and an exit rule.

## Files
`src/` harness · `test/harness.test.ts` tests · `rubric.json` shared rubric · `scorecard.md` readable rubric · `agent-seat.yaml` agent seat template · `samples/` committed demo outputs · `STACK.md` versions and env vars

TypeScript stays pinned at 5.9.3 (the 5.x line); the newer 7.x major was not adopted for this starter.

MIT licensed. See `LICENSE`.
