// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36896 — the metadata list's state in the address, and the
 * ordered names the detail's ‹ › step through (epic objectstack#36890,
 * decision 10). Pinned, each with its control:
 *
 *  - the codec round-trips every filter and the sort, writes nothing for an
 *    untouched list, keeps the params it does not own, and reads a value the
 *    list does not offer as that filter's default;
 *  - no list-state param names a reserved console param or one the item page
 *    reads, so a detail address can carry them all;
 *  - the ordered names follow the filter and the sort, and with no list
 *    context they are every row by API name;
 *  - a filter the list does not offer (no reader member) is ignored, and an
 *    unknown activation state matches neither status.
 */
import { describe, it, expect } from 'vitest';
import {
  applyListState,
  decodeListState,
  DEFAULT_LIST_STATE,
  hasListContext,
  listContextQuery,
  LIST_STATE_PARAMS,
  orderedListNames,
  scopeListRows,
  writeListState,
  type ListRowReader,
  type MetadataListState,
} from './metadataListState';
import { RESERVED_URL_PARAMS } from '../../urlParams';
import { BUNDLE_MEMBER_PARAM } from './registry';
import { CATALOG_SCOPE_PARAM } from './catalog-scope';
import { DESIGNER_SEL_PARAM } from './nav-selection';

interface Row {
  item: Record<string, unknown>;
  source: 'artifact' | 'runtime';
  custom?: boolean;
  active?: boolean | null;
}

const ROWS: Row[] = [
  { item: { name: 'lead_flow', label: 'Zebra lead', _packageId: 'crm' }, source: 'artifact', custom: false, active: true },
  { item: { name: 'account_flow', label: 'Account sync', _packageId: 'crm' }, source: 'runtime', custom: true, active: false },
  { item: { name: 'case_flow', _packageId: 'crm.custom' }, source: 'runtime', custom: true, active: null },
  { item: { name: 'beta_flow', label: 'Beta', _packageId: 'other' }, source: 'artifact', custom: false, active: true },
  { item: { name: 'flow10', label: 'Flow 10', _packageId: 'crm' }, source: 'artifact', custom: false, active: true },
  { item: { name: 'flow9', label: 'Flow 9', _packageId: 'crm' }, source: 'artifact', custom: false, active: true },
];

const read: ListRowReader<Row> = {
  name: (r) => String(r.item.name ?? ''),
  label: (r) => (typeof r.item.label === 'string' ? r.item.label : undefined),
  matches: (r, q) => String(r.item.name).includes(q) || String(r.item.label ?? '').toLowerCase().includes(q),
  source: (r) => r.source,
  customized: (r) => !!r.custom,
  active: (r) => r.active ?? null,
};

const state = (patch: Partial<MetadataListState>): MetadataListState => ({ ...DEFAULT_LIST_STATE, ...patch });

describe('the list-state codec (objectstack#36896)', () => {
  it('round-trips every filter and the sort, beside the params it does not own', () => {
    const full = state({
      query: 'lead & co',
      source: 'runtime',
      customizedOnly: true,
      status: 'inactive',
      sort: { key: 'label', dir: 'desc' },
    });
    const written = writeListState(new URLSearchParams('package=crm&scope=environment'), full);
    expect(written.get('package')).toBe('crm');
    expect(written.get('scope')).toBe('environment');
    expect(written.get('sort')).toBe('-label');
    // Through the address string, as a link carries it.
    expect(decodeListState(new URLSearchParams(written.toString()))).toEqual(full);
  });

  it('writes nothing for an untouched list, and clears a filter set back to its default', () => {
    expect(listContextQuery(DEFAULT_LIST_STATE)).toBe('');
    expect(writeListState(new URLSearchParams('package=crm'), DEFAULT_LIST_STATE).toString()).toBe('package=crm');
    const set = writeListState(new URLSearchParams(), state({ query: 'x', sort: { key: 'label', dir: 'asc' } }));
    expect(set.toString()).toBe('q=x&sort=label');
    expect(writeListState(set, DEFAULT_LIST_STATE).toString()).toBe('');
    // Control: the default sort spelled out is the default.
    expect(decodeListState(new URLSearchParams('sort=name')).sort).toEqual(DEFAULT_LIST_STATE.sort);
  });

  it('reads a value the list does not offer as that filter default', () => {
    expect(decodeListState(new URLSearchParams('source=nope&status=maybe&customized=yes&sort=-modified'))).toEqual(
      DEFAULT_LIST_STATE,
    );
    // Control: the offered spellings are read.
    expect(decodeListState(new URLSearchParams('source=artifact&status=active&customized=1&sort=-name'))).toEqual(
      state({ source: 'artifact', status: 'active', customizedOnly: true, sort: { key: 'name', dir: 'desc' } }),
    );
  });

  it('tells a list context from none', () => {
    expect(hasListContext(new URLSearchParams('package=crm&member=en'))).toBe(false);
    expect(hasListContext(new URLSearchParams('package=crm&sort=label'))).toBe(true);
  });

  it('names no reserved console param and none the item page reads', () => {
    const taken = new Set([
      ...RESERVED_URL_PARAMS,
      'package',
      CATALOG_SCOPE_PARAM,
      BUNDLE_MEMBER_PARAM,
      DESIGNER_SEL_PARAM,
      'review',
      'open',
    ]);
    expect(LIST_STATE_PARAMS.filter((p) => taken.has(p))).toEqual([]);
    // Control: the check sees a collision.
    expect(['tab', ...LIST_STATE_PARAMS].filter((p) => taken.has(p))).toEqual(['tab']);
  });
});

