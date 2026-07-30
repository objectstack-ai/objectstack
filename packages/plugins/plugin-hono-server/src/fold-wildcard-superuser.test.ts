// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { foldWildcardSuperUser, clampManagedObjectWrites, type ManagedSchemaLike } from './current-user-endpoints.js';

/**
 * ADR-0057 D10 / ADR-0092 D5 — the `/me/permissions` per-object FLS map must
 * mirror the server's actual enforcement, which grants writes via a `'*'`
 * modifyAll super-user bypass regardless of another set's explicit per-object
 * deny (most-permissive merge, no deny-wins).
 */
describe('foldWildcardSuperUser', () => {
  it('lifts an explicit per-object deny when the wildcard is a modifyAll super-user grant', () => {
    const objects: Record<string, any> = {
      '*': { allowRead: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true },
      // As produced when admin_full_access ('*') composes with organization_admin
      // (explicit sys_user deny) — the naive merge leaves allowEdit:false.
      sys_user: { allowRead: true, allowEdit: false, allowCreate: false, allowDelete: false },
    };
    foldWildcardSuperUser(objects);
    expect(objects.sys_user).toMatchObject({ allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true });
    // The wildcard entry itself is untouched.
    expect(objects['*'].modifyAllRecords).toBe(true);
  });

  it('viewAll-only wildcard lifts read but NOT write', () => {
    const objects: Record<string, any> = {
      '*': { allowRead: true, viewAllRecords: true },
      sys_session: { allowRead: false, allowEdit: false },
    };
    foldWildcardSuperUser(objects);
    expect(objects.sys_session.allowRead).toBe(true);
    expect(objects.sys_session.allowEdit).toBe(false);
  });

  it('no-ops when the wildcard is not a super-user grant', () => {
    const objects: Record<string, any> = {
      '*': { allowRead: true, allowEdit: true }, // plain allow, no view/modifyAll
      sys_user: { allowRead: true, allowEdit: false },
    };
    foldWildcardSuperUser(objects);
    expect(objects.sys_user.allowEdit).toBe(false); // untouched — no super-user bypass
  });

  it('no-ops when there is no wildcard entry', () => {
    const objects: Record<string, any> = { sys_user: { allowEdit: false } };
    foldWildcardSuperUser(objects);
    expect(objects.sys_user.allowEdit).toBe(false);
  });
});

/**
 * ADR-0092 D2 / ADR-0103 — the engine write guards are a second enforcement
 * layer the permission sets don't model. The client hint must reflect
 * permission ∩ guard: guarded (`better-auth`, and now engine-owned
 * `system`/`append-only`) objects are user-context-writable only where the
 * object opened the affordance via `userActions`; `config`/`platform` are
 * untouched.
 */
describe('clampManagedObjectWrites', () => {
  const SCHEMAS: Record<string, ManagedSchemaLike> = {
    sys_user: { managedBy: 'better-auth', userActions: { edit: true } },
    sys_member: { managedBy: 'better-auth' },
    sys_session: { managedBy: 'better-auth' },
    // ADR-0103: explicit engine-owned bucket → guarded (clamped).
    sys_automation_run: { managedBy: 'engine-owned' },
    // ADR-0103: a `system` object with no userActions still resolves locked → guarded.
    sys_notification_receipt: { managedBy: 'system' },
    // ADR-0103: system that opened its writes → writable set → NOT clamped.
    sys_user_position: { managedBy: 'system', userActions: { create: true, edit: true, delete: true } },
    crm_lead: { managedBy: 'platform' },
  };
  const schemaOf = (n: string) => SCHEMAS[n];

  it('keeps write on a managed object that opened the edit affordance (sys_user)', () => {
    const objects: Record<string, any> = { sys_user: { allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true } };
    clampManagedObjectWrites(objects, schemaOf);
    // edit opted-in stays; create/delete were NOT opted in → clamped off.
    expect(objects.sys_user).toMatchObject({ allowRead: true, allowEdit: true, allowCreate: false, allowDelete: false });
  });

  it('clamps write to false on managed objects the guard blocks (sys_member, sys_session)', () => {
    const objects: Record<string, any> = {
      sys_member: { allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true },
      sys_session: { allowRead: true, allowEdit: true },
    };
    clampManagedObjectWrites(objects, schemaOf);
    expect(objects.sys_member).toMatchObject({ allowRead: true, allowEdit: false, allowCreate: false, allowDelete: false });
    expect(objects.sys_session.allowEdit).toBe(false);
    expect(objects.sys_session.allowRead).toBe(true); // read never clamped
  });

  it('clamps engine-owned + locked-system objects (ADR-0103) but leaves config/platform untouched', () => {
    const objects: Record<string, any> = {
      sys_automation_run: { allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true },
      sys_notification_receipt: { allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true },
      crm_lead: { allowEdit: true },
    };
    clampManagedObjectWrites(objects, schemaOf);
    // explicit engine-owned bucket → writes clamped off; read kept.
    expect(objects.sys_automation_run).toMatchObject({ allowRead: true, allowEdit: false, allowCreate: false, allowDelete: false });
    // locked `system` (no userActions) → also clamped.
    expect(objects.sys_notification_receipt).toMatchObject({ allowEdit: false, allowCreate: false, allowDelete: false });
    // platform bucket → not guarded → untouched.
    expect(objects.crm_lead.allowEdit).toBe(true);
  });

  it('leaves the writable system set untouched (userActions opened the writes)', () => {
    const objects: Record<string, any> = {
      sys_user_position: { allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true },
    };
    clampManagedObjectWrites(objects, schemaOf);
    expect(objects.sys_user_position).toMatchObject({ allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true });
  });

  it('treats the #2614 object form by its enabled flag only (predicates are UI gating, not a grant)', () => {
    const schemas: Record<string, ManagedSchemaLike> = {
      sys_user: {
        managedBy: 'better-auth',
        userActions: { edit: { enabled: true, disabledWhen: 'record.frozen == true' } as never },
      },
      sys_account: {
        managedBy: 'better-auth',
        // enabled omitted → NOT an explicit opt-in; the clamp stays fail-closed.
        userActions: { edit: { disabledWhen: 'record.frozen == true' } as never },
      },
    };
    const objects: Record<string, any> = {
      sys_user: { allowEdit: true },
      sys_account: { allowEdit: true },
    };
    clampManagedObjectWrites(objects, (n) => schemas[n]);
    expect(objects.sys_user.allowEdit).toBe(true);
    expect(objects.sys_account.allowEdit).toBe(false);
  });

  it('fold + clamp compose to permission ∩ guard for a platform admin', () => {
    // As produced for a platform admin (admin_full_access '*' modifyAll) who
    // also holds organization_admin (explicit managed denies).
    const objects: Record<string, any> = {
      '*': { allowRead: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true },
      sys_user: { allowRead: true, allowEdit: false, allowCreate: false, allowDelete: false },
      sys_member: { allowRead: true, allowEdit: false, allowCreate: false, allowDelete: false },
    };
    foldWildcardSuperUser(objects);
    clampManagedObjectWrites(objects, schemaOf);
    expect(objects.sys_user.allowEdit).toBe(true);   // opened + admin → editable
    expect(objects.sys_member.allowEdit).toBe(false); // guard blocks → not editable
    expect(objects.sys_member.allowRead).toBe(true);  // read still granted by super-user
  });
});
