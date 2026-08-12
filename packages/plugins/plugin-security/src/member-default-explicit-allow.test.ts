// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5491] The platform baseline is EXPLICIT-ALLOW: `member_default` ships no
// `'*'` object grant.
//
// The measured defect (HotCRM 17.0 GA sweep, 188 probes, 5 profiles × 17
// objects, `@objectstack/*` 17.0.0-rc.2): `member_default` carried
// `object_permissions['*'] = {allowCreate, allowRead, allowEdit}` and is
// union-merged (most-permissive) into every org member, so an application's
// explicit-allow object gate was erased on three axes. 21 of 21 create-DENIAL
// probes returned 201; a `service_agent` profile that declares no edit anywhere
// edited its own `crm_account`; on `public_read` objects a non-holder read ALL
// rows. `security/explain` stated it outright for a profile carrying an
// all-false deny: "create on 'crm_opportunity' is granted by [member_default]".
//
// Maintainer ruling (2026-08-07, issue comment 5219845380): remove the wildcard
// on all three live axes; the baseline narrows to explicit-allow, and object
// access comes from OWDs plus profile / permission-set declarations only.
// Deny-precedence merge semantics were considered and REJECTED — these cases
// must never be "fixed" by giving a deny priority over the union.
//
// The evaluator is exercised through its REAL merge (`checkObjectPermission`
// over the real seed), because the union is the mechanism at fault: pinning the
// seed's shape alone would stay green if a wildcard came back from anywhere
// else in the baseline.
import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator.js';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { defaultPermissionSets, BETTER_AUTH_MANAGED_OBJECTS } from './objects/default-permission-sets.js';

const evaluator = new PermissionEvaluator();
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/** The app object at the centre of the report. */
const APP_OBJECT = 'crm_opportunity';

