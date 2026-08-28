---
'@objectstack/sdui-parser': minor
---

html tier: a dashboard widget `options` key that reaches no renderer now draws an `unconsumed-widget-option` warning naming the consumed set

`@objectstack/spec`'s `DashboardWidgetOptionsSchema` ends in `.passthrough()`
("declared query keys + open renderer extras"), so ANY key parses, validates
and lints cleanly — including one no renderer reads. That is how a dashboard
shipped `options: { invert: true }` on a gauge with a comment saying what it
was believed to do and rendered the un-inverted measure with no diagnostic
anywhere (objectui#5709). The 2026-08-23 maintainer ruling on that card: open
extras stay open — they just stop being **silent**. A key that reaches no
renderer draws a **warning** naming the consumed set.

objectui's copy of this parser has emitted that warning since the ruling
landed; this repo's hoisted copy emitted nothing, so the same authored page
produced a diagnostic on one surface and silence on the other — the dialect
split the two copies' invariant forbids (objectstack#12719 — both copies agree
on the accepted grammar **and** on diagnostic codes). `validateTree` now ends
its known-component branch with `checkDashboardWidgetOptions(node)`, and the
new module is a byte-equal port of objectui's save for one token (the emitted
`code` is spelled as an inline literal rather than through the exported
constant, so this repo's ADR-0112 vocabulary gate can classify it — called out
at the site, and pinned equal to the constant by test), so the emitted `code`,
`severity`, `message` and census scope are identical.

The warning is scoped to the only spec-legal render path: a `dashboard` /
`dashboard-grid` host, a widget with a `dataset`, not in the legacy
`component` format, and not carrying the spec's own
`suppressWarnings: ['unconsumed-widget-option']` escape hatch. The consumed set
is the five keys `DashboardWidgetOptionsSchema` declares (`dateGranularity`,
`sortBy`, `sortOrder`, `limit`, `stageOrder`) plus `description`, the metric
sub-caption channel `translateDashboard` writes into `options`.

New exports for third-party manifest consumers: `checkDashboardWidgetOptions`,
`CONSUMED_WIDGET_OPTION_KEYS`, `DASHBOARD_WIDGET_HOST_TYPES` and
`UNCONSUMED_WIDGET_OPTION` (the diagnostic code, which is also the id
`suppressWarnings` suppresses).

Unlike the union-arm port that preceded it, this change is **additive**: it
reports an already-inert state and emits `warning` only, so what this copy
accepts and rejects is exactly where it stood — pinned by a dedicated test.
Today it is latent in the production gate anyway: this repo resolves no
`sdui.manifest.json`, so `validateJsxPages` runs parse-only and `validateTree`
is not reached from it. Wiring that manifest (the second gap recorded on
objectstack#12719, still unowned) is what makes this author-visible, and this
port lands ahead of that wiring deliberately.
