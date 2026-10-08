// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20161 — the judgement half of `report-joined-chart-removed`, owed under
// #17152 ruling B (one D3 entry per retirement family, even when a lossless D2
// exists). The D2 conversion strips a joined report's `chart` mechanically, at
// both coordinates, and that strip changes nothing that renders. What it cannot
// do is decide whether the author MEANT a chart: that intent has no place to go
// on a joined report, so moving it to a report that draws one is the author's
// call. Its own family, not an extension of
// `ui-report-joined-container-selection-refused`: that entry is the enforce arm
// for four selection keys that stay declared and has no D2 at all, while this one
// retires a declared block key, refuses a container key, and pairs with a D2.
export const entry: SemanticMigration = {
  id: 'ui-report-joined-chart-retired',
  surface:
    '`report.blocks[].chart` (REMOVED from the joined report block shape) and `report.chart` on '
    + 'a report whose `type` is `joined` (REFUSED by `ReportSchema`\'s refinement) — a chart '
    + 'anywhere on a joined report',
  replacement:
    'nothing on the joined report: a joined report draws each block as a table and has no chart '
    + 'channel at either level. Delete the `chart`. If the chart was wanted, give the slice it '
    + 'was meant to plot a report of its own — `type` `tabular`, `summary` or `matrix`, binding '
    + 'the same `dataset` the block bound, selecting the dimension and measure the chart names '
    + 'in its `rows` and `values` — carry the `chart` over to that report\'s top level, where '
    + '`xAxis` names a dataset dimension and `yAxis` a measure exactly as before, and reach it '
    + 'from the app navigation beside the joined report.',
  reason:
    'ADR-0049 enforce-or-remove. Nothing ever drew a chart on a joined report: the renderer\'s '
    + 'joined branch draws each block as a table and returns before its one read of the '
    + 'report\'s `chart`, and no renderer reads a block\'s `chart` at all — measured at this '
    + 'repo\'s `.objectui-sha` pin `f8a9d0fb0596f4521076628e2bbfe27e6ce67d52` '
    + '(`DatasetReportRenderer.tsx`, joined branch at lines 1462-1524, the only chart read at '
    + '1557). So both coordinates parsed, passed the `validate-chart-bindings` lint (which '
    + 'resolved their axes as if they would plot), and showed tables only. The D2 conversion '
    + '`report-joined-chart-removed` already REPAIRS THE DATA: it strips both from authored '
    + 'sources on a chain replay and from stored `sys_metadata` rows at rehydration, a lossless '
    + 'delete because neither value ever rendered. What it cannot repair is intent. Deleting '
    + 'the key leaves the report looking exactly as it always did — which is the problem when '
    + 'the author believed a chart was there: they were reading a chart that never existed, '
    + 'and only they know whether they wanted one. A walker cannot move it anywhere either: a '
    + 'joined report has no chart channel, and creating a new report, choosing its type and '
    + 'placing it in navigation are authoring decisions, not rewrites. The Studio report form '
    + 'offered a block chart input until this change, so a stored row carrying one is a real '
    + 'shape, not a hypothetical. Ships at once, no deprecation window: there is no window in '
    + 'which a key the renderer never reads does anything. `chart` on every non-joined report '
    + 'is unchanged — it is that report\'s live embedded chart.',
  acceptanceCriteria:
    'WHICH DOOR: the refusal is the spec schema\'s, so it lands wherever a report is parsed '
    + 'through `@objectstack/spec` — `defineReport`, `os validate` / `os build`, and the metadata '
    + 'save door (the `report` entry of the metadata type registry, answered as '
    + '`INVALID_METADATA` with status 422). A block `chart` is refused as an unrecognized key '
    + 'on that block with the upgrade prescription; a container `chart` on a joined report is '
    + 'one `custom` issue at `chart`. (1) No joined report carries a `chart` at either level: the '
    + 'D2 strip covers existing sources on a chain replay, and the stored-row seams replay it for '
    + 'rows already at rest. (2) For every joined report '
    + 'that carried one, decide whether the chart was wanted; if it was, a non-joined report '
    + 'now binds that slice\'s dataset and carries the chart, and its `xAxis` / `yAxis` resolve '
    + '(`validate-chart-bindings` checks them there). (3) Check the rendered joined report: it '
    + 'renders exactly as before, because the chart was never drawn. A joined report with no '
    + '`chart` parses byte-identically to before, and every non-joined report is untouched. '
    + 'Census at the time of the change: zero joined reports with a chart in this repo\'s '
    + 'example apps and in the hotcrm reference app, against a lit control (non-joined reports '
    + 'carrying a chart: one and five). '
    + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.',
};
