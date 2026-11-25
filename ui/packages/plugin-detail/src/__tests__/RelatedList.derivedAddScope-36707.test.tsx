/**
 * objectstack#36707 — the related tab's derived 「+ 添加」 on a `lookup`
 * relationship (`derivedAddOf`, the lookup arm):
 *
 *  1. the relationship lookup's `dependsOn` scopes the picker from the parent
 *     record. An opportunity's 合同 tab: `contract.opportunity` `dependsOn`
 *     the contract's account, so the picker lists only unlinked contracts of
 *     the opportunity's own account — never another customer's, which a pick
 *     would have linked here. A scope it cannot resolve offers no picker;
 *  2. the picker's label column is the picked object's name field, not a
 *     hard-coded `name` (an empty 「NAME」 column on contracts, whose name
 *     field is `contract_number`).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { FilterScopeProvider, RecordContextProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { RelatedList, derivedAddOf } from '../RelatedList';
import { relatedCreateSeedOf } from '../relatedParentScope';
import { resetRelatedTabConditionsForTests } from '../relatedTabConditions';
import { RelatedListEnlargedContext } from '../relatedListCompact';

afterEach(() => resetRelatedTabConditionsForTests());

/** `object-grid` lives in `plugin-grid`, which this package cannot import. */
function ObjectGridStandIn({ schema }: { schema: any }) {
  const rows: any[] = schema?.data?.items ?? [];
  return <ul data-object-grid-stand-in="">{rows.map((row) => <li key={row.id}>{String(row.subject ?? row.contract_number ?? row.id)}</li>)}</ul>;
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  ComponentRegistry.register('object-grid', ObjectGridStandIn as never);
});

const CONTRACT_FIELDS = {
  contract_number: { type: 'autonumber', label: 'Contract Number' },
  account: { type: 'master_detail', reference: 'account', label: 'Account', required: true },
  opportunity: { type: 'lookup', reference: 'opportunity', label: 'Opportunity', dependsOn: ['account'] },
  status: { type: 'text', label: 'Status' },
};
const CONTRACT_SCHEMA = { name: 'contract', nameField: 'contract_number', fields: CONTRACT_FIELDS };

/** The unlinked contracts of two accounts; the stand-in server honours equality on `account`. */
const POOL = [
  { id: 'k-own', contract_number: 'CTR-0003', account: 'A-1', opportunity: null, status: 'Draft' },
  { id: 'k-other', contract_number: 'CTR-0004', account: 'A-2', opportunity: null, status: 'Draft' },
];
const LINKED = [{ id: 'k-here', contract_number: 'CTR-0001', account: 'A-1', opportunity: 'O-1', status: 'Active' }];

function dataSourceFor(schema: Record<string, unknown> = CONTRACT_SCHEMA) {
  return {
    find: vi.fn(async (resource: string, params?: any) => {
      const filter = JSON.stringify(params?.$filter ?? []);
      if (resource === 'contract' && JSON.stringify(params ?? {}).includes('O-1')) return { data: LINKED, total: LINKED.length };
      const data = POOL.filter((r) => !filter.includes('"account"') || filter.includes(`"${r.account}"`));
      return { data, total: data.length };
    }),
    getObjectSchema: vi.fn(async () => schema),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    batchTransaction: vi.fn(async (ops: unknown[]) => ({ results: ops.map(() => ({})) })),
  };
}

function renderTab(parent: Record<string, unknown>, { onNew = vi.fn(), schema }: { onNew?: () => void; schema?: Record<string, unknown> } = {}) {
  const dataSource = dataSourceFor(schema);
  render(
    <FilterScopeProvider currentUserId="u-1">
      <RecordContextProvider objectName="opportunity" recordId="O-1" data={parent} dataSource={dataSource as any}>
        <RelatedListEnlargedContext.Provider value>
          <RelatedList
            title="Contracts"
            type="table"
            api="contract"
            objectName="contract"
            referenceField="opportunity"
            parentId="O-1"
            pageSize={25}
            columns={[{ field: 'contract_number', label: 'Contract Number' }]}
            onNew={onNew}
            dataSource={dataSource as never}
          />
        </RelatedListEnlargedContext.Provider>
      </RecordContextProvider>
    </FilterScopeProvider>,
  );
  return { dataSource };
}

/** The picker's column headers that carry a name, in order (the select-all column has none). */
const headerTexts = (dialog: HTMLElement) =>
  Array.from(within(dialog).getByTestId('record-picker-sticky-header').querySelectorAll('th'))
    .map((th) => th.textContent?.trim() ?? '')
    .filter((text) => text !== '');