/** A profile that DECLARES an explicit all-false deny — the erased gate. */
const DENYING_PROFILE: PermissionSet = PermissionSetSchema.parse({
  name: 'service_agent',
  objects: {
    [APP_OBJECT]: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});

/** A profile that DECLARES access — the positive control per axis. */
const GRANTING_PROFILE: PermissionSet = PermissionSetSchema.parse({
  name: 'sales_rep',
  objects: {
    [APP_OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

/** Operations, one per axis the ruling names, plus the axis already correct. */
const AXES = [
  { axis: 'read', operation: 'find' },
  { axis: 'create', operation: 'insert' },
  { axis: 'edit', operation: 'update' },
  { axis: 'delete', operation: 'delete' },
] as const;

const allows = (operation: string, sets: PermissionSet[], objectName = APP_OBJECT, isPrivate = false) =>
  evaluator.checkObjectPermission(operation, objectName, sets, { isPrivate });

describe('[#5491] `member_default` ships no wildcard object grant', () => {
  it('has no `*` key at all — not a narrowed one, not a false-valued one', () => {
    expect(Object.keys(MEMBER_DEFAULT.objects ?? {})).not.toContain('*');
  });

  it('every entry it does ship NAMES its object (explicit-allow, no sentinels)', () => {
    for (const key of Object.keys(MEMBER_DEFAULT.objects ?? {})) {
      expect(key, 'no wildcard or glob sentinels').not.toMatch(/\*/);
    }
  });
});

describe('[#5491] the baseline no longer erases an app-declared object gate', () => {
  it.each(AXES)('$axis: the baseline ALONE grants nothing on an app object', ({ operation }) => {
    expect(allows(operation, [MEMBER_DEFAULT])).toBe(false);
  });

  it.each(AXES)(
    '$axis: an explicit all-false profile stays denied once the baseline is union-merged in',
    ({ operation }) => {
      // This is the exact merge that produced "granted by [member_default]".
      expect(allows(operation, [DENYING_PROFILE, MEMBER_DEFAULT])).toBe(false);
    },
  );

  it.each(AXES)('$axis: a profile that DECLARES the grant still works (positive probe)', ({ operation }) => {
    expect(allows(operation, [GRANTING_PROFILE, MEMBER_DEFAULT])).toBe(true);
  });

  it('an object no set mentions is denied on every axis (the `public_read` all-rows leak)', () => {
    for (const { operation } of AXES) {
      expect(allows(operation, [GRANTING_PROFILE, MEMBER_DEFAULT], 'crm_account')).toBe(false);
    }
  });

  it('the delete axis is unchanged — it was already profile-driven before this change', () => {
    expect(allows('delete', [MEMBER_DEFAULT])).toBe(false);
    expect(allows('delete', [GRANTING_PROFILE, MEMBER_DEFAULT])).toBe(true);
  });
});

describe('[#5491] what the baseline still declares, it still enforces', () => {
  it('better-auth identity tables stay READABLE for a member with no app profile', () => {
    for (const object of BETTER_AUTH_MANAGED_OBJECTS) {
      expect(allows('find', [MEMBER_DEFAULT], object), `${object} readable`).toBe(true);
    }
  });

  it('better-auth identity tables stay WRITE-DENIED (the door is better-auth, not CRUD)', () => {
    for (const object of BETTER_AUTH_MANAGED_OBJECTS) {
      expect(allows('insert', [MEMBER_DEFAULT], object), `${object} insert`).toBe(false);
      expect(allows('update', [MEMBER_DEFAULT], object), `${object} update`).toBe(false);
      expect(allows('delete', [MEMBER_DEFAULT], object), `${object} delete`).toBe(false);
    }
  });

  it('self-service preferences survive the wildcard removal as an EXPLICIT grant', () => {
    // `sys_user_preference` is not a better-auth table, so the managed-deny
    // block does not cover it, and its `sys_user_preference_self` RLS policy
    // (`operation: 'all'`) declares that a member reads and writes their own
    // rows. Under the wildcard that grant was implicit; it is now named.
    expect(allows('find', [MEMBER_DEFAULT], 'sys_user_preference')).toBe(true);
    expect(allows('insert', [MEMBER_DEFAULT], 'sys_user_preference')).toBe(true);
    expect(allows('update', [MEMBER_DEFAULT], 'sys_user_preference')).toBe(true);
    expect(allows('delete', [MEMBER_DEFAULT], 'sys_user_preference')).toBe(false);
    const policy = (MEMBER_DEFAULT.rowLevelSecurity ?? [])
      .find((p) => p.name === 'sys_user_preference_self');
    expect(policy, 'the RLS carve-out that scopes it is still shipped').toBeTruthy();
    expect(policy!.using).toBe('user_id == current_user.id');
  });

  it('the owner-scoped write RLS is untouched — object bits moved, row policies did not', () => {
    const names = (MEMBER_DEFAULT.rowLevelSecurity ?? []).map((p) => p.name);
    expect(names).toContain('owner_only_writes');
    expect(names).toContain('owner_only_deletes');
  });

  it('the set stays anchor-safe for `everyone` (ADR-0090 D5 / #2753)', () => {
    // Removing a grant can only narrow, but the bootstrap binds this set to the
    // anchor and an anchor-forbidden bit makes the whole baseline unbindable.
    for (const perm of Object.values(MEMBER_DEFAULT.objects ?? {}) as any[]) {
      expect(perm.allowDelete ?? false).toBe(false);
      expect(perm.allowExport ?? false).toBe(false);
      expect(perm.viewAllRecords ?? false).toBe(false);
      expect(perm.modifyAllRecords ?? false).toBe(false);
    }
  });
});

// [#7344] Maintainer ruling (2026-08-11): extend `member_default` with
// owner-scoped READ grants for `sys_inbox_message` and
// `sys_notification_receipt`, RLS-scoped to the caller. `sys_activity` is
// deliberately NOT included — it is not a per-user-scoped shape.
//
// The measured defect: the Account app declares a Notifications nav entry with
// `requiresObject: 'sys_inbox_message'` and no `requiredPermissions`, so every
// authenticated member can reach the app but no shipped set named the object —
// `[Security] Access denied: operation 'find' on object 'sys_inbox_message'`.
//
// This mirrors the `sys_user_preference` precedent above: an explicit object
// grant PLUS a `_self` RLS policy, because the grant alone would be org-wide.
// Both halves are asserted here — the read bit is worthless if the scoping is
// missing, and the scoping is what makes the grant safe to ship on the
// `everyone` anchor.
const INBOX_OBJECTS = ['sys_inbox_message', 'sys_notification_receipt'] as const;

const MEMBER = { userId: 'u_member', tenantId: 'org_1', positions: ['org_member'] } as any;
const rls = new RLSCompiler();

/** The policies `member_default` contributes for one object × operation. */
const policiesFor = (object: string, operation: string) =>
  (MEMBER_DEFAULT.rowLevelSecurity ?? []).filter(
    (p: any) => (p.object === object || p.object === '*') && (p.operation === operation || p.operation === 'all'),
  );

describe('[#7344] the personal inbox is readable by a member, scoped to their own rows', () => {
  it.each(INBOX_OBJECTS)('%s: the baseline NAMES it, so a member with no app profile can read', (object) => {
    expect(allows('find', [MEMBER_DEFAULT], object)).toBe(true);
  });

  it.each(INBOX_OBJECTS)('%s: the grant is READ-ONLY — the writer is the inbox channel, not the member', (object) => {
    expect(allows('insert', [MEMBER_DEFAULT], object), `${object} insert`).toBe(false);
    expect(allows('update', [MEMBER_DEFAULT], object), `${object} update`).toBe(false);
    expect(allows('delete', [MEMBER_DEFAULT], object), `${object} delete`).toBe(false);
  });

  it.each(INBOX_OBJECTS)('%s: a read is RLS-narrowed to the caller — another user\'s rows are unreachable', (object) => {
    const policies = policiesFor(object, 'select');
    expect(policies.map((p: any) => p.name)).toEqual([`${object}_self`]);
    const filter = rls.compileFilter(policies as any, MEMBER);
    // The scoping is a positive `user_id` equality, not a fail-closed sentinel:
    // the member sees their own rows and ONLY their own. A row belonging to
    // another user cannot satisfy this filter, which is the "cannot read another
    // user's rows" half of the ruling.
    expect(filter).not.toBeNull();
    expect(filter).not.toEqual(RLS_DENY_FILTER);
    expect(filter).toEqual({ user_id: 'u_member' });
  });

  it.each(INBOX_OBJECTS)('%s: an anonymous/unidentified caller fails CLOSED, not open', (object) => {
    // No `current_user.id` to compile against ⇒ the sentinel, i.e. zero rows.
    expect(rls.compileFilter(policiesFor(object, 'select') as any, {} as any)).toEqual(RLS_DENY_FILTER);
  });

  it('`sys_activity` is deliberately NOT granted — the ruling excludes it', () => {
    // Named as an explicit negative so a future "while we are here" sweep has to
    // argue with the ruling rather than quietly widen past it. It is not a
    // per-user-scoped shape; a separate question if it ever matters.
    for (const { operation } of AXES) {
      expect(allows(operation, [MEMBER_DEFAULT], 'sys_activity'), `sys_activity ${operation}`).toBe(false);
    }
    const names = (MEMBER_DEFAULT.rowLevelSecurity ?? []).map((p: any) => p.name);
    expect(names).not.toContain('sys_activity_self');
  });

  it('the additions stay anchor-safe and explicit (no wildcard crept in with them)', () => {
    for (const object of INBOX_OBJECTS) {
      const perm = (MEMBER_DEFAULT.objects as any)[object];
      expect(perm, `${object} is named`).toBeTruthy();
      expect(perm.allowDelete ?? false).toBe(false);
      expect(perm.allowExport ?? false).toBe(false);
      expect(perm.viewAllRecords ?? false).toBe(false);
      expect(perm.modifyAllRecords ?? false).toBe(false);
    }
    expect(Object.keys(MEMBER_DEFAULT.objects ?? {})).not.toContain('*');
  });
});

describe('[#5491] the admin sets keep their wildcards (this is a BASELINE change only)', () => {
  it.each(['admin_full_access', 'organization_admin', 'viewer_readonly'])(
    '%s still carries a `*` entry',
    (name) => {
      const set = defaultPermissionSets.find((p) => p.name === name)!;
      expect(set, `${name} is shipped`).toBeTruthy();
      expect(Object.keys(set.objects ?? {})).toContain('*');
    },
  );

  it('viewer_readonly is read-only, unchanged — its wildcard is a CEILING, not a floor', () => {
    // The distinction that makes removing one wildcard and keeping the other
    // coherent: `viewer_readonly` is granted deliberately to a principal, while
    // `member_default` resolved additively for EVERY member.
    const viewer = defaultPermissionSets.find((p) => p.name === 'viewer_readonly')!;
    const wildcard = (viewer.objects as any)['*'];
    expect(wildcard.allowRead).toBe(true);
    expect(wildcard.allowCreate).toBe(false);
    expect(wildcard.allowEdit).toBe(false);
    expect(wildcard.allowDelete).toBe(false);
  });
});
