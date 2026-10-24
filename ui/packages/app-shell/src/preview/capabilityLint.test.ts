/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { lintDraftCapabilityReferences } from './capabilityLint';

const draft = (item: Record<string, unknown>) => Promise.resolve({ item });

function fakeClient(overrides: Partial<Record<'getDraft' | 'list', any>> = {}) {
  return {
    getDraft: vi.fn((type: string, name: string) => {
      if (type === 'object' && name === 'inv_invoice') {
        return draft({ name: 'inv_invoice', requiredPermissions: ['mange_billing'] });
      }
      if (type === 'permission' && name === 'billing_admin') {
        return draft({ name: 'billing_admin', systemPermissions: ['manage_billing'] });
      }
      return Promise.resolve(null);
    }),
    list: vi.fn(() => Promise.resolve([{ item: { name: 'member_default', systemPermissions: [] } }])),
    ...overrides,
  };
}

describe('lintDraftCapabilityReferences (ADR-0066 ⑨, pre-publish)', () => {
  it('assembles the pseudo-stack (object drafts + published ∪ draft permissions) and formats warnings', async () => {
    const client = fakeClient();
    const rule = vi.fn((stack: Record<string, unknown>) => {
      // The rule sees the object draft AND both declaration sources.
      expect((stack.objects as unknown[]).length).toBe(1);
      const perms = stack.permissions as Array<{ name: string }>;
      expect(perms.map((p) => p.name)).toEqual(['member_default', 'billing_admin']);
      return [
        { severity: 'warning', rule: 'capability-reference-unknown', where: 'object "inv_invoice"', path: 'objects[0].requiredPermissions', message: 'references capability "mange_billing" which is registered nowhere' },
        { severity: 'error', rule: 'other', where: 'x', path: 'y', message: 'errors are not surfaced by this advisory pass' },
      ];
    });

    const warnings = await lintDraftCapabilityReferences(
      client,
      [
        { type: 'object', name: 'inv_invoice', packageId: 'pkg_a' },
        { type: 'permission', name: 'billing_admin', packageId: 'pkg_a' },
        { type: 'seed', name: 'demo', packageId: null }, // not a linted type
      ],
      rule,
    );

    expect(rule).toHaveBeenCalledTimes(1);
    expect(warnings).toEqual([
      'object "inv_invoice": references capability "mange_billing" which is registered nowhere',
    ]);
  });

  it('is a no-op when no linted draft types are pending (rule never runs)', async () => {
    const rule = vi.fn(() => []);
    const warnings = await lintDraftCapabilityReferences(
      fakeClient(),
      [{ type: 'seed', name: 'demo', packageId: null }],
      rule,
    );
    expect(rule).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });

  it('never breaks publish: swallows client and rule failures', async () => {
    const throwingClient = fakeClient({
      getDraft: vi.fn(() => Promise.reject(new Error('network'))),
      list: vi.fn(() => Promise.reject(new Error('network'))),
    });
    const throwingRule = vi.fn(() => { throw new Error('rule blew up'); });
    await expect(
      lintDraftCapabilityReferences(
        throwingClient,
        [{ type: 'object', name: 'x', packageId: null }],
        throwingRule,
      ),
    ).resolves.toEqual([]);
  });

  it('feature-detect: no-op against an installed @objectstack/lint without the rule', async () => {
    // No ruleOverride → real dynamic import. The pinned @objectstack/lint
    // (< 12.7) does not export validateCapabilityReferences, so the pass
    // resolves to a silent no-op. When the dependency is bumped this branch
    // starts exercising the real rule with zero code change.
    const client = fakeClient();
    const warnings = await lintDraftCapabilityReferences(client, [
      { type: 'object', name: 'inv_invoice', packageId: null },
    ]);
    expect(Array.isArray(warnings)).toBe(true);
  });
});
