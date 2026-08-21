// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Strategy pattern types — re-exported from @objectstack/spec/contracts
 * for convenience. The canonical definitions live in the spec package.
 *
 * [#4538] `DriverCapabilities` → `AnalyticsDriverCapabilities`: the old name
 * belonged to the data domain's driver feature-flag record
 * (`DriverCapabilitiesSchema` — every `IDataDriver.supports`); the analytics
 * execution-path trio was renamed with its spec declaration.
 */
export type {
  AnalyticsStrategy,
  StrategyContext,
  AnalyticsDriverCapabilities,
} from '@objectstack/spec/contracts';

import type { FilterCondition } from '@objectstack/spec/data';
import type { StrategyContext } from '@objectstack/spec/contracts';

/**
 * The semantic scope a compiled DATASET carries beside its Cube (#10298).
 *
 * `compileDataset` splits a dataset into two halves: the parts the Cube model
 * can express (measures, dimensions, joins) and the parts it cannot — the
 * dataset's definition-level `filter` and each measure's own scoped `filter`.
 * Until #10298 the second half was read by `DatasetExecutor` alone, so the
 * dashboard door applied it and the strict `/api/v1/analytics/query` door —
 * which addresses the registered Cube directly and never touches the executor
 * — silently answered UNFILTERED aggregates under the same measure names, for
 * the same cube. Two doors, two numbers.
 *
 * This is the channel that carries the missing half to the strategy, so both
 * doors compile the same declaration. It is deliberately declared HERE rather
 * than on the spec's {@link StrategyContext}: the analytics package builds the
 * context object it hands its own strategies, and nothing about this channel
 * is an authorable surface — no metadata key, no wire shape, no error code —
 * so widening the published contract would buy nothing and cost a spec edit.
 * A strategy that does not know the hook keeps the behaviour it had.
 *
 * Every member is optional and tiered "cannot answer, do not block": a cube
 * that is not a compiled dataset (an inferred cube, a manifest cube) answers
 * `undefined` and compiles exactly as it did before.
 */
export interface DatasetScope {
  /** The dataset's definition-level filter — its intrinsic scope. */
  filter?: FilterCondition;
  /** Per-measure scoped filters, keyed by measure name. */
  measureFilters?: Record<string, FilterCondition>;
}

/** A {@link StrategyContext} that can answer for a compiled dataset (#10298). */
export interface DatasetScopedStrategyContext extends StrategyContext {
  getDatasetScope?(cubeName: string): DatasetScope | undefined;
}
