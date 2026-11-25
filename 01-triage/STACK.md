# STACK: drop 1, AI triage bot

**Scope:** A starter that classifies and routes queue items with a human review step, not a production system.

| Item | Value |
|---|---|
| Language | Python 3.10+ (tested on Python 3.13.5) |
| Runtime dependencies | none (standard library only) |
| Dev/test dependencies | `pytest==9.2.0` (`requirements-dev.txt`); no lockfile needed for a single pinned dev dependency |
| Model / API (default) | **Built-in mock**: keyword classifier over the labels in `queues.json`. No network, no key. |
| Model / API (real) | Any **OpenAI-compatible** API. Set `TRIAGE_PROVIDER=openai` plus `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY` (if needed). Examples: OpenAI (`AI_BASE_URL=https://api.openai.com/v1`, `AI_API_KEY=<key>`) or local Ollama (`AI_BASE_URL=http://localhost:11434/v1`, no key). See `.env.example`. **Not verified against either provider.** |
| Proof commands | `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt && python -m pytest -q && python triage.py run samples.jsonl` |
| Proof output | `proof.txt` |
| License | MIT (`LICENSE`) |

**Runs in:** any terminal with Python 3.10+. Plain VS Code is the baseline. Because this is a plain Python project with no editor-specific files, it should work the same in Cursor, Claude Code or Codex. No tool-specific features are used or claimed.

**Why Python, not the TypeScript default:** the whole drop is one file using only the Python standard library (`json`, `urllib.request`, `http.server` for the test stand-in). There is no runtime dependency, no build step and no lockfile to drift, so a reader can copy one file and run it. A TypeScript port is doable later. It was not done tonight, because an independent reviewer is reviewing this exact code and a port would change what they are checking.
