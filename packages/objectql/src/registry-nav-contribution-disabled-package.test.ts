// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry';

/**
 * [#28117] A DISABLED package's navigation contributions leave the app it
 * contributes to, on every read that folds them, and come back on enable.
 *
 * A suite module (a `type: 'module'` package of an installed app) puts its
 * menu entries into the app's groups through `navigationContributions`
 * (ADR-0029 D7). Disabling the module must take those entries out of the app:
 * "disabled" has one meaning, hidden + refused on the data plane + data kept.
 * Before this card the fold (`applyNavContributions`) pushed every registered
 * contribution and never asked whether its package was switched off, so the
 * module's objects answered 404 `OBJECT_PACKAGE_DISABLED` while the menu kept
 * offering them.
 *
 * The fold is the ONE seam all three readers go through: the registry helpers
 * `getApp` / `getAllApps` here, and the protocol's `app` list and by-name reads
 * (`getMetaItems` / `getMetaItem` call `registry.applyNavContributions`), which
 * the runtime pin `packages/runtime/src/domains/packages-disable-app-module.test.ts`
 * drives through the real door. Nothing is cached past the fold: the verdict
 * is the package row's state at read time, so a re-enable needs no
 * invalidation.
 */
describe('[#28117] navigation contributions of a disabled package', () => {
  const APP_PKG = 'com.qa.suite';
  const MODULE_PKG = 'com.qa.suite.orders';
  const OTHER_PKG = 'com.qa.suite.reports';

  let registry: SchemaRegistry;

  const suiteApp = () => ({
    name: 'qs_app',
    label: 'Suite',
    navigation: [
      {
        id: 'qs_group',
        type: 'group',
        label: 'Sales',
        children: [{ id: 'nav_accounts', type: 'object', label: 'Accounts', objectName: 'qs_account' }],
      },
    ],
  });

  // Each module declares the app, as a suite's modules do: that is also what
  // lets it co-own the app's namespace (ADR-0141 D5).
  const manifest = (id: string, type: string) =>
    ({ id, name: id, version: '1.0.0', type, namespace: 'qs', ...(type === 'module' ? { dependencies: { [APP_PKG]: '^1.0.0' } } : {}) }) as any;

  /** The ids the folded app's group holds, read the way `reader` reads it. */
  const groupIds = (app: any) =>
    (app.navigation.find((n: any) => n.id === 'qs_group')?.children ?? []).map((c: any) => c.id);
  const topIds = (app: any) => app.navigation.map((n: any) => n.id);

  const READERS: ReadonlyArray<{ label: string; read: (r: SchemaRegistry) => any }> = [
    { label: 'getApp', read: (r) => r.getApp('qs_app') },
    { label: 'getAllApps', read: (r) => r.getAllApps().find((a: any) => a.name === 'qs_app') },
    { label: 'applyNavContributions (the protocol app read)', read: (r) => r.applyNavContributions(suiteApp()) },
  ];

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    (registry as any).logLevel = 'silent';
    registry.installPackage(manifest(APP_PKG, 'app'), 'code');
    registry.installPackage(manifest(MODULE_PKG, 'module'), 'code');
    registry.installPackage(manifest(OTHER_PKG, 'module'), 'code');
    registry.registerApp(suiteApp(), APP_PKG);
    registry.registerAppNavContribution(
      { app: 'qs_app', group: 'qs_group', priority: 50, items: [{ id: 'nav_orders', type: 'object', label: 'Orders', objectName: 'qs_order' }] },
      MODULE_PKG,
    );
    // A contribution into a group the app does not declare: the fold relocates
    // it to the top level (#14553). Disabled, it must not be relocated either.
    registry.registerAppNavContribution(
      { app: 'qs_app', group: 'qs_missing_group', priority: 60, items: [{ id: 'nav_order_help', type: 'url', label: 'Help', url: '/help' }] },
      MODULE_PKG,
    );
    registry.registerAppNavContribution(
      { app: 'qs_app', group: 'qs_group', priority: 70, items: [{ id: 'nav_reports', type: 'object', label: 'Reports', objectName: 'qs_report' }] },
      OTHER_PKG,
    );
  });

  for (const { label, read } of READERS) {
    it(`${label}: an enabled package's contributions are folded (the control)`, () => {
      const app = read(registry);
      expect(groupIds(app)).toEqual(['nav_accounts', 'nav_orders', 'nav_reports']);
      expect(topIds(app)).toContain('nav_order_help');
    });

    it(`${label}: a disabled package's contributions are dropped, in its group and at the top level, and the others stay`, () => {
      expect(registry.disablePackage(MODULE_PKG), 'precondition: disabled').toBeTruthy();
      const app = read(registry);
      expect(groupIds(app)).toEqual(['nav_accounts', 'nav_reports']);
      expect(topIds(app)).not.toContain('nav_order_help');
    });

    it(`${label}: re-enabling the package restores its contributions`, () => {
      registry.disablePackage(MODULE_PKG);
      read(registry);
      expect(registry.enablePackage(MODULE_PKG), 'precondition: enabled').toBeTruthy();
      const app = read(registry);
      expect(groupIds(app)).toEqual(['nav_accounts', 'nav_orders', 'nav_reports']);
      expect(topIds(app)).toContain('nav_order_help');
    });
  }

  it('records no missing-group diagnostic for a disabled package (its contribution is not folded at all)', () => {
    registry.disablePackage(MODULE_PKG);
    registry.getApp('qs_app');
    expect(registry.getAppNavDiagnostics('qs_app').map((d: any) => d.packageId)).not.toContain(MODULE_PKG);
  });

  it('keeps the stored app untouched: disabling never edits the app the module contributes to', () => {
    registry.disablePackage(MODULE_PKG);
    registry.getApp('qs_app');
    const stored = (registry as any).getItem('app', 'qs_app');
    expect(groupIds(stored)).toEqual(['nav_accounts']);
  });
});
