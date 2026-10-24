/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The "recently used" rail must obey the declared filters — objectui#5195.
 *
 * Reported from a deployed project: a `product` lookup declaring
 * `lookupFilters: [{ field: 'status', operator: 'eq', value: 'active' }]` plus
 * `dependsOn: [{ field: 'project', param: 'project' }]` served its recents rail
 * from a re-fetch that merged NEITHER filter. Pick a product under project A,
 * switch the form to project B, reopen the lookup, and project A's product was
 * still offered — and selecting it produced a cross-project value the author's
 * metadata had excluded. The main candidate query was filtered correctly the
 * whole time; only the recents channel was not, which left the application a
 * server-side `beforeInsert`/`beforeUpdate` hook as its only defence.
 *
 * There are TWO such channels and they failed differently, so both are pinned
 * here, against both filter kinds — four pins:
 *
 *   inline dropdown (`LookupField`'s quick-select popover)
 *     re-read each remembered id with `dataSource.findOne(object, id)`, which
 *     takes no filter argument at all.
 *   search-first picker (`PeoplePicker`, the Level-2 picker `LookupField`
 *   renders for `picker: 'search'` fields)
 *     batched value ids + recent ids into one `{ [idField]: { $in: ids } }`
 *     query that merged neither the base `lookupFilters` nor the `dependsOn`
 *     cascade — while the main candidate query beside it merged both.
 *
 * The cascade pins drive the reporter's sequence for real (select under project
 * A, which pushes the record into the recents store, then re-render under
 * project B and reopen) rather than seeding the store by hand, so the whole
 * loop is under test.
 *
 * Two further pins guard the deliberate scope boundary this fix draws: the
 * current VALUE's re-fetch stays unfiltered (it reports a choice already made,
 * so narrowing it would only hide the record's own label and could empty a
 * selection tray), and a gated cascade shows no rail at all.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LookupField } from './LookupField';
import { PeoplePicker } from './PeoplePicker';
import { pushRecentLookupId } from './recentLookups';

type Row = Record<string, any>;

const products: Row[] = [
  { id: 'p1', name: 'Alpha Widget', status: 'active', project: 'projA' },
  { id: 'p2', name: 'Beta Widget', status: 'active', project: 'projB' },
  { id: 'p3', name: 'Retired Widget', status: 'archived', project: 'projB' },
];

/**
 * A fake backend that evaluates BOTH `$filter` shapes the pickers emit: the
 * `QueryParams.$filter` record form, and the ObjectQL AST node `mergeFilterNodes`
 * lowers a conjunction to. Evaluating rather than shape-matching is the point —
 * a pin that asserted a query shape would pass for a merge that is syntactically
 * present and semantically wrong, and these tests exist to answer "can the user
 * still see the excluded record", which only a real filter evaluation answers.
 * Unsupported operators throw instead of matching everything, so a widened
 * filter can never read as a passing test.
 */
function matchesOp(actual: any, op: string, v: any): boolean {
  switch (op) {
    case '$eq': return actual === v;
    case '$ne': return actual !== v;
    case '$in': return (v as any[]).map(String).includes(String(actual));
    case '$nin': return !(v as any[]).map(String).includes(String(actual));
    case '$contains': return String(actual ?? '').includes(String(v));
    default: throw new Error(`fake backend: unsupported record operator '${op}'`);
  }
}

function matchesNode(row: Row, node: any): boolean {
  if (!Array.isArray(node)) return matchesRecord(row, node);
  if (node.length === 0) return true;
  const head = node[0];
  if (head === 'and') return node.slice(1).every((n: any) => matchesNode(row, n));
  if (head === 'or') return node.slice(1).some((n: any) => matchesNode(row, n));
  // A bare array of nodes (no boolean head) is a conjunction.
  if (Array.isArray(head)) return node.every((n: any) => matchesNode(row, n));
  const [field, op, v] = node as [string, string, any];
  switch (op) {
    case '=': return row[field] === v;
    case '!=': return row[field] !== v;
    case 'in': return (v as any[]).map(String).includes(String(row[field]));
    case 'nin': return !(v as any[]).map(String).includes(String(row[field]));
    case 'contains': return String(row[field] ?? '').includes(String(v));
    default: throw new Error(`fake backend: unsupported AST operator '${op}'`);
  }
}

