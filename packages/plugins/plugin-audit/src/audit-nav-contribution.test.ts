// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #23890 — the Audit plugin's Setup navigation contribution is ONE entry,
// "Audit Log", and it opens the console's audit browser.
//
// The browser is registered by the console under the `audit:log` component key
// (objectui `apps/console/src/registerSystemComponents.tsx`). At the commit
// objectstack's `.objectui-sha` pins (5e15928b4631) it filters by action,
// object, actor and date, offers `sys_audit_log`'s served list views as
// presets, and links to the object list ("Open as list") — so the list needs
// no menu entry of its own, and a second entry onto it was a second door onto
// the same rows (#23803, item 1). objectui pins the registration half
// (`orphanedPageComponentRefs-10520.test.tsx`); this file pins the half this
// repo owns — the one entry and the ref it names (#20142 first gave the page
// an entry).
//
// Why here and not in `@objectstack/platform-objects`: the page reads
// `sys_audit_log`, which this plugin owns (ADR-0029 K2), so its entry lives and
// dies with this plugin — and needs no item gate for the same reason.

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects/apps';
import { NavigationContributionSchema } from '@objectstack/spec/ui';
import { AuditPlugin } from './audit-plugin.js';

type NavItem = {
  id?: string;
  type?: string;
  label?: string;
  objectName?: string;
  componentRef?: string;
  url?: string;
  requiresService?: string;
  requiresObject?: string;
  children?: NavItem[];
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

/**
 * The Setup app as `GET /api/v1/meta/app` folds it: the real `SchemaRegistry`
 * over `SETUP_APP`, `@objectstack/platform-objects`' own contributions and this
 * plugin's, registered under the manifest id the engine uses for them
 * (`engine.ts` step 4b). `structuredClone` because `registerItem` writes the
 * `_lock` envelope onto what it is handed (ADR-0010 §3.7).
 */
async function renderedSetup(): Promise<NavItem[]> {
  const manifest = await registeredManifest();
  const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
  (registry as any).logLevel = 'silent';
  registry.registerApp(structuredClone(SETUP_APP), '@objectstack/platform-objects');
  for (const contribution of SETUP_NAV_CONTRIBUTIONS) {
    registry.registerAppNavContribution(structuredClone(contribution) as any, '@objectstack/platform-objects');
  }
  for (const contribution of manifest.navigationContributions) {
    registry.registerAppNavContribution(structuredClone(contribution), manifest.id);
  }
  return (registry.getApp('setup')?.navigation ?? []) as NavItem[];
}

/** Every leaf of a nav tree, depth-first, with the group it sits in. */
function leaves(items: NavItem[], group?: string): Array<NavItem & { group?: string }> {
  return items.flatMap((item) =>
    Array.isArray(item.children) && item.children.length > 0
      ? leaves(item.children, item.id)
      : item.type === 'group' ? [] : [{ ...item, group }],
  );
}

/** An entry whose target is an audit surface: the browser, or the ledger's list. */
const isAuditSurface = (item: NavItem): boolean =>
  item.componentRef === 'audit:log' ||
  item.objectName === 'sys_audit_log' ||
  (typeof item.url === 'string' && /sys_audit_log|audit[/-]log/.test(item.url));

describe('AuditPlugin — one Setup audit entry (#23890)', () => {
  it('contributes exactly one entry into group_diagnostics, and it parses', async () => {
    const manifest = await registeredManifest();
    expect(manifest.navigationContributions).toHaveLength(1);
    const [contribution] = manifest.navigationContributions;
    expect(contribution).toMatchObject({ app: 'setup', group: 'group_diagnostics' });
    expect((contribution.items as NavItem[]).map((i) => i.id)).toEqual(['nav_audit_logs']);
    expect(() => NavigationContributionSchema.parse(contribution)).not.toThrow();
  });

  it('"Audit Log" routes to the `audit:log` registry key, never to the object list', async () => {
    const manifest = await registeredManifest();
    const [entry] = manifest.navigationContributions[0].items as NavItem[];
    expect(entry).toMatchObject({
      id: 'nav_audit_logs',
      type: 'component',
      componentRef: 'audit:log',
      label: 'Audit Log',
    });
    // A registry KEY, never a console path (objectui#2763).
    expect(entry.componentRef).toMatch(/^[a-z0-9_-]+:[a-z0-9_-]+$/);
    // The list is reached from the page's "Open as list" link, so the entry
    // names no object. A component item has no object route to gate, and a
    // contribution exists only while this plugin is installed — which is
    // exactly when the page's `sys_audit_log` reads can answer. No gate.
    expect(entry.objectName).toBeUndefined();
    expect(entry.requiresObject).toBeUndefined();
    expect(entry.requiresService).toBeUndefined();
  });

  it('the rendered Setup nav has exactly one entry whose target is an audit surface', async () => {
    const all = leaves(await renderedSetup());
    // Control: the fold really carries the other contributors' entries, so an
    // empty walk cannot pass the count below by vacuity.
    expect(all.map((i) => i.id)).toContain('nav_sessions');
    expect(all.length).toBeGreaterThan(10);

    const audit = all.filter(isAuditSurface);
    expect(audit.map((i) => i.id)).toEqual(['nav_audit_logs']);
    expect(audit[0]).toMatchObject({ type: 'component', componentRef: 'audit:log', group: 'group_diagnostics' });
    // The page's former id is not served beside it.
    expect(all.map((i) => i.id)).not.toContain('nav_audit_log_browser');
  });
});
