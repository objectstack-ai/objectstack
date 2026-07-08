import { describe, it, expect } from 'vitest';
import { ObjectListViewSchema, ObjectUserFiltersSchema, ListViewSchema } from './view.zod';

/**
 * ADR-0047 amendment (framework #2679 / objectui #2338) — an object list view
 * ("views" mode) MAY carry a `dropdown` (value-chip) `userFilters`, but NOT the
 * page-only `tabs` preset bar (it would collide with the ViewTabBar). The
 * guardrail is layered: `ObjectUserFiltersSchema` narrows `element` to
 * dropdown/toggle (a `tabs` element is untypable at author time and rejected at
 * parse), while the full `ListViewSchema` used by page lists ("filters" mode)
 * still accepts the tabs style.
 */
describe('ObjectListViewSchema (ADR-0047 "views" mode)', () => {
  const base = { columns: ['name'] };

  it('exposes userFilters on its shape (dropdown chips are allowed)', () => {
    expect('userFilters' in (ObjectListViewSchema as unknown as { shape: Record<string, unknown> }).shape).toBe(true);
  });

  it('preserves a dropdown userFilters at parse', () => {
    const uf = { element: 'dropdown', fields: [{ field: 'status' }] };
    const parsed = ObjectListViewSchema.parse({ ...base, userFilters: uf } as never);
    expect((parsed as { userFilters?: unknown }).userFilters).toMatchObject(uf);
  });

  it('drops the page-only tabs/showAllRecords keys from a dropdown userFilters', () => {
    const parsed = ObjectListViewSchema.parse({
      ...base,
      userFilters: { element: 'dropdown', tabs: [{ name: 'mine', label: 'Mine', filter: [] }], showAllRecords: true },
    } as never);
    const parsedUf = (parsed as { userFilters?: Record<string, unknown> }).userFilters!;
    expect(parsedUf).not.toHaveProperty('tabs');
    expect(parsedUf).not.toHaveProperty('showAllRecords');
    expect(parsedUf.element).toBe('dropdown');
  });

  it('rejects a tabs-element userFilters (page-only, would collide with ViewTabBar)', () => {
    expect(() =>
      ObjectUserFiltersSchema.parse({ element: 'tabs' } as never),
    ).toThrow();
    expect(() =>
      ObjectListViewSchema.parse({ ...base, userFilters: { element: 'tabs' } } as never),
    ).toThrow();
  });

  it('accepts a clean object list view unchanged', () => {
    const parsed = ObjectListViewSchema.parse({ ...base, label: 'All' } as never);
    expect((parsed as { label?: string }).label).toBe('All');
  });

  it('ListViewSchema (page "filters" mode) still accepts the tabs style', () => {
    const parsed = ListViewSchema.parse({
      ...base,
      userFilters: { element: 'tabs', tabs: [{ name: 'mine', label: 'Mine', filter: [] }] },
    } as never);
    expect((parsed as { userFilters?: { element?: string } }).userFilters?.element).toBe('tabs');
  });
});
