---
'@objectstack/cli': patch
---

**A config-booted app no longer loses its `onEnable` — every `script` action's
handler reaches the engine again instead of 404'ing at dispatch (#4095).**

`os serve <config>` calls `createStandaloneStack()`, which reads
`dist/objectstack.json` and returns a ready-made `AppPlugin` for the app. That
satisfied serve's "does the host already wrap itself with an AppPlugin?" guard,
so the `new AppPlugin(config)` built from the LOADED MODULE — the only one
carrying the module's `onEnable` — was skipped. A JSON artifact cannot hold a
function, so the app booted with all of its metadata and none of its code.

On `examples/app-todo` that meant eight declared `script` actions, zero
registered handlers, and every button answering
`404 Action 'complete_task' on object 'todo_task' not found`. The example is
correctly authored: it declares `target: 'completeTask'`, registers
`todo_task:completeTask`, and exports `onEnable`. serve carried that hook intact
all the way to the branch that discarded it.

Serve now grafts the module's executable members onto the app bundle already
registered, rather than dropping them with the wrap:

- Only members `AppPlugin` actually executes travel — `onEnable` and the
  `functions` map that string-named hook/job handlers resolve against. (`onDisable`
  is deliberately excluded: it is declared in `packages/spec` but no kernel,
  runtime or service ever calls it, so grafting it would wire a hook nothing
  runs.)
- The artifact stays the metadata source of truth. Neither side is a superset —
  the artifact carries compile-time enrichment the config never has (ADR-0046
  packaged docs, which serve already grafts the other way) — so this moves code
  only, and never metadata.
- Targeting is by `manifest.id`, so a host composing several `AppPlugin`s can
  never have one app's handlers attached to another. With no id to match, it
  falls back to the single app bundle present and refuses when there are several.
- A bundle's own value always wins, so a host that wrapped itself on purpose is
  untouched.
- Code that finds no bundle to land on is now reported with a boot warning naming
  the consequence ("they 404 at dispatch") instead of vanishing. That silent drop
  is what hid this.

Verified end to end on `examples/app-todo`: `POST /api/v1/actions/todo_task/complete_task`
went from `404 RESOURCE_NOT_FOUND` to `{"success":true}`, `export_csv` now returns
real CSV, and the `[action-governance]` boot warning naming all eight actions is
gone. 14 unit cases pin the graft and — as importantly — the cases where it must
refuse; one end-to-end case boots a real stack through `bin/run-dev.js` and fails
against the pre-fix command.

Note that `os serve <config>` still cannot boot at all when `dist/objectstack.json`
is absent (#4085, `Service 'manifest' is async - use await`). That was verified to
be a **separate** defect on the other side of the same fork, not this one: the
failure reproduces unchanged with this fix applied.
