---
'@objectstack/spec': minor
---

**BREAKING** — remove `aria` from the chart config, and answer its two alias spellings with the retirement instead of renaming an author onto a tombstone.

`ChartConfigSchema` declared a nested ARIA block that **no chart renderer has ever applied**. Measured first-hand at this checkout's own `.objectui-sha` pin `53ded82bf7a4` and re-confirmed at objectui HEAD: `AdvancedChartImpl` declares no `aria` prop; `chartConfigPresentation` names it nowhere — its own docblock calls it *"the one declared key with no reader at all"*; `SchemaRenderer`'s ARIA injection reads flat node props and never a nested `aria` object; and `ui/react-blocks.ts` omits it from `<ObjectChart>`'s thirteen `dataProps`, the one `ChartConfigSchema` key missing from that list. Every objectui hit on the chart paths is a **negative** pin asserting nothing reads it. So a chart could declare accessibility work that had measurably not happened.

It is the third and last member of the `aria` family retired for exactly this: `dashboard.aria` went at the audit close-out and `dashboard.widgets[].aria` at the widget drill. This one survived both sweeps by **depth**, not by evidence — it sits inside the widget's `chartConfig`, a container no drill had reached until the per-key pass recorded in `liveness/dashboard.json`.

**Removed rather than enforced**, which is the less usual ADR-0049 answer and is the whole of the ruling (maintainer decision batch #118 item 2, 2026-09-12 — recommendation C, 「其他同意」 to judging the protocol wrong for this one key). The same chart config already carries a **working** accessible-name channel in `description`, which the chart renderer lowers onto the chart graphic as `role="img"` + `aria-label`, pinned in the DOM. Wiring `aria` as well would put two accessible-name sources on one element and demand a precedence rule nobody has written. One node, one accessibility vocabulary.

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `chartConfig: { aria: { ariaLabel: 'Orders by month' } }` on a dashboard widget | `chartConfig: { description: 'Orders by month' }` — the renderer announces it as the chart graphic's accessible name |
| `chart: { aria: { … } }` on a report, or on a report block | the same: `description` on that chart config |
| `chartConfig: { accessibility: { … } }` (an alias for `aria`) | the same — the alias is now a refusal carrying this retirement, and it never accepted the key anyway |
| `chartConfig: { ariaProps: { … } }` (the other alias) | the same |
| `ariaLabel` / `ariaDescribedBy` / `role` on a surface that renders DOM | unchanged — the shared `AriaProps` block stays live on `page.aria`, `page.components[].aria` and the list view `aria` |

**The one-line fix:** delete `aria` from the chart config; move an accessible name into the sibling `description`.

`os migrate meta --from 17` lists the mechanical edits for existing sources; apply them by hand.

## The retirement kit

- **A `retiredKey()` tombstone, not a bare deletion** — even though `ChartConfigSchema` **is** a `strictObject`. A bare delete would still be loud, but only as a generic unrecognized-key report that cannot carry the prescription; the tombstone types the key `never` for `tsc` and raises the upgrade text at parse. The key therefore stays in the walked shape, which is why its liveness row stays (regraded with a `REMOVED` note, the `rls.priority` precedent) and why the authorable-surface baseline marks it `[RETIRED]` rather than losing the line.
- **Two registered keys from one tombstone.** `ReportChartSchema` is a `ChartConfigSchema.extend(...)`, and an extension copies the retired property into its own walked shape, so the retirement registers `ui/ChartConfig:aria` **and** `ui/ReportChart:aria`. Nothing radiates from the base.
- **The two alias entries are gone from `aliases` and present in `guidance`.** This narrows nothing: an alias table runs only from the `unrecognized_keys` path, so `accessibility:` and `ariaProps:` were *already refused* — the entries only decorated the rejection, and after the retirement they would have decorated it by pointing at the one key the shape is now guaranteed to reject. Leaving them is not a style choice: `shared/alias-integrity.test.ts` refuses an alias whose target accepts nothing, by name.
- **No form input and no locale bundle move.** Unlike its siblings this key never reached a `*.form.ts`, so there is no false-compliant UI half to remove; the generated `chart` / `report` references regenerate with the prescription in place of the old nested-shape table.

## What an operator with a STORED dashboard or report sees

A `sys_metadata` `dashboard` or `report` row written before this release can carry the key at any of its three coordinates — `widgets[].chartConfig.aria`, `chart.aria`, `blocks[].chart.aria`. Nothing breaks at read: the ADR-0087 conversion `chart-config-aria-removed` (protocol 18) replays on rehydration and strips it, so the row is served canonical. `os migrate meta --stored --apply` rewrites the rows; the next save through the metadata door heals one row the way it heals any pre-protocol shape.

The strip is the **whole** of it — there is no paired semantic entry, and that is a statement, not an omission. The key never had an effect to lose, so deleting it changes no behaviour and closes no hole. It stops an unkept promise from being made.

<!-- adr-0087: registered chart-config-aria-removed -->
