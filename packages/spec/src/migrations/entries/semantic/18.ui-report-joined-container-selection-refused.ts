// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-report-joined-container-selection-refused',
  surface: 'report selection keys on a `joined` container — a top-level `dataset`, or a '
    + 'NON-EMPTY top-level `rows` / `columns` / `values` list, on a report whose `type` is '
    + '`joined` (`ReportSchema`\'s refinement)',
  replacement: 'the same key on the `blocks[]` entries that need it — each block binds its own '
    + '`dataset` and selects its own `rows` / `columns` / `values` — or DELETE it. Deleting '
    + 'changes nothing that renders: the container value was never read. The refusal lands at '
    + 'the key\'s own path and says both, the way the container `order` refusal beside it '
    + 'always has, and that `order` refusal is unchanged.',
  reason:
    'ADR-0049 enforce-or-remove, the enforce arm: the four keys stay declared (they are the '
    + 'selection of every non-joined report), and the one report type that never reads them '
    + 'now refuses them. A `joined` report selects nothing itself, and the refinement already '
    + 'said so for `order` alone — it refused a container `order` with a pointer onto '
    + '`blocks[]` while the four selection keys beside it parsed green. Measured at this '
    + 'repo\'s `.objectui-sha` pin `f8a9d0fb0596f4521076628e2bbfe27e6ce67d52`: '
    + '`DatasetReportRenderer`\'s joined branch (`DatasetReportRenderer.tsx:1462`) reads '
    + '`blocks`, plus the container `runtimeFilter` and `drilldown` resolved above it, and '
    + 'returns before the top-level reads of `columns` / `dataset` / `rows` / `values` begin '
    + '(line 1529 onward) — so each was accepted by the metadata layer and dropped by the '
    + 'renderer without a word. The alias tables made it reachable: `fields` / `measures` / '
    + '`metrics` route to `values`, `groupings` / `groupBy` / `dimensions` to `rows`, and '
    + '`objectName` / `object` / `dataSet` / `source` to `dataset`, on a joined report as on '
    + 'any other. Studio\'s report inspector hides the top-level binding for a joined report '
    + '(`ReportDefaultInspector.tsx:328`) but its type picker patches only `type`, so a '
    + 'report bound first and switched to `joined` second carries the keys invisibly. An '
    + 'empty list is NOT refused: it selects nothing, which is what a joined container '
    + 'selects — the container `order` refusal\'s own threshold. Ships at once, no '
    + 'deprecation window: there is no window in which a key the renderer never reads does '
    + 'anything.',
  acceptanceCriteria:
    'WHICH DOOR: this is the spec schema\'s refusal, so it lands wherever a report is parsed '
    + 'through `@objectstack/spec` — `defineReport`, `os validate` / `os build`, and the '
    + 'metadata save door (the `report` entry of the metadata type registry) — as one '
    + '`custom` issue per key at `dataset` / `rows` / `columns` / `values`. A stored '
    + '`sys_metadata` report row is not rewritten: it carries the same issue in its read-side '
    + '`_diagnostics` and is refused on its next save. Fix each by moving the key onto the '
    + 'blocks that need it or deleting it, then check the rendered report: it renders exactly '
    + 'as before, because the container value was never read. A joined report that carries '
    + 'only `blocks`, `runtimeFilter`, `drilldown` and the identity / protection keys parses '
    + 'byte-identically to before, and every non-joined report is untouched. Census at the '
    + 'time of the change: zero joined reports carry any of the four at the container — in '
    + 'this repo one example-app report, one docs example and five test fixtures across '
    + '`packages/lint` and `packages/platform-objects`; in objectui every joined-report '
    + 'fixture and docs example at the pin above (13 occurrences); in the cloud repo none '
    + 'exist.',
};
