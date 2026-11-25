/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27188 — the "used" half of a record-currency code field's
 * "available" group (ADR-0144 D8 rule 3). The form renderer asks the object's
 * distinct stored codes once (one grouped header query) and hands them down
 * on the field's own metadata, `usedCurrencyCodes`.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererContext } from '@object-ui/react';
import '../../../renderers';
// The renderers reach a dynamic `import('@object-ui/react-runtime')`; pay its
// first load at collection, never inside a case's clocked window
// (`check:test-source-alias`).
import '@object-ui/react-runtime';
import {
  currencyCodeFieldNames,
  readUsedCurrencyCodes,
  usedCurrencyCodesQuery,
  withUsedCurrencyCodes,
} from '../usedCurrencyCodes';

const seen: Record<string, any> = {};

beforeAll(() => {
  // `field:text` is contributed by `@object-ui/fields`, which this package
  // does not depend on — the stub shadows nothing.
  ComponentRegistry.register('field:text', function Stub(props: any) {
    seen[props.field?.name ?? 'unnamed'] = props;
    return <div data-testid="stub-text" />;
  });
});

afterEach(() => {
  cleanup();
  for (const k of Object.keys(seen)) delete seen[k];
});

describe('the used-codes query and its answer', () => {
  it('groups by the code field, counting', () => {
    const q = usedCurrencyCodesQuery('currency_code');
    expect(q.groupBy).toEqual(['currency_code']);
    expect(q.aggregations?.map((a) => a.function)).toEqual(['count']);
    expect(q.where).toBeUndefined();
  });

  it('reads the distinct domain-valid codes, sorted', () => {
    expect(
      readUsedCurrencyCodes(
        [
          { currency_code: 'USD', count: 3 },
          { currency_code: null, count: 1 },
          { currency_code: 'BTC', count: 1 },
          { currency_code: 'EUR', count: 2 },
          { currency_code: 'USD', count: 1 },
        ],
        'currency_code',
      ),
    ).toEqual(['EUR', 'USD']);
  });

  it('names only ISO 4217 code fields', () => {
    expect(
      currencyCodeFieldNames([
        { name: 'currency_code', field: { type: 'text', valueDomain: 'iso_4217_currency' } },
        { name: 'title', field: { type: 'text' } },
        { name: 'other_code', valueDomain: 'iso_4217_currency' },
      ]),
    ).toEqual(['currency_code', 'other_code']);
  });

  it('decorates a def only when there are codes', () => {
    const def = { name: 'currency_code' };
    expect(withUsedCurrencyCodes(def, [])).toBe(def);
    expect(withUsedCurrencyCodes(def, ['EUR'])).toEqual({ name: 'currency_code', usedCurrencyCodes: ['EUR'] });
  });
});

