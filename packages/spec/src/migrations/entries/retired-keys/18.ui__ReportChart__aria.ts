// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17751 — the SECOND key one tombstone produced. `ReportChartSchema` is a
// `ChartConfigSchema.extend(...)`, and an extension copies the retired property
// into its own walked shape, which `authorable-surface/` marks `[RETIRED]`
// separately. Registered per key, as the gate reads them — nothing radiates
// from the base (the `shared/FieldMapping:transform` precedent). See
// `18.ui__ChartConfig__aria.ts` for the evidence and the ruling.
//
// The report face is where this key was authorable at two depths —
// `reports[].chart.aria` and `reports[].blocks[].chart.aria`, a `joined` report
// carrying both — and the D2 conversion `chart-config-aria-removed` strips all
// of them together with the dashboard site.
export const entry = 'ui/ReportChart:aria';
