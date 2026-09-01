// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0092 / ADR-0103 / #3325 — registry-driven managed-object write denies.

import { describe, it, expect } from 'vitest';
import {
  applyManagedWriteDenies,
  MANAGED_DENY_ENTRY,
  MANAGED_DENY_TARGET_SETS,
} from './managed-object-write-denies.js';
import { MCP_AGENT_PERMISSION_SET_WRITE, MCP_AGENT_PERMISSION_SET_READ } from '@objectstack/spec/ai';
import { ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';

// Minimal PermissionSet-shaped fixtures (only name + objects matter here).
const set = (name: string, objects: Record<string, unknown> = {}): any => ({ name, objects });

const DENY = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };

const schemas = [
  { name: 'sys_user', managedBy: 'better-auth', userActions: { edit: true } }, // intentional divergence
  { name: 'sys_sso_provider', managedBy: 'better-auth' },
  { name: 'crm_lead', managedBy: 'platform' },
  { name: 'sys_setting', managedBy: 'system-data' }, // #3355: was 'system'
  { name: 'sys_audit_log', managedBy: 'append-only' },
  { name: 'sys_sharing_rule', managedBy: 'config' },
  { name: 'sys_no_bucket' }, // unset
];

describe('applyManagedWriteDenies (#3325)', () => {
  it('injects a read-only-write deny for every better-auth object into the five target sets', () => {
    const sets = [
      set('organization_admin'),
      set(ORGANIZATION_ADMIN_NO_BYPASS), // #14029 — derived at module load, so it needs its own injection
      set('member_default'),
      set('viewer_readonly'),
      set(MCP_AGENT_PERMISSION_SET_WRITE),
    ];
    const res = applyManagedWriteDenies(sets, schemas);
    // 2 better-auth objects × 5 sets = 10 injections.
    expect(res.applied).toBe(10);
    expect(res.skippedExisting).toBe(0);
    for (const s of sets) {
      expect(s.objects.sys_user).toEqual(DENY);
      expect(s.objects.sys_sso_provider).toEqual(DENY);
    }
  });

  it('hard-denies sys_user despite userActions.edit:true (permission-set booleans cannot whitelist fields)', () => {
    const s = set('member_default');
    applyManagedWriteDenies([s], schemas);
    expect(s.objects.sys_user).toEqual(DENY);
    expect(s.objects.sys_user.allowEdit).toBe(false);
  });

  it('ignores platform / config / system-data / append-only / unset buckets (pins the ADR-0103 deferral)', () => {
    const s = set('member_default');
    applyManagedWriteDenies([s], schemas);
    for (const name of ['crm_lead', 'sys_setting', 'sys_audit_log', 'sys_sharing_rule', 'sys_no_bucket']) {
      expect(s.objects[name]).toBeUndefined();
    }
  });

  it('never touches admin_full_access or the MCP read/restricted sets', () => {
    const admin = set('admin_full_access', { '*': { allowRead: true, allowCreate: true } });
    const mcpRead = set(MCP_AGENT_PERMISSION_SET_READ, { '*': { allowRead: true } });
    const res = applyManagedWriteDenies([admin, mcpRead], schemas);
    expect(res.applied).toBe(0);
    expect(admin.objects).toEqual({ '*': { allowRead: true, allowCreate: true } });
    expect(mcpRead.objects.sys_user).toBeUndefined();
  });

  it('never overrides an existing explicit entry (protects the org-admin RBAC block / static baseline)', () => {
    // Mirror org-admin: sys_user already carved out read-only; keep it verbatim.
    const existing = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false, viewAllRecords: true };
    const s = set('organization_admin', { sys_user: existing });
    const res = applyManagedWriteDenies([s], schemas);
    expect(s.objects.sys_user).toBe(existing); // same reference, untouched (viewAllRecords preserved)
    expect(res.skippedExisting).toBe(1); // sys_user skipped
    expect(res.applied).toBe(1); // sys_sso_provider injected
    expect(s.objects.sys_sso_provider).toEqual(DENY);
  });

  it('is idempotent — a second apply injects nothing', () => {
    const s = set('viewer_readonly');
    const first = applyManagedWriteDenies([s], schemas);
    const second = applyManagedWriteDenies([s], schemas);
    expect(first.applied).toBe(2);
    expect(second.applied).toBe(0);
    expect(second.skippedExisting).toBe(2);
  });

  it('injects a distinct object per entry (no shared reference across tables)', () => {
    const s = set('member_default');
    applyManagedWriteDenies([s], schemas);
    expect(s.objects.sys_user).not.toBe(s.objects.sys_sso_provider);
    expect(s.objects.sys_user).not.toBe(MANAGED_DENY_ENTRY);
  });

  it('tolerates empty / malformed input', () => {
    expect(applyManagedWriteDenies([], schemas)).toEqual({ applied: 0, skippedExisting: 0 });
    expect(applyManagedWriteDenies([set('member_default')], [])).toEqual({ applied: 0, skippedExisting: 0 });
    // a target set with no objects map is skipped, not thrown on
    expect(() => applyManagedWriteDenies([{ name: 'member_default' } as any], schemas)).not.toThrow();
  });

  it('the target allowlist is exactly the five known sets (see the independent-property pin for the floor)', () => {
    // Exact membership record. This is deliberately NOT the only pin on the
    // list: `objects/default-permission-sets.test.ts` derives the required
    // floor ("holds a write-granting '*' wildcard") from the real default sets
    // and diffs it against this list, so a set that SHOULD be a member cannot
    // hide behind an assertion that only restates the list (#14029).
    expect([...MANAGED_DENY_TARGET_SETS].sort()).toEqual(
      [
        'member_default',
        'organization_admin',
        ORGANIZATION_ADMIN_NO_BYPASS,
        'viewer_readonly',
        MCP_AGENT_PERMISSION_SET_WRITE,
      ].sort(),
    );
  });
});
