// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry';
import { ObjectQL } from './engine';

/**
 * ADR-0029 D7 — app navigation contributions.
 *
 * A "shell" app exposes empty group anchors; packages contribute their nav
 * entries into those groups, merged on read by group id + priority. This is
 * the UI-layer analog of object `own`/`extend`.
 */
describe('SchemaRegistry navigation contributions (ADR-0029 D7)', () => {
  let registry: SchemaRegistry;

  const shellApp = () => ({
    name: 'setup',
    label: 'Setup',
    navigation: [
      { id: 'group_people_org', type: 'group', label: 'People & Organization', children: [] },
      { id: 'group_integrations', type: 'group', label: 'Integrations', children: [] },
    ],
  });

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    registry.registerApp(shellApp(), 'com.objectstack.platform-objects');
  });

  it('merges a contribution into the targeted group', () => {
    registry.registerAppNavContribution(
      {
        app: 'setup',
        group: 'group_integrations',
        priority: 100,
        items: [
          { id: 'nav_webhooks', type: 'object', label: 'Webhooks', objectName: 'sys_webhook', requiresObject: 'sys_webhook' },
        ],
      },
      'com.objectstack.plugin-webhook-outbox.schema',
    );

    const app = registry.getApp('setup');
    const group = app.navigation.find((n: any) => n.id === 'group_integrations');
    expect(group.children).toHaveLength(1);
    expect(group.children[0].objectName).toBe('sys_webhook');
    // Untargeted group stays empty.
    const other = app.navigation.find((n: any) => n.id === 'group_people_org');
    expect(other.children).toHaveLength(0);
  });

  it('orders contributions to the same group by ascending priority', () => {
    registry.registerAppNavContribution(
      { app: 'setup', group: 'group_people_org', priority: 200, items: [{ id: 'nav_b', type: 'object', label: 'B', objectName: 'sys_b' }] },
      'pkg.late',
    );
    registry.registerAppNavContribution(
      { app: 'setup', group: 'group_people_org', priority: 100, items: [{ id: 'nav_a', type: 'object', label: 'A', objectName: 'sys_a' }] },
      'pkg.early',
    );

    const app = registry.getApp('setup');
    const group = app.navigation.find((n: any) => n.id === 'group_people_org');
    expect(group.children.map((c: any) => c.id)).toEqual(['nav_a', 'nav_b']);
  });

  it('appends at the top level when the target group is missing', () => {
    registry.registerAppNavContribution(
      { app: 'setup', group: 'group_does_not_exist', priority: 100, items: [{ id: 'nav_orphan', type: 'url', label: 'Orphan', url: '/x' }] },
      'pkg.orphan',
    );
    const app = registry.getApp('setup');
    expect(app.navigation.some((n: any) => n.id === 'nav_orphan')).toBe(true);
  });

  it('does not mutate the stored app — reads are idempotent', () => {
    registry.registerAppNavContribution(
      { app: 'setup', group: 'group_integrations', priority: 100, items: [{ id: 'nav_webhooks', type: 'object', label: 'Webhooks', objectName: 'sys_webhook' }] },
      'pkg.webhooks',
    );
    const first = registry.getApp('setup');
    const second = registry.getApp('setup');
    const firstCount = first.navigation.find((n: any) => n.id === 'group_integrations').children.length;
    const secondCount = second.navigation.find((n: any) => n.id === 'group_integrations').children.length;
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1); // not 2 — contributions are not appended cumulatively
  });

  it('returns the un-merged app when there are no contributions', () => {
    const app = registry.getApp('setup');
    for (const group of app.navigation) {
      expect(group.children).toHaveLength(0);
    }
  });

  it('applies contributions through getAllApps too', () => {
    registry.registerAppNavContribution(
      { app: 'setup', group: 'group_integrations', priority: 100, items: [{ id: 'nav_webhooks', type: 'object', label: 'Webhooks', objectName: 'sys_webhook' }] },
      'pkg.webhooks',
    );
    const apps = registry.getAllApps();
    const setup = apps.find((a: any) => a.name === 'setup');
    const group = setup.navigation.find((n: any) => n.id === 'group_integrations');
    expect(group.children).toHaveLength(1);
  });
});

/**
 * [#30581] A package BODY's contributions are derived from its manifest, never
 * appended to: registering the same body again folds each entry once.
 *
 * An artifact reload (`metadata:reloaded`) re-registers every package of the
 * artifact through `ObjectQL.registerApp`, and the manifest step used to push
 * each contribution once more per registration, so a single reload listed
 * every module's entries twice until a restart. Each pin below compares the
 * served app against the snapshot a fresh registration of the same bodies
 * gives, in the same test.
 */
