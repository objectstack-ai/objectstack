---
"@objectstack/cli": patch
---

`os package publish --install` installs into the environment `os environments switch` just selected, instead of refusing with ``--install` requires `--env <id>``. Nobody remembers a UUID.

The two credential stores are two **identities on two servers**, and the active environment used to live in only one of them. `os environments switch` wrote `activeEnvironmentId` into `~/.objectstack/credentials.json` (the runtime identity, written by `os login`); `os package publish` reads `~/.objectstack/cloud.json` (the cloud identity, written by `os cloud login`) and never opened the other file — so the environment the CLI had just called active, and that `os environments list` marks with a ★, was invisible to the one command that could install into it.

- **The id now lives in `cloud.json`, beside `activeOrgId`** — the `CloudConfig` field that was already there for exactly this kind of control-plane scope selector, one level up.
- **`os environments switch` records it there as well** when the control plane it just talked to *is* `cloud.json`'s `url`, and keeps writing `credentials.json` unchanged — that copy is what `createApiClient` reads for the `data` / `meta` / `environments` families.
- **`--install` with no `--env` and no `$OS_ENVIRONMENT_ID`** falls back to that value, and only when `cloud.json`'s `url` is the control plane being published to.
- **A value written by an older CLI is migrated once**, and only when both files' `url`s agree.
- ⛔ **Publish never reads `credentials.json` for this.** That is not a purity argument: the files carry *different servers* — `credentials.json`'s url falls back to `http://localhost:3000`, `cloud.json`'s default is `https://cloud.objectos.ai`, and the publish POSTs to the latter. An id taken from the runtime store can therefore name an environment on a **different control plane**, which the server resolves by bare id with no name or short-id rescue. The url gate, not the file name, is the invariant, and it lives in one place (`utils/active-environment.ts`).
