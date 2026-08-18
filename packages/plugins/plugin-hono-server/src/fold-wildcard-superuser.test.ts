// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { foldWildcardSuperUser, clampManagedObjectWrites, type ManagedSchemaLike } from './current-user-endpoints.js';

/**
 * Server enforces, client is courtesy (cited as ADR-0057 D10 — an attribution,
 * not a resolvable anchor, #9628) / ADR-0092 D5 — the `/me/permissions`
 * per-object FLS map must
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
 * permission ∩ guard: guarded (`better-auth`, and engine-owned
 * `engine-owned`/`append-only`) objects are user-context-writable only where the
 * object opened the affordance via `userActions`; `config`/`platform`/
 * `system-data` are untouched (#3355).
 */
describe('clampManagedObjectWrites', () => {
  const SCHEMAS: Record<string, ManagedSchemaLike> = {
    sys_user: { managedBy: 'better-auth', userActions: { edit: true } },
    sys_member: { managedBy: 'better-auth' },
    sys_session: { managedBy: 'better-auth' },
    // ADR-0103: explicit engine-owned bucket → guarded (clamped).
    sys_automation_run: { managedBy: 'engine-owned' },
    // ADR-0103: an engine-owned receipt row → guarded (clamped).
    sys_notification_receipt: { managedBy: 'engine-owned' },
    // #3355: was `system` + a `userActions` re-open block; now `system-data`,
    // a bucket no guard covers → still NOT clamped. See the equivalence pin below.
    sys_user_position: { managedBy: 'system-data' },
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

  it('leaves the writable platform-data set untouched (the bucket default grants the writes)', () => {
    const objects: Record<string, any> = {
      sys_user_position: { allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true },
    };
    clampManagedObjectWrites(objects, schemaOf);
    expect(objects.sys_user_position).toMatchObject({ allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true });
  });

  /**
   * #3355 equivalence pin for the `/me/permissions` hint.
   *
   * This clamp reads `userActions` DIRECTLY rather than the resolved affordances,
   * so removing `system` from GUARDED_WRITE_BUCKETS is load-bearing: had the
   * bucket stayed listed while the 8 objects legitimately dropped their now-
   * redundant `userActions` blocks, every one of them would report
   * `allowEdit: false` for tables the engine happily writes — the exact false
   * NEGATIVE this function exists to avoid, merely inverted.
   *
   * So: the answer must be identical for the v16 declaration shape (bucket
   * `system` + `userActions`) and the v17 one (bucket `system-data`, no
   * `userActions`), for all four flags, on the same input grant.
   */
  it('reports the same allowEdit/Create/Delete for the v16 and v17 declaration shapes', () => {
    const GRANT = { allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true };
    const v16Schemas: Record<string, ManagedSchemaLike> = {
      sys_user_position: { managedBy: 'system', userActions: { create: true, edit: true, delete: true } },
    };
    const v16: Record<string, any> = { sys_user_position: { ...GRANT } };
    const v17: Record<string, any> = { sys_user_position: { ...GRANT } };

    clampManagedObjectWrites(v16, (n) => v16Schemas[n]);
    clampManagedObjectWrites(v17, schemaOf);

    expect(v17.sys_user_position).toEqual(v16.sys_user_position);
    // …and that shared answer is "unclamped", not "both wrong the same way".
    expect(v17.sys_user_position).toMatchObject(GRANT);
  });

  /**
   * The inverted-failure pin: if `system-data` were (re-)added to
   * GUARDED_WRITE_BUCKETS, a v17-shaped declaration carrying no `userActions`
   * would clamp to read-only. This asserts the bucket is genuinely out of scope
   * by showing a userActions-less member keeps its writes.
   */
  it('does not clamp a `system-data` object that declares no userActions at all', () => {
    const objects: Record<string, any> = {
      sys_notification_template: { allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true },
    };
    clampManagedObjectWrites(objects, () => ({ managedBy: 'system-data' }) as ManagedSchemaLike);
    expect(objects.sys_notification_template).toMatchObject({
      allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true,
    });
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

  /**
   * #7692 widened `userActions.create` to the same boolean-or-object union, so
   * this clamp had to stop testing it with a bare `create !== true`. Without
   * that change an object opting the create affordance IN through the object
   * form would be clamped OFF here — a silent permission-hint tightening that
   * `edit`/`delete` beside it do not suffer. Read `create` the same way, with
   * the same fail-closed rule when `enabled` is omitted.
   */
  it('treats the #7692 create object form by its enabled flag only, like edit/delete', () => {
    const schemas: Record<string, ManagedSchemaLike> = {
      sys_user: {
        managedBy: 'better-auth',
        userActions: { create: { enabled: true, visibleWhen: 'record.status == "draft"' } as never },
      },
      sys_account: {
        managedBy: 'better-auth',
        // enabled omitted → NOT an explicit opt-in; the clamp stays fail-closed.
        userActions: { create: { visibleWhen: 'record.status == "draft"' } as never },
      },
    };
    const objects: Record<string, any> = {
      sys_user: { allowCreate: true },
      sys_account: { allowCreate: true },
    };
    clampManagedObjectWrites(objects, (n) => schemas[n]);
    expect(objects.sys_user.allowCreate).toBe(true);
    expect(objects.sys_account.allowCreate).toBe(false);
    // The bare boolean form is untouched by the widening.
    const boolObjects: Record<string, any> = { sys_user: { allowCreate: true }, sys_member: { allowCreate: true } };
    clampManagedObjectWrites(boolObjects, (n) => (
      n === 'sys_user'
        ? { managedBy: 'better-auth', userActions: { create: true } }
        : { managedBy: 'better-auth' }
    ));
    expect(boolObjects.sys_user.allowCreate).toBe(true);
    expect(boolObjects.sys_member.allowCreate).toBe(false);
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
