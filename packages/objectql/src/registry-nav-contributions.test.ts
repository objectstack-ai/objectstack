// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry';

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