describe('the ordered names for the detail ‹ › (objectstack#36896)', () => {
  it('with no list context: every row, by API name, numbers in number order', () => {
    expect(orderedListNames(ROWS, DEFAULT_LIST_STATE, read)).toEqual([
      'account_flow',
      'beta_flow',
      'case_flow',
      'flow9',
      'flow10',
      'lead_flow',
    ]);
  });

  it('with a filter and a sort: the rows the list shows, in its order', () => {
    // Runtime rows only, by label Z to A; a row without a label sorts by its name.
    expect(orderedListNames(ROWS, state({ source: 'runtime', sort: { key: 'label', dir: 'desc' } }), read)).toEqual([
      'case_flow',
      'account_flow',
    ]);
    expect(orderedListNames(ROWS, state({ query: 'flow1' }), read)).toEqual(['flow10']);
    expect(orderedListNames(ROWS, state({ sort: { key: 'label', dir: 'asc' } }), read)).toEqual([
      'account_flow',
      'beta_flow',
      'case_flow',
      'flow9',
      'flow10',
      'lead_flow',
    ]);
  });

  it('applies "only customizations" and the status only where the list offers them', () => {
    expect(orderedListNames(ROWS, state({ customizedOnly: true }), read)).toEqual(['account_flow', 'case_flow']);
    // An unknown state (`null`) matches neither status.
    expect(orderedListNames(ROWS, state({ status: 'inactive' }), read)).toEqual(['account_flow']);
    expect(orderedListNames(ROWS, state({ status: 'active' }), read)).not.toContain('case_flow');
    // Not offered: the state is ignored, as the page draws no control for it.
    const plain: ListRowReader<Row> = { ...read, customized: undefined, active: undefined };
    expect(orderedListNames(ROWS, state({ customizedOnly: true, status: 'inactive' }), plain)).toHaveLength(ROWS.length);
  });

  it('rows sharing a name are one entry, at the first row', () => {
    const twins: Row[] = [
      { item: { name: 'welcome', label: 'B' }, source: 'artifact' },
      { item: { name: 'alpha', label: 'C' }, source: 'artifact' },
      { item: { name: 'welcome', label: 'A' }, source: 'runtime' },
    ];
    expect(applyListState(twins, state({ sort: { key: 'label', dir: 'asc' } }), read).map((r) => r.item.label)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(orderedListNames(twins, state({ sort: { key: 'label', dir: 'asc' } }), read)).toEqual(['welcome', 'alpha']);
  });

  it('the package scope holds the active package and its pair, or every package unscoped', () => {
    const names = (rows: Row[]) => rows.map((r) => r.item.name);
    expect(names(scopeListRows(ROWS, { unscoped: false, activePackage: 'crm', pairId: 'crm.custom' }))).toEqual([
      'lead_flow',
      'account_flow',
      'case_flow',
      'flow10',
      'flow9',
    ]);
    expect(names(scopeListRows(ROWS, { unscoped: false, activePackage: 'crm', pairId: null }))).not.toContain('case_flow');
    expect(scopeListRows(ROWS, { unscoped: false, activePackage: null, pairId: null })).toEqual([]);
    expect(scopeListRows(ROWS, { unscoped: true, activePackage: null, pairId: null })).toHaveLength(ROWS.length);
    expect(
      names(scopeListRows(ROWS, { unscoped: true, activePackage: null, pairId: null, listFilter: (i) => i.name !== 'beta_flow' })),
    ).not.toContain('beta_flow');
  });
});
