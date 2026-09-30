// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20142 — the Audit plugin's Setup navigation contribution carries BOTH doors
// onto `sys_audit_log`: the object view and the console's Audit Log page.
//
// The page is registered by the console under the `audit:log` component key
// (objectui `apps/console/src/registerSystemComponents.tsx`, measured at the
// commit objectstack's `.objectui-sha` pins, dd3f7e1be356). Its only in-app
// link was the System Hub card wall, which objectui#10520 retired; without an
// entry naming the key the page is reachable by typed URL alone. objectui pins
// the registration half (`orphanedPageComponentRefs-10520.test.tsx`); this file
// pins the half this repo owns — the ref the entry names.
//
// Why here and not beside #20142's Studio entry in
// `@objectstack/platform-objects`: the page reads `sys_audit_log`, which this
// plugin owns (ADR-0029 K2), so its entry lives and dies with this plugin the
// way `nav_audit_logs` does — and needs no item gate for the same reason.

import { describe, it, expect } from 'vitest';
import { NavigationContributionSchema } from '@objectstack/spec/ui';
import { AuditPlugin } from './audit-plugin.js';

type NavItem = {
  id?: string;
  type?: string;
  label?: string;
  objectName?: string;
  componentRef?: string;
  requiresService?: string;
  requiresObject?: string;
};

/** Run the plugin's init() and return the manifest it registered. */
async function registeredManifest(): Promise<any> {
  const registered: any[] = [];
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    getService: (name: string) =>
      name === 'manifest' ? { register: (m: unknown) => registered.push(m) } : undefined,
    registerService() {},
    hook() {},
  };
  await new AuditPlugin().init(ctx);
  expect(registered).toHaveLength(1);
  return registered[0];
}

describe('AuditPlugin — Setup navigation contribution (#20142)', () => {
  it('contributes the object view AND the console page into group_diagnostics, in that order', async () => {
    const manifest = await registeredManifest();
    expect(manifest.navigationContributions).toHaveLength(1);
    const [contribution] = manifest.navigationContributions;
    expect(contribution).toMatchObject({ app: 'setup', group: 'group_diagnostics' });
    // Array order IS rendered order (`applyNavContributions` appends `items`
    // verbatim), so the page sits directly under the object view it adds to.
    expect((contribution.items as NavItem[]).map((i) => i.id)).toEqual([
      'nav_audit_logs',
      'nav_audit_log_browser',
    ]);
    expect(() => NavigationContributionSchema.parse(contribution)).not.toThrow();
  });

  it('the page entry routes to the `audit:log` registry key', async () => {
    const manifest = await registeredManifest();
    const page = (manifest.navigationContributions[0].items as NavItem[])
      .find((i) => i.id === 'nav_audit_log_browser');
    expect(page).toMatchObject({
      type: 'component',
      componentRef: 'audit:log',
      label: 'Audit Log Browser',
    });
    // A registry KEY, never a console path (objectui#2763).
    expect(page?.componentRef).toMatch(/^[a-z0-9_-]+:[a-z0-9_-]+$/);
    // A component item has no object route to gate, and a contribution exists
    // only while this plugin is installed — which is exactly when the page's
    // `sys_audit_log` reads can answer. No gate of either kind.
    expect(page?.objectName).toBeUndefined();
    expect(page?.requiresObject).toBeUndefined();
    expect(page?.requiresService).toBeUndefined();
  });

  it('keeps the object view entry unchanged beside it', async () => {
    const manifest = await registeredManifest();
    const objectView = (manifest.navigationContributions[0].items as NavItem[])
      .find((i) => i.id === 'nav_audit_logs');
    expect(objectView).toMatchObject({
      type: 'object',
      objectName: 'sys_audit_log',
      label: 'Audit Logs',
    });
  });
});
