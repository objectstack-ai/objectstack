---
"@objectstack/cli": patch
---

`os init` / `os create` now write a `lint` script into every scaffolded project, matching what `npx create-objectstack` already emits.

The two scaffolders had diverged. `npx create-objectstack` copies a template that declares `dev`, `start`, `build`, `validate`, `lint` and `typecheck`, and ships a CI workflow that runs `pnpm validate`, `pnpm lint` and `pnpm typecheck`. The three script maps in `os init` each declared `validate` and no `lint`, so a project scaffolded through `os init` that adopted that workflow — the documented next step — failed its first push with `Command "lint" not found`.

`objectstack lint` is not a second spelling of `objectstack validate`. Both run the shared authoring-rule engine, but only `lint` reaches the hook-body lowering check, so `hook-body/not-lowerable` — a handler that has silently stopped lowering to a metadata-only body, a change of deployment shape from a refactor that looks like tidying — was unreachable from a project scaffolded this way.

The new entry sits after `validate` in each map, matching the template's order, and its value is `objectstack lint` on both sides. Existing projects are unaffected; add the script by hand to pick the check up:

```json
"scripts": {
  "validate": "objectstack validate",
  "lint": "objectstack lint"
}
```

A pin now holds the two scaffolders equal on the scripts the shipped CI workflow runs, derived from that workflow rather than transcribed, so the next divergence is a red test instead of a discovery.
