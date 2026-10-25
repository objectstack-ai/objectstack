import { describe, it, expect } from 'vitest';
import { deriveLookupColumns } from './deriveLookupColumns';

const accountSchema = {
  name: 'showcase_account',
  fields: {
    created_at: { type: 'datetime', label: 'Created At' },
    updated_at: { type: 'datetime', label: 'Last Modified At' },
    name: { type: 'text', label: 'Account Name' },
    industry: { type: 'select', label: 'Industry' },
    annual_revenue: { type: 'currency', label: 'Annual Revenue' },
    website: { type: 'url', label: 'Website' },
    hq: { type: 'location', label: 'Headquarters' },
    status: { type: 'select', label: 'Lifecycle' },
    support_config: { type: 'json', label: 'Support Config' },
    owner_id: { type: 'lookup', label: 'Owner' },
    organization_id: { type: 'lookup', label: 'Organization' },
  },
};

describe('deriveLookupColumns', () => {
  it('returns [] when no schema/fields are available', () => {
    expect(deriveLookupColumns(undefined, { displayField: 'name' })).toEqual([]);
    expect(deriveLookupColumns({ fields: {} }, { displayField: 'name' })).toEqual([]);
  });

  it('leads with the display field and adds business fields in declaration order', () => {
    const cols = deriveLookupColumns(accountSchema, { displayField: 'name', max: 4 });
    expect(cols.map((c) => c.field)).toEqual(['name', 'industry', 'annual_revenue', 'website']);
  });

  it('carries field label and type onto each column for type-aware rendering', () => {
    const cols = deriveLookupColumns(accountSchema, { displayField: 'name', max: 3 });
    expect(cols[0]).toEqual({ field: 'name', label: 'Account Name', type: 'text' });
    expect(cols[2]).toEqual({ field: 'annual_revenue', label: 'Annual Revenue', type: 'currency' });
  });

  it('skips system/audit fields and heavy non-tabular types', () => {
    const cols = deriveLookupColumns(accountSchema, { displayField: 'name', max: 10 });
    const names = cols.map((c) => c.field);
    expect(names).not.toContain('created_at');
    expect(names).not.toContain('updated_at');
    expect(names).not.toContain('owner_id');
    expect(names).not.toContain('organization_id');
    expect(names).not.toContain('support_config'); // json
    expect(names).not.toContain('hq'); // location
  });

  it('respects the max column cap', () => {
    expect(deriveLookupColumns(accountSchema, { displayField: 'name', max: 2 })).toHaveLength(2);
  });

  it('skips fields flagged `system: true` even when the name is not a known audit column', () => {
    const schema = {
      fields: {
        name: { type: 'text', label: 'Name' },
        // Non-canonical name, but stamped system by the framework — must be skipped.
        custom_ref: { type: 'lookup', label: 'Custom Ref', system: true } as any,
        code: { type: 'text', label: 'Code' },
      },
    };
    const cols = deriveLookupColumns(schema, { displayField: 'name', max: 10 });
    expect(cols.map((c) => c.field)).toEqual(['name', 'code']);
  });

  it('honours an object-level displayFields list, with the display field first', () => {
    const schema = {
      fields: {
        name: { type: 'text', label: 'Name' },
        code: { type: 'text', label: 'Code' },
        region: { type: 'select', label: 'Region' },
      },
      displayFields: ['code', 'region'],
    };
    const cols = deriveLookupColumns(schema, { displayField: 'name', max: 4 });
    expect(cols.map((c) => c.field)).toEqual(['name', 'code', 'region']);
  });

  it('does not duplicate the display field when it also appears in displayFields', () => {
    const schema = {
      fields: { name: { type: 'text' }, region: { type: 'select' } },
      displayFields: ['name', 'region'],
    };
    const cols = deriveLookupColumns(schema, { displayField: 'name' });
    expect(cols.map((c) => c.field)).toEqual(['name', 'region']);
  });

  it('prefers ADR-0085 highlightFields over the declaration-order walk', () => {
    const schema = {
      fields: {
        name: { type: 'text', label: 'Name' },
        code: { type: 'text', label: 'Code' },
        region: { type: 'select', label: 'Region' },
        notes: { type: 'text', label: 'Notes' },
      },
      highlightFields: ['region', 'code'],
    };
    const cols = deriveLookupColumns(schema, { displayField: 'name', max: 4 });
    // Display field leads, then highlightFields in order — not the raw field walk.
    expect(cols.map((c) => c.field)).toEqual(['name', 'region', 'code']);
  });

  it('lets highlightFields win over legacy displayFields when both are present', () => {
    const schema = {
      fields: { name: { type: 'text' }, code: { type: 'text' }, region: { type: 'select' } },
      highlightFields: ['region'],
      displayFields: ['code'],
    };
    const cols = deriveLookupColumns(schema, { displayField: 'name' });
    expect(cols.map((c) => c.field)).toEqual(['name', 'region']);
  });
});
