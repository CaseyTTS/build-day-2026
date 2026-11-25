# Stack

| Piece | Version / detail |
|---|---|
| Language | TypeScript 5.9.3 (compiled with `tsc` to `dist/`) |
| Runtime | Node.js 22 or newer (`engines: >=22`). Node 20 is end-of-life and not supported. Proof run on Node v24.22.1 (npm 11.21.1) and Node v22 (via npx node@22) |
| Runtime dependencies | none (uses Node built-ins: `node:readline`, `node:fs`, global `fetch`) |
| Dev dependencies | `typescript` 5.9.3, `@types/node` 22.20.5 (pinned in `package-lock.json`; TypeScript 7.x not adopted, 5.9.3 kept as the safe pin) |
| Tests | `node:test` + `node:assert` (built in), run on the compiled output |

## Model providers
| `MODEL_PROVIDER` | Calls | Env vars |
|---|---|---|
| `standin` (default) | Nothing. Built-in canned answers, deterministic, no key, no network | none |
| `ollama` | `POST {OLLAMA_HOST}/api/chat` (Ollama's chat API, `stream: false`, temperature 0) | `OLLAMA_HOST` (default `http://localhost:11434`), `MODEL` |
| `openai` | `POST {OPENAI_BASE_URL}/chat/completions` (OpenAI Chat Completions format, temperature 0) | `OPENAI_API_KEY`, `OPENAI_BASE_URL` (default `https://api.openai.com/v1`; any OpenAI-compatible API works), `MODEL` |

`SCORER=model` makes the configured model score too, with a verbatim-quote check. Default scoring is the deterministic rubric matcher.

## Editors and tools
It runs in plain VS Code with an integrated terminal. It is a plain Node project with no editor-specific config, so it runs the same way in Cursor, Claude Code or Codex. No tool-specific features are used or claimed.
