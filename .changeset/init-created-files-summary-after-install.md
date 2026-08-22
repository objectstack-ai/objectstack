---
"@objectstack/cli": patch
"create-objectstack": patch
---

Fix `objectstack init`'s closing "Created files" summary omitting `pnpm-lock.yaml` / `package-lock.json` and `node_modules/` (#10557).

The summary used to be printed from a list accumulated while the template
files were written — before `<pm> install` ran — so it could never name what
the package manager wrote. `init` now prints it after the install attempt
(succeeded or failed) from a walk of the finished project directory, reusing
`create-objectstack`'s `created-summary.ts` (now published as the
`create-objectstack/created-summary` subpath) instead of a second copy of the
same renderer.
