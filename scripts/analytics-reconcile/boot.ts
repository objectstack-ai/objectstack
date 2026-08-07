// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0021 Phase 2 — shared kernel-boot + reconciliation driver.
//
// Boots an example stack with a real in-memory engine + the analytics service,
// then reconciles every dual-form dashboard widget (legacy `aggregate()` vs
// dataset `queryDataset()`). Read-only: never writes metadata or data.

import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AnalyticsServicePlugin } from '@objectstack/service-analytics';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Dataset, Dashboard, Report } from '@objectstack/spec/ui';
import type { IAnalyticsService, DatasetSelection } from '@objectstack/spec/contracts';
import type { FilterCondition } from '@objectstack/spec/data';
import { reconcileDashboard, reconcileReports, type ReconcileExecutors, type WidgetReconcileResult } from './reconcile.js';
import { resolveDateMacros } from './macros.js';

interface DataEngineLike {
  aggregate(object: string, options: {
    where?: Record<string, unknown>;
    // Plain fields or structured date-bucket items ({ field, dateGranularity }).
    groupBy?: Array<string | { field: string; dateGranularity: string }>;
    aggregations?: Array<{ function: string; field: string; alias: string }>;
  }): Promise<Record<string, unknown>[]>;
}

export interface ReconcileAppOptions {
  appName: string;
  /** The defineStack() result for the example app. */
  config: unknown;
  /** Dashboards to reconcile (each dual-form widget is checked). */
  dashboards: Dashboard[];
  /** Reports to reconcile (each dual-form report is checked). */
  reports?: Report[];
  /** Authored datasets (Dataset) the dashboards/reports reference by name. */
  datasets: Dataset[];
}

/** Boot, reconcile every dashboard, print a report, and return the mismatch count. */
export async function reconcileApp(opts: ReconcileAppOptions): Promise<number> {
  process.env.OS_MULTI_ORG_ENABLED = 'false';

  const kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));
  await kernel.use(new AppPlugin(opts.config as ConstructorParameters<typeof AppPlugin>[0]));
  // Force the ObjectQL aggregate path (no raw SQL) so legacy and dataset paths
  // run through the identical engine.aggregate() — the cleanest apples-to-apples.
  await kernel.use(new AnalyticsServicePlugin({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
  }));
  await kernel.bootstrap();

  const engine =
    (kernel.getService('data') as DataEngineLike | undefined) ??
    (kernel.getService('objectql') as DataEngineLike | undefined);
  if (!engine || typeof engine.aggregate !== 'function') {
    throw new Error('No IDataEngine with aggregate() found (expected "data"/"objectql" service).');
  }
  const analytics = kernel.getService('analytics') as IAnalyticsService | undefined;
  if (!analytics || typeof analytics.queryDataset !== 'function') {
    throw new Error('No analytics service with queryDataset() found.');
  }

  const datasets = new Map<string, Dataset>();
  for (const ds of opts.datasets) {
    const parsed = DatasetSchema.parse(ds) as Dataset;
    datasets.set(parsed.name, parsed);
  }

  const exec: ReconcileExecutors = {
    runAggregate: (spec) => engine.aggregate(spec.objectName, {
      where: spec.filter as Record<string, unknown> | undefined,
      groupBy: spec.groupBy.length > 0 ? spec.groupBy : undefined,
      aggregations: spec.aggregations.map((a) => ({ function: a.method, field: a.field, alias: a.alias })),
    }),
    runDataset: async (dataset: Dataset, selection: DatasetSelection) => {
      const result = await analytics.queryDataset!(dataset, selection);
      return result.rows as Record<string, unknown>[];
    },
    resolveFilter: (filter?: FilterCondition) => (filter == null ? filter : resolveDateMacros(filter)),
  };

  let totalMismatch = 0;
  for (const dashboard of opts.dashboards) {
    const results = await reconcileDashboard(dashboard, datasets, exec);
    totalMismatch += report(`${opts.appName} · ${dashboard.name}`, results);
  }
  if (opts.reports && opts.reports.length > 0) {
    const results = await reconcileReports(opts.reports, datasets, exec);
    totalMismatch += report(`${opts.appName} · reports`, results);
  }
  return totalMismatch;
}

function report(surface: string, results: WidgetReconcileResult[]): number {
  let mismatches = 0;
  const icons: Record<WidgetReconcileResult['status'], string> = {
    ok: '✅', mismatch: '❌', skipped: '⏭️ ', pending: '🕗',
  };
  console.log(`\n── Analytics reconciliation · ${surface} ──`);
  for (const r of results) {
    console.log(`${icons[r.status]} ${r.widgetId}  [${r.status}]`);
    if (r.status === 'mismatch') {
      mismatches++;
      for (const issue of r.issues) console.log(`     · ${issue}`);
    } else if ((r.status === 'skipped' || r.status === 'pending') && r.issues.length) {
      console.log(`     · ${r.issues[0]}`);
    }
  }
  const count = (s: WidgetReconcileResult['status']) => results.filter((r) => r.status === s).length;
  console.log(
    `\n${mismatches === 0 ? '🎉' : '🔴'} ${count('ok')} ok · ${count('skipped')} skipped · ` +
    `${count('pending')} pending · ${mismatches} mismatch`,
  );
  return mismatches;
}

/** Run a reconcileApp() and exit the process with a CI-friendly code. */
export function runAsMain(run: () => Promise<number>): void {
  run()
    .then((mismatches) => process.exit(mismatches === 0 ? 0 : 1))
    .catch((err) => {
      console.error('❌ Reconciliation runner failed:', err);
      process.exit(2);
    });
}
