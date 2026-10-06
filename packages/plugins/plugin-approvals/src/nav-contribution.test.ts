// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { NavigationContributionSchema } from '@objectstack/spec/ui';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';

/** The plugin's one manifest, as `init` registers it. */
async function registeredManifest(): Promise<any> {
  const registered: any[] = [];
  const ctx: any = {
    getService: (name: string) =>
      name === 'manifest' ? { register: (m: any) => registered.push(m) } : undefined,
    logger: { info: () => {}, warn: () => {} },
  };
  await new ApprovalsServicePlugin({ disableService: true }).init(ctx);
  expect(registered).toHaveLength(1);
  return registered[0];
}

/** A view is caller-scoped when it filters on the caller: the token appears anywhere in it. */
const isCallerScoped = (view: unknown): boolean => JSON.stringify(view ?? {}).includes('{current_user_id}');

/**
 * ADR-0029 K2.b / D7 — the approvals plugin owns sys_approval_request /
 * sys_approval_action and ships their Setup-app menu as a navigation
 * contribution (rather than the entries living statically in the
 * platform-objects Setup shell).
 */
describe('ApprovalsServicePlugin schema + nav contribution (ADR-0029 K2.b)', () => {
  it('registers the approval objects and contributes the group_approvals slot', async () => {
    const registered: any[] = [];
    const ctx: any = {
      getService: (name: string) =>
        name === 'manifest' ? { register: (m: any) => registered.push(m) } : undefined,
      logger: { info: () => {}, warn: () => {} },
    };

    const plugin = new ApprovalsServicePlugin({ disableService: true });
    await plugin.init(ctx);

    expect(registered).toHaveLength(1);
    const manifest = registered[0];

    // Owns the approval objects (moved out of platform-objects).
    expect(manifest.objects.map((o: any) => o.name).sort()).toEqual([
      'sys_approval_action',
      'sys_approval_approver',
      'sys_approval_delegation',
      'sys_approval_request',
      'sys_approval_token',
    ]);

    // Contributes its menu into the Setup app's approvals slot.
    expect(manifest.navigationContributions).toHaveLength(1);
    const contribution = manifest.navigationContributions[0];
    expect(contribution).toMatchObject({ app: 'setup', group: 'group_approvals' });

    // ORDER IS THE ASSERTION, not a by-product (#7234). `applyNavContributions`
    // appends `c.items` into the group verbatim, so this array's order IS the
    // rendered order — the inbox must come first. A set-shaped assertion (the
    // `.sort()` this case used to open with) cannot see that, and putting the
    // working surface below three raw tables is most of the defect #7213
    // reported.
    expect(contribution.items.map((i: any) => i.id)).toEqual([
      'nav_approvals_inbox',
      'nav_approval_requests',
      'nav_approval_actions',
      'nav_approval_delegations',
    ]);

    // The inbox entry addresses the component REGISTRY KEY, never a console
    // path (objectui#2763) — the console resolves `approvals:inbox` to
    // `component/approvals/inbox` on its side (objectui#4071).
    const [inbox, ...rawTables] = contribution.items as any[];
    expect(inbox).toMatchObject({
      id: 'nav_approvals_inbox',
      type: 'component',
      componentRef: 'approvals:inbox',
    });
    // It carries no object gate: `requiresObject` names the object an entry
    // routes to, and this one routes to a component. It needs none — a
    // navigation CONTRIBUTION only exists while its plugin is installed, which
    // is the same condition that makes the inbox's REST path answer.
    expect(inbox.objectName).toBeUndefined();
    expect(inbox.requiresObject).toBeUndefined();

    // The raw engine tables stay, unchanged, as the admin/diagnostic view.
    expect(rawTables.map((i: any) => i.objectName)).toEqual([
      'sys_approval_request',
      'sys_approval_action',
      'sys_approval_delegation',
    ]);
    // Each object entry is gated so the slot degrades cleanly when an object is
    // not registered.
    for (const item of rawTables) {
      expect(item.type).toBe('object');
      expect(item.requiresObject).toBe(item.objectName);
    }
  });

  // Setup → Approvals → Requests is an administrator's page. When a route names
  // no view, the console opens the object's FIRST declared list view, so two
  // things must hold: the first declared view is not filtered to the caller,
  // and the Setup entry does not depend on that order at all. The merged-app
  // pin in `packages/qa/dogfood` asserts the same two rules over every object
  // entry of the runtime-merged Setup and Account apps; this case is the owning
  // package's own copy for this one entry.
  it('the Requests entry opens the tenant-wide list, and no caller-scoped view is declared first', async () => {
    const manifest = await registeredManifest();
    const entry = manifest.navigationContributions[0].items.find((i: any) => i.id === 'nav_approval_requests');
    expect(entry, 'nav_approval_requests is contributed').toBeDefined();
    expect(entry.viewName, 'nav_approval_requests names its view').toBe('all_requests');

    const listViews = (SysApprovalRequest as any).listViews as Record<string, unknown>;
    expect(Object.keys(listViews)[0], 'sys_approval_request declares all_requests first').toBe('all_requests');
    expect(isCallerScoped(listViews.all_requests), 'all_requests is not filtered to the caller').toBe(false);
    // Non-vacuity: the object really declares caller-scoped views, so the order
    // and the named view are what decide the landing page.
    expect(isCallerScoped(listViews.my_pending)).toBe(true);
    expect(isCallerScoped(listViews.submitted_by_me)).toBe(true);

    // `viewName` is the key the spec already declares on an object nav item;
    // it survives the contribution schema rather than being stripped.
    const parsed = NavigationContributionSchema.parse(manifest.navigationContributions[0]);
    expect(parsed.items.find((i: any) => i.id === 'nav_approval_requests')).toMatchObject({ viewName: 'all_requests' });
  });
});
