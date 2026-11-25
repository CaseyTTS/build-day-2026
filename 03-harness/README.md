# The agent harness: guardrails as a graph

Built by the CornerStone AI Research Lab at CornerStone Technology Talent Services.

**Scope:** A starter skeleton that gates an agent's tool calls, not a production agent platform or a security sandbox.

**Runs in:** any terminal with the listed runtime. Plain VS Code is the baseline; because this is a plain Python project with no editor-specific files, it should work the same opened in Cursor, Claude Code or Codex. No tool-specific features are used or claimed.

Most agent safety lives in a system prompt. This puts it in the control flow instead:

```
task → plan → tool call → permission check → human approval gate → log → result
```

The model only **proposes** steps. The harness decides, per call, whether it runs:
- every tool declares a risk (`read`, `write`, `destructive`)
- the planner prompt includes each tool's argument schema; args that do not match (wrong or missing names) are a clear error, not a TypeError, and the tool does not run
- a policy maps risk to `allow`, `ask`, or `deny`; unknown tools are denied
- `ask` stops at a human gate (default in CI: refuse)
- tools only see a sandbox folder; escapes are denied
- a step budget caps runaway loops
- every node writes a line to `audit.jsonl`

## Files
- `harness.py`: the skeleton (stdlib only, Python 3.10+), about 120 lines
- `workspace_demo/`: the only folder the demo agent may touch
- `test_harness.py`, `mock_openai.py`: tests, including a fake OpenAI-compatible planner

## Run it (no keys, no model)
```bash
python3 harness.py                          # write is refused, delete denied, escape denied, unknown tool denied
HARNESS_APPROVE=cli python3 harness.py      # you approve the write at the gate; everything else still blocked
git checkout -- workspace_demo/notes.txt   # optional: the approved write edits the demo file; restore it to replay the demo
cat audit.jsonl
pip install pytest && pytest -q test_harness.py
```
The mock planner deliberately proposes a delete, a sandbox escape, and an unregistered `shell` tool.

## Use a real model as the planner
```bash
export HARNESS_PLANNER=openai AI_BASE_URL=http://localhost:11434/v1 AI_MODEL=<model>   # or any OpenAI-compatible endpoint
python3 harness.py "Fix the typo in notes.txt"
```
The gates do not change when the model does. That is the point.

## Make it yours
- Add tools with `@tool("read" | "write" | "destructive")`; keep the policy table in code review.
- Replace `approval_gate` with a chat or ticket approval; keep the default as "refuse".
- Redact secrets before logging tool args.
- Use OS-level isolation (container, separate user, scoped tokens) as well; an in-process sandbox check is a seatbelt, not a wall.

## Where multi-agent setups tend to break
At the handoffs: when one agent passes work to another, the permissions, budget, and audit trail
often stay behind. Run every agent's tool calls through the same gate and log.

## Setup and proof commands (from a clean copy)
```bash
python3 -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt                  # pytest only; the code itself has no dependencies
python -m pytest -q
python harness.py
```
Optional: copy `.env.example` to `.env`, fill it in, then `set -a; . ./.env; set +a` (the code reads environment variables; it does not load `.env` by itself).

License: MIT (see `LICENSE`). No warranty.
