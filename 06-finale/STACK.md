# STACK: drop 6, assemble it (five builds, one system)

**Scope:** A runnable reference system that shows five starters working together and repurposed by config, not a production platform.

| Item | Value |
|---|---|
| Language | TypeScript on Node.js 22+ (`engines: >=22`). Tested on Node 24.22.1 (npm 11.21.1) and Node 22.23.5. Node 20 reached end of life on 2026-04-30. |
| Port or subprocess | **Full port.** Drops 1, 2 and 3 (Python) were ported to TypeScript modules. No Python runs at runtime. Drop 4 (TypeScript) is copied. Drop 5's container files are reused. |
| Runtime dependencies | none (Node built-ins: `node:fs`, `node:path`, `node:crypto`, `node:readline`, global `fetch`) |
| Dev dependencies | `typescript 6.0.3`, `@types/node 22.20.5`, exact pins, `package-lock.json` committed. ESLint from drop 5 is left out to keep dependencies minimal. |
| Tests | `node:test` + `node:assert`, run on the compiled output (`npm test`) |
| Playbook format | JSON (no YAML parser dependency), checked by `src/playbook.ts` before any run |
| Container image | `mcr.microsoft.com/devcontainers/typescript-node:22-bookworm` (same as drop 5; `.devcontainer/devcontainer.json`, `compose.yaml`). **Not run on this machine: no Docker.** |
| Proof | `proof.txt` (stand-in), `proof-real-model.txt` (optional local Ollama run), `TEST_LOG.md` |
| License | MIT (`LICENSE`), CornerStone Technology Talent Services |

## Model providers
| `MODEL_PROVIDER` | Calls | Env vars |
|---|---|---|
| `standin` (default) | Nothing. Drop 1's keyword classifier, drop 2's extractive answer, canned interview answers from each playbook's `tasks.json` | none |
| `ollama` | `POST {OLLAMA_HOST}/api/chat` (`stream: false`, temperature 0) | `OLLAMA_HOST` (default `http://localhost:11434`), `MODEL` |
| `openai` | `POST {OPENAI_BASE_URL}/chat/completions` (temperature 0) | `OPENAI_API_KEY`, `OPENAI_BASE_URL` (default `https://api.openai.com/v1`; any OpenAI-compatible API), `MODEL` |

A real model is used for the triage label, the grounded answer or draft, and the bot candidate's answers. Retrieval always uses the built-in hashed embedding, interview scoring always uses the deterministic rubric matcher, and the model never chooses tools. The OpenAI-compatible path is tested only against a local fake server in `npm test`. The Ollama path was also run against a real local model (see `proof-real-model.txt`). No paid API was called.

## Where each piece came from
| Piece | Source | How |
|---|---|---|
| `src/triage.ts` | drop 1 `triage.py` | Ported. Parity test against Python output on drop 1's 13 samples. Addition: `always_human_terms`. |
| `src/rag.ts` | drop 2 `rag.py` | Ported (same MD5-hashed 4096-dim embedding, chunking, stemming, threshold). Parity test against Python output on drop 2's 5 questions. Change: no embedding-model option. |
| `src/harness.ts` | drop 3 `harness.py` | Ported rules: risk per tool, default deny, unknown tool deny, ask → approval gate (default deny), sandbox escape → deny, tool errors are results, audit log per call. Changes: per-tool policy from the playbook, new stub tools, `--approve` flag. |
| `src/interviewer/` | drop 4 `src/*.ts` | Copied, re-synced after drop 4's reviewer fixes (quote check needs 20+ characters and 4+ words, `(no answer)` turns filtered, `<` escaped in report quotes, honest scorer label, the seconds/milliseconds cap, now set by `capUnlessUnitFlaw` in drop 4 itself). FINALE edits are only the model import path, playbook wording, required tasks and the non-null index; the header of each file has the sha256 of the drop 4 file it came from. |
| `playbooks/recruiting/rubric.json`, `tasks.json` | drop 4 `rubric.json`, `tasks.ts` + stand-in answers in `model.ts` | Copied (tasks converted to JSON). |
| `.devcontainer/`, `compose.yaml`, `tsconfig.json` | drop 5 | Copied; commands changed to `npm test` and a playbook run. |

**Runs in:** any terminal with Node 22+. Plain VS Code is the baseline. Because this is a plain Node project, it should work the same in Cursor, Claude Code or Codex. The `.devcontainer/` folder follows the open Dev Container spec, which VS Code and GitHub Codespaces read. No other tool-specific features are used or claimed.
