// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24332] A navigation entry may declare ONE API data source — the page
 * element's `ElementApiDataSourceSchema`, BY REFERENCE — and its `visible`
 * reads the bound value as `data` (shape 1 of the card, the spec half of the
 * objectstack-ai/cloud#3002 letter A sidebar row).
 *
 * What is pinned here is the SHAPE half:
 *
 * 1. the binding parses on every branch that spreads the shared nav base, and
 *    on a `group`'s child, beside a `visible` that reads `data.*`;
 * 2. it is the page element's binding and not a restatement of it: the nav
 *    door refuses an unknown key, an off-origin `read.url`, a credential key
 *    and the object binding at the nav item's own path, with the very issue
 *    the page element's binding raises for the same value;
 * 3. a separator refuses the key with its own prescription;
 * 4. the key is PLANNED: its describe carries the marker and its liveness row
 *    is `planned`, never `live`, until the navigation renderer reads it.
 *
 * The refusal sentences are the binding's own and are deliberately not pinned
 * as text: each refusal is compared with the page element's answer for the
 * same input, which is the claim (one binding, one set of refusals).
 */
import fs from 'node:fs';

import { describe, it, expect } from 'vitest';

import { AppSchema, NavigationItemSchema, ObjectNavItemSchema } from './app.zod';
import { ElementApiDataSourceSchema } from './page.zod';

const API_BINDING = { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data.environments' } as const;

/** One entry per branch that spreads the shared nav base — every `type` but `separator`. */
const BRANCHES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['object', { type: 'object', objectName: 'sys_environment' }],
  ['dashboard', { type: 'dashboard', dashboardName: 'ops' }],
  ['page', { type: 'page', pageName: 'environment_home' }],
  ['url', { type: 'url', url: '/apps/cloud' }],
  ['report', { type: 'report', reportName: 'usage' }],
  ['action', { type: 'action', actionDef: { actionName: 'create_environment' } }],
  ['component', { type: 'component', componentRef: 'metadata:directory' }],
  ['doc', { type: 'doc', book: 'cloud_manual' }],
  ['group', { type: 'group', children: [] }],
];

const withNav = (navigation: unknown[]) => ({ name: 'cloud_console', label: 'Cloud', navigation });

/** The page element binding's own issues for `value`, re-rooted at `prefix`. */
const bindingIssues = (value: unknown, prefix: PropertyKey[]) => {
  const r = ElementApiDataSourceSchema.safeParse(value);
  expect(r.success, 'control: the page element binding must refuse this value too').toBe(false);
  return r.error!.issues.map((i) => ({ code: i.code, path: [...prefix, ...i.path], message: i.message }));
};

const navIssues = (item: Record<string, unknown>) => {
  const r = NavigationItemSchema.safeParse(item);
  expect(r.success).toBe(false);
  return r.error!.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));
};

