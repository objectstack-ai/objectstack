---
"@objectstack/spec": major
---

refactor(spec)!: retire `dashboard.widgets[].responsive` — the straggler of the #3896 inert-key sweep (#4876, ADR-0049)

`DashboardWidgetSchema.responsive` let an author declare per-breakpoint layout
overrides on a dashboard widget — `breakpoint`, `hiddenOn`, `columns`, `order` —
and no renderer ever read them. The value parsed, validated, and then did
nothing: `DashboardRenderer`, `DashboardEditor` and `plugin-designer` name
`responsive` only in comments, and the one genuine per-breakpoint consumer in
objectui (`useResponsiveConfig`) is fed by `page.components[].responsive`, never
by a widget. Re-measured 2026-08-03 across both repos, plus zero authored
instances anywhere in this repo's examples, apps and tests.

Four days earlier, #3896 retired the **literally same-named** `view.responsive`
on exactly this evidence. This embed survived that sweep for a reason that is
worth stating plainly, because it is not "we looked and it was live": the
liveness ledger declares no `children` on `dashboard.widgets`, and the walk
drills only one level through an explicit `children` — so **no widget-level key
has ever been classified at all** (22 of them). The instrument had a hole, not
the key a mandate. That gap is filed and fixed separately as **#4956**.

Leaving it would have shipped v17 with one word and two fates — `view.responsive`
a `tsc` error, `dashboard.widgets[].responsive` silently accepted — which no
author or authoring agent could be expected to explain, on a key that today
accepts *any* content on both sides (objectui types it a documented `any`). That
is precisely where AI-authored metadata errors hide and multiply.

FROM → TO:

| Removed | Replacement |
| :--- | :--- |
| `dashboard.widgets[].responsive` (key) | **none** — delete it; the grid reflows by `columns` + `gap` on the dashboard and the `layout` box on each widget |

**The shape is NOT removed — only this embed.** `ResponsiveConfigSchema` /
`ResponsiveConfig` stay exported and stay live on `page.components[].responsive`,
whose renderer genuinely reads them. Nothing that imports the shape breaks, and
an author who needs breakpoint behaviour today has a real place to put it. This
narrowness is deliberate: the maintainer's ruling covers the dashboard widget
surface only.

The retirement kit:

- **Tombstone.** `retiredKey()` on the widget key. `DashboardWidgetSchema` *is*
  `.strict()`, so a plain delete would still be loud — but only as a generic
  "unrecognized key". The tombstone keeps the key declared so the rejection
  carries the **prescription**, and types the key `never` so authoring it fails
  `tsc` first. A pin asserts the message is the prescription and *not*
  `Unrecognized key`.
- **ADR-0087 D2 conversion + D3 chain step**
  (`dashboard-widget-responsive-removed`, `retiredFromLoadPath`):
  `os migrate meta --from 16` deletes the key from author sources, and stored
  dashboards replay clean instead of meeting the tombstone at load. A lossless
  delete — the key never had an effect to lose. Kept as its own entry rather than
  folded into `dashboard-inert-keys-removed`, whose identity is the #3896 sweep:
  this removal rests on its own 2026-08-03 measurement and should say so in
  `spec-changes.json` and the upgrade guide.
- **No liveness row is added**, matching `widgets[].performance` in the #3896
  sweep — a widget-level row would be an ORPHAN, not a classification, until
  #4956 lands the drill. The ledger `_note` records the removal and why the row
  is absent.
- Baselines moved at KEY level only, as the shape's survival implies:
  `authorable-surface.json` gains `ui/DashboardWidget:responsive [RETIRED]`;
  `json-schema.manifest.json`, `api-surface.json` and
  `api-surface-signatures.json` are unchanged by construction — no def stopped
  being emitted and no export was removed.

No runtime behaviour changes — that impossibility is the reason for the removal.

**objectui shard:** the outcome is retirement, not the fallback clause, so
objectui#3235's conditional pin-bump item is permanently de-listed; the `any`
declaration on that repo's side can be cleaned on its own schedule.