const CODE_FIELD = {
  name: 'currency_code',
  label: 'Currency',
  type: 'field:text',
  field: { name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency' },
};
const TITLE_FIELD = { name: 'title', label: 'Title', type: 'field:text', field: { name: 'title', type: 'text' } };

function renderForm(dataSource: any, objectName?: string) {
  const Form = ComponentRegistry.get('form')!;
  const schema = {
    type: 'form',
    ...(objectName ? { objectName } : {}),
    showSubmit: false,
    showCancel: false,
    fields: [CODE_FIELD, TITLE_FIELD],
  };
  return render(
    <SchemaRendererContext.Provider value={{ dataSource } as any}>
      <Form schema={schema} />
    </SchemaRendererContext.Provider>,
  );
}

describe('form renderer — used currency codes on the code field', () => {
  it('asks once per object and hands the codes down on `field`', async () => {
    const queryGroupHeaders = vi.fn(async () => [
      { currency_code: 'USD', count: 3 },
      { currency_code: 'EUR', count: 2 },
      { currency_code: null, count: 1 },
    ]);
    const { rerender } = renderForm({ find: async () => ({ data: [] }), queryGroupHeaders }, 'deal');

    await waitFor(() => expect(seen.currency_code?.field?.usedCurrencyCodes).toEqual(['EUR', 'USD']));
    expect(queryGroupHeaders).toHaveBeenCalledTimes(1);
    expect(queryGroupHeaders).toHaveBeenCalledWith('deal', expect.objectContaining({ groupBy: ['currency_code'] }));
    // Only the code field carries them.
    expect(seen.title?.field?.usedCurrencyCodes).toBeUndefined();
    // A re-render with a rebuilt (equal) field list does not re-ask.
    const Form = ComponentRegistry.get('form')!;
    rerender(
      <SchemaRendererContext.Provider value={{ dataSource: { find: async () => ({ data: [] }), queryGroupHeaders } } as any}>
        <Form schema={{ type: 'form', objectName: 'deal', showSubmit: false, showCancel: false, fields: [{ ...CODE_FIELD }, { ...TITLE_FIELD }] }} />
      </SchemaRendererContext.Provider>,
    );
    expect(queryGroupHeaders).toHaveBeenCalledTimes(1);
  });

  it('asks nothing without an object or a grouped-query capability', async () => {
    const queryGroupHeaders = vi.fn(async () => []);
    renderForm({ find: async () => ({ data: [] }), queryGroupHeaders });
    renderForm({ find: async () => ({ data: [] }) }, 'deal');
    await new Promise((r) => setTimeout(r, 0));
    expect(queryGroupHeaders).not.toHaveBeenCalled();
    expect(seen.currency_code?.field?.usedCurrencyCodes).toBeUndefined();
  });

  it('a failed read leaves the field without used codes', async () => {
    const queryGroupHeaders = vi.fn(async () => {
      throw new Error('boom');
    });
    renderForm({ find: async () => ({ data: [] }), queryGroupHeaders }, 'deal');
    await waitFor(() => expect(queryGroupHeaders).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.currency_code?.field?.usedCurrencyCodes).toBeUndefined();
  });
});

/**
 * objectstack#37278 — a grouped read cut to a deployment's default page size.
 * The double answers the used-codes header query the way the platform's
 * `POST /data/:object/query` does under `OS_DATA_DEFAULT_PAGE_SIZE`: every
 * group of the stored rows, sliced to the page, with `hasMore` on the answer
 * when the slice dropped a group (as `queryGroupHeaders` hands it on). The
 * control is the same store under a page that holds every group.
 */
describe('form renderer — a partial used-codes answer (objectstack#37278)', () => {
  const STORED = ['USD', 'EUR', 'GBP', 'USD', null];

  function cappedDataSource(defaultPageSize: number) {
    const queryGroupHeaders = vi.fn(async (_object: string, query: { groupBy?: string[] }) => {
      const field = query.groupBy?.[0] as string;
      const counts = new Map<unknown, number>();
      for (const code of STORED) counts.set(code, (counts.get(code) ?? 0) + 1);
      const groups = [...counts.entries()].map(([code, count]) => ({ [field]: code, count }));
      const answer = groups.slice(0, defaultPageSize) as Array<Record<string, unknown>> & { hasMore?: boolean };
      if (answer.length < groups.length) answer.hasMore = true;
      return answer;
    });
    return { find: async () => ({ data: [] }), queryGroupHeaders };
  }

  it('a cut answer hands down no used codes — never the groups it happened to list', async () => {
    const ds = cappedDataSource(2);
    renderForm(ds, 'deal');
    await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1));
    const answer = await ds.queryGroupHeaders.mock.results[0].value;
    // The cut is real: two of four groups, flagged.
    expect(answer).toHaveLength(2);
    expect(answer.hasMore).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.currency_code?.field?.usedCurrencyCodes).toBeUndefined();
  });

  it('control: a page that holds every group hands every used code down', async () => {
    const ds = cappedDataSource(10);
    renderForm(ds, 'deal');
    await waitFor(() => expect(seen.currency_code?.field?.usedCurrencyCodes).toEqual(['EUR', 'GBP', 'USD']));
    const answer = await ds.queryGroupHeaders.mock.results[0].value;
    expect(answer.hasMore).toBeUndefined();
  });

  it('readUsedCurrencyCodes reads a partial answer as no codes, a whole one as its codes', () => {
    const rows = [{ currency_code: 'USD', count: 2 }, { currency_code: 'EUR', count: 1 }];
    expect(readUsedCurrencyCodes(rows, 'currency_code')).toEqual(['EUR', 'USD']);
    expect(readUsedCurrencyCodes(Object.assign([...rows], { hasMore: true }), 'currency_code')).toEqual([]);
  });
});
