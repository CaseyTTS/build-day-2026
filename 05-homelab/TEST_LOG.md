# TEST_LOG: drop-5 build-anywhere-ts

- Date: 2026-11-18 20:57 CST (Linux test machine), npm 11.21.1; run in a clean temp copy
- Installed: typescript 6.0.3, eslint 10.15.0, @eslint/js 10.0.1, typescript-eslint 8.73.0, @types/node 22 (lockfile committed)

## 1. Node 24.22.1
```
$ npm ci
found 0 vulnerabilities
$ npm run lint
exit=0
> build-anywhere-ts@1.0.0 lint
> eslint .

$ npm test
exit=0
✔ codespaces wins when its variable is set (0.58201ms)
✔ dev container is detected from its marker variable (3.586387ms)
✔ plain container falls back to /.dockerenv (0.142246ms)
✔ otherwise it is the host (0.082105ms)
✔ report names the node version (0.267159ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
$ npm start
node v24.22.1 on linux/x64 | host test-host | place: host
$ DEVCONTAINER=true npm start
node v24.22.1 on linux/x64 | host test-host | place: dev-container
$ CODESPACES=true npm start
node v24.22.1 on linux/x64 | host test-host | place: codespaces
```
## 2. Node 22.23.5 (the image's major version)
`node --test "dist/test/**/*.test.js"` -> tests 5, pass 5, fail 0; `node dist/src/index.js` -> `node v22.23.5 on linux/x64 | ... | place: host`

## 3. Config validation
- `.devcontainer/devcontainer.json` validated against the official devContainer.base.schema.json (devcontainers/spec, main): 0 errors
- Image `mcr.microsoft.com/devcontainers/typescript-node:22-bookworm`: registry manifest returns HTTP 200 (tag exists)
- `docker compose -f compose.yaml config --quiet` (Compose v5.8.0, standalone binary): valid
- Found while building: TypeScript 7.0.2 (npm latest) conflicts with typescript-eslint 8.73.0's peer range (<6.1.0); pinned `typescript ~6.0`.

## Not verified here
- Running inside a container, Codespaces, or VS Code Dev Containers (no Docker daemon on the test machine; `devcontainer read-configuration` exits 1 without Docker).
- Proxmox (any Docker host should behave the same; not tested).
- Windows/macOS hosts.

## Update 21:08 CST: Node 20 support
- Node 20 does not accept the glob form `node --test "dist/test/**/*.test.js"`. It fails with "Could not find". The test script now names the file (`node --test dist/test/where.test.js`), which works on Node 20, 22 and 24.
- `engines` is now `>=20.19`, matching ESLint 10's floor (`^20.19.0 || ^22.13.0 || >=24`). Added a `demo` script. The lockfile was re-synced, and dependency versions are unchanged.
- Clean-copy proof on Node 24.22.1, plus tests and the demo on Node 20.20.2: see `proof.txt`.

## Re-run after independent review (2026-11-18 21:14 CST): supersedes the 21:08 update
- `engines` is back to `>=22`, because Node 20 reached end of life on 2026-04-30. The test script uses the glob form again (`node --test "dist/test/**/*.test.js"`), which works on Node 22+. The lockfile was re-synced, and dependency versions are unchanged.
- `devcontainer.json` `postCreateCommand` is now `npm ci && npm run check && npm run demo`, so the README line "All three run npm ci, then npm run check" is now true. Re-validated against the devContainer schema: see below.
- Clean-copy proof (`proof.txt`), Node 24.22.1: npm ci, lint clean, 5/5 tests, demo (host and dev-container). Node 22.23.5: 5/5 tests and the demo. Compose config is valid. Docker is not installed, so no container was run.
- devcontainer.json schema errors after edit: 0
