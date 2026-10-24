/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Lightweight list primitives for SIMPLE data — the antidote to dropping a
 * full data-grid (toolbar + filters + pagination + selection) on a handful of
 * reference rows. Two presentational/low-chrome components:
 *
 *   - element:definition-list — a compact key/value `<dl>` for a single record.
 *   - element:repeater        — a data-bound, chrome-free list: one line per
 *                               row, no toolbar/card/pagination.
 *
 * Props are read off `schema.properties` (spec convention) with a `schema.props`
 * fallback, matching the other `element:*` renderers. The repeater's query is
 * the node-level `dataSource` binding alone (objectui#11880, objectui#12345).
 */

import * as React from 'react';
import { ComponentRegistry, elementDataSourceBlock } from '@object-ui/core';
import {
  ElementDataSourceErrorPanel,
  ElementDataSourceLoadingPanel,
  useAdapter,
  useDataInvalidation,
  useElementDataSource,
  useFilterScope,
  useResolvedFilter,
} from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { cn } from '../../lib/utils';
import { readProps } from './readProps';

function toText(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// element:definition-list — compact key/value display
// ---------------------------------------------------------------------------

interface DefinitionItem {
  term: string;
  description?: unknown;
}

function DefinitionListRenderer({ schema }: { schema: any }) {
  const props = readProps<{
    items?: DefinitionItem[];
    columns?: 1 | 2;
    inline?: boolean;
    className?: string;
  }>(schema);
  const items = Array.isArray(props.items) ? props.items : [];
  const cols = props.columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1';
  // objectui#12910 — the empty state reads `common.noData`, the key
  // `element:repeater` below reads for its own, so a zh-CN page draws its own
  // language instead of the English "No details" this block used to print.
  const { t } = useObjectTranslation();

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="definition-list-empty">
        {t('common.noData', { defaultValue: 'No data' })}
      </p>
    );
  }

  return (
    <dl
      className={cn('grid gap-x-6 gap-y-3', cols, schema?.className, props.className)}
      data-testid="definition-list"
    >
      {items.map((it, i) => (
        <div
          key={i}
          className={cn(props.inline ? 'flex items-baseline justify-between gap-3' : 'flex flex-col gap-0.5')}
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {it.term}
          </dt>
          <dd className="text-sm text-foreground">{toText(it.description)}</dd>
        </div>
      ))}
    </dl>
  );
}

ComponentRegistry.register('definition-list', DefinitionListRenderer, {
  namespace: 'element',
  skipFallback: true,
  label: 'Definition List',
  category: 'content',
  // objectui#11168 slice 2 — each input as the renderer reads it and as the
  // `@objectstack/spec` row accepts it, pinned in
  // `__tests__/element-list-inputs-11168.test.tsx`:
  //   - `columns` is compared to the NUMBER 2 (`props.columns === 2`), so the
  //     enum members are the numbers 1 and 2. The strings '1' / '2' it used to
  //     publish render one column, and the spec refuses them.
  //   - `items` is optional: absent and empty both render the empty state
  //     (`common.noData`, objectui#12910), and the spec row does not require it. Marking it required made
  //     the page validator raise `missing-required-prop` on a list the spec
  //     and the renderer both accept.
  inputs: [
    {
      name: 'items',
      type: 'array',
      of: 'object',
      description:
        'Term/description pairs [{ term, description }], in order: `term` is the row label, `description` is shown as-is (an object as JSON, an omitted one as an em dash). Omitted or empty renders the empty state: the active language’s "No data" (`common.noData`)',
    },
    {
      name: 'columns',
      type: 'enum',
      enum: [
        { label: '1', value: 1 },
        { label: '2', value: 2 },
      ],
      description: 'Grid columns from the small breakpoint up: the NUMBER 1 or 2 (default 1)',
    },
    { name: 'inline', type: 'boolean', description: 'Term and description on one baseline-aligned row' },
  ],
});

// ---------------------------------------------------------------------------
// element:repeater — data-bound, chrome-free list
// ---------------------------------------------------------------------------

