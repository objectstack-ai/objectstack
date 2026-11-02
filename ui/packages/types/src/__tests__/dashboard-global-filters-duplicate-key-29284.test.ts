/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29284 — the published mirror refuses a dashboard whose
 * `globalFilters` declares one key twice, with the spec's own issue.
 *
 * `@objectstack/spec`'s `DashboardSchema` attaches its duplicate-key refusal
 * (objectstack#29023) to the `globalFilters` ARRAY. `DashboardComponentSchema`
 * rebuilt that array as `z.array(GlobalFilterSchema)`, which kept every element
 * check and dropped the array's own, so two filters under one key passed here
 * while every spec door refused them. The mirror now takes the spec's slot by
 * reference; this file pins that it carries the refusal, and that the
 * refusal is the spec's issue (code, path and message), not a local dialect.
 *
 * A filter's key is its `name`, else its `field`.
 */
import { describe, expect, it } from 'vitest';
import { DashboardSchema as SpecDashboardSchema } from '@objectstack/spec/ui';
import { DashboardComponentSchema, GlobalFilterSchema } from '../zod/complex.zod';

/** The mirror's node: component discriminator plus the one required slot. */
const node = (globalFilters: unknown[]) => ({ type: 'dashboard', widgets: [], globalFilters });
/** The spec's dashboard for the same filters. */
const specBoard = (globalFilters: unknown[]) => ({ name: 'qa_board', label: 'QA board', widgets: [], globalFilters });

const customIssues = (result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }) =>
  (result.success ? [] : result.error!.issues.filter((i) => i.code === 'custom'))
    .map(({ code, path, message }) => ({ code, path, message }));

const BY_NAME = [
  { name: 'region', field: 'region', type: 'text' },
  { name: 'region', field: 'territory', type: 'text' },
];
const BY_FIELD = [
  { field: 'status', type: 'text' },
  { field: 'status', type: 'text' },
];

describe('objectstack#29284 — DashboardComponentSchema refuses a duplicate globalFilters key with the spec\'s issue', () => {
  it('two filters under one `name` are refused at the second one\'s `name`', () => {
    const mirror = customIssues(DashboardComponentSchema.safeParse(node(BY_NAME)));
    expect(mirror).toHaveLength(1);
    expect(mirror[0]).toMatchObject({ code: 'custom', path: ['globalFilters', 1, 'name'] });
    expect(mirror[0]!.message.startsWith("This dashboard declares the global filter 'region' twice in globalFilters")).toBe(true);
  });

  it('two unnamed filters over one `field` are refused at the second one\'s `field` (the key falls back to the field)', () => {
    const mirror = customIssues(DashboardComponentSchema.safeParse(node(BY_FIELD)));
    expect(mirror).toHaveLength(1);
    expect(mirror[0]).toMatchObject({ code: 'custom', path: ['globalFilters', 1, 'field'] });
    expect(mirror[0]!.message).toContain('A filter with no `name` is keyed by its `field`.');
  });

  it.each([
    ['by name', BY_NAME],
    ['by field fallback', BY_FIELD],
  ])('the refusal %s is the spec door\'s own issue, byte for byte', (_label, filters) => {
    const spec = customIssues(SpecDashboardSchema.safeParse(specBoard(filters)));
    expect(spec).toHaveLength(1);
    expect(customIssues(DashboardComponentSchema.safeParse(node(filters)))).toEqual(spec);
  });

  it('distinct keys parse — a named filter over a field another filter is keyed by is a different key', () => {
    const filters = [
      { name: 'region', field: 'region', type: 'text' },
      { name: 'territory', field: 'region', type: 'text' },
      { field: 'status', type: 'text' },
    ];
    expect(SpecDashboardSchema.safeParse(specBoard(filters)).success).toBe(true);
    expect(DashboardComponentSchema.safeParse(node(filters)).success).toBe(true);
  });

  it('the slot\'s element is still the published GlobalFilterSchema, so element checks are unchanged', () => {
    const slot = DashboardComponentSchema.shape.globalFilters;
    const array = slot.unwrap();
    expect(array.element).toBe(GlobalFilterSchema);
  });
});
