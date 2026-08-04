---
"@objectstack/spec": major
"@objectstack/lint": minor
---

refactor(spec,lint)!: retire the dashboard widget action trio + `aria` — and the build gate that enforced a button nobody renders (#5010, ADR-0049)

`DashboardWidgetSchema` let an author declare a per-widget action **button**
(`actionUrl` / `actionType` / `actionIcon`) and per-widget ARIA attributes
(`aria`). None of the four reached a renderer. Re-measured 2026-08-04 across both
repos on a closed call graph:

- **the action trio** — all 14 `actionUrl` reads in objectui's
  `DashboardRenderer.tsx` are scoped to `schema.header.actions[]`, which is
  `DashboardHeaderAction`, a *different* schema. Nothing anywhere reads
  `widget.actionUrl`. `actionIcon` is the starkest: zero references in either
  repo outside its own declaration — not even the lint looked at it.
- **`aria`** — no consumer of `widget.aria` anywhere. The `aria-*` attributes in
  `DashboardRenderer` / `DatasetWidget` are the renderer's own DOM attributes,
  and objectui's single `.aria` read (`plugin-view/ObjectView.tsx:989`) is a
  **view**'s. This is the dashboard-level `aria` that #3896 removed, one level
  down — an accessibility guarantee an author could declare and nothing honoured.

These four survived the #3896 sweep for the same reason `widgets[].responsive`
did, and it is not "we looked and they were live": the liveness ledger declared
no `children` on `dashboard.widgets`, so **no widget-level key had ever been
classified**. #4956 fixed that instrument and gave all 22 keys their first per-key
verdicts; this change acts on four of the six it found dead.

## The second-order cost this settles

`packages/lint`'s `validate-dashboard-action-refs` enforced **ERROR-severity**
reference integrity on `widgets[].actionUrl` — a dangling target failed the
build. Its docblock called the key *"the per-widget button"* and claimed to
mirror the objectui runtime dispatch. It did not, because that button does not
exist. So an author could be blocked from shipping because a control that cannot
render pointed at an action that also did not.

A rule written to delete false affordances was sustaining one. That is why the
keys were retired rather than the check merely relaxed: the widget branch is
deleted, with a pin test asserting it stays silent and a second pin proving
header actions are still checked in the same stack.

FROM → TO:

| Removed | Replacement |
| :--- | :--- |
| `dashboard.widgets[].actionUrl` | `dashboard.header.actions[].actionUrl` |
| `dashboard.widgets[].actionType` | `dashboard.header.actions[].actionType` |
| `dashboard.widgets[].actionIcon` | `dashboard.header.actions[].icon` (the header spelling) |
| `dashboard.widgets[].aria` | **none** — delete it; author `title`/`description`, which the renderer really does label the card with |

For a per-**row** affordance, reach for a dataset-bound `table`/`pivot` widget:
its rows are clickable and drill through the semantic layer already (no
per-widget drill config exists, by design — #5022).

**The `AriaProps` shape is NOT removed — only this embed.** `AriaPropsSchema` /
`AriaProps` stay exported and stay live on `app.aria` and
`page.components[].aria`. Nothing importing the shape breaks.

The retirement kit:

- **Tombstones.** `retiredKey()` on all four, matching `responsive` in this same
  schema. `DashboardWidgetSchema` *is* `.strict()`, so a plain delete would still
  be loud — but only as a generic "unrecognized key". The tombstone keeps the key
  declared so the rejection carries the **prescription**, and types it `never` so
  authoring it fails `tsc` first. Pins assert the message *is* the prescription
  and is *not* `Unrecognized key`. The action trio shares one prescription that
  names all three, so an author who deletes the one key they were told about does
  not hit the same error twice more.
- **ADR-0087 D2 conversion + D3 chain step**
  (`dashboard-widget-action-aria-removed`, `retiredFromLoadPath`):
  `os migrate meta --from 16` strips the four from author sources, and stored
  dashboards replay clean instead of meeting a tombstone at load. Lossless
  deletes — none of the keys had an effect to lose. Its own entry rather than
  more keys on `dashboard-inert-keys-removed`, whose identity is the #3896 sweep.
- **Liveness rows stay** (`status: dead`, `verifiedAt`, a REMOVED note) because
  a tombstone keeps the key in the walked shape — the `rls.priority` precedent.
  `authorWarn`/`authorHint` are dropped from all four: the parse owns them now.
- Baselines moved at KEY level only, as the shape's survival implies:
  `authorable-surface.json` gains four `… [RETIRED]` lines;
  `json-schema.manifest.json`, `api-surface.json` and
  `api-surface-signatures.json` are unchanged by construction — no def stopped
  being emitted and no export was removed.

No runtime behaviour changes — that impossibility is the reason for the removal.
The one behaviour that *does* change is a build that used to fail and now does
not.

## Not in this change

`widgets[].colorVariant`, the fifth dead key #5010 lists, is **deliberately
untouched**. The rewrite target its triage assumed — `options.colorVariant` —
measured dead as well: `options` only reaches a renderer through the inline
`componentSchema` path, and `dataset` is *required* on this schema, so every
spec-authorable widget is dataset-bound and renders through `DatasetWidget`,
which has no colour affordance at all. Moving the key would relocate 16 authored
sites (7 in `platform-objects`, 9 in `app-showcase`) from one dead slot to
another and mint a second inert key. Returned for adjudication.
