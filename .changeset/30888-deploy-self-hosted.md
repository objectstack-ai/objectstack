---
'@objectstack/cli': patch
---

feat(cli): `os deploy` and the `d` key in `os dev` deploy to a self-hosted runtime (Docker Community or Enterprise) that `os environments use-runtime` remembered; `os package install` falls back to it

Clause-②: no
Metadata-protocol: none

**`os environments use-runtime <url> --token <key>`** (new) remembers a self-hosted runtime and an API key it issued, and makes it the deploy target. The key is tried on the runtime's install-local door first (`--no-verify` skips that); a rejected key, a runtime that does not serve install-local, or one that cannot be reached is refused and nothing is recorded. Both are stored in `~/.objectstack/cloud.json` (0600) as their own record beside the cloud session: `os cloud login` and `os cloud logout` keep it, and the key is only ever sent to that url. `os environments switch <id>` makes ObjectOS Cloud the deploy target again (the runtime stays remembered); `os environments use-runtime --forget` drops it.

**`os deploy`** with a runtime as the active target (and no `--env`) builds the app, asks the runtime's install-local dry run and prints the upgrade plan (declared `renamedFrom` renames included), then installs the build inline — no catalog publish and no `-dev` version — and reports it live from the runtime's answer. A refusal from the dry run or the install stops the deploy with exit 1 and the runtime's sentence; a runtime that does not serve install-local (one booted from a composed artifact) or that predates the dry run is named, with what to do, exit 1. `--confirm-access-upgrade <finding-set>` passes the access-upgrade confirmation through (and is refused when the target is ObjectOS Cloud). **The `d` key** names the remembered runtime and deploys there without asking for a cloud login.

**`os package install`** without `-u` / `$OS_RUNTIME_URL` installs into the remembered runtime, and without `-t` / `--email` uses its key — only when the url is that runtime's. With nothing remembered the default stays `http://localhost:3000`. Its 404 answer now names the composed-artifact case and what to do.
