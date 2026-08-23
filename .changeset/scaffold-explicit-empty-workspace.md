---
"@objectstack/cli": patch
"create-objectstack": patch
---

Scaffolded projects declare an explicit empty `packages: []` in their
`pnpm-workspace.yaml` (#10933). Both scaffold paths render it —
`renderPnpmWorkspaceYaml` in `objectstack init`, and the bundled `blank`
template `npx create-objectstack` copies.

The file was deliberately keyless so it would act purely as a settings file.
That intent is now written down rather than inferred from a missing key, and
writing it down is what fixes a first-command failure: pnpm 9.x and 10.0–10.4
parse `pnpm-workspace.yaml` **before** they read `engines`, so they refused a
brand-new project outright with

```
 ERROR  packages field missing or empty
```

naming a file the user never wrote and giving no hint that the cause is their
pnpm version — and no `engines.pnpm` floor could reach them, because they never
got as far as the engines check. Measured, one clean install per pnpm version,
each with its own store:

| pnpm | before | after |
|---|---|---|
| 9.15.9, 10.0.0, 10.4.0 | `ERROR packages field missing or empty` | `ERR_PNPM_UNSUPPORTED_ENGINE`, naming `>=10.15` |
| 10.5.0–10.14.0 | `ERR_PNPM_UNSUPPORTED_ENGINE` | unchanged |
| 10.15.0, 10.34.5, 11.22.0 | installs | installs, byte-identical `pnpm-lock.yaml` |

So every unsupported pnpm now reports the same actionable cause, and supported
pnpm is unaffected: the empty key was measured equivalent to omission on
10.15.0, 10.34.5 and 11.22.0 — identical lockfile bytes, identical
`node_modules/.modules.yaml` once the run-local `prunedAt`/`storeDir` fields are
dropped, identical `pnpm ls -r --depth -1`, and an identical second-install
"Already up to date".

The declaration is an **empty** list on purpose. `packages: ['.']` satisfies the
same parsers but declares the project root a workspace *member* — a monorepo
root — which a single-package scaffold is not, and which reads to the next
author (human or AI) as an invitation to add member packages to an app.

`engines.pnpm` is unchanged at `>=10.15`.
