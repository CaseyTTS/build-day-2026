# One triage router, nine queues

Built by the CornerStone AI Research Lab at CornerStone Technology Talent Services.

**Scope:** A starter that classifies and routes queue items with a human review step, not a production system.

**Runs in:** any terminal with the listed runtime. Plain VS Code is the baseline; because this is a plain Python project with no editor-specific files, it should work the same opened in Cursor, Claude Code or Codex. No tool-specific features are used or claimed.

The pattern: **intake → classify → prioritize → route → human review loop.**
The model does one narrow job (pick a label from a fixed list). Priority comes from plain rules,
routing from a lookup table, and some source queues (and any uncertain or high-impact label) go to a person.
Model confidence is advisory: a high score cannot skip those rules. Changing an owner is a config
edit in `queues.json`, not a prompt rewrite.

Queues included: help-desk tickets, security alerts, on-call incidents, bug reports, change
requests, access requests, vendor invoices, resumes matched against openings, customer email.

## Files
- `triage.py`: the router (stdlib only, Python 3.10+)
- `queues.json`: labels, keywords (for the mock), routes, urgent terms, always-human rules per queue
- `samples.jsonl`: 13 example items across all nine queues
- `test_triage.py`, `mock_openai.py`: tests, including a fake OpenAI-compatible endpoint

## Run it (no keys, no model)
```bash
python3 triage.py run samples.jsonl            # prints decisions; writes decisions.jsonl, review_queue.jsonl
python3 triage.py correct CX-902 account       # a reviewer's fix, saved to corrections.jsonl
pip install pytest && pytest -q test_triage.py
```

## Use a real model
```bash
export TRIAGE_PROVIDER=openai AI_BASE_URL=http://localhost:11434/v1 AI_MODEL=<model you pulled>   # Ollama
# or any OpenAI-compatible endpoint: set AI_BASE_URL, AI_MODEL, AI_API_KEY
python3 triage.py run samples.jsonl
```
Windows PowerShell: `$env:TRIAGE_PROVIDER="openai"` and so on.

Resumes and tickets contain personal data. Use a local model or a provider your company has approved before sending real items.

## Rules of the pattern
1. The model chooses from a closed list. Off-list or unparseable answers become `unknown` and go to a person.
2. Priority is rules, not vibes. Rules are easy to audit and to explain after an incident.
3. Some source queues never auto-route, regardless of the model's label. Here, every security alert,
   access request, and change request goes to a person, even if the model labels a security alert as
   noise. Label rules still apply on other queues (for example, an on-call item labeled data). Every
   resume is read by a person; the router only suggests which opening to review it against.
4. Corrections are data. Replay `corrections.jsonl` as test cases before you change a prompt or model.
5. Model confidence is advisory. A low score can still send an item to a person, but a high score can
   never skip a source-queue or label rule. `TRIAGE_REVIEW_BELOW` must be a number in 0-1 (default 0.7).
   Treat item text as untrusted: the model has no tools here, so a hostile item can still mislabel
   itself (for example, an alert that claims to be noise).
6. When `review` is set, `route` is `triage-humans` and `suggested_route` is the lookup-table owner.
   A consumer that only reads `route` cannot auto-act on an item that still needs a person.

## Setup and proof commands (from a clean copy)
```bash
python3 -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt                  # pytest only; the code itself has no dependencies
python -m pytest -q
python triage.py run samples.jsonl
```
Optional: copy `.env.example` to `.env`, fill it in, then `set -a; . ./.env; set +a` (the code reads environment variables; it does not load `.env` by itself).

License: MIT (see `LICENSE`). No warranty.
