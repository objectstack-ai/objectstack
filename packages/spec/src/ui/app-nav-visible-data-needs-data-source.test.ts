// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24450] A navigation entry whose `visible` reads `data` must declare
 * `dataSource` — question 2 of #24332's ruling, letter A: the narrowing arm.
 *
 * `data` in a navigation predicate is the value the entry's OWN `dataSource`
 * binds (#24332 shape 1). An entry that reads it without declaring one has
 * nothing to read, so it is refused at parse, at the entry's `visible`, with
 * the fix in the message. What is pinned:
 *
 * 1. the refusal: one `custom` issue at `visible` (re-rooted under every
 *    navigation door: `navigation`, a group's `children`, `areas[].navigation`
 *    and a contribution's `items`), whose message names the fix;
 * 2. what stays accepted: the same entry with a `dataSource`, and entries
 *    whose predicates read only the ambient roots (`current_user`, `features`);
 * 3. the reader's soundness edges: a `data` that is a member name, a string,
 *    a comment, or a macro's own iteration variable is not a root read.
 */
import { describe, it, expect } from 'vitest';

import { AppSchema, NavigationContributionSchema, NavigationItemSchema } from './app.zod';

const API_BINDING = { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data.environments' } as const;
const entry = (visible: unknown, extra: Record<string, unknown> = {}) =>
  ({ id: 'nav_environments', type: 'object', objectName: 'sys_environment', visible, ...extra });

const issuesOf = (r: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }) =>
  (r.error?.issues ?? []).map((i) => ({ code: i.code, path: i.path, message: i.message }));

const expectRefusedAt = (r: Parameters<typeof issuesOf>[0], path: PropertyKey[]) => {
  expect(r.success, 'a `data` read with no `dataSource` must be refused').toBe(false);
  const issues = issuesOf(r);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ code: 'custom', path });
  expect(issues[0].message).toContain('declares no `dataSource`');
  expect(issues[0].message).toContain('Declare `dataSource` on this entry');
  expect(issues[0].message).toContain('drop the `data.*` read');
};

describe('a `visible` that reads `data` on an entry with no `dataSource` is refused at parse', () => {
  it.each([
    ['a comparison', 'data.total == 1'],
    ['a negation', '!data.has_more'],
    ['the bare root', 'data'],
    ['a `has()` test', 'has(data.total)'],
    ['beside an ambient root', '\'org_admin\' in current_user.positions && data.total > 1'],
    ['the leading-dot absolute name', '.data.total == 1'],
    ['a `${…}`-wrapped predicate', '${data.total == 1}'],
    ['an index read', 'data[\'total\'] == 1'],
    ['after a raw string ending in a backslash', 'r\'\\\' == data.sep'],
  ])('refuses %s (`%s`) at `visible`', (_name, visible) => {
    expectRefusedAt(NavigationItemSchema.safeParse(entry(visible)), ['visible']);
  });

  it('refuses the `{ dialect: \'cel\', source }` envelope the same way', () => {
    expectRefusedAt(
      NavigationItemSchema.safeParse(entry({ dialect: 'cel', source: 'data.total == 1' })),
      ['visible'],
    );
  });

  it('refuses on every branch that spreads the base, a `group` included', () => {
    for (const target of [
      { type: 'dashboard', dashboardName: 'ops' },
      { type: 'page', pageName: 'environment_home' },
      { type: 'url', url: '/apps/cloud' },
      { type: 'group', children: [] },
    ]) {
      const r = NavigationItemSchema.safeParse({ id: 'nav_x', visible: 'data.total == 1', ...target });
      expectRefusedAt(r, ['visible']);
    }
  });

  it('refuses at the entry\'s own path through every navigation door', () => {
    expectRefusedAt(
      AppSchema.safeParse({ name: 'cloud_console', label: 'Cloud', navigation: [entry('data.total == 1')] }),
      ['navigation', 0, 'visible'],
    );
    // A group's binding is NOT published to its children: the child reads nothing.
    expectRefusedAt(
      AppSchema.safeParse({
        name: 'cloud_console', label: 'Cloud',
        navigation: [{
          id: 'grp_tenancy', type: 'group', label: 'Tenancy', dataSource: API_BINDING, visible: 'data.total > 0',
          children: [{ id: 'nav_home', type: 'page', pageName: 'environment_home', visible: 'data.total == 1' }],
        }],
      }),
      ['navigation', 0, 'children', 0, 'visible'],
    );
    expectRefusedAt(
      AppSchema.safeParse({
        name: 'cloud_console', label: 'Cloud',
        areas: [{ id: 'area_main', label: 'Main', navigation: [entry('data.total == 1')] }],
      }),
      ['areas', 0, 'navigation', 0, 'visible'],
    );
    expectRefusedAt(
      NavigationContributionSchema.safeParse({ app: 'setup', items: [entry('data.total == 1')] }),
      ['items', 0, 'visible'],
    );
  });
});

describe('what stays accepted', () => {
  it('the same entry with a `dataSource` parses, and keeps its predicate', () => {
    const r = NavigationItemSchema.safeParse(entry('data.total == 1', { dataSource: API_BINDING }));
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect((r.data as { visible?: unknown }).visible).toEqual({ dialect: 'cel', source: 'data.total == 1' });
  });

  it.each([
    ['a `current_user` read', '\'org_admin\' in current_user.positions'],
    ['a `features` read', 'features.cloud_billing == true'],
    ['both ambient roots', 'current_user.id != \'\' && features.beta'],
    ['a member named `data`', 'current_user.data.total == 1'],
    ['`data` inside a string literal', '\'data.total\' in current_user.positions'],
    ['`data` inside a triple-quoted string', '"""data.total""" == current_user.id'],
    ['`data` inside a comment', 'current_user.id != \'\' // data.total == 1'],
    ['a macro iteration variable named `data`', 'current_user.positions.exists(data, data == \'org_admin\')'],
    ['a field named `data` after a selection on a call', 'size(current_user.positions).data == 1'],
  ])('%s parses with no `dataSource` (`%s`)', (_name, visible) => {
    const r = NavigationItemSchema.safeParse(entry(visible));
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });

  it('an entry with no `visible`, and a separator, are untouched', () => {
    expect(NavigationItemSchema.safeParse({ id: 'nav_plain', type: 'object', objectName: 'sys_environment' }).success).toBe(true);
    expect(NavigationItemSchema.safeParse({ type: 'separator', id: 'sep_1' }).success).toBe(true);
  });
});