function matchesRecord(row: Row, filter: any): boolean {
  if (filter === undefined || filter === null) return true;
  if (typeof filter !== 'object') return true;
  return Object.entries(filter).every(([field, cond]) => {
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      return Object.entries(cond as Row).every(([op, v]) => matchesOp(row[field], op, v));
    }
    return row[field] === cond;
  });
}

function matchesFilter(row: Row, filter: any): boolean {
  if (Array.isArray(filter)) return matchesNode(row, filter);
  return matchesRecord(row, filter);
}

function makeDataSource(rows: Row[] = products) {
  const find = vi.fn(async (_obj: string, params: any) => {
    let data = rows.filter(r => matchesFilter(r, params?.$filter));
    const search: string | undefined = params?.$search;
    if (search) {
      data = data.filter(r => String(r.name).toLowerCase().includes(search.toLowerCase()));
    }
    const skip: number = params?.$skip ?? 0;
    const top: number = params?.$top ?? data.length;
    return { data: data.slice(skip, skip + top), total: data.length };
  });
  // The unfiltered by-id read the inline dropdown used to resolve recents with.
  // Kept on the fake on purpose: without it the pre-fix rail would come up empty
  // and these pins would pass against the very code they exist to reject.
  const findOne = vi.fn(async (_obj: string, id: any) =>
    rows.find(r => String(r.id) === String(id)) ?? null,
  );
  return { find, findOne } as any;
}

/** Labels currently offered in the inline dropdown's candidate list. */
function optionLabels(): string[] {
  return screen.queryAllByRole('option').map(el => el.textContent ?? '');
}

/** Names currently offered as rows in the search-first picker. */
function personRowNames(): string[] {
  return screen.queryAllByTestId('person-row').map(el => el.textContent ?? '');
}

beforeEach(() => {
  // jsdom has no matchMedia; PeoplePicker's useIsMobile needs it. Desktop width.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
});

// The reporter's field, spelled the way the report spells it — camelCase
// `lookupFilters` / `dependsOn`, which the widget accepts alongside the
// snake_case ObjectStack convention.
const staticFilterField = {
  name: 'product',
  label: 'Product',
  reference: 'product',
  reference_field: 'name',
  lookupFilters: [{ field: 'status', operator: 'eq', value: 'active' }],
} as any;

const cascadeField = {
  name: 'product',
  label: 'Product',
  reference: 'product',
  reference_field: 'name',
  dependsOn: [{ field: 'project', param: 'project' }],
} as any;

describe('inline dropdown — the recents rail merges the declared filters (#5195)', () => {
  it('drops a recent record the static lookupFilters exclude', async () => {
    // Both were picked before; only one is still `status: active`.
    pushRecentLookupId('product', 'p3');
    pushRecentLookupId('product', 'p2');
    const ds = makeDataSource();

    render(
      <LookupField
        field={staticFilterField}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={ds}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
    });

    await waitFor(() => expect(optionLabels().join('|')).toContain('Beta Widget'));
    // The rail is alive (positive control) and the archived record is gone.
    expect(screen.getByText(/recently used/i)).toBeTruthy();
    expect(optionLabels().join('|')).not.toContain('Retired Widget');
  });

  it("stops offering project A's product after the parent switches to project B", async () => {
    const ds = makeDataSource();
    const onChange = vi.fn();

    // 1. Under project A, pick Alpha Widget — this is what fills the recents store.
    const { rerender } = render(
      <LookupField
        field={cascadeField}
        value={undefined}
        onChange={onChange}
        readonly={false}
        dataSource={ds}
        {...({ dependentValues: { project: 'projA' } } as any)}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
    });
    await waitFor(() => expect(optionLabels().join('|')).toContain('Alpha Widget'));
    await act(async () => {
      fireEvent.click(screen.getByText('Alpha Widget'));
    });
    expect(onChange).toHaveBeenCalledWith('p1');

    // 2. The form's project moves to B. Reopen the lookup.
    rerender(
      <LookupField
        field={cascadeField}
        value={undefined}
        onChange={onChange}
        readonly={false}
        dataSource={ds}
        {...({ dependentValues: { project: 'projB' } } as any)}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /select/i }));
    });

    // 3. Project B's products are offered; project A's recent is not.
    await waitFor(() => expect(optionLabels().join('|')).toContain('Beta Widget'));
    expect(optionLabels().join('|')).not.toContain('Alpha Widget');
  });

  it('shows no rail at all while the cascade is still gated', async () => {
    pushRecentLookupId('product', 'p1');
    const ds = makeDataSource();

    render(
      <LookupField
        field={cascadeField}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={ds}
        {...({ dependentValues: { project: null } } as any)}
      />,
    );

    // The gated trigger cannot open the popover; nothing may be offered, and in
    // particular no leftover recent may be resolved behind the gate.
    await waitFor(() => expect(screen.getByTestId('lookup-trigger-gated')).toBeDisabled());
    expect(optionLabels()).toHaveLength(0);
    expect(screen.queryByText('Alpha Widget')).toBeNull();
  });
});