describe('[#30581] a package body re-registered folds its contributions once', () => {
  const APP = 'com.qa.nav.app';
  const ORDERS = 'com.qa.nav.orders';
  const SERVICE = 'com.qa.nav.service';
  const LOOSE = 'com.qa.nav.loose';

  const appBody = () => ({
    id: APP, name: APP, version: '1.0.0', type: 'app', namespace: 'qn',
    apps: [{
      name: 'qn_app', label: 'Suite',
      navigation: [
        { id: 'g_sales', type: 'group', label: 'Sales', children: [{ id: 'nav_accounts', type: 'object', label: 'Accounts', objectName: 'qn_account' }] },
        { id: 'g_service', type: 'group', label: 'Service', children: [] },
      ],
    }],
  });
  // Equal priorities on purpose: the default 200 makes ties the common case,
  // so the order a re-registration leaves is a real question.
  const ordersBody = (items = [{ id: 'nav_orders', type: 'object', label: 'Orders', objectName: 'qn_order' }]) => ({
    id: ORDERS, name: ORDERS, version: '1.0.0', type: 'module', namespace: 'qn', dependencies: { [APP]: '^1.0.0' },
    navigationContributions: [
      { app: 'qn_app', group: 'g_sales', items },
      { app: 'qn_app', group: 'g_service', items: [{ id: 'nav_returns', type: 'object', label: 'Returns', objectName: 'qn_return' }] },
    ],
  });
  const serviceBody = () => ({
    id: SERVICE, name: SERVICE, version: '1.0.0', type: 'module', namespace: 'qn', dependencies: { [APP]: '^1.0.0' },
    navigationContributions: [
      { app: 'qn_app', group: 'g_service', items: [{ id: 'nav_cases', type: 'object', label: 'Cases', objectName: 'qn_case' }] },
      { app: 'qn_app', group: 'g_sales', items: [{ id: 'nav_quotes', type: 'object', label: 'Quotes', objectName: 'qn_quote' }] },
    ],
  });
  // A module that contributes nothing: toggling or re-registering it moves nothing.
  const looseBody = () => ({ id: LOOSE, name: LOOSE, version: '1.0.0', type: 'module', namespace: 'qn', dependencies: { [APP]: '^1.0.0' } });

  /** Every navigation entry of the served app, `group/id`, in served order. */
  const served = (engine: ObjectQL): string[] =>
    (engine.registry.getApp('qn_app')?.navigation ?? []).flatMap((n: any) =>
      n.type === 'group' ? (n.children ?? []).map((c: any) => `${n.id}/${c.id}`) : [n.id]);

  const boot = (): ObjectQL => {
    const engine = new ObjectQL();
    (engine.registry as any).logLevel = 'silent';
    for (const body of [appBody(), ordersBody(), serviceBody(), looseBody()]) engine.registerApp(body as any);
    return engine;
  };

  let engine: ObjectQL;
  let fresh: string[];
  beforeEach(() => {
    engine = boot();
    fresh = served(boot());
  });

  it('serves each entry once on a fresh registration (the control)', () => {
    expect(fresh).toEqual([
      'g_sales/nav_accounts', 'g_sales/nav_orders', 'g_sales/nav_quotes',
      'g_service/nav_returns', 'g_service/nav_cases',
    ]);
    expect(served(engine)).toEqual(fresh);
  });

  it('re-registering every body twice (two artifact reloads) serves the fresh registration, in its order', () => {
    for (let reload = 0; reload < 2; reload++) {
      for (const body of [appBody(), ordersBody(), serviceBody(), looseBody()]) engine.registerApp(body as any);
    }
    expect(served(engine)).toEqual(fresh);
    expect(engine.registry.getAppNavContributions('qn_app')).toHaveLength(4);
  });

  it('re-registering ONE module keeps its entries where a fresh registration puts them', () => {
    engine.registerApp(ordersBody() as any);
    engine.registerApp(ordersBody() as any);
    expect(served(engine)).toEqual(fresh);
  });

  it('two disable/enable cycles of a module, each followed by a reload, serve the fresh registration', () => {
    // The enable announcement the roll-up recompute rides on (#30377) still
    // fires once per enable of a disabled package: a reload is no enable.
    const heard: string[] = [];
    const stop = engine.registry.onPackageEnabled((id) => { heard.push(id); });
    for (let cycle = 0; cycle < 2; cycle++) {
      engine.registry.disablePackage(ORDERS);
      expect(served(engine)).toEqual(['g_sales/nav_accounts', 'g_sales/nav_quotes', 'g_service/nav_cases']);
      for (const body of [appBody(), ordersBody(), serviceBody(), looseBody()]) engine.registerApp(body as any);
      engine.registry.enablePackage(ORDERS);
      expect(served(engine)).toEqual(fresh);
    }
    stop();
    expect(heard).toEqual([ORDERS, ORDERS]);
  });

  it('toggling and re-registering a module with no contributions leaves the navigation unchanged', () => {
    engine.registry.disablePackage(LOOSE);
    engine.registerApp(looseBody() as any);
    engine.registry.enablePackage(LOOSE);
    expect(served(engine)).toEqual(fresh);
  });

  it('a re-registered body replaces its contributions: an entry it dropped leaves, one it added appears once', () => {
    engine.registerApp(ordersBody([{ id: 'nav_invoices', type: 'object', label: 'Invoices', objectName: 'qn_invoice' }]) as any);
    expect(served(engine)).toEqual([
      'g_sales/nav_accounts', 'g_sales/nav_invoices', 'g_sales/nav_quotes',
      'g_service/nav_returns', 'g_service/nav_cases',
    ]);
    const { navigationContributions: _dropped, ...withNone } = ordersBody();
    engine.registerApp(withNone as any);
    expect(served(engine)).toEqual(['g_sales/nav_accounts', 'g_sales/nav_quotes', 'g_service/nav_cases']);
  });

  it('uninstalling a module (not disabling it) drops its contributions from the app', () => {
    expect(engine.registry.uninstallPackage(ORDERS), 'precondition: uninstalled').toBe(true);
    expect(served(engine)).toEqual(['g_sales/nav_accounts', 'g_sales/nav_quotes', 'g_service/nav_cases']);
    expect(engine.registry.getAppNavContributions('qn_app').map((c) => c.packageId)).toEqual([SERVICE, SERVICE]);
  });
});
