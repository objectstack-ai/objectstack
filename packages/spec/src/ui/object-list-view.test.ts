import { describe, it, expect } from 'vitest';
import { ObjectListViewSchema, ListViewSchema } from './view.zod';

/**
 * ADR-0053 phase 4 — the object list view ("views" mode) must not carry the
 * page-only `userFilters` control. The guardrail is layered: the field is
 * OMITTED from ObjectListViewSchema (untypable at author time), STRIPPED at
 * parse (no throw — runtime back-compat), while the full ListViewSchema used by
 * page lists ("filters" mode) still accepts it. See objectui #2219 / #2220.
 */
describe('ObjectListViewSchema (ADR-0053 "views" mode)', () => {
  const base = { columns: ['name'] };

  it('omits userFilters from its shape (untypable at author time)', () => {
    expect('userFilters' in (ObjectListViewSchema as unknown as { shape: Record<string, unknown> }).shape).toBe(false);
  });

  it('strips an authored userFilters at parse instead of throwing (runtime back-compat)', () => {
    const parsed = ObjectListViewSchema.parse({ ...base, userFilters: { element: 'dropdown' } } as never);
    expect(parsed).not.toHaveProperty('userFilters');
    expect((parsed as { columns: string[] }).columns).toEqual(['name']); // sibling survives
  });

  it('accepts a clean object list view unchanged', () => {
    const parsed = ObjectListViewSchema.parse({ ...base, label: 'All' } as never);
    expect((parsed as { label?: string }).label).toBe('All');
  });

  it('ListViewSchema (page "filters" mode) still accepts userFilters', () => {
    const parsed = ListViewSchema.parse({ ...base, userFilters: { element: 'dropdown' } } as never);
    expect((parsed as { userFilters?: unknown }).userFilters).toEqual({ element: 'dropdown' });
  });
});
