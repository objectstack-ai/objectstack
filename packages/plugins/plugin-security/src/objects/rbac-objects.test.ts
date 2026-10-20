// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { SysUserPermissionSet, SysUserPosition, defaultPermissionSets } from './index.js';
import { DelegatedAdminGate } from '../delegated-admin-gate.js';
import { bindTestSecurityCatalog } from '../__tests__/security-catalog.testkit.js';

/**
 * RBAC object + default-permission-set assertions. Moved here with the objects
 * from `@objectstack/platform-objects` (ADR-0029 K2) — the plugin that owns the
 * data owns its tests.
 */
describe('default permission sets', () => {
  it('exposes the canonical platform permission sets + the ADR-0090 D10 agent ceilings', () => {
    const names = defaultPermissionSets.map((p) => p.name).sort();
    expect(names).toEqual([
      'admin_full_access',
      // [ADR-0090 D10] MCP agent capability ceilings (scope-derived; one side
      // of the agent∩user intersection). Never bound to a position/anchor.
      'mcp_agent_data_read',
      'mcp_agent_data_write',
      'mcp_agent_restricted',
      'member_default',
      'organization_admin',
      // [ADR-0105 D4] The wall-less variant of `organization_admin`, DERIVED
      // from it by dropping the wildcard viewAllRecords/modifyAllRecords bits.
      // Granted by `auto-org-admin-grant` when the posture enforces no
      // organization wall, where nothing would bound them (finding F2).
      'organization_admin_no_bypass',
      'viewer_readonly',
    ]);
  });

  it('the MCP agent ceiling sets carry pure CRUD bits and NO row-level security', () => {
    const read = defaultPermissionSets.find((p) => p.name === 'mcp_agent_data_read')!;
    const write = defaultPermissionSets.find((p) => p.name === 'mcp_agent_data_write')!;
    const restricted = defaultPermissionSets.find((p) => p.name === 'mcp_agent_restricted')!;
    expect(read.rowLevelSecurity ?? []).toEqual([]);
    expect(write.rowLevelSecurity ?? []).toEqual([]);
    // Read-only: read yes, write no.
    expect(read.objects?.['*']?.allowRead).toBe(true);
    expect(read.objects?.['*']?.allowEdit ?? false).toBe(false);
    expect(read.objects?.['*']?.allowCreate ?? false).toBe(false);
    // Write ceiling: full CRUD on the wildcard.
    expect(write.objects?.['*']?.allowEdit).toBe(true);
    expect(write.objects?.['*']?.allowDelete).toBe(true);
    // Restricted floor: no wildcard object grant at all (fail-closed).
    expect(restricted.objects?.['*']).toBeUndefined();
    // None of the agent ceilings carry high-privilege system permissions.
    for (const s of [read, write, restricted]) {
      expect(s.systemPermissions ?? []).toEqual([]);
    }
  });

  it('organization_admin has setup.access but not studio.access / manage_metadata / manage_platform_settings', () => {
    const orgAdmin = defaultPermissionSets.find((p) => p.name === 'organization_admin')!;
    const sys = orgAdmin.systemPermissions ?? [];
    expect(sys).toContain('setup.access');
    expect(sys).toContain('manage_org_users');
    expect(sys).not.toContain('studio.access');
    expect(sys).not.toContain('manage_metadata');
    expect(sys).not.toContain('manage_platform_settings');
  });

  // [ADR-0090 D12, amended 2026-10-17] The boundary pin. The overrides open
  // create and remove on both assignment tables and keep edit closed; what an
  // org admin may create there is decided by the delegated-administration
  // gate, judged here against the sets this package actually ships.
  it('organization_admin creates and removes assignment rows, never edits them — both variants', () => {
    for (const name of ['organization_admin', 'organization_admin_no_bypass']) {
      const set = defaultPermissionSets.find((p) => p.name === name)!;
      for (const obj of ['sys_user_permission_set', 'sys_user_position']) {
        const perms = (set.objects as any)[obj];
        expect(perms, `${name}.${obj} explicit perms missing`).toBeDefined();
        expect([perms.allowRead, perms.allowCreate, perms.allowEdit, perms.allowDelete], `${name}.${obj}`)
          .toEqual([true, true, false, true]);
      }
    }
  });

  describe('the organization boundary over the shipped sets', () => {
    const ADMIN_SCOPED = {
      name: 'qa_delegated_admin',
      objects: {},
      adminScope: { businessUnit: 'hq', includeSubtree: true, manageAssignments: true, assignablePermissionSets: [] },
    };
    const PLATFORM_CAPABLE = { name: 'qa_platform_capable', objects: {}, systemPermissions: ['manage_users'] };
    const ORG_CAPABLE = { name: 'qa_org_capable', objects: {}, systemPermissions: ['manage_org_users'] };

    function harness(orgAdminSet: string) {
      const ql: any = { async find() { return []; }, async findOne() { return null; } };
      bindTestSecurityCatalog(ql, {
        permissions: [...defaultPermissionSets, ADMIN_SCOPED, PLATFORM_CAPABLE, ORG_CAPABLE] as any,
        positions: [
          { name: 'qa_platform_seat', permissionSets: [ADMIN_FULL_ACCESS] },
          { name: 'qa_member_seat', permissionSets: ['member_default'] },
        ],
        capabilities: PLATFORM_CAPABILITIES as any,
      });
      const orgAdmin = defaultPermissionSets.find((p) => p.name === orgAdminSet)!;
      const gate = new DelegatedAdminGate({ ql, resolveSets: async () => [orgAdmin] });
      const ctx = { userId: 'u_org_admin', tenantId: 'org_a', permissions: [orgAdminSet] };
      const grant = (setName: string, userId: string) => gate.assert({
        object: 'sys_user_permission_set', operation: 'insert',
        data: { user_id: userId, permission_set: setName }, context: ctx,
      });
      const assign = (position: string, userId: string) => gate.assert({
        object: 'sys_user_position', operation: 'insert',
        data: { user_id: userId, position }, context: ctx,
      });
      return { grant, assign };
    }

    async function refusal(run: () => Promise<unknown>): Promise<any> {
      try { await run(); } catch (e) { return e; }
      throw new Error('expected the write to be refused, but it was admitted');
    }

    for (const orgAdminSet of ['organization_admin', 'organization_admin_no_bypass']) {
      it(`${orgAdminSet}: admin_full_access, an adminScope set and a platform-capability set are refused — to anyone, itself included`, async () => {
        const h = harness(orgAdminSet);
        const cases: Array<[string, RegExp]> = [
          [ADMIN_FULL_ACCESS, /outside the organization boundary by name/],
          ['qa_delegated_admin', /condition \(b\)/],
          ['qa_platform_capable', /condition \(c\).*'manage_users'/],
          ['organization_admin', /outside the organization boundary by name/],
          ['organization_admin_no_bypass', /outside the organization boundary by name/],
        ];
        for (const [setName, why] of cases) {
          for (const userId of ['u_org_admin', 'u_member']) {
            const err = await refusal(() => h.grant(setName, userId));
            expect([err.code, err.status], `${setName} → ${userId}`).toEqual(['PERMISSION_DENIED', 403]);
            expect(err.message, `${setName} → ${userId}`).toContain(`'${setName}'`);
            expect(err.message, `${setName} → ${userId}`).toMatch(why);
          }
        }
        // …and a position that carries admin_full_access, likewise.
        const err = await refusal(() => h.assign('qa_platform_seat', 'u_org_admin'));
        expect([err.code, err.status]).toEqual(['PERMISSION_DENIED', 403]);
        expect(err.message).toMatch(/position 'qa_platform_seat' carries permission set 'admin_full_access'/);
      });

      it(`${orgAdminSet}: CONTROL — member_default, viewer_readonly and an org-capability set are inside`, async () => {
        const h = harness(orgAdminSet);
        for (const setName of ['member_default', 'viewer_readonly', 'qa_org_capable']) {
          await expect(h.grant(setName, 'u_member'), setName).resolves.toBeUndefined();
        }
        await expect(h.assign('qa_member_seat', 'u_member')).resolves.toBeUndefined();
      });
    }
  });

  it('admin_full_access grants wildcard CRUD with viewAll/modifyAll', () => {
    const admin = defaultPermissionSets.find((p) => p.name === 'admin_full_access')!;
    const wildcard = admin.objects['*'];
    expect(wildcard).toBeDefined();
    expect(wildcard.allowRead).toBe(true);
    expect(wildcard.allowCreate).toBe(true);
    expect(wildcard.allowEdit).toBe(true);
    expect(wildcard.allowDelete).toBe(true);
    expect(wildcard.viewAllRecords).toBe(true);
    expect(wildcard.modifyAllRecords).toBe(true);
  });

  it('member_default ships owner + better-auth self RLS policies; tenant wall is Layer 0 (ADR-0095 D1)', () => {
    const member = defaultPermissionSets.find((p) => p.name === 'member_default')!;
    const policyNames = (member.rowLevelSecurity ?? []).map((p) => p.name).sort();
    // [ADR-0095 D1] `tenant_isolation` RETIRED from the seed — the tenant wall is
    // now Layer 0 (`tenant-layer.ts`), not an OR-merged RLS policy. The remaining
    // policies are business RLS: owner-scoped writes + better-auth `_self` carve-outs.
    expect(policyNames).toEqual([
      'owner_only_deletes',
      'owner_only_writes',
      'sys_api_key_self',
      // [ADR-0131 D7] The compliance ledger's organization scope on its
      // attribution field `tenant_id`: the ledger has no tenant column, so
      // Layer 0 is inert on it and this is the row scope for a ledger read any
      // set grants. Behaviour is pinned end to end in
      // `sys-audit-log-row-scope.test.ts`; this list only records presence.
      'sys_audit_log_org',
      // [commit c25b2d52a] The one DELETE-class per-object policy, and the only entry here
      // that widens rather than narrows. `owner_only_deletes` above is a
      // parent-blind second implementation of "who may remove this row", and on
      // `sys_comment` it was answering ahead of plugin-audit's
      // author-or-parent-editor gate — killing comment moderation in every
      // org-bound deployment. This contributes the alternate match; the gate
      // still decides. Maintainer-approved widening (2026-08-15), scoped to this
      // object: the wildcard floor above is deliberately unchanged.
      'sys_comment_moderation',
      'sys_device_code_self',
      // [#7344] The personal-inbox pair — not better-auth tables, but the same
      // `_self` shape for the same reason: no `organization_id`, so Layer 0 is
      // inert and these policies are the row scoping for their read grants.
      'sys_inbox_message_self',
      // [#8095] The invitation ledger's row scope. Keyed on `email`, not
      // `user_id`, because an invitation predates the account it invites — the
      // addressee is identified by address. Its object DOES carry
      // `organization_id`, so unlike the two above this is not "Layer 0 is
      // inert here": Layer 0 was engaged and correctly org-scoped, and the org
      // is precisely the audience the row must be hidden from.
      //
      // [#8240] `sys_invitation_issuer` is its sibling and the ONE entry in this
      // list that is not a `_self` shape: it keys on the OTHER end of the row
      // (`inviter_id`), so a `delegated_admin` can review the invitations it
      // issued. It sorts ahead of `_self` alphabetically; the pair is
      // deliberate, not a duplicate to be collapsed.
      'sys_invitation_issuer',
      'sys_invitation_self',
      // [#24164 E′ item 3] Absent by design: the row scope of the two
      // credential tables (`_none`), the seven SCIM projection tables and the
      // `select` self scope of `sys_account`, `sys_team_member` and the two
      // OAuth token tables. Each is now its object's own declared
      // `defaultRowScope`, which the collection applies where no held set
      // carries a policy — so a copy here would change no row and only move
      // explain back to this set. Behaviour is pinned end to end in
      // `shipped-sets-identity-default-row-scope.test.ts`,
      // `private-credential-row-scope.test.ts` and
      // `scim-projection-row-scope.test.ts`; this list only records presence.
      'sys_notification_receipt_self',
      'sys_oauth_application_self',
      'sys_oauth_consent_self',
      'sys_organization_self',
      'sys_session_self',
      'sys_two_factor_self',
      'sys_user_org_members',
      'sys_user_preference_self',
      'sys_user_self',
    ]);
    expect(policyNames).not.toContain('tenant_isolation');
    const orgSelf = (member.rowLevelSecurity ?? []).find((p) => p.name === 'sys_organization_self')!;
    expect(orgSelf.object).toBe('sys_organization');
    expect(orgSelf.using).toBe('id == current_user.organization_id');
    const sessionSelf = (member.rowLevelSecurity ?? []).find((p) => p.name === 'sys_session_self')!;
    expect(sessionSelf.object).toBe('sys_session');
    expect(sessionSelf.using).toBe('user_id == current_user.id');
  });

  it('viewer_readonly denies writes', () => {
    const viewer = defaultPermissionSets.find((p) => p.name === 'viewer_readonly')!;
    const wildcard = viewer.objects['*'];
    expect(wildcard.allowRead).toBe(true);
    expect(wildcard.allowCreate).toBe(false);
    expect(wildcard.allowEdit).toBe(false);
    expect(wildcard.allowDelete).toBe(false);
  });
});

describe('sys_user_permission_set — `delegated_from` is retired (#9730, ADR-0049)', () => {
  it('no longer declares `delegated_from` — the runtime delegation gate never read it here', () => {
    // Maintainer ruling 2026-08-18 (REMOVE): the delegation gate's
    // `isDelegationWrite` is structurally scoped to `sys_user_position`, so on
    // this object the column was declared and data-door-writable while no
    // runtime consumer read it — authoring-lint-only enforcement on a security
    // object. Re-declaring the key here without a runtime reader in the same
    // change is the exact defect the ruling removed; this pin makes that
    // re-growth loud.
    expect(SysUserPermissionSet.fields).not.toHaveProperty('delegated_from');
  });

  it('the ADR-0091 D3 declaration on the sibling `sys_user_position` is untouched', () => {
    // The ruling removes the UNENFORCED half only. Position-table delegation
    // stays declared AND enforced (delegated-admin gate, explain engine, lint).
    const f: any = (SysUserPosition.fields as any).delegated_from;
    expect(f).toBeDefined();
    expect(f.type).toBe('lookup');
    expect(f.reference).toBe('sys_user');
  });
});
