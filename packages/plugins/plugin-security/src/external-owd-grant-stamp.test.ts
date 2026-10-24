// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling of record 6355206139, letter B] What counts as a held grant's RLS
 * speaking for an object, for the EXTERNAL OWD seam — and what does not: the
 * object's own declared default, the platform's ownership floor, a `check`-only
 * policy, and (for a read) a write-class predicate.
 */

import { describe, it, expect } from 'vitest';
import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { EXTERNAL_READ_GRANT_KEY, EXTERNAL_WRITE_GRANT_KEY } from '@objectstack/core';
import { externalGrantPatch, grantRowPolicySpeaks, stampExternalGrant } from './external-owd-grant-stamp.js';
import { objectDefaultRowScopePolicy } from './object-default-row-scope.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { humanBaselineFor, holdsExternalPosition } from './external-baseline.js';

const policy = (over: Partial<RowLevelSecurityPolicy>): RowLevelSecurityPolicy =>
  ({ name: 'p', object: 'po', operation: 'select', using: "supplier == 's1'", ...over }) as RowLevelSecurityPolicy;

/** A collector answering per RLS operation, as Layer 1's collection would. */
const collector = (byOp: Record<string, RowLevelSecurityPolicy[]>) => (op: string) => byOp[op] ?? [];

const floorOf = (name: 'owner_only_writes' | 'owner_only_deletes') => {
  const set = defaultPermissionSets.find((s) => s.name === 'external_default')!;
  return (set.rowLevelSecurity ?? []).find((p) => p.name === name)!;
};

describe('grantRowPolicySpeaks', () => {
  it('a select predicate speaks for the read class and, as Layer 1 derives it, the write class', () => {
    const collect = collector({ select: [policy({})] });
    expect(grantRowPolicySpeaks(collect, 'read')).toBe(true);
    expect(grantRowPolicySpeaks(collect, 'write', 'update')).toBe(true);
  });

  it('a write-class predicate speaks for its write class, never for a read', () => {
    const collect = collector({ update: [policy({ operation: 'update' })] });
    expect(grantRowPolicySpeaks(collect, 'read')).toBe(false);
    expect(grantRowPolicySpeaks(collect, 'write', 'update')).toBe(true);
    expect(grantRowPolicySpeaks(collect, 'write', 'delete')).toBe(false);
  });

  it('the object’s own declared default row scope is not a grant', () => {
    const declared = objectDefaultRowScopePolicy('po', { defaultRowScope: { name: 'po_default', operation: 'select', using: "status == 'open'" } })!;
    expect(grantRowPolicySpeaks(collector({ select: [declared] }), 'read')).toBe(false);
  });

  it('the platform’s owner_only floor is not a grant, on either limb', () => {
    expect(grantRowPolicySpeaks(collector({ update: [floorOf('owner_only_writes')] }), 'write', 'update')).toBe(false);
    expect(grantRowPolicySpeaks(collector({ delete: [floorOf('owner_only_deletes')] }), 'write', 'delete')).toBe(false);
  });

  it('a check-only policy gates the post-image, not which rows are reached', () => {
    const checkOnly = { name: 'c', object: 'po', operation: 'update', check: "status != 'closed'" } as RowLevelSecurityPolicy;
    expect(grantRowPolicySpeaks(collector({ update: [checkOnly] }), 'write', 'update')).toBe(false);
  });
});

describe('the stamp', () => {
  it('names the object when a grant speaks, and removes the key when none does', () => {
    const ctx: Record<string, unknown> = { [EXTERNAL_READ_GRANT_KEY]: 'po' };
    stampExternalGrant(ctx, 'po', 'read', false);
    expect(EXTERNAL_READ_GRANT_KEY in ctx).toBe(false);
    stampExternalGrant(ctx, 'po', 'write', true);
    expect(ctx[EXTERNAL_WRITE_GRANT_KEY]).toBe('po');
  });

  it('as a patch: an external gets its stamp (undefined overwrites a carried one); an internal principal gets nothing', () => {
    const speaks = collector({ select: [policy({})] });
    const silent = collector({});
    const external = { audience: 'external', [EXTERNAL_READ_GRANT_KEY]: 'po' };
    expect(externalGrantPatch(external, 'po', 'read', speaks)).toEqual({ [EXTERNAL_READ_GRANT_KEY]: 'po' });
    expect(externalGrantPatch(external, 'po', 'read', silent)).toEqual({ [EXTERNAL_READ_GRANT_KEY]: undefined });
    expect(externalGrantPatch({ posture: 'MEMBER' }, 'po', 'read', speaks)).toEqual({});
  });
});

describe('the baseline an external resolves, named once', () => {
  it('external_default for a holder of org_external; the configured baseline for anyone else', () => {
    expect(holdsExternalPosition(['org_external', 'supplier_portal'])).toBe(true);
    expect(humanBaselineFor(['org_external'], ['member_default', 'app_default'])).toEqual(['external_default']);
    expect(humanBaselineFor(['org_member', 'everyone'], ['member_default', 'app_default'])).toEqual(['member_default', 'app_default']);
    expect(humanBaselineFor(undefined, ['member_default'])).toEqual(['member_default']);
  });

  it('external_default carries the owner_only write floor, bound to org_external', () => {
    for (const name of ['owner_only_writes', 'owner_only_deletes'] as const) {
      expect(floorOf(name)).toMatchObject({ object: '*', using: 'created_by == current_user.id', positions: ['org_external'] });
    }
  });
});
