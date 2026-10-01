import { describe, it, expect } from 'vitest';
import { expandSearchToFilter, resolveSearchFields, normalizeSearch } from './search-filter';

/**
 * The compiler's output shape, named so the assertions below are typed rather
 * than reaching into an `any`. `expandSearchToFilter` is declared `any` at the
 * source (a driver-agnostic filter tree), so this is the test's own reading of
 * the contract it pins.
 */
type SearchFilter = Record<string, unknown>;

const accountFields: Record<string, { type: string; options?: Array<{ label: string; value: string }> }> = {
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

  it('accepts a comma-separated requestedFields string (URL param form)', () => {
    const f = resolveSearchFields({
      fields: accountFields,
      searchableFields: ['name', 'industry', 'status'],
      requestedFields: 'industry, status',
    });
    expect(f).toEqual(['industry', 'status']);
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

  it('single term → $or of $icontains across resolved fields', () => {
    const f: SearchFilter | null = expandSearchToFilter('acme', { fields: accountFields, searchableFields: ['name', 'website'] });
    expect(f).toEqual({ $or: [
      { name: { $icontains: 'acme' } },
      { website: { $icontains: 'acme' } },
    ] });
  });

  it('maps a select label to stored option values ($in)', () => {
    const f: SearchFilter | null = expandSearchToFilter('retail', { fields: accountFields, searchableFields: ['name', 'industry'] });
    expect(f).toEqual({ $or: [
      { name: { $icontains: 'retail' } },
      { industry: { $in: ['retail'] } },
    ] });
  });

  it('multi-term → AND across terms, OR across fields', () => {
    const f: SearchFilter | null = expandSearchToFilter('acme tech', { fields: accountFields, searchableFields: ['name', 'industry'] });
    const and: SearchFilter[] = (f as { $and: SearchFilter[] }).$and;
    expect(and).toHaveLength(2);
    // first term "acme": no industry label matches → falls back to $icontains
    expect(and[0]).toEqual({ $or: [
      { name: { $icontains: 'acme' } },
      { industry: { $icontains: 'acme' } },
    ] });
    // second term "tech": matches the "Technology" label → $in
    expect(and[1]).toEqual({ $or: [
      { name: { $icontains: 'tech' } },
      { industry: { $in: ['technology'] } },
    ] });
  });

  it('case-insensitive label match', () => {
    const f: SearchFilter | null = expandSearchToFilter('ACTIVE', { fields: accountFields, searchableFields: ['status'] });
    expect(f).toEqual({ $or: [{ status: { $in: ['active'] } }] });
  });

  /**
   * [#7641] The case-fold clause, asserted on the OPERATOR the compiler picks
   * rather than on a matched row — this module's output IS the contract, and
   * every filter face downstream is separately conformance-checked against
   * `$icontains` (`FILTER_TEXT_CASES`).
   *
   * `$contains` is contractually case-SENSITIVE (#4706 Q2 = A), so emitting it
   * for a textual field made the docblock's "Matching: case-insensitive" a
   * declaration nothing enforced. These cases fail on the pre-#7641 compiler in
   * exactly the way the HTTP repro did: the term's own spelling reaches the
   * driver under an operator that will not fold it.
   */
  describe('[#7641] textual fields compile to the case-folding operator', () => {
    it('emits $icontains — never the case-SENSITIVE $contains — for text fields', () => {
      const f: SearchFilter | null = expandSearchToFilter('retail', { fields: accountFields, searchableFields: ['name'] });
      expect(f).toEqual({ $or: [{ name: { $icontains: 'retail' } }] });
      // Spelled as its own assertion so a regression reads as "went back to the
      // case-sensitive operator", not as an opaque object-shape diff.
      expect(JSON.stringify(f)).not.toContain('$contains');
    });

    it('picks the operator by field TYPE, not by the term\'s own casing', () => {
      // The pre-#7641 defect was invisible to a capitalized term, because the
      // stored value happened to match it. Both spellings must compile
      // identically — the fold is the operator's job, not the caller's.
      const lower: SearchFilter | null = expandSearchToFilter('retail', { fields: accountFields, searchableFields: ['name'] });
      const upper: SearchFilter | null = expandSearchToFilter('Retail', { fields: accountFields, searchableFields: ['name'] });
      expect(lower).toEqual({ $or: [{ name: { $icontains: 'retail' } }] });
      expect(upper).toEqual({ $or: [{ name: { $icontains: 'Retail' } }] });
    });

    it('folds the select RAW-VALUE fallback too, but leaves the label→value $in exact', () => {
      // "zzz" matches no industry label, so the fallback clause is what runs.
      const fallback: SearchFilter | null = expandSearchToFilter('zzz', { fields: accountFields, searchableFields: ['industry'] });
      expect(fallback).toEqual({ $or: [{ industry: { $icontains: 'zzz' } }] });
      // …while a term that DOES hit a label still compiles to an exact-value
      // $in: that path folds in JS (`optionValuesMatching`) and #7641 did not
      // touch it.
      const mapped: SearchFilter | null = expandSearchToFilter('RETAIL', { fields: accountFields, searchableFields: ['industry'] });
      expect(mapped).toEqual({ $or: [{ industry: { $in: ['retail'] } }] });
    });

    it('leaves the `__search` companion clause on $contains (both sides already lowercase)', () => {
      const withCompanion: Record<string, { type: string }> = { ...accountFields, __search: { type: 'text' } };
      const f: SearchFilter | null = expandSearchToFilter('Retail', { fields: withCompanion, searchableFields: ['name'] });
      // The companion is a normalized blob: the column is lowercase by
      // construction and the term is lowercased here, so a case-SENSITIVE
      // operator over two folded values is exact rather than a case bug. This
      // is a different mechanism from the source-column clause above.
      expect(f).toEqual({ $or: [
        { name: { $icontains: 'Retail' } },
        { __search: { $contains: 'retail' } },
      ] });
    });
  });

  /**
   * [#21009] A field the object declares MULTI-VALUED is stored as a JSON array,
   * where every operator but the membership pair is refused (`INVALID_FILTER` /
   * 400). So it is searched by MEMBERSHIP: a label term becomes one `$contains`
   * per matched option value, and a term matching no label — or a field with no
   * options — becomes `$contains: term`. A scalar field keeps its clause.
   */
  describe('[#21009] a multi-valued field is searched by membership', () => {
    // app-todo's `todo_task.tags` shape: a `select` declared `multiple: true`,
    // in the auto-default set (no `searchableFields`).
    const taskFields: Record<string, { type: string; multiple?: boolean; options?: Array<{ label: string; value: string }> }> = {
      subject: { type: 'text' },
      tags: { type: 'select', multiple: true, options: [
        { label: 'Important', value: 'important' },
        { label: 'Quick Win', value: 'quick_win' },
        { label: 'Quick Fix', value: 'quick_fix' },
      ] },
      status: { type: 'select', options: [{ label: 'Open', value: 'open' }] },
    };

    it('the auto-default set includes the multi-valued select — the premise', () => {
      expect(resolveSearchFields({ fields: taskFields })).toContain('tags');
    });

    it('a label term: one $contains per matched option value, never $in', () => {
      // The auto-default set: the scalar `status` beside it keeps its fallback.
      expect(expandSearchToFilter('important', { fields: taskFields })).toEqual({ $or: [
        { subject: { $icontains: 'important' } },
        { tags: { $contains: 'important' } },
        { status: { $icontains: 'important' } },
      ] });
      // Two labels match → two membership clauses in the same $or (any-of).
      expect(expandSearchToFilter('QUICK', { fields: taskFields, searchableFields: ['tags'] })).toEqual({ $or: [
        { tags: { $contains: 'quick_win' } },
        { tags: { $contains: 'quick_fix' } },
      ] });
    });

    it('a term matching no label: $contains of the term, never $icontains', () => {
      const f: SearchFilter | null = expandSearchToFilter('meeting', { fields: taskFields, searchableFields: ['tags'] });
      expect(f).toEqual({ $or: [{ tags: { $contains: 'meeting' } }] });
      expect(JSON.stringify(f)).not.toContain('$icontains');
      expect(JSON.stringify(f)).not.toContain('$in');
    });

    it('an option-less multi-valued field (tags, a multi-valued lookup): $contains of the term', () => {
      const noteFields = {
        title: { type: 'text' },
        labels: { type: 'tags' },
        owners: { type: 'lookup', multiple: true },
      };
      expect(expandSearchToFilter('red', { fields: noteFields, searchableFields: ['title', 'labels', 'owners'] })).toEqual({ $or: [
        { title: { $icontains: 'red' } },
        { labels: { $contains: 'red' } },
        { owners: { $contains: 'red' } },
      ] });
    });

    it('a scalar select and a scalar text field keep their clauses — the control', () => {
      expect(expandSearchToFilter('open', { fields: taskFields, searchableFields: ['subject', 'status'] })).toEqual({ $or: [
        { subject: { $icontains: 'open' } },
        { status: { $in: ['open'] } },
      ] });
      expect(expandSearchToFilter('zzz', { fields: taskFields, searchableFields: ['status'] }))
        .toEqual({ $or: [{ status: { $icontains: 'zzz' } }] });
    });
  });
});
