import { describe, it, expect } from 'vitest';
import { expandSearchToFilter, resolveSearchFields, normalizeSearch } from './search-filter';

const accountFields = {
  name: { type: 'text' },
  industry: { type: 'select', options: [
    { label: 'Technology', value: 'technology' },
    { label: 'Retail', value: 'retail' },
    { label: 'Healthcare', value: 'healthcare' },
  ] },
  annual_revenue: { type: 'currency' },
  website: { type: 'url' },
  hq: { type: 'location' },
  status: { type: 'select', options: [
    { label: 'Active', value: 'active' },
    { label: 'Churned', value: 'churned' },
  ] },
  support_config: { type: 'json' },
  owner_id: { type: 'lookup' },
  created_at: { type: 'datetime' },
};

describe('normalizeSearch', () => {
  it('accepts string, {query}, and nullish', () => {
    expect(normalizeSearch('acme')).toEqual({ query: 'acme' });
    expect(normalizeSearch({ query: 'acme', fields: ['name'] })).toEqual({ query: 'acme', fields: ['name'] });
    expect(normalizeSearch(null)).toEqual({ query: '' });
  });
});

describe('resolveSearchFields', () => {
  it('auto-defaults to name + short-text + select, excluding system/heavy types', () => {
    const f = resolveSearchFields({ fields: accountFields });
    expect(f[0]).toBe('name');                 // display/name leads
    expect(f).toContain('industry');           // select included (label search)
    expect(f).toContain('website');            // url included
    expect(f).not.toContain('annual_revenue'); // currency excluded
    expect(f).not.toContain('hq');             // location excluded
    expect(f).not.toContain('support_config'); // json excluded
    expect(f).not.toContain('owner_id');       // lookup excluded
    expect(f).not.toContain('created_at');     // system/date excluded
  });

  it('honours declared searchableFields over the auto-default', () => {
    const f = resolveSearchFields({ fields: accountFields, searchableFields: ['name', 'industry'] });
    expect(f).toEqual(['name', 'industry']);
  });

  it('intersects a requested ($searchFields) override with the allowed set', () => {
    const f = resolveSearchFields({
      fields: accountFields,
      searchableFields: ['name', 'industry'],
      requestedFields: ['industry', 'annual_revenue'], // annual_revenue not allowed → dropped
    });
    expect(f).toEqual(['industry']);
  });

  it('ignores an override that resolves to nothing allowed (falls back)', () => {
    const f = resolveSearchFields({
      fields: accountFields,
      searchableFields: ['name'],
      requestedFields: ['secret_field'],
    });
    expect(f).toEqual(['name']);
  });
});

describe('expandSearchToFilter', () => {
  it('returns null for empty query or no fields', () => {
    expect(expandSearchToFilter('', { fields: accountFields })).toBeNull();
    expect(expandSearchToFilter('x', { fields: {} })).toBeNull();
  });

  it('single term → $or of $contains across resolved fields', () => {
    const f = expandSearchToFilter('acme', { fields: accountFields, searchableFields: ['name', 'website'] });
    expect(f).toEqual({ $or: [
      { name: { $contains: 'acme' } },
      { website: { $contains: 'acme' } },
    ] });
  });

  it('maps a select label to stored option values ($in)', () => {
    const f = expandSearchToFilter('retail', { fields: accountFields, searchableFields: ['name', 'industry'] });
    expect(f).toEqual({ $or: [
      { name: { $contains: 'retail' } },
      { industry: { $in: ['retail'] } },
    ] });
  });

  it('multi-term → AND across terms, OR across fields', () => {
    const f = expandSearchToFilter('acme tech', { fields: accountFields, searchableFields: ['name', 'industry'] });
    expect(f.$and).toHaveLength(2);
    // first term "acme": no industry label matches → falls back to $contains
    expect(f.$and[0]).toEqual({ $or: [
      { name: { $contains: 'acme' } },
      { industry: { $contains: 'acme' } },
    ] });
    // second term "tech": matches the "Technology" label → $in
    expect(f.$and[1]).toEqual({ $or: [
      { name: { $contains: 'tech' } },
      { industry: { $in: ['technology'] } },
    ] });
  });

  it('case-insensitive label match', () => {
    const f = expandSearchToFilter('ACTIVE', { fields: accountFields, searchableFields: ['status'] });
    expect(f).toEqual({ $or: [{ status: { $in: ['active'] } }] });
  });
});
