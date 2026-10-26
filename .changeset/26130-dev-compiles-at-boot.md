---
'@objectstack/cli': patch
---

fix(cli): `os dev` compiles the config before it boots, so the served connector `baseUrl` is the one dispatch calls

Clause-②: no
Metadata-protocol: none

- **Before.** `os dev` booted whatever `dist/objectstack.json` already held, and compiled only when it was missing or `--compile` was passed. A host config's dev boot serves the stack from two copies: the config module the server evaluates (what a provider-bound connector is materialized from, so what dispatch calls) and the artifact (what `/api/v1/meta/<type>` serves). A config value read from the environment, such as `examples/app-showcase`'s self URL built from `OS_PORT`, then differed between them. With `OS_PORT=41302` over an artifact built without it, `GET /api/v1/meta/connector/showcase_status_api` served `http://127.0.0.1:3000` while the connector called port 41302.
- **Now.** `--compile` is on by default: `os dev` compiles `objectstack.config.ts` into the artifact it serves, in its own environment, before the server starts, so both copies come from one evaluation. The watch loop already recompiled in that environment.
- **`--no-compile`** boots the existing artifact as built, as a bare `os dev` did before (it is still compiled when missing, and the startup warning still says when it is older than the sources). A pinned artifact (`--artifact`, `OS_ARTIFACT_URL`, a remote `OS_ARTIFACT_PATH`) is never rebuilt. With no `objectstack.config.ts`, an existing artifact boots as before.
- `os serve` and `os start` are unchanged.
