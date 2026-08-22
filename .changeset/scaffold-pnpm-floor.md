---
"@objectstack/cli": patch
"create-objectstack": patch
---

Declare a pnpm floor (`engines.pnpm: ">=10.15"`) in the `package.json` both
scaffolders write, so an unsupported pnpm reports its own version instead of an
error about a file the user never wrote.

Both scaffold paths emit a settings-only `pnpm-workspace.yaml` with no
`packages:` key. Early pnpm 10 refuses that file outright — `pnpm install` exits
1 with `ERROR packages field missing or empty` before resolving a single
dependency, so a brand-new project could not be installed at all. Measured on
the rendered shape, one clean install per pnpm version, each with its own store:

| pnpm | before | after |
| --- | --- | --- |
| 10.0.0 – 10.4.0 | `packages field missing or empty` | unchanged — see below |
| 10.5.0 – 10.14.0 | `packages field missing or empty` | `ERR_PNPM_UNSUPPORTED_ENGINE`, naming the expected range |
| >= 10.15.0 | installs | installs |

The floor is a diagnosis, not a repair: pnpm 10.0.0–10.4.0 parse
`pnpm-workspace.yaml` *before* they read `engines`, so they still print the raw
workspace error. Closing that remaining sliver requires deciding what a
single-package scaffold should declare under `packages:`, which is tracked
separately and deliberately not decided here.

`engines.pnpm` rather than a `packageManager` stamp: npm, yarn and bun ignore
`engines.pnpm` entirely, so the scaffold keeps working for all four package
managers `objectstack init` hands off to. A `packageManager: "pnpm@x.y.z"` stamp
would declare the project pnpm-only (corepack-driven yarn refuses to run in such
a project) and pin one exact version that goes stale on every pnpm release — and
it buys nothing on 10.0–10.4, which reach the workspace error before reading
that field either.

No existing project is affected; this only changes what a newly scaffolded
`package.json` contains.