/**
 * One entry of `fields` in its object form. `field` is the only member read:
 * the list has no header row, so a `label` was never rendered, and the spec
 * row refuses it (objectui#11168 slice 2).
 */
interface RepeaterColumn {
  field: string;
}

function RepeaterRenderer({ schema }: { schema: any }) {
  const props = readProps<{
    titleField?: string;
    fields?: Array<string | RepeaterColumn>;
    emptyText?: string;
    divided?: boolean;
    className?: string;
  }>(schema);

  const adapter = useAdapter() as any;
  // objectui#12889 — the loading, empty and error defaults read the shared
  // bundle keys through the hook `element:number` (elements.tsx) reads its
  // copy through, so a zh-CN page draws its own language instead of the
  // English literals this renderer used to print. Each inline `defaultValue`
  // is the `en` pack's value, served when no `I18nProvider` is mounted and
  // held byte-identical to the pack by `pnpm check:i18n-keys`. An authored
  // `emptyText` still wins over the default.
  const { t } = useObjectTranslation();
  // objectui#11880 — the spec's per-element binding (`PageComponentSchema
  // .dataSource`), resolved through `useElementDataSource` as `element:number`
  // and `element:record_picker` resolve theirs, against the repeater's own
  // adapter. It is the repeater's ONE query source (objectui#12345):
  // `@objectstack/spec` 18 retired the row's flat `object`, `filter`, `sort`
  // and `limit` (objectstack#11509, ruled A-narrow), and this renderer reads
  // none of them. `composed` already carries the precedence between the
  // binding and its saved view: the binding's own `sort` and usable `limit`
  // win, the view's are the baseline, and the two filters are AND-combined.
  const dataBinding = useElementDataSource(schema, adapter);
  const { composed } = dataBinding;
  // While a named view is unresolved (or unresolvable, or its filter is
  // refused), there is NO object: reading one would fire the wider query the
  // binding was written to narrow. The render reports instead.
  const object =
    dataBinding.status === 'loading' || dataBinding.status === 'missing' ? undefined : composed?.object;
  const sort = composed?.sort;
  const limit = composed?.limit;
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // objectui#10666 — the repeater's filter (above), with every context token
  // (`{current_user_id}`, `{current_org_id}`, the date macros) resolved ONCE
  // through `@object-ui/core`'s shared `resolveFilterPlaceholders`, against the
  // session scope the host provides, and HELD by structure (`useResolvedFilter`
  // in `@object-ui/react`). It sent the literal token on `$filter` before. The
  // query and its content key below read THIS, never a raw filter.
  const filterScope = useFilterScope();
  const queryFilter = useResolvedFilter(composed?.filter, filterScope);
  const filterKey = React.useMemo(() => (queryFilter ? JSON.stringify(queryFilter) : ''), [queryFilter]);
  // objectui#10664 — the sort reaches `$orderby` below, so the fetch effect
  // keys on it, by CONTENT the way `filterKey` keys the filter: a fresh array
  // with the same entries is not a change (AGENTS.md #10).
  const sortKey = React.useMemo(() => (sort ? JSON.stringify(sort) : ''), [sort]);

  const cols: RepeaterColumn[] = React.useMemo(
    () => (props.fields ?? []).map((f) => (typeof f === 'string' ? { field: f } : f)),
    [props.fields],
  );

  // objectui#10623 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10494 way: the nonce moves when a
  // write to the object this list REPEATS over is declared, and the effect
  // below names it, so the rows are re-read. Subscribed only when the effect
  // can query: without an adapter `find` there is no read to repeat. Keyed on
  // the RESOLVED object, so a bound list re-reads for the object it lists.
  const invalidationNonce = useDataInvalidation(
    adapter && typeof adapter.find === 'function' ? object : undefined,
  );

  React.useEffect(() => {
    let cancelled = false;
    if (!adapter || !object || typeof adapter.find !== 'function') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const query: any = {};
        if (queryFilter) query.$filter = queryFilter;
        if (sort) query.$orderby = sort;
        if (limit) query.$top = limit;
        const res = await adapter.find(object, query);
        // `data` is the ONE rows member `QueryResult` (`@object-ui/types`)
        // declares; the bare-array arm stays because fakes at this seam really
        // do answer with a plain array. A `res?.records` arm sat between them
        // until objectui#6726 — a below-the-adapter spelling
        // (`ObjectStackAdapter.normalizeQueryResult` maps the server/SDK
        // `records` envelope to `data` before returning), so no producer emits
        // it here and the arm bought nothing. Pinned by
        // `data-list.contractEnvelope-6726.test.tsx`.
        const data: any[] = res?.data ?? (Array.isArray(res) ? res : []);
        if (!cancelled) setRows(data);
      } catch (e: any) {
        // The thrown message when there is one; otherwise the empty string
        // still selects the error branch below, which draws the translated
        // default in its place.
        if (!cancelled) setError(e?.message ?? '');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, object, filterKey, sortKey, limit, invalidationNonce]);

  // After every hook above, so hook order stays stable across resolution
  // states. A `view` that names nothing, or a filter the composition refuses,
  // reports rather than listing the wider set.
  if (dataBinding.status === 'missing') {
    return <ElementDataSourceErrorPanel testId="repeater" message={dataBinding.error} />;
  }
  if (dataBinding.status === 'loading') return <ElementDataSourceLoadingPanel testId="repeater" />;
  if (loading) {
    return (
      <p className="py-2 text-sm text-muted-foreground" role="status" data-testid="repeater-loading">
        {t('common.loading', { defaultValue: 'Loading…' })}
      </p>
    );
  }
  if (error !== null) {
    return (
      <p className="py-2 text-sm text-destructive" data-testid="repeater-error">
        {error || t('list.loadErrorTitle', { defaultValue: 'Couldn’t load records' })}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        {props.emptyText ?? t('common.noData', { defaultValue: 'No data' })}
      </p>
    );
  }

  return (
    <ul
      className={cn(props.divided !== false && 'divide-y divide-border', schema?.className, props.className)}
      data-testid="repeater"
    >
      {rows.map((row, i) => (
        <li key={row?.id ?? i} className="flex items-baseline gap-3 py-2">
          {props.titleField && (
            <span className="text-sm font-medium text-foreground">{toText(row[props.titleField])}</span>
          )}
          {cols.map((c) => (
            <span key={c.field} className="text-sm text-muted-foreground">
              {toText(row[c.field])}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

// The renderer READS the node-level `dataSource` binding (objectui#11880), so
// it declares it from the seam every reader of the binding declares it from:
// the marker makes `Registry.register` emit `ELEMENT_DATA_SOURCE_INPUT` into
// these `inputs`. That binding is the ONE query door published here
// (objectui#12085): `@objectstack/spec` retires the flat `object` / `filter` /
// `sort` / `limit` as tombstones (objectstack#11509), and publishing them made
// the html tier accept the retired spelling while a required `object` refused a
// repeater bound through `dataSource` alone. The renderer reads none of the
// flat four either (objectui#12345): the binding is its only query source.
// The seam comes from `@object-ui/core` for the measured reason
// `element:record_picker`'s registration states.
ComponentRegistry.register('repeater', elementDataSourceBlock(RepeaterRenderer), {
  namespace: 'element',
  skipFallback: true,
  label: 'Repeater',
  category: 'content',
  // objectui#11168 slice 2 — the members of `fields` are pinned in
  // `__tests__/element-list-inputs-11168.test.tsx`: what the renderer prints
  // for each entry. The query's own members (`filter`, `sort`) are the
  // binding's, pinned in `__tests__/data-list.elementDataSource-11880.test.tsx`.
  inputs: [
    { name: 'titleField', type: 'string' },
    {
      name: 'fields',
      type: 'array',
      description: 'Fields shown after the title on each line, in order: a bare field name, or `{ field }`',
    },
    { name: 'emptyText', type: 'string' },
    { name: 'divided', type: 'boolean', description: 'Separator between rows' },
  ],
});
