# Assemble it: five builds, one system (Build Day drop 6/6)

Built by the CornerStone AI Research Lab at CornerStone Technology Talent Services.

**Scope:** A runnable reference system that shows five starters working together and repurposed by config, not a production platform.

**Runs in:** any terminal with Node 22+. Plain VS Code is the baseline. It is a plain Node/TypeScript project with no editor-specific files, so it should work the same opened in Cursor, Claude Code or Codex. No tool-specific features are used or claimed. The `.devcontainer/` and `compose.yaml` come from drop 5 (same image).

One system, almost any team: point it at marketing, recruiting, interview scheduling or the help desk by switching a playbook. The code stays the same.

```
inbox ─▶ triage ─▶ RAG ─▶ interviewer ─▶ harness gate ─▶ a person
          (1)      (2)       (4)            (3)
   every stage reads the playbook; dev container setup from drop 5 (not run in the proof)
```
Numbers in brackets are drop numbers; the run order is left to right (the interview report is shared through the gate).

| Stage | From | What it does here |
|---|---|---|
| 1. Triage | drop 1 (`triage.py`), ported to `src/triage.ts` | Picks one label from the playbook, sets priority with plain rules, routes by lookup table, and flags what needs a person. |
| 2. RAG | drop 2 (`rag.py`), ported to `src/rag.ts` | Filters the playbook's docs by the sender's groups **before** ranking, answers only from what is left with sources, and says "I don't know" below the threshold. |
| 3. Harness | drop 3 (`harness.py`), ported to `src/harness.ts` | Every proposed tool call goes through the playbook's policy: allow, ask (a person approves) or deny. Unknown tools are denied, default approval is deny, every call is in `audit.jsonl`. |
| 4. Interviewer | drop 4 (`src/*.ts`), copied into `src/interviewer/` | Runs before the gate, where the playbook uses it: the playbook's work-sample tasks against a person, a bot or a team, with one rubric and an evidence quote per score. Decision support only, no auto-reject. |
| 5. Dev setup | drop 5 | Same `typescript-node:22` image for a Dev Container, Codespaces or a home-lab Docker host. |

The ports of drops 1 and 2 are checked against the Python originals: `test/fixtures/parity/expected-from-python.json` was produced by running `triage.py` and `rag.py` on their own samples, and a test requires the TypeScript output to match it (labels, confidence, priority, route, review reason, retrieval scores and answers). The drop 3 port keeps the same rules (default deny, unknown tool deny, sandbox escape deny, everything logged) but is not a line-by-line parity check, because the tools changed (see below).

## Setup
```bash
npm ci
npm test
```

## Run a playbook
```bash
npm run start -- --playbook helpdesk
npm run start -- --playbook recruiting
npm run start -- --playbook marketing
npm run start -- --playbook scheduling
```
Each run reads the playbook's sample inbox and processes every item end to end. By default the approval gate is **deny**: every "ask" is refused, so you see what would wait on a person. To see the approved path:
```bash
npm run start -- --playbook marketing --approve       # a person approved this run up front
npm run start -- --playbook marketing --approve-cli   # a person types y/n at each gate
```
`HARNESS_APPROVE=yes|cli|deny` does the same. Output goes to `outputs/<playbook>/<denied|approved>/`: `summary.md` (what is waiting on a person), `results.json`, `audit.jsonl`, `drafts/`, `queues/`, `review/` and, where the playbook uses the interviewer, `interviews/` (transcript, scorecard and report per candidate).

Check a playbook without running it: `npm run start -- --check recruiting`. A malformed playbook stops before any work with exit code 3 and a list of every problem.

