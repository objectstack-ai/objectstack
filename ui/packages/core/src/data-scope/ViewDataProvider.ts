/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - View Data Provider
 *
 * Resolves @objectstack/spec ViewData discriminated union into
 * a unified data access interface. Supports two data modes:
 *
 * 1. 'object' — Metadata-driven via ObjectStack API (object name → fields/records)
 * 2. 'value' — Static data (pre-loaded items array)
 *
 * The view-level `'api'` mode is retired in `@objectstack/spec`
 * (objectstack#23082, ADR-0049) and has no arm here (objectui#12325): a
 * config that still names it resolves as an unknown provider, with an error.
 *
 * @module data-scope
 * @packageDocumentation
 */

import {
  collectSavedViews,
  composeElementDataSource,
  elementDataSourceRefusedLimitMessage,
  elementDataSourceViewNotFoundMessage,
  resolveSavedView,
  type ElementDataSourceConfig,
  type ElementSavedView,
} from './element-data-source.js';

/** ViewData union — matches @objectstack/spec ViewDataSchema */
export type ViewDataConfig =
  | { provider: 'object'; object: string }
  | { provider: 'value'; items: any[] };

/**
 * Re-exported from `./element-data-source.js`, where the binding's type now
 * lives alongside the logic that consumes it. Kept on this module path because
 * that is where it was declared before objectstack#5576.
 */
export type { ElementDataSourceConfig };

/** Fetcher interface — consumers provide the actual fetch implementation */
export interface DataFetcher {
  /** Fetch records for an object */
  fetchRecords(
    object: string,
    options?: {
      filter?: Record<string, any>;
      sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
      limit?: number;
      offset?: number;
      fields?: string[];
    },
  ): Promise<{ records: any[]; total: number }>;

  /** Fetch object metadata (fields, etc.) */
  fetchMetadata?(object: string): Promise<{
    name: string;
    label?: string;
    fields: Array<{
      name: string;
      label?: string;
      type: string;
      required?: boolean;
    }>;
  }>;

  /**
   * Fetch the object's saved views, so an `ElementDataSource.view` name can be
   * resolved to real columns / filter / sort (objectstack#5576).
   *
   * Optional because most fetchers only read records. A fetcher WITHOUT it
   * cannot honour a named view, and {@link ViewDataProvider.resolveElementDataSource}
   * says so in `error` rather than dropping the key — the whole point of objectstack-ai/objectstack#5576
   * is that a `view` the runtime cannot apply must never look applied.
   *
   * Either shape stored views come in is accepted: a map keyed by view id, or
   * the array of overlay rows an adapter's `listViews()` returns.
   */
  fetchViews?(
    object: string,
  ): Promise<Record<string, ElementSavedView> | ElementSavedView[]>;
}

/** Resolved data result */
export interface ResolvedData {
  /** Data records */
  records: any[];
  /** Total record count (for pagination) */
  total: number;
  /** Object metadata (if available) */
  metadata?: {
    name: string;
    label?: string;
    fields: Array<{
      name: string;
      label?: string;
      type: string;
      required?: boolean;
    }>;
  };
  /** Provider type */
  provider: 'object' | 'value';
  /** Loading state */
  loading: boolean;
  /** Error */
  error?: string;
}

/**
 * Resolves ViewData configuration into actual data via a pluggable fetcher.
 *
 * @example
 * ```ts
 * const provider = new ViewDataProvider(myFetcher);
 * const data = await provider.resolve({ provider: 'object', object: 'Account' });
 * ```
 */
export class ViewDataProvider {
  private fetcher: DataFetcher | null = null;

  constructor(fetcher?: DataFetcher) {
    this.fetcher = fetcher ?? null;
  }

  /** Set the data fetcher implementation */
  setFetcher(fetcher: DataFetcher): void {
    this.fetcher = fetcher;
  }

  /** Resolve ViewData config into actual data */
  async resolve(
    config: ViewDataConfig,
    options?: {
      filter?: Record<string, any>;
      sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
      limit?: number;
      offset?: number;
      fields?: string[];
    },
  ): Promise<ResolvedData> {
    switch (config.provider) {
      case 'value':
        return this.resolveValue(config);
      case 'object':
        return this.resolveObject(config, options);
      default:
        return {
          records: [],
          total: 0,
          provider: 'value' as const,
          loading: false,
          error: `Unknown data provider: ${(config as any).provider}`,
        };
    }
  }

  /** Resolve static value data */
  private resolveValue(config: {
    provider: 'value';
    items: any[];
  }): ResolvedData {
    const items = Array.isArray(config.items) ? config.items : [];
    return {
      records: items,
      total: items.length,
      provider: 'value',
      loading: false,
    };
  }

  /** Resolve object-based data (metadata-driven) */
  private async resolveObject(
    config: { provider: 'object'; object: string },
    options?: {
      filter?: Record<string, any>;
      sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
      limit?: number;
      offset?: number;
      fields?: string[];
    },
  ): Promise<ResolvedData> {
    if (!this.fetcher) {
      return {
        records: [],
        total: 0,
        provider: 'object',
        loading: false,
        error: 'No data fetcher configured for object data provider',
      };
    }

    try {
      // Fetch metadata if available
      let metadata: ResolvedData['metadata'];
      if (this.fetcher.fetchMetadata) {
        metadata = await this.fetcher.fetchMetadata(config.object);
      }

      // Fetch records
      const result = await this.fetcher.fetchRecords(config.object, options);

      return {
        records: result.records,
        total: result.total,
        metadata,
        provider: 'object',
        loading: false,
      };
    } catch (error) {
      return {
        records: [],
        total: 0,
        provider: 'object',
        loading: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Resolve an element-level data source (`PageComponentSchema.dataSource`).
   *
   * `view` is HONOURED here, not dropped. Until objectstack#5576 this method
   * forwarded `filter`/`sort`/`limit` and silently discarded `view`, so a page
   * component that named a saved view got every record the object had — the
   * declared binding was inert while looking applied.
   *
   * Three outcomes, all explicit:
   *  - no `view` → unchanged behaviour, the binding's own keys are forwarded;
   *  - `view` resolved → its columns become the `fields` projection and its
   *    filter/sort/limit the baseline the binding's keys compose with (see
   *    {@link composeElementDataSource} for the per-key rule);
   *  - `view` unresolvable, or the fetcher cannot list views at all → an
   *    `error` naming the view and what the object does have. NOT an empty
   *    result, and NOT a silent fall back to the unfiltered object.
   */
  async resolveElementDataSource(
    config: ElementDataSourceConfig,
  ): Promise<ResolvedData> {
    let view: ElementSavedView | undefined;

    if (config.view) {
      if (!this.fetcher?.fetchViews) {
        return {
          records: [],
          total: 0,
          provider: 'object',
          loading: false,
          error:
            `dataSource.view "${config.view}" cannot be resolved: this data ` +
            `fetcher does not implement fetchViews().`,
        };
      }
      let views: Record<string, ElementSavedView>;
      try {
        views = collectSavedViews(await this.fetcher.fetchViews(config.object));
      } catch (error) {
        return {
          records: [],
          total: 0,
          provider: 'object',
          loading: false,
          error: (error as Error).message,
        };
      }
      view = resolveSavedView(views, config.view, config.object);
      if (!view) {
        return {
          records: [],
          total: 0,
          provider: 'object',
          loading: false,
          error: elementDataSourceViewNotFoundMessage(
            config.object,
            config.view,
            Object.keys(views),
          ),
        };
      }
    }

    const composed = composeElementDataSource(config, view);

    // The loud half of the row-cap refusal. This method is the consumer that
    // has NO guard of its own — it forwards `limit` straight to
    // `DataFetcher.fetchRecords` — so before the guard a view's `0` / `-10` /
    // `25.5` reached the fetcher verbatim, and nothing anywhere said so. A
    // renderer that receives the same key reports it through its own channel;
    // this path has no renderer, so it reports here, on the same `console.warn`
    // channel those sites use. ⛔ Not an `error`: the refusal is FAIL-SOFT and
    // the records still load, so blanking the result would be a worse outcome
    // than the defect.
    //
    // Both operands of the chain are asked (objectui#10016): a refused binding
    // `limit` is not authored and yields to the view's cap, so it is reported
    // in its own words. The builder is also handed the binding for the VIEW's
    // sentence, because that sentence says the fetch falls back to a default,
    // which is false when the binding's own usable cap is what gets used.
    for (const operand of ['binding', 'view'] as const) {
      const refusedLimit = elementDataSourceRefusedLimitMessage(
        view,
        config.view,
        config.object,
        config,
        operand,
      );
      if (refusedLimit) console.warn(refusedLimit);
    }

    const fields = Array.isArray(composed.columns)
      ? composed.columns.filter((c): c is string => typeof c === 'string' && !!c)
      : undefined;

    return this.resolve(
      { provider: 'object', object: composed.object },
      {
        // `DataFetcher.fetchRecords`'s `filter` is declared
        // `Record<string, any>`, which predates the three filter shapes that
        // legitimately circulate here: a MongoDB-style condition object, an
        // ObjectQL AST node array, and a spec `ViewFilterRule[]`. The last two
        // are arrays, so a saved view's filter does not fit the declared option
        // — the cast is that gap, not a coercion. Widening the declared option
        // is a separate change with its own consumers.
        filter: composed.filter as Record<string, any> | undefined,
        sort: composed.sort as Array<{ field: string; order: 'asc' | 'desc' }> | undefined,
        limit: composed.limit,
        ...(fields && fields.length > 0 ? { fields } : {}),
      },
    );
  }

}
