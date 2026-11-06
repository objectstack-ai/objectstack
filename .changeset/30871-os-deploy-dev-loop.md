---
'@objectstack/cli': patch
'create-objectstack': patch
---

feat(cli): `os deploy` — one command from a local checkout to your ObjectOS Cloud environment; installs pick the organization's only environment, keep it across `os cloud login`, and refuse before any write when none resolves

Clause-②: no
Metadata-protocol: none

**`os deploy`** (new). With no flags it builds the app (the same compile `os build` runs), publishes it as `<manifest.version>-dev.<YYYYMMDDHHMMSS>` (a UTC semver pre-release, so deploying again never needs a version bump and never collides with an existing version), installs that version into your organization's environment, and waits until the environment serves it. A failed local build prints its errors and exits 1 having published nothing; a build the environment reports as failed prints the environment's reason and exits 1. Flags only for the uncommon case: `--env <id>` when your account reaches several environments, `--no-wait`, `--wait-timeout <seconds>`. Against a control plane that does not yet report which version an environment serves, the command says so and does not claim the version is live.

**`os package publish --install`** keeps its meaning (a release version, the manifest's own), and now resolves its environment like `os deploy`: `--env` / `$OS_ENVIRONMENT_ID`, then the environment `os environments switch` recorded for this control plane, then the organization's only environment, asked of the control plane and printed. With none, several, or an unreadable list it exits 1 **before registering the package or publishing anything**, naming how to pass one. It used to print "Skipping auto-install", publish anyway and exit 0.

**`os cloud login`** no longer drops the active environment: re-logging in to the same control plane as the same account keeps `activeEnvironmentId` in `~/.objectstack/cloud.json`. A different control plane or a different account still starts without one.

**`os dev`** offers the deploy on a key once the local server is up: press `d` to run `os deploy` in the same terminal; when not logged in to ObjectOS Cloud, the same key logs in first. There is no deploy on save. **`os build`** ends with the next step (`os deploy`), and bare `os` lists the everyday commands first. New projects from `create-objectstack` (and `os init`'s app template) ship `npm run deploy`.
