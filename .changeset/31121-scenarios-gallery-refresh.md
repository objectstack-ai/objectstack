---
'@objectstack/scenarios': patch
---

feat(scenarios): `gallery-refresh`, the gallery refresh in one deterministic step

Clause-②: yes — a new `gallery-refresh` entry point on the published `@objectstack/scenarios` widens its surface; the PR body carries the reading
Metadata-protocol: none

- **`pnpm --filter @objectstack/scenarios gallery-refresh --gallery DIR [--cards DIR] [--model M] [--debut] [--work DIR] [--chromium PATH]`** (`src/export/refresh-cli.ts`): reads npm's latest stable `@objectstack/cli` and the `framework.version` of every app the gallery checkout's `index.json` lists. When every listed app states that release it prints one `skip: …` line and exits 0, having run nothing; it also skips while a remote-tracking `export/<version>` branch awaits review. Otherwise it runs every card the gallery may show (origin `generic`, tier `starter` or `delivery`; `--debut`: the first of them, only into an empty gallery) with `run-scenarios --modes scratch --packages published --create-version <version>`, exports with screenshots into the checkout, commits `apps/` and `index.json` on a new local branch `export/<version>` and prints the branch, the commit and a ready PR body. It never pushes and never opens a PR. Every refusal (not a clean checkout, an index that does not validate, a prerelease `latest`, an existing local branch, no app exported, an app on another framework version, a change outside `apps/` and `index.json`) exits 1 with the reason.
- **`@objectstack/scenarios/export`** also exports the step as a library: `galleryRefresh`, `runnerArgv`, `readGalleryVersions`, `npmLatestVersion`, `refreshPrBody`, `galleryBranch`, `RefreshRefusal`, `FRAMEWORK_PACKAGE`, `STABLE_VERSION` and their types.
- The live driver's header names ruling D2: a local session or a scheduled cloud Claude Code task on the maintainer's subscription login may run the cards; an API-billed model still never may. The driver's refusal of an API key is unchanged.
- The README gains "Refreshing the gallery — `gallery-refresh`" and the scheduled task's runbook: what it runs, what it needs, what it never does, and the task's prompt verbatim.
