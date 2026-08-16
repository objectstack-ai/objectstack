---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

`os validate`: a dashboard header `modal` action's target resolves against declared PAGES, only (#9013)

`validateDashboardActionRefs` resolved an `actionType: 'modal'` header button's
`actionUrl` the way objectui's `DashboardView` used to dispatch it: a defined
action name, a bare object name, or the `<verb>_<object>` prefix form
(`create_`/`new_`/`add_`/`edit_`/`update_` + a defined object) all passed, and a
target naming a declared page ERRORED unless it collided with one of those.

That mirror is gone. Maintainer ruling objectstack#6739-A (2026-08-09): a
`type: 'modal'` string target names a PAGE, only — the spec TSDoc, the published
docs and `defineStack`'s cross-reference walk already said so, and objectui#4764
/ objectui#4782 retired the renderer's object fallback and `DashboardView`'s
second copy of the prefix convention (enumerated across both repos' corpora:
zero producers). After that, `os validate` blessed exactly the buttons the
runtime refuses — the false affordance the rule exists to eliminate — while
refusing the one shape the runtime serves.

**BREAKING** accept-set change on the `os validate` gating tier (landing after
the v17.0.0 cut; the lockstep launch-window convention ships it as `minor`):

- A `modal` header target naming a defined action, a bare object, or a
  `<verb>_<object>` form now **fails** validation. Those buttons already
  dispatch to a named refusal at runtime.
- A `modal` header target naming a declared page now **passes** — it was
  wrongly refused before.

## FROM → TO

```ts
// before — passed validation; the runtime now refuses the click
header: {
  actions: [{ label: 'New Deal', actionType: 'modal', actionUrl: 'create_opportunity' }],
}

// after — name a declared page…
header: {
  actions: [{ label: 'Intake', actionType: 'modal', actionUrl: 'deal_intake' }], // pages: [{ name: 'deal_intake' }]
}
// …or, to open an object's form, use the validated first-class shape
header: {
  actions: [{ label: 'New Deal', actionType: 'form', actionUrl: 'opportunity.edit' }],
}
```

There is deliberately no automatic rewrite: a retired-shape target is a
name-shaped guess (`create_opportunity` names the page `create_opportunity`, or
it names nothing — the ruling explicitly declined keeping the prefix), and only
the author knows whether the button meant a page or an object form.
`objectstack migrate meta` surfaces the change as a structured TODO (semantic
entry `dashboard-header-modal-target-page-only`, protocol major 18).

<!-- adr-0087: registered dashboard-header-modal-target-page-only -->
