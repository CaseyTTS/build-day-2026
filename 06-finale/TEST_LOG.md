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
npm run check:playbooks
node dist/src/cli.js --playbook test/fixtures/bad-playbook   # exit code 3
```

## Tests (31, node:test), all pass (29 on Node 24.22.1 and Node 22.23.5 on 2026-11-18; 31 on Node 24.22.1 after tests 30-31 were added)
1. Triage port matches drop 1's `triage.py` on its 13 samples (label, confidence, priority, route, review).
2. RAG port matches drop 2's `rag.py` on its 5 questions (hits, scores, answers).
3. RAG: a doc the reader's groups can't see never reaches ranking; the answer is "I don't know".
4. Harness: unknown tool, unlisted tool, deny and sandbox escape are denied; ask → not-approved by default; approved runs the stub; every call is logged.
5–8. Schema: the three playbooks pass; a malformed playbook lists every problem; the CLI exits 3 before any work; publish is never "allow".
9–11. End to end per playbook: denied run lets nothing past an "ask", approved run lets asks through, "deny" stays denied, outputs and audit log written, at least one honest "I don't know".
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

Stand-in proof regenerated 2026-11-18 22:29 CST from a clean copy at `<drop>`. Interviewer `score.ts` sha256 prefix `8f5ac727c062` (drop 4, after recording the raw model score).

## Mocked or not run
- Stand-in model in every default run: no real AI model in `proof.txt`.
- Scripted people (fixed lines in `inbox.jsonl`).
- All tools are local stubs. `publish` is a no-op. Nothing was sent, published or changed outside `outputs/`.
- `--approve` stands in for a person approving the whole run.
- No Docker on this machine: `.devcontainer/devcontainer.json` and `compose.yaml` were not run. Windows and macOS were not tested.