describe('navigation item `dataSource` — accepted on every branch that spreads the base', () => {
  it.each(BRANCHES)('a `%s` entry parses with the API binding and a `visible` reading `data`', (_name, target) => {
    const item = { id: 'nav_environments', label: 'Environments', visible: 'data.total == 1', dataSource: API_BINDING, ...target };
    const r = NavigationItemSchema.safeParse(item);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect((r.data as { dataSource?: unknown }).dataSource).toEqual(API_BINDING);
  });

  it('parses through the app door, on a top-level entry and on a group\'s child', () => {
    const r = AppSchema.safeParse(withNav([
      { id: 'nav_environments', type: 'object', objectName: 'sys_environment', visible: 'data.total != 1', dataSource: API_BINDING },
      {
        id: 'grp_tenancy', type: 'group', label: 'Tenancy',
        children: [{ id: 'nav_environment_home', type: 'page', pageName: 'environment_home', visible: 'data.total == 1', dataSource: API_BINDING }],
      },
    ]));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('accepts the bare binding: `path` and `read.method` stay optional, and `GET` is the one method', () => {
    for (const dataSource of [
      { provider: 'api', read: { url: '/api/v1/cloud/home' } },
      { provider: 'api', read: { url: '/api/v1/cloud/home', method: 'GET' } },
    ]) {
      const r = ObjectNavItemSchema.safeParse({ id: 'nav_environments', type: 'object', objectName: 'sys_environment', dataSource });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    }
  });
});

describe('navigation item `dataSource` — the page element binding\'s refusals, at the nav item\'s path', () => {
  const entry = (dataSource: unknown) => ({ id: 'nav_environments', type: 'object', objectName: 'sys_environment', dataSource });

  it('refuses an unknown key on the binding, not drops it', () => {
    const value = { ...API_BINDING, refresh: 30 };
    const issues = navIssues(entry(value));
    expect(issues).toEqual(bindingIssues(value, ['dataSource']));
    expect(issues[0]).toMatchObject({ code: 'unrecognized_keys', path: ['dataSource'] });
  });

  it('refuses an off-origin `read.url` at `dataSource.read.url`', () => {
    for (const url of ['https://api.example.com/v1/home', '//evil.example/home', 'api/v1/home']) {
      const value = { provider: 'api', read: { url } };
      const issues = navIssues(entry(value));
      expect(issues, url).toEqual(bindingIssues(value, ['dataSource']));
      expect(issues[0], url).toMatchObject({ code: 'invalid_format', path: ['dataSource', 'read', 'url'] });
    }
  });

  it('refuses a credential key inside the read request', () => {
    const value = { provider: 'api', read: { url: '/api/v1/cloud/home', headers: { authorization: 'Bearer x' } } };
    const issues = navIssues(entry(value));
    expect(issues).toEqual(bindingIssues(value, ['dataSource']));
    expect(issues[0]).toMatchObject({ code: 'unrecognized_keys', path: ['dataSource', 'read'] });
  });

  it('refuses a method other than `GET`', () => {
    const value = { provider: 'api', read: { url: '/api/v1/cloud/home', method: 'POST' } };
    const issues = navIssues(entry(value));
    expect(issues).toEqual(bindingIssues(value, ['dataSource']));
    expect(issues[0]).toMatchObject({ code: 'invalid_value', path: ['dataSource', 'read', 'method'] });
  });

  it('does not admit the page element\'s OBJECT binding — a nav entry binds an API answer only', () => {
    const value = { object: 'sys_environment', limit: 1 };
    const issues = navIssues(entry(value));
    expect(issues).toEqual(bindingIssues(value, ['dataSource']));
    expect(issues.every((i) => i.path[0] === 'dataSource'), JSON.stringify(issues)).toBe(true);
  });
});

describe('a separator refuses `dataSource` with its own prescription', () => {
  it('answers with the separator guidance, not a bare unknown key', () => {
    const r = NavigationItemSchema.safeParse({ type: 'separator', id: 'sep_1', dataSource: API_BINDING });
    expect(r.success).toBe(false);
    const issue = r.error!.issues[0];
    expect(issue).toMatchObject({ code: 'unrecognized_keys', path: [] });
    expect(issue.message).toContain('`dataSource` is not a separator key');
  });
});

describe('navigation item `dataSource` is PLANNED — declared, not yet rendered', () => {
  it('its describe carries the planned marker', () => {
    const shape = (ObjectNavItemSchema as unknown as { shape: Record<string, { description?: string }> }).shape;
    expect(shape.dataSource.description).toMatch(/^\[PLANNED — not yet rendered\] /);
  });

  it('its liveness row is `planned` with an author warning, never `live`', () => {
    const ledger = JSON.parse(fs.readFileSync(new URL('../../liveness/app.json', import.meta.url), 'utf8'));
    const row = ledger.props.navigation.children.dataSource;
    expect(row, 'liveness/app.json navigation.children.dataSource must exist').toBeDefined();
    expect(row.status).toBe('planned');
    expect(row.authorWarn).toBe(true);
  });
});
