# TEST_LOG: drop-4 interview harness

Full captured output: `proof.txt` (clean copy at <drop>, node_modules and dist deleted, then npm ci, npm test, demo:bot, demo:team).
- Date: 2026-11-18 22:29:35 CST (Linux test machine), Node v24.22.1, npm 11.21.1
- npm test: 19/19 pass on Node v24.22.1 and Node v22.23.5 (cap is `capUnlessUnitFlaw` on the criterion, applied to both scorers; approving the PR still caps at 2 even if a stray "units" is present, including phrasing such as "Approved, ship it"; a model scorer's raw score is recorded in the note before any cap).
- demo:bot scores: connect_to_work=3, judge_output=4, tools_within_limits=4, own_the_result=3 (stand-in still names the unit flaw and does not approve, so T2 remains 4).
- demo:team scores: connect_to_work=3, judge_output=3, tools_within_limits=3, own_the_result=4
- Default scoring is the deterministic signal matcher, with the capUnlessUnitFlaw rule described above.

## Mocked / not verified
- The bot is the built-in stand-in (canned answers). The demo:team "person" is scripted lines.
- Ollama and OpenAI-compatible calls were tested in npm test only against a local fake HTTP server. Real-model quality is in `proof-real-model.txt`.
- The default scorer is a keyword-signal matcher; it can under-score strong answers worded differently. A human still makes the hiring call.
