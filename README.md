# Build Day 2026: six runnable builds

Built by the CornerStone AI Research Lab at CornerStone Technology Talent Services.

## Prerequisites

- Python 3.10+ (3.13 recommended) for drops 01-03
- Node.js 22.13+ (24 LTS recommended) with npm for drops 04-06
- Git. No API keys or model needed: every drop runs in mock (stand-in) mode by default.

## Get the code

Copy the URL from the green **Code** button on this repo's GitHub page, then:

```bash
git clone <repo-url> build-day-2026
cd build-day-2026
```

## Run everything at once

`run-all.sh` (macOS, Linux, WSL, Git Bash) and `run-all.ps1` (Windows PowerShell) run every drop's tests and demos in mock mode and print a pass/fail summary.

```bash
bash run-all.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\run-all.ps1
```

## The six drops

Or run one drop at a time from its folder:

- **01-triage** — A starter that classifies and routes queue items with a human review step, not a production system. Run: `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt && python -m pytest -q`
- **02-rag** — A starter that shows the five RAG steps on four sample docs, not a production search system. Run: `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt && python -m pytest -q`
- **03-harness** — A starter skeleton that gates an agent's tool calls, not a production agent platform or a security sandbox. Run: `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt && python -m pytest -q`
- **04-interview** — a starter interview harness that runs one work-sample interview against a person, a bot, or a team and drafts an evidence-backed scorecard, not a hiring system. Run: `npm ci && npm test`
- **05-homelab** — A starter that shows one TypeScript project running the same way on a home-lab Docker host and in a cloud dev environment; it is not a deployment or hosting setup. Run: `npm ci && npm test`
- **06-finale** — A runnable reference system that shows five starters working together and repurposed by config, not a production platform. Playbooks: help desk, recruiting, marketing and an interview scheduling assistant (all sample data made up). Run: `npm ci && npm test`

Runs in plain VS Code; works the same in Cursor, Claude Code or Codex.
