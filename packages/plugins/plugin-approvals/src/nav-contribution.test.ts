// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ApprovalsServicePlugin } from './approvals-plugin.js';

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
      'sys_approval_request',
      'sys_approval_token',
    ]);

    // Contributes its menu into the Setup app's approvals slot.
    expect(manifest.navigationContributions).toHaveLength(1);
    const contribution = manifest.navigationContributions[0];
    expect(contribution).toMatchObject({ app: 'setup', group: 'group_approvals' });
    expect(contribution.items.map((i: any) => i.objectName).sort()).toEqual([
      'sys_approval_action',
      'sys_approval_request',
    ]);
    // Each entry is gated so the slot stays empty when the plugin is absent.
    for (const item of contribution.items) {
      expect(item.requiresObject).toBe(item.objectName);
    }
  });
});
