---
"create-objectstack": patch
---

fix(create-objectstack): the blank scaffold declares pnpm build approvals, so a fresh `pnpm install` no longer exits 1 on pnpm 11

pnpm 11 turned an unapproved dependency build script from a warning into a hard
error. The blank template declared no build approvals, so the very first command
a new user runs failed on any current pnpm:

```
npx create-objectstack myapp && cd myapp && pnpm install
# [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: better-sqlite3@12.11.1, esbuild@0.28.1
# exit 1
```

The scaffold now ships a `pnpm-workspace.yaml` approving the two packages it
actually depends on building — `better-sqlite3` (the native sqlite driver behind
`@objectstack/driver-sql`) and `esbuild` (compiles `objectstack.config.ts`).

Both approval keys are present because pnpm reads them by version, and neither
alone covers the supported range:

- `allowBuilds` (a package → boolean map) — the only key pnpm 11 honors, and
  understood back to pnpm 10.31. `onlyBuiltDependencies` alone still errors.
- `onlyBuiltDependencies` (a list) — pnpm 10.0–10.30, which ignore `allowBuilds`.

npm and yarn ignore the file, so the npm install path is unaffected. Both
packages ship prebuilt binaries, so this was an install-time hard stop rather
than a runtime defect — the project ran fine once installed.

This is the #3091 failure class (in-repo settings masking what users resolve)
and was caught by the publish smoke gate added in #3100, which installs the
release candidate the way a user does — on whatever pnpm corepack hands a fresh
machine.
