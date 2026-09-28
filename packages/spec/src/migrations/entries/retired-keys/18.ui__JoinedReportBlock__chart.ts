// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20161 (ADR-0049 enforce-or-remove). `JoinedReportBlock.chart` declared an
// inline chart on one block of a `joined` report, and no renderer ever drew it:
// at the `.objectui-sha` pin `f8a9d0fb0596`, `DatasetReportRenderer`'s joined
// branch draws each block as a table and has no read of a block's `chart` at
// all, so the chart parsed, passed `validate-chart-bindings`, and plotted
// nothing. The block shape is `.strict()`, so the key is removed from it and
// its prescription is served from the block schema's `guidance` table. A
// joined report's container `chart` is refused by `ReportSchema`'s refinement
// in the same change; `chart` stays live on every non-joined report. D2:
// `report-joined-chart-removed`.
export const entry = 'ui/JoinedReportBlock:chart';