const addButton = () => document.querySelector('[data-related-enlarged-toolbar] [data-related-add]') as HTMLElement;
const pickerReads = (ds: ReturnType<typeof dataSourceFor>) =>
  ds.find.mock.calls.filter(([r, p]) => r === 'contract' && !JSON.stringify(p ?? {}).includes('O-1'));

describe('derivedAddOf — a lookup relationship scoped by dependsOn (objectstack#36707)', () => {
  const unlinked = { field: 'opportunity', operator: 'is_empty' };

  it('each dependsOn field must equal the parent\'s value: string and { field, param } entries', () => {
    expect(derivedAddOf(CONTRACT_FIELDS, 'opportunity', 'contract', { id: 'O-1', account: 'A-1' })).toEqual({
      picker: { object: 'contract', filter: [unlinked, { field: 'account', operator: 'equals', value: 'A-1' }] },
    });
    const byParam = { ...CONTRACT_FIELDS, opportunity: { type: 'lookup', reference: 'opportunity', dependsOn: [{ field: 'account', param: 'customer' }] } };
    expect(derivedAddOf(byParam, 'opportunity', 'contract', { id: 'O-1', customer: 'A-9', account: 'A-1' })?.picker.filter).toEqual([
      unlinked,
      { field: 'account', operator: 'equals', value: 'A-9' },
    ]);
  });

  it('an expanded reference on the parent reads as its id', () => {
    expect(derivedAddOf(CONTRACT_FIELDS, 'opportunity', 'contract', { id: 'O-1', account: { id: 'A-1', name: 'Initech' } })?.picker.filter).toEqual([
      unlinked,
      { field: 'account', operator: 'equals', value: 'A-1' },
    ]);
  });

  it.each([
    ['the parent has no value for it', { id: 'O-1', account: null }],
    ['the parent record is not read', undefined],
  ] as const)('no picker when the scope cannot be resolved: %s', (_label, parent) => {
    expect(derivedAddOf(CONTRACT_FIELDS, 'opportunity', 'contract', parent as any)).toBeUndefined();
  });

  it('no picker when a lookupFilters comparand on the relationship reads $record', () => {
    const fields = {
      ...CONTRACT_FIELDS,
      opportunity: { type: 'lookup', reference: 'opportunity', lookupFilters: [{ field: 'region', operator: 'eq', value: { $record: 'region' } }] },
    };
    expect(derivedAddOf(fields, 'opportunity', 'contract', { id: 'O-1', region: 'east' })).toBeUndefined();
  });

  it('control: an unscoped lookup (static lookupFilters included) keeps the unlinked-only picker, parent read or not', () => {
    const fields = {
      ...CONTRACT_FIELDS,
      opportunity: { type: 'lookup', reference: 'opportunity', lookupFilters: [{ field: 'is_active', operator: 'eq', value: true }] },
    };
    expect(derivedAddOf(fields, 'opportunity', 'contract')).toEqual({ picker: { object: 'contract', filter: [unlinked] } });
  });
});

describe('the opportunity\'s 合同 tab picker (objectstack#36707)', () => {
  it('lists only the account\'s own unlinked contracts, led by the contract number under its label', async () => {
    const { dataSource } = renderTab({ id: 'O-1', name: 'Initech Cloud Migration', account: 'A-1' });
    await waitFor(() => expect(screen.getByText('CTR-0001')).toBeInTheDocument());
    fireEvent.click(addButton());
    const dialog = await screen.findByTestId('record-picker-dialog');
    expect(await within(dialog).findByTestId('record-row-k-own')).toHaveTextContent('CTR-0003');
    expect(within(dialog).queryByTestId('record-row-k-other')).toBeNull();
    const reads = pickerReads(dataSource);
    expect(reads.length).toBeGreaterThan(0);
    for (const [, params] of reads) {
      const filter = JSON.stringify((params as any)?.$filter ?? []);
      expect(filter).toContain('"A-1"');
      expect(filter).toContain('is_empty');
    }
    const headers = headerTexts(dialog);
    expect(headers[0]).toBe('Contract Number');
    expect(headers).not.toContain('Name');
  });

  it('a parent with no account offers no picker: 「+ 添加」 creates a contract', async () => {
    const onNew = vi.fn();
    const { dataSource } = renderTab({ id: 'O-1', name: 'Initech Cloud Migration', account: null }, { onNew });
    await waitFor(() => expect(screen.getByText('CTR-0001')).toBeInTheDocument());
    fireEvent.click(addButton());
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('record-picker-dialog')).toBeNull();
    expect(pickerReads(dataSource)).toHaveLength(0);
  });

  it('with no declared nameField the label column is the derived title field, still never an empty 「NAME」', async () => {
    const { nameField: _drop, ...undeclared } = CONTRACT_SCHEMA;
    renderTab({ id: 'O-1', account: 'A-1' }, { schema: undeclared });
    await waitFor(() => expect(screen.getByText('CTR-0001')).toBeInTheDocument());
    fireEvent.click(addButton());
    const dialog = await screen.findByTestId('record-picker-dialog');
    await within(dialog).findByTestId('record-row-k-own');
    expect(headerTexts(dialog)).not.toContain('Name');
  });
});

