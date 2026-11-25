# build-anywhere-ts: one TypeScript starter, home lab or cloud dev environment

Built by the CornerStone AI Research Lab at CornerStone Technology Talent Services.

**Scope:** A starter that shows one TypeScript project running the same way on a home-lab Docker host and in a cloud dev environment; it is not a deployment or hosting setup.

**Runs in:** any terminal with the listed runtime. Plain VS Code is the baseline; because this is a plain Node/TypeScript project with no editor-specific files, it should work the same opened in Cursor, Claude Code or Codex. No tool-specific features are used or claimed.

The same repo runs unchanged on a home-lab Docker host (a Proxmox VM, a spare PC) and in a
cloud dev environment (GitHub Codespaces or a local VS Code Dev Container), because both use
the same container image. It prints where it thinks it is running.

## Files
- `package.json`, `package-lock.json`: TypeScript 6.0, ESLint 10 (flat config), typescript-eslint 8
- `tsconfig.json`: strict, NodeNext modules
- `eslint.config.js`: recommended + type-aware rules
- `src/`, `test/`: a tiny module and `node:test` tests
- `.devcontainer/devcontainer.json`: for Codespaces and VS Code Dev Containers
- `compose.yaml`: for any Docker host in a home lab

## Run it
**On your machine (Node 22+):**
```bash
npm ci && npm test && npm run demo     # or: npm run check (lint + test)
```
**Home lab (any Docker host):**
```bash
docker compose run --rm dev
```
**Codespaces:** push the repo, then Code → Codespaces → Create. **VS Code:** "Dev Containers: Reopen in Container".
All three run `npm ci`, then `npm run check` (lint + build + tests) and print the place.

## Why TypeScript 6.0 and not 7
At the time of writing, typescript-eslint's peer range stops below TypeScript 6.1, so `npm install`
with TypeScript 7 fails dependency resolution. Check `npm view typescript-eslint peerDependencies`
before you bump.

## Choosing where to build (no universal answer)
- **Cost**: home lab = hardware + power up front; cloud = pay per use, watch idle time.
- **Control**: home lab = you own the hardware, network, and data; cloud = the provider's policies and limits.
- **Speed**: cloud = new environment in minutes, near the repo; home lab = no per-hour clock, local network speed.
- **Security**: home lab = you patch and segment everything; cloud = managed isolation, but secrets and access live with the provider.

No model or API key is involved; `.env.example` lists only an optional test variable.

License: MIT (see `LICENSE`). No warranty.
