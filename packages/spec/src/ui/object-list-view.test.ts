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

  it('REJECTS the page-only tabs/showAllRecords/allowAddTab keys on a dropdown userFilters', () => {
    // Flipped from "drops" at #5073, and the flip is the point: until then the
    // schema silently discarded these while the CLI lint
    // (`packages/lint/src/validate-list-view-mode.ts`) reported them — two
    // doors disagreeing about the same config. They now agree.
    const r = ObjectListViewSchema.safeParse({
      ...base,
      userFilters: {
        element: 'dropdown',
        tabs: [{ name: 'mine', label: 'Mine', filter: [] }],
        showAllRecords: true,
        allowAddTab: true,
      },
    } as never);
    expect(r.success).toBe(false);
    const msg = JSON.stringify(r.error?.issues ?? []);
    expect(msg).toContain('tabs');
    expect(msg).toContain('showAllRecords');
    expect(msg).toContain('allowAddTab');
  });

  it('…and the rejection prescribes `listViews`, the thing an object view actually uses', () => {
    // A page-only key has a right answer on an object view, so a bare
    // "unrecognized key" would be a correct refusal that still leaves the
    // author guessing — the failure mode #5073 was filed to avoid.
    const r = ObjectListViewSchema.safeParse({
      ...base,
      userFilters: { element: 'dropdown', tabs: [{ name: 'mine', label: 'Mine', filter: [] }] },
    } as never);
    expect(JSON.stringify(r.error?.issues ?? [])).toContain('listViews');
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
