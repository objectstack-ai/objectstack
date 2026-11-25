// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36906 — which app a dashboard or a report opened from a Studio
 * list opens in (epic #36890 decision 6), and the app addresses it opens.
 */

import { describe, expect, it } from 'vitest';
import {
  appItemPath,
  appNewReportPath,
  isStudioAppEditType,
  menuOpensItem,
  studioAppCreateSegment,
  studioAppEditSegment,
  type StudioAppTarget,
} from './studioAppEdit.js';
import { studioBackTarget } from './StudioBackToApp.js';

const one: StudioAppTarget[] = [{ name: 'crm_app', label: 'CRM' }];
const two: StudioAppTarget[] = [
  { name: 'sales', label: 'Sales' },
  { name: 'service', label: 'Service' },
];
const page = (app: string) => ({ path: `/apps/${app}/home`, app, label: app });

describe('studioAppEditSegment — decision 6', () => {
  it('opens only dashboards and reports in an app', () => {
    expect(isStudioAppEditType('dashboard')).toBe(true);
    expect(isStudioAppEditType('report')).toBe(true);
    for (const type of ['view', 'page', 'app', 'object', 'flow', 'reports']) expect(isStudioAppEditType(type)).toBe(false);
  });

  it('1. the remembered app, when it is one of the package apps (by name, or by the package id)', () => {
    const base = { packageId: 'crm', type: 'dashboard' as const, name: 'ops' };
    expect(studioAppEditSegment({ ...base, apps: two, remembered: page('service') })).toBe('service');
    // The package id is the route key of a one-app package.
    expect(studioAppEditSegment({ ...base, apps: one, remembered: page('crm') })).toBe('crm');
    expect(studioAppEditSegment({ ...base, apps: one, remembered: page('crm_app') })).toBe('crm');
  });

  it('1. the remembered app of another package, when its menu opens the item, at any depth', () => {
    const base = { packageId: 'crm', apps: one, remembered: page('setup'), type: 'dashboard' as const, name: 'ops' };
    const menu = [{ id: 'g', type: 'group', label: 'G', children: [{ id: 'd', type: 'dashboard', dashboardName: 'ops' }] }];
    expect(studioAppEditSegment({ ...base, rememberedMenu: menu })).toBe('setup');
    // A menu that opens another item, or the report of the same name, does not count.
    expect(studioAppEditSegment({ ...base, rememberedMenu: [{ id: 'd', type: 'dashboard', dashboardName: 'other' }] })).toBe('crm');
    expect(studioAppEditSegment({ ...base, rememberedMenu: [{ id: 'r', type: 'report', reportName: 'ops' }] })).toBe('crm');
  });

  it("2. otherwise the package's first published app, never the remembered app of another package", () => {
    const base = { packageId: 'crm', type: 'report' as const, name: 'pipeline' };
    expect(studioAppEditSegment({ ...base, apps: one, remembered: null })).toBe('crm');
    expect(studioAppEditSegment({ ...base, apps: two, remembered: page('setup') })).toBe('sales');
    expect(studioAppEditSegment({ ...base, apps: two, remembered: page('setup'), rememberedMenu: undefined })).toBe('sales');
  });

  it('3. none: no published app, or no package (the generic item page)', () => {
    expect(studioAppEditSegment({ packageId: 'crm', apps: [], remembered: page('crm'), type: 'dashboard', name: 'ops' })).toBeNull();
    expect(studioAppEditSegment({ packageId: null, apps: one, remembered: page('crm_app'), type: 'dashboard', name: 'ops' })).toBeNull();
    expect(studioAppEditSegment({ packageId: 'crm', apps: one, remembered: null, type: 'dashboard', name: '' })).toBeNull();
  });

  it('a new report opens in the remembered app of the package, else the first, else none; a foreign menu never counts', () => {
    expect(studioAppCreateSegment({ packageId: 'crm', apps: two, remembered: page('service') })).toBe('service');
    expect(studioAppCreateSegment({ packageId: 'crm', apps: two, remembered: page('setup') })).toBe('sales');
    expect(studioAppCreateSegment({ packageId: 'crm', apps: [], remembered: page('crm') })).toBeNull();
    expect(studioAppCreateSegment({ packageId: null, apps: one, remembered: null })).toBeNull();
  });

  it('agrees with the back link on the app of the package (the rule they share)', () => {
    for (const [apps, remembered] of [
      [one, null],
      [one, page('crm')],
      [two, page('service')],
      [two, page('setup')],
    ] as const) {
      const back = studioBackTarget({ remembered, packageId: 'crm', apps, locale: 'en', landingPath: '/home' });
      const segment = studioAppCreateSegment({ packageId: 'crm', apps, remembered });
      // The back link returns to the remembered page itself, or to the app's first screen.
      expect(back.path === remembered?.path || back.path === `/apps/${segment}`).toBe(true);
    }
  });

  it('menuOpensItem reads no menu that is not one', () => {
    expect(menuOpensItem(undefined, 'dashboard', 'ops')).toBe(false);
    expect(menuOpensItem({ type: 'dashboard', dashboardName: 'ops' }, 'dashboard', 'ops')).toBe(false);
  });
});

describe('the app addresses', () => {
  it('spell the item page and the new-report page, encoded', () => {
    expect(appItemPath('crm', 'dashboard', 'ops_board')).toBe('/apps/crm/dashboard/ops_board');
    expect(appItemPath('com.acme.crm', 'report', 'a b')).toBe('/apps/com.acme.crm/report/a%20b');
    expect(appNewReportPath('crm')).toBe('/apps/crm/reports/new');
  });
});
