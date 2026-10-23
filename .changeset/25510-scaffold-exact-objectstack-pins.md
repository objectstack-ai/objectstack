---
'create-objectstack': patch
'@objectstack/cli': patch
---

fix(create-objectstack, cli): a scaffolded project pins every `@objectstack/*` dependency to the exact version of the tool that wrote it, not a `^` range

Clause-②: no
Metadata-protocol: none

On the v18 line a breaking change may ship in a minor or a patch, and the release notes say "Pin exact versions". The scaffolders wrote `^<version>` instead, so the next re-resolve (`npm update`, a deleted lockfile, an install without the lock) could move a new project onto a release that breaks it without anyone deciding to upgrade.

- **`npm create objectstack`** (`create-objectstack`), **`os init`** and **`os create`** (the default standalone placement) now write the scaffolder's own version, exactly, for every `@objectstack/*` entry in the emitted `package.json`: `18.0.0`, not `^18.0.0`. A prerelease is written verbatim (`18.1.0-rc.2`).
- **Unchanged.** `os create --in-repo` still writes `workspace:*`. Third-party ranges (`typescript`, `vitest`, `zod`, `@types/node`) are not touched. Every `@objectstack/*` package is released on one version, so the exact version is published for each of them.
- **An existing project** keeps whatever its `package.json` says. To follow the docs, replace each `^18.x.y` on an `@objectstack/*` entry with the exact version you run (for example `"@objectstack/runtime": "18.0.0"`), then reinstall.
