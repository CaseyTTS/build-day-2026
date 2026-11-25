# STACK: drop 5, home lab vs virtual dev (TypeScript starter)

**Scope:** A starter that shows one TypeScript project running the same way on a home-lab Docker host and in a cloud dev environment; it is not a deployment or hosting setup.

| Item | Value |
|---|---|
| Language | TypeScript on Node.js 22.13+ (`engines: >=22.13`; tested on Node 24.22.1 and 22.23.5. Node 20 reached end of life on 2026-04-30) |
| Dev dependencies (package.json range → locked version) | `typescript ~6.0 → 6.0.3`, `eslint ^10.15.0 → 10.15.0`, `@eslint/js ^10.0.1 → 10.0.1`, `typescript-eslint ^8.73.0 → 8.73.0`, `@types/node ^22.20.5 → 22.20.5` (`package-lock.json` committed) |
| Runtime dependencies | none |
| Model / API | **None.** This drop calls no model or API, so it needs no keys or env vars. |
| Container image | `mcr.microsoft.com/devcontainers/typescript-node:22-bookworm` (used by `.devcontainer/devcontainer.json` and `compose.yaml`) |
| Proof commands | `rm -rf node_modules dist && npm ci && npm test && npm run demo` (plus `npm run lint`) |
| Proof output | `proof.txt` |
| License | MIT (`LICENSE`) |

**Runs in:** any terminal with Node 22.13+. Plain VS Code is the baseline. Because this is a plain Node project, it should work the same in Cursor, Claude Code or Codex. The `.devcontainer/` folder follows the open Dev Container spec, which VS Code and GitHub Codespaces read. No other tool-specific features are used or claimed.

**Why TypeScript 6.0, not 7:** typescript-eslint 8.73.0 declares `typescript >=4.8.4 <6.1.0` as its peer range, so TypeScript 7 fails `npm install` dependency resolution as of Nov 18, 2026.
