// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29023 — a dashboard declares each global filter key (its `name`, else its
 * `field`) once.
 *
 * Measured on `main` @ `12aad143` before the rule: `DashboardSchema` accepted
 * `globalFilters: [{ name: 'r', field: 'region' }, { name: 'r', field: 'status' }]`,
 * the save door answered 200, and the board drew ONE control whose value
 * filtered `status`, the second definition's field. The refusal is located at
 * the second declaration's key and names every index.
 */
import { describe, expect, it } from 'vitest';
import { DashboardSchema } from './dashboard.zod';
import { duplicateGlobalFilterNames } from './duplicate-global-filter-names';
import { globalFilterKey } from '../system/i18n-resolver';

const board = (globalFilters: unknown[]) => ({
  name: 'qa_probe_dfn',
  label: 'QA probe',
  widgets: [],
  globalFilters,
});

const customIssues = (input: unknown) => {
  const result = DashboardSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.filter((i) => i.code === 'custom');
};

describe('#29023 DashboardSchema refuses two globalFilters under one name', () => {
  it('CONTROL: two filters with distinct names parse', () => {
    const result = DashboardSchema.safeParse(board([
      { name: 'r', field: 'region', type: 'text' },
      { name: 's', field: 'status', type: 'text' },
    ]));
    expect(result.success).toBe(true);
  });

  it('CONTROL: two distinct names over the SAME field parse (the key is the name, not the field)', () => {
    const result = DashboardSchema.safeParse(board([
      { name: 'region_a', field: 'region', type: 'text' },
      { name: 'region_b', field: 'region', type: 'select', options: [{ value: 'north', label: 'North' }] },
    ]));
    expect(result.success).toBe(true);
  });

  it('the card reproduction is refused at globalFilters[1].name, naming both indices, the name and the fix', () => {
    const result = DashboardSchema.safeParse(board([
      { name: 'r', field: 'region', type: 'text' },
      { name: 'r', field: 'status', type: 'text' },
    ]));
    expect(result.success).toBe(false);
    const issues = result.error!.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'custom', path: ['globalFilters', 1, 'name'] });
    expect(issues[0]!.message.startsWith(
      "This dashboard declares the global filter 'r' twice in globalFilters: globalFilters[0] and globalFilters[1].",
    )).toBe(true);
    expect(issues[0]!.message).toMatch(/Rename all but one of them .* or delete the copy\.$/);
    // Runtime strings carry no tracker number (check:doc-authoring).
    expect(issues[0]!.message).not.toMatch(/#\d{3,}/);
  });

  it('two UNNAMED filters on one field collide on the field, located at globalFilters[1].field', () => {
    const issues = customIssues(board([
      { field: 'region', type: 'text' },
      { field: 'region', type: 'select', options: [{ value: 'north', label: 'North' }] },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['globalFilters', 1, 'field'] });
    expect(issues[0]!.message).toContain("the global filter 'region' twice");
    expect(issues[0]!.message).toContain('A filter with no `name` is keyed by its `field`.');
  });

  it('a name colliding with another entry\'s field (no name) is the same key and is refused', () => {
    const issues = customIssues(board([
      { field: 'region', type: 'text' },
      { name: 'region', field: 'sales_region', type: 'text' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['globalFilters', 1, 'name'] });
  });

  it('an empty `name` keys by `field`, as `globalFilterKey` does', () => {
    const issues = customIssues(board([
      { name: '', field: 'region', type: 'text' },
      { field: 'region', type: 'text' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['globalFilters', 1, 'field'] });
  });

  it('three declarations of one name answer ONE issue at the second, listing every index', () => {
    const issues = customIssues(board([
      { name: 'r', field: 'region' },
      { name: 'other', field: 'owner' },
      { name: 'r', field: 'status' },
      { name: 'r', field: 'stage' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['globalFilters', 2, 'name'] });
    expect(issues[0]!.message.startsWith(
      "This dashboard declares the global filter 'r' 3 times in globalFilters: "
      + 'globalFilters[0], globalFilters[2] and globalFilters[3].',
    )).toBe(true);
  });

  it('two repeated names answer one issue each', () => {
    const issues = customIssues(board([
      { name: 'a', field: 'region' },
      { name: 'b', field: 'owner' },
      { name: 'a', field: 'status' },
      { name: 'b', field: 'stage' },
    ]));
    expect(issues.map((i) => i.path)).toEqual([['globalFilters', 2, 'name'], ['globalFilters', 3, 'name']]);
  });

  it('the rule travels with `DashboardSchema.shape.globalFilters` (a mirror spreading the shape keeps it)', () => {
    const slot = (DashboardSchema as unknown as { shape: Record<string, { safeParse(v: unknown): { success: boolean } }> })
      .shape.globalFilters!;
    expect(slot.safeParse([{ name: 'r', field: 'region' }, { name: 'r', field: 'status' }]).success).toBe(false);
    expect(slot.safeParse([{ name: 'r', field: 'region' }, { name: 's', field: 'status' }]).success).toBe(true);
    expect(slot.safeParse(undefined).success).toBe(true);
  });
});

describe('#29023 duplicateGlobalFilterNames keys a filter the way globalFilterKey does', () => {
  const filters = [
    { name: 'dept', field: 'department' },
    { field: 'created_at' },
    { name: '', field: 'owner_id' },
    { name: 'stage' , field: 'stage' },
    { label: 'Unkeyed' },
  ];

  it('every keyed filter resolves to globalFilterKey(filter), and an unkeyed one is passed over', () => {
    // Doubling each filter makes every keyed one a duplicate, so the list reads back the predicate's keys.
    const keys = duplicateGlobalFilterNames([...filters, ...filters]).map((d) => d.name);
    expect(keys).toEqual(filters.map((f) => globalFilterKey(f)).filter((k): k is string => k !== undefined));
  });

  it('a non-array, a non-object entry and an entry with neither key are left to the schema', () => {
    expect(duplicateGlobalFilterNames(undefined)).toEqual([]);
    expect(duplicateGlobalFilterNames({ name: 'r' })).toEqual([]);
    expect(duplicateGlobalFilterNames([null, 'r', 7, { label: 'x' }, { label: 'y' }])).toEqual([]);
  });
});
