/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import { ReportRenderer } from './ReportRenderer';
import { LegacyReportRenderer } from './LegacyReportRenderer';
import { ReportViewer } from './ReportViewer';
import { DatasetReportRenderer, isDatasetReport } from './DatasetReportRenderer';

export { ReportRenderer, LegacyReportRenderer, ReportViewer, DatasetReportRenderer, isDatasetReport };
export type { ReportRendererProps, ReportRendererSchema } from './ReportRenderer';
export type { LegacyReportRendererProps } from './LegacyReportRenderer';
export type { DatasetReportRendererProps, DatasetDrillArgs } from './DatasetReportRenderer';
export { formatValue } from './formatValue';
export { exportReport, exportAsCSV, exportAsJSON, exportAsHTML, exportAsPDF, exportAsExcel } from './ReportExportEngine';
export {
  exportWithLiveData,
  exportExcelWithFormulas,
  createScheduleTrigger,
} from './LiveReportExporter';
export type {
  LiveExportOptions,
  LiveExportResult,
  ExcelColumnConfig,
  ScheduleTriggerCallback,
} from './LiveReportExporter';

// `mergeFilters` — the scope-filter combinator shared by the dataset report
// path. The pre-9.0 client-side aggregation pipeline (`useReportData` + its
// `buildAggregateQuery`/`groupAndAggregate`/`pivotRows`/… helpers) was removed
// with ADR-0021: dataset-bound reports aggregate in the semantic layer via
// `queryDataset`, so the client-side path had no remaining consumers.
export { mergeFilters } from './mergeFilters';

// NAMESPACE — `plugin-report`, the spelling this package's consumers declare
// (objectui#6416).
//
// These registrations (three until objectui#11440 retired `spec-report`, see
// below) used to name namespace `report`, while
// `apps/console/src/register-plugins.ts` declared the lazy stubs for the same
// short names under `plugin-report` and
// `packages/cli/src/utils/known-schema-types.ts` shipped the `plugin-report:*`
// spellings as renderable. Two things followed from the disagreement:
//
//   * `plugin-report:report` / `:report-viewer` / `:spec-report` could never be
//     satisfied. `register()` clears the lazy stub for the type IT registers,
//     and that type was `report:report`, so the `plugin-report:*` stubs were
//     never cleared and no component was ever stored under them —
//     `get('report', 'plugin-report')` stayed undefined and
//     `hasLazy('report', 'plugin-report')` stayed true forever.
//   * The bare `report` key was claimed twice under two different namespaces
//     (`Registry.register` and `registerLazy` share the `meta?.namespace &&
//     !meta?.skipFallback` branch), so what bare `report` DECLARED depended on
//     whether the chunk had loaded yet — the objectui#6353 shape.
//
// Direction chosen by measurement, not by preference: nothing in this repo or
// the sibling `objectstack` checkout authors a `report:*` spelling (0 hits),
// while the bare spellings are authored in 48 places, so the `report:*` keys
// are retired rather than the consumer-facing ones. Every sibling plugin
// already namespaces by package name.
//
// The bare keys stay claimed here ON PURPOSE and must NOT take `skipFallback`:
// after this change both claimants of each bare key — the console's lazy stub
// and the registration below — name the SAME full type, which is the shape all
// 27 other console-stub/plugin pairs in this repo have. Suppressing either
// claim would strand bare `report`, the only spelling anything authors.
// Pinned by `./__tests__/report-bare-key-ownership.test.ts` and
// `scripts/__tests__/report-namespace-agreement-6416.test.ts`.

// Register report component (dispatches dataset-bound vs legacy automatically)
ComponentRegistry.register(
  'report',
  ReportRenderer,
  {
    namespace: 'plugin-report',
    label: 'Report',
    category: 'Report',
    inputs: [
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'chart', type: 'code' },
        // objectui#11440: the wrapper the retired `spec-report` alias carried.
        // `ReportRenderer` unwraps it first, and `@object-ui/types/zod`'s
        // `ReportNodeSchema` declares it as `@objectstack/spec`'s `ReportSchema`.
        {
          name: 'report',
          type: 'object',
          description: 'The report to render, as `@objectstack/spec` declares it (`ReportSchema`: `name`, `label`, `type`, `dataset`, `rows`, `values`, …). When present, the block renders this report and reads none of its own presentation inputs.',
        },
    ]
  }
);

/**
 * ⛔ The `spec-report` node type key is RETIRED (objectui#11440, the seat ruling
 * `5945530142` on objectui#10859, by the objectui#10393 / objectui#8760 route).
 * A report embedded in a JSON tree has one spelling: the `report` node above
 * with the report in its `report` member — `{ "type": "report", "report": {
 * "name": "…", "type": "summary", "dataset": "…", "rows": ["…"], "values":
 * ["…"] } }` — which both validator faces accept and `ReportRenderer` unwraps.
 *
 * ## What was here, and why it went
 *
 * A second registration of the same `ReportRenderer` under the kebab key
 * `spec-report` in the `plugin-report` namespace, so it stored
 * `plugin-report:spec-report` and the bare `spec-report` fallback, labelled
 * "Spec Report", with two declared inputs (`dataset` and `type`, both strings).
 * (Described rather than quoted, so the registry derivation does not read this
 * comment as a registration.) The ruling found the capability passes the
 * mainstream criterion (an embedded saved report) and the spelling is an alias
 * of `report`. No `@object-ui/types` arm claimed it, so `objectui validate`
 * refused a `spec-report` node at `type` while the registry mounted it.
 *
 * ## Why unregistering is the whole retirement
 *
 * In the ruled order: `report` declares the wrapper shape first (its `report`
 * input above, `ReportNodeSchema` on the zod face); the one emitter, the
 * dashboard's `DrillDownDrawer`, writes `report`; the console's lazy stub for
 * the key goes in the same change. A node written with this type now renders
 * the OBJUI-001 "Unknown component type" panel.
 */

// Register report viewer component
ComponentRegistry.register(
  'report-viewer',
  ReportViewer,
  {
    namespace: 'plugin-report',
    label: 'Report Viewer',
    category: 'Report',
    inputs: [
        { name: 'report', type: 'code' },
        { name: 'showToolbar', type: 'boolean' }
    ]
  }
);