/**
 * objectstack#37246 — the related tab's New seeds the child with what the
 * relationship lookup `dependsOn`, from the parent (`relatedCreateSeedOf`):
 * the picker's scope above, read as values. The derived picker is the control:
 * its scope stays as #36707 set it.
 */
describe('relatedCreateSeedOf — a related New seeds the dependsOn fields from the parent (objectstack#37246)', () => {
  it('each dependsOn field takes the parent\'s value: string and { field, param } entries, an expanded reference as its id', () => {
    expect(relatedCreateSeedOf(CONTRACT_FIELDS, 'opportunity', { id: 'O-1', account: 'A-1' })).toEqual({ account: 'A-1' });
    const byParam = { ...CONTRACT_FIELDS, opportunity: { type: 'lookup', reference: 'opportunity', dependsOn: [{ field: 'account', param: 'customer' }] } };
    expect(relatedCreateSeedOf(byParam, 'opportunity', { id: 'O-1', customer: { id: 'A-9', name: 'Contoso' }, account: 'A-1' })).toEqual({ account: 'A-9' });
  });

  it('a two-entry dependsOn seeds both fields; one the parent does not answer seeds neither, as the picker offers none', () => {
    const twoEntries = {
      ...CONTRACT_FIELDS,
      opportunity: { type: 'lookup', reference: 'opportunity', dependsOn: ['account', { field: 'region', param: 'sales_region' }] },
    };
    expect(relatedCreateSeedOf(twoEntries, 'opportunity', { id: 'O-1', account: 'A-1', sales_region: 'R-1' })).toEqual({ account: 'A-1', region: 'R-1' });
    expect(relatedCreateSeedOf(twoEntries, 'opportunity', { id: 'O-1', account: 'A-1', sales_region: null })).toEqual({});
    expect(derivedAddOf(twoEntries, 'opportunity', 'contract', { id: 'O-1', account: 'A-1', sales_region: null })).toBeUndefined();
  });

  it('a lookupFilters comparand reading $record does not stop the seed (the form still applies it)', () => {
    const fields = {
      ...CONTRACT_FIELDS,
      opportunity: { ...CONTRACT_FIELDS.opportunity, lookupFilters: [{ field: 'region', operator: 'eq', value: { $record: 'region' } }] },
    };
    expect(relatedCreateSeedOf(fields, 'opportunity', { id: 'O-1', account: 'A-1' })).toEqual({ account: 'A-1' });
  });

  it.each([
    ['no dependsOn', { ...CONTRACT_FIELDS, opportunity: { type: 'lookup', reference: 'opportunity' } }, { id: 'O-1', account: 'A-1' }],
    ['the parent has no value for it', CONTRACT_FIELDS, { id: 'O-1', account: null }],
    ['the parent record is not read', CONTRACT_FIELDS, undefined],
    ['a multi-valued relationship', { ...CONTRACT_FIELDS, opportunity: { ...CONTRACT_FIELDS.opportunity, multiple: true } }, { id: 'O-1', account: 'A-1' }],
    ['a value that is not text', CONTRACT_FIELDS, { id: 'O-1', account: 7 }],
  ] as const)('nothing to seed: %s', (_label, fields, parent) => {
    expect(relatedCreateSeedOf(fields, 'opportunity', parent as any)).toEqual({});
  });

  it('control: the derived picker keeps its #36707 scope', () => {
    expect(derivedAddOf(CONTRACT_FIELDS, 'opportunity', 'contract', { id: 'O-1', account: 'A-1' })).toEqual({
      picker: {
        object: 'contract',
        filter: [{ field: 'opportunity', operator: 'is_empty' }, { field: 'account', operator: 'equals', value: 'A-1' }],
      },
    });
    const scoped = { ...CONTRACT_FIELDS, opportunity: { ...CONTRACT_FIELDS.opportunity, lookupFilters: [{ field: 'region', operator: 'eq', value: { $record: 'region' } }] } };
    expect(derivedAddOf(scoped, 'opportunity', 'contract', { id: 'O-1', account: 'A-1' })).toBeUndefined();
  });
});
