---
'@objectstack/cli': patch
---

fix(cli): a direct `os serve --dev` compiles the config before its dev artifact door serves it, so the served connector `baseUrl` is the one dispatch calls

Clause-②: no
Metadata-protocol: none

- **Before.** `os serve --dev` over an existing `dist/objectstack.json` served that file through the dev artifact door as found, while dispatch read the config module it evaluated. A config value read from the environment, such as `examples/app-showcase`'s self URL built from `OS_PORT`, then differed between them. With `OS_PORT=41302` over an artifact built without it, `GET /api/v1/meta/connector/showcase_status_api` served `http://127.0.0.1:3000` while the connector called port 41302. `os dev` had the same split until it began compiling at boot.
- **Now.** Before it composes that door, a direct dev boot compiles the config into the artifact in its own environment, using the same decision `os dev` uses (`devCompilesAtBoot`), so both copies come from one evaluation. A failed compile refuses the boot, as under `os dev`. This costs about 3 s per boot on the showcase.
- Under `os dev`, the `serve` child keeps its parent's decision and never compiles again, so `os dev --no-compile` still boots the artifact as built. A dev boot with no artifact on disk composes no door and compiles nothing, as before. A pinned artifact (`OS_ARTIFACT_URL`) is never rebuilt.
- Production `os serve` (no `--dev`, `NODE_ENV` not `development`) and `os start` are unchanged.