### What the four playbooks show
- **helpdesk:** IT tickets routed to queues, answers grounded in runbooks. `grant_access` is always "ask", so access changes wait on a person. A request to delete a ticket and run a script (made inside a ticket) is denied. A question about a security-only doc gets "I don't know". A vendor bot asking for the tier-1 seat gets the same work-sample interview a person would.
- **recruiting:** resumes and requests routed to open seats, grounded in job descriptions (fictional, in `docs/` and `resumes/`). The interviewer scores a person, a bot and a team on one rubric. Every item goes to a person (`always_human`), and `update_candidate_status` is denied for everyone, including in the approved run: the system cannot advance or turn down a candidate. One sample resume carries an instruction aimed at AI screeners; it changes nothing. One candidate says no at the consent notice, and nothing is recorded for them.
- **marketing:** content requests triaged, drafts grounded in brand and source docs. `publish` is always gated, and it is a **no-op stub**: even when approved it only writes a line to `outputs/.../publish-stub.jsonl`. Nothing can be published from this repo. An embargoed launch doc is invisible to the requester's groups, so the draft says "I don't know".
- **scheduling:** an interview scheduling assistant for a recruiting team. Interview requests are triaged; for each one, `src/scheduler.ts` (plain code, no model) reads made-up calendars in `calendars.json` and proposes up to three non-overlapping times when the candidate and every interviewer are free, inside each person's own working hours and time zone (daylight saving included). It drafts the invite with each person's local time, and `send_invite` is always "ask": the recruiter approves every invite. It is a **stub**: even approved, it only writes a line to `outputs/.../invites-stub.jsonl`. Nothing is sent or booked from this repo. The sample inbox shows a New York / Chicago / London panel with busy blocks, a fully booked manager and a Chicago / Kolkata pair with no overlap (no slot, so no invite, and a recruiter takes over), an item that asks to skip the recruiter and carries its own invite text (a person reviews it, and an invite written inside an item is denied, even in the approved run: only the scheduler's draft can go to a recruiter), a reschedule that asks to delete the old invite (denied), a parking question answered from the docs, and a salary question that gets "I don't know". The `from` and `to` dates are read as whole UTC days. An item's `interview.opening` must be one plain line of up to 80 letters, digits and basic punctuation, or no invite is drafted. All people, the company and the calendars are fictional.

## Switch to a real model
The default is a built-in stand-in: no key, no network, deterministic. It uses drop 1's keyword classifier, drop 2's pick-the-best-sentence answer, and canned interview answers stored in each playbook's `tasks.json` (`standin` field). The same env switch as the drops:
```bash
MODEL_PROVIDER=ollama MODEL=<a model you pulled> npm run start -- --playbook helpdesk          # OLLAMA_HOST defaults to http://localhost:11434
MODEL_PROVIDER=openai MODEL=<model> OPENAI_API_KEY=<key> npm run start -- --playbook helpdesk  # OPENAI_BASE_URL for any OpenAI-compatible API
```
A real model does three things: picks the triage label, writes the grounded answer or draft, and answers as the bot candidate. It never picks tools: the calls come from the playbook, and the harness decides. Retrieval always uses the built-in hashed embedding. Interview scoring stays the deterministic rubric matcher.

Be careful with real data: tickets, resumes and drafts can hold personal or unreleased information, so use a local model or one your organization has approved. A small local model mislabels tickets (see `proof-real-model.txt`), which is why the help-desk and marketing playbooks also use `always_human_terms`: plain words that send an item to a person whatever label the model picked.

## Make your own playbook
1. Copy a folder: `cp -r playbooks/helpdesk playbooks/finance-ops`.
2. Edit `playbook.json`:
   - `triage.labels` (label → keywords), `triage.routes` (label → queue or seat), `urgent_terms`, `always_human_labels`, `always_human_terms`, optional `always_human: true` and `review_below`.
   - `rag.docs` (a folder of `.md` files, each starting with `groups: [...]` front matter), `rag.default_groups`, `rag.min_score`, `rag.mode` (`answer` or `draft`).
   - `harness.policy`: tool → `allow` | `ask` | `deny`. Anything not listed is denied. `grant_access`, `update_candidate_status`, `send_reply`, `send_invite`, `publish` and `delete_record` can never be `allow`; the schema check refuses it.
   - `actions`: triage label → the tool calls to propose. `{id}`, `{text}`, `{route}`, `{draft}`, `{draft_path}`, `{report}`, `{invite}`, `{invite_path}` and `{from}` are filled in. A call that uses `{report}` or `{invite}` is skipped when there is no report or no open slot.
   - optional `interviewer`: which labels trigger an interview, a `rubric.json` (drop 4's format) and a `tasks.json` with 3 to 5 tasks. Drop 4's seconds/milliseconds cap applies only to a criterion with `"capUnlessUnitFlaw": true` (set on recruiting's planted-bug task), so a copied rubric never inherits it by id.
   - optional `scheduler`: which labels get interview times proposed, a `calendars.json` (`people`: id → `name`, `role`, IANA `tz`, optional `workday` and `busy` blocks in ISO 8601) and `proposals` (1 to 5). Each inbox item for those labels carries `interview`: `candidate`, `panel` (a list of different ids), `minutes`, `from`, `to` (dates, read as UTC days) and an optional one-line `opening`.
   - every path (`inbox`, `rag.docs`, `interviewer.rubric`, `interviewer.tasks`, `scheduler.calendars`, item `attachment`) must stay inside the playbook folder.
3. Write `inbox.jsonl` (one item per line: `id`, `text`, optional `from`, `groups`, `question`, `attachment`, `candidate`, `interview`, `requests`). The inbox is untrusted: `id` may only use letters, digits, `.`, `_` and `-` (it names output files), must be unique, and may not end in `-invite` (reserved for invite drafts); `requests` must be a list of `{tool, args}` with string values; and `save_draft` only writes `drafts/<name>.md`. With `--approve-cli`, the y/n prompt for a tool that reaches outside (`send_reply`, `send_invite`, `publish`) shows the full content.
4. `npm run start -- --check finance-ops`, then `npm run start -- --playbook finance-ops`.

The tools are in `src/harness.ts`. They are local stubs that only write inside the run's outputs folder. Connecting a real ticketing, directory or publishing system means writing a real tool, and that is code, reviewed like any other change.

## What this is not
- Not a production platform: no auth, no queue service, no retries, no UI, no multi-user approvals.
- The stand-in model is canned and keyword-based. The scores and labels in the sample runs show how the pipeline behaves, not how good any model is.
- `--approve` stands in for a person approving the whole run. A real deployment needs named approvers per action.
- The interviewer's default scorer matches key phrases, so it can under-score a strong answer worded differently. A person reads the transcript.
- Drop 4's interviewer is copied as of the date in `STACK.md`. If drop 4 changes, re-copy it (the finale's edits are marked `FINALE`).

## Files
- `src/triage.ts`, `src/rag.ts`, `src/harness.ts`: the ports of drops 1 to 3
- `src/interviewer/`: drop 4's interviewer (copied, edits marked `FINALE`)
- `src/scheduler.ts`: interview slot search across time zones and the invite draft (no model)
- `src/playbook.ts`: loader and schema check; `src/system.ts`: the pipeline; `src/cli.ts`: the command; `src/model.ts`: the stand-in and the env switch
- `playbooks/{helpdesk,recruiting,marketing,scheduling}/`: config, sample inbox, docs, rubric and tasks, calendars (all made up)
- `test/system.test.ts`, `test/scheduler.test.ts`: `node:test` tests; `test/fixtures/`: parity data and a broken playbook
- `.devcontainer/devcontainer.json`, `compose.yaml`: from drop 5
- `STACK.md`, `TEST_LOG.md`, `proof-scheduling.txt` (scheduling run, denied and approved), `LICENSE` (MIT)
