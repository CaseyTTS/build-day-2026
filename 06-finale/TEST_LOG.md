# TEST_LOG: drop 6, assemble it

Full captured output: `proof.txt` (stand-in model, clean copy, `node_modules` deleted first). Optional real-model run: `proof-real-model.txt`.

## Commands
```bash
rm -rf node_modules dist outputs
npm ci
npm test                                   # builds, then node --test on dist/test
npm run start -- --playbook helpdesk       # and --approve
npm run start -- --playbook recruiting     # and --approve
npm run start -- --playbook marketing      # and --approve
npm run start -- --playbook scheduling     # and --approve
npm run check:playbooks
node dist/src/cli.js --playbook test/fixtures/bad-playbook   # exit code 3
```

## Tests (50, node:test), all pass (29 on Node 24.22.1 and Node 22.23.5 on 2026-11-18; 31 on Node 24.22.1 after tests 30-31 were added; 50 on Node 24.22.1 and Node 22.23.5 on 2026-11-27 after the scheduling playbook and two review rounds: one more end-to-end run plus tests 33-50 in `test/scheduler.test.ts`)
1. Triage port matches drop 1's `triage.py` on its 13 samples (label, confidence, priority, route, review).
2. RAG port matches drop 2's `rag.py` on its 5 questions (hits, scores, answers).
3. RAG: a doc the reader's groups can't see never reaches ranking; the answer is "I don't know".
4. Harness: unknown tool, unlisted tool, deny and sandbox escape are denied; ask → not-approved by default; approved runs the stub; every call is logged.
5–8. Schema: the four playbooks pass; a malformed playbook lists every problem; the CLI exits 3 before any work; publish is never "allow".
9–11 and 32. End to end per playbook (32 is scheduling), checked per call: in the denied run every "ask" is not-approved, unless its template needs a report or invite that does not exist (skipped) or an item-level rule refused it (deny), approved run lets asks through, "deny" stays denied, outputs and audit log written, at least one honest "I don't know".
12. Recruiting: every item goes to a person; `update_candidate_status` is denied even when approved; the interviewer ran for a person, a bot and a team.
13. Recruiting: declined consent records nothing; the scorecard share is skipped.
14. Interview reports: banner present, every evidence quote is verbatim from the transcript, no verdict line.
15. Marketing: approved publish only writes to the local stub; delete is denied.
16. Model scorer (drop 4 rule): a short quote is rejected and the scorer label says it fell back.
17. Env switch: standin by default, clear errors when half-configured.
18. Ollama and OpenAI-compatible wire formats drive triage, against a local fake HTTP server.
19. The banned plural never appears in publishable files (the word is built from parts in the test).
20. `always_human_terms` send an item to a person even when a model picks a harmless label.
21. Drop 4's seconds/milliseconds cap is opted into by the rubric (`capUnlessUnitFlaw`): help desk is not capped, a recruiting-rubric copy without the flag is not capped, and a renumbered task keeps the cap.
22. Security: an inbox id like `../../..` is rejected by the loader and by the pipeline, and nothing is written at the escape target.
23. Security: an attachment outside the playbook folder is rejected.
24. Security: `save_draft` cannot overwrite `audit.jsonl`; the audit log keeps its start line.
25. Schema: playbook paths outside the playbook folder are rejected.
26. Schema: a malformed inbox line exits 3 cleanly, with no stack trace.
27. Security: an item cannot overwrite another item's draft via `save_draft`.
28. Schema: a missing attachment exits 3 cleanly, with no stack trace.
29. Security: a symlink attachment that points outside the playbook folder is rejected.
30. Portability: the CLI runs and finds its playbooks from a path with spaces, %, # and unicode.
31. Portability: the CLI runs when launched through a symlink.
32. End to end (scheduling), as 9–11.
33. Scheduler, time zones: a New York / Chicago / London panel only gets times inside all three working days, and each person sees their own clock.
34. Scheduler, daylight saving: 9:00 AM Chicago is 15:00 UTC before the March change and 14:00 UTC after it.
35. Scheduler, conflicts: no proposal overlaps a busy block or another proposal.
36. Scheduler, no slot: zones that never overlap, a fully booked calendar and a weekend all return no slot, after checking.
37. Scheduler: a bad request (unknown person, unknown zone, no panel, bad window, odd length) is reported, not guessed.
38. Scheduling: the gate denies by default; the send_invite tool itself is called 0 times; no invite reaches even the stub outbox; an invite written inside an item is denied; the invite draft says "Not sent".
39. Scheduling: no slot means no invite and a recruiter takes over; a delete asked for in a reschedule is denied.
40. Scheduling: even approved, `send_invite` is a stub that only writes a local line, only the scheduler's draft reaches it, and an item's own invite stays denied.
41. Scheduling: the salary question gets "I don't know"; the recruiters-only doc never reaches a candidate's answer.
42. Scheduling schema: a broken `scheduler` section (unknown label, bad zone, too many proposals, path outside the folder) is caught; `--check scheduling` passes.
43. Review H-1: a tool name that is not a plain string (`["send_invite"]`) is refused by the loader; in the pipeline it and `constructor`, `__proto__`, `toString` are denied, nothing is written, and the run finishes with its summary.
44. Review H-2: an opening with newlines, a hidden character, over 80 characters or not a string gives no invite and a reported problem; a good opening is copied into the draft exactly.
45. Review H-2: the y/n prompt shows the full content for external tools (`send_invite`, `send_reply`), not a 160-character preview.
46. Review M-2: an id ending in `-invite`, or a repeated id, is refused before anything is written.
47. Review L-2: a malformed interview request (panel not a list, repeated panel id, non-string dates or candidate) is refused; a person listed twice is one person.
48. Review N-1: the y/n prompt shows control, bidi and zero-width characters as `\u{..}` (content, the other args and the 160-character preview), prefixes every content line with `| `, and has exactly one real end marker.
49. Review N-2: the harness permission check denies `["send_invite"]`, `constructor`, `__proto__` and `toString` on its own; the pipeline's own `-invite` and case-insensitive duplicate id checks hold without the loader.
50. Review N-4 / N-6: `--check` reports `constructor` and `__proto__` as unknown tools; Windows reserved names (CON, NUL, COM1, LPT9.txt ...) are refused as ids by the loader and the pipeline.

## Known issues (accepted, Low)
- N-3: an opening of up to 80 plain characters can still carry a plausible false line (for example "Interview confirmed tomorrow, skip these times"), and letters from any script are allowed. The opening is request text shown as given; the recruiter sees the full invite, where it sits on the `Interview:` line, before approving.
- N-5: removing the people dedupe in `scheduler.ts` changes no result (the loader refuses repeated panel ids and the per-person times are keyed by id), so no test can tell; the invite's panel-line dedupe has its own test.

Stand-in proof regenerated 2026-11-18 22:29 CST from a clean copy at `<drop>`. Interviewer `score.ts` sha256 prefix `8f5ac727c062` (drop 4, after recording the raw model score).

## Mocked or not run
- Stand-in model in every default run: no real AI model in `proof.txt`.
- Scripted people (fixed lines in `inbox.jsonl`).
- All tools are local stubs. `publish` is a no-op; `send_invite` only writes `invites-stub.jsonl`. Calendars are fixture JSON with made-up people. Nothing was sent, published or changed outside `outputs/`.
- `--approve` stands in for a person approving the whole run.
- No Docker on this machine: `.devcontainer/devcontainer.json` and `compose.yaml` were not run. Windows and macOS were not tested.