describe('search-first picker — the seed re-fetch merges the declared filters (#5195)', () => {
  it('drops a recent record the static lookupFilters exclude', async () => {
    pushRecentLookupId('product', 'p3');
    pushRecentLookupId('product', 'p2');
    const ds = makeDataSource();

    render(
      <PeoplePicker
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="product"
        displayField="name"
        onSelect={vi.fn()}
        lookupFilters={[{ field: 'status', operator: 'eq', value: 'active' }]}
      />,
    );

    await waitFor(() => expect(personRowNames().join('|')).toContain('Beta Widget'));
    expect(screen.getByText(/recently used/i)).toBeTruthy();
    expect(personRowNames().join('|')).not.toContain('Retired Widget');
  });

  it("stops offering project A's product after the parent switches to project B", async () => {
    const ds = makeDataSource();
    const onSelect = vi.fn();

    // 1. Under project A, pick Alpha Widget.
    const { rerender } = render(
      <PeoplePicker
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="product"
        displayField="name"
        onSelect={onSelect}
        baseFilter={{ project: 'projA' }}
      />,
    );

    await waitFor(() => expect(personRowNames().join('|')).toContain('Alpha Widget'));
    await act(async () => {
      fireEvent.click(screen.getByText('Alpha Widget'));
    });
    expect(onSelect).toHaveBeenCalledWith('p1');

    // 2. The cascade moves to project B; the picker reopens.
    rerender(
      <PeoplePicker
        open={false}
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="product"
        displayField="name"
        onSelect={onSelect}
        baseFilter={{ project: 'projB' }}
      />,
    );
    rerender(
      <PeoplePicker
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="product"
        displayField="name"
        onSelect={onSelect}
        baseFilter={{ project: 'projB' }}
      />,
    );

    // 3. Project B's products are offered; project A's recent is not.
    await waitFor(() => expect(personRowNames().join('|')).toContain('Beta Widget'));
    expect(personRowNames().join('|')).not.toContain('Alpha Widget');
  });

  it('still hydrates a current value the filters exclude (the value leg stays unfiltered)', async () => {
    const ds = makeDataSource();

    render(
      <PeoplePicker
        open
        multiple
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="product"
        displayField="name"
        value={['p3']}
        onSelect={vi.fn()}
        onSelectRecords={vi.fn()}
        lookupFilters={[{ field: 'status', operator: 'eq', value: 'active' }]}
      />,
    );

    // `p3` is archived, so it is not a candidate and not a recent — but it IS
    // what the record holds, and the tray must say so rather than silently
    // dropping it (a no-op Confirm would otherwise clear the field).
    await waitFor(() => expect(screen.getAllByTestId('selection-chip')).toHaveLength(1));
    expect(screen.getByTestId('selection-tray').textContent).toContain('Retired Widget');
    expect(personRowNames().join('|')).not.toContain('Retired Widget');
  });
});
