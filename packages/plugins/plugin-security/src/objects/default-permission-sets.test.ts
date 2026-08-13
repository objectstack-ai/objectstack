// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// #3325 — pin the better-auth managed-object deny-list against the real schemas
// so it can never silently drift again (ADR-0092: registry-driven, no rot).

import { describe, it, expect } from 'vitest';
import * as PlatformObjects from '@objectstack/platform-objects';
import { defaultPermissionSets, BETTER_AUTH_MANAGED_OBJECTS } from './default-permission-sets.js';
import { MANAGED_DENY_TARGET_SETS } from '../managed-object-write-denies.js';

// Every object schema the platform-objects package exports whose bucket is
// `better-auth` — the ground truth the static baseline must mirror.
const betterAuthSchemaNames = Object.values(PlatformObjects as Record<string, any>)
  .filter((v) => v && typeof v === 'object' && typeof v.name === 'string' && v.managedBy === 'better-auth')
  .map((v) => v.name as string)
  .sort();

const listNames = [...BETTER_AUTH_MANAGED_OBJECTS].sort();
const setByName = (name: string): any => defaultPermissionSets.find((s) => s.name === name);

describe('BETTER_AUTH_MANAGED_OBJECTS ↔ schemas (drift pin, #3325)', () => {
  it('found the better-auth identity schemas to compare against', () => {
    // Guard against a broken import silently passing the bidirectional check.
    expect(betterAuthSchemaNames.length).toBeGreaterThanOrEqual(20);
  });

  it('every listed name is a real object declaring managedBy:"better-auth"', () => {
    const notBetterAuth = listNames.filter((n) => !betterAuthSchemaNames.includes(n));
    expect(notBetterAuth).toEqual([]);
  });

  it('every better-auth schema is in the list (this is the drift that #3325 fixes)', () => {
    const missing = betterAuthSchemaNames.filter((n) => !listNames.includes(n));
    expect(missing).toEqual([]);
  });

  it('the list has no duplicates', () => {
    expect(listNames.length).toBe(new Set(listNames).size);
  });
});

/**
 * [#8053] The single, deliberate exception to the blanket managed-object edit
 * deny: `member_default` may EDIT `sys_api_key`, so a member can revoke their
 * own personal key. Bounded elsewhere and not by the permission-set boolean —
 * the `sys_api_key_self` RLS carve-out decides which rows, ADR-0092 D2's column
 * whitelist (`revoked` alone) decides which fields.
 *
 * Encoded as an exact (set, object) pair rather than by loosening the loop, so
 * a second entry — or the same one on another set — still fails this pin. The
 * create/delete/read axes are NOT excepted and are still asserted below.
 */
const EDIT_EXCEPTIONS = new Set(['member_default::sys_api_key']);

describe('default permission sets carry the managed denies (static baseline)', () => {
  it('each write-granting target set denies create/edit/delete on every managed object', () => {
    for (const setName of MANAGED_DENY_TARGET_SETS) {
      const set = setByName(setName);
      expect(set, `set ${setName} exists`).toBeTruthy();
      for (const obj of BETTER_AUTH_MANAGED_OBJECTS) {
        const entry = set.objects[obj];
        expect(entry, `${setName} has entry for ${obj}`).toBeTruthy();
        expect(entry.allowCreate).toBe(false);
        expect(entry.allowEdit, `${setName}.${obj} allowEdit`).toBe(
          EDIT_EXCEPTIONS.has(`${setName}::${obj}`),
        );
        expect(entry.allowDelete).toBe(false);
        expect(entry.allowRead).toBe(true);
      }
    }
  });

  it('the edit exception is exactly one (set, object) pair, and it is the API-key one', () => {
    // The exception list is itself pinned: a future widening has to edit THIS
    // assertion, which is the moment someone is asked whether the new pair
    // really rides an owner-scoping RLS policy and a column whitelist the way
    // `sys_api_key` does. Without this, `EDIT_EXCEPTIONS` could grow silently.
    expect([...EDIT_EXCEPTIONS]).toEqual(['member_default::sys_api_key']);

    const member = setByName('member_default');
    expect(member.objects.sys_api_key.allowEdit).toBe(true);
    // The owner scoping the grant leans on must exist, or the edit bit is
    // table-wide on a credential table.
    const selfPolicy = (member.rowLevelSecurity ?? []).find(
      (p: any) => p.object === 'sys_api_key' && p.name === 'sys_api_key_self',
    );
    expect(selfPolicy, 'member_default must keep the sys_api_key_self RLS carve-out').toBeTruthy();
    expect(selfPolicy.using).toBe('user_id == current_user.id');
    expect(['all', 'update']).toContain(selfPolicy.operation);
  });

  it('admin_full_access keeps its bare wildcard (zero per-object entries) — admin rescue path', () => {
    const admin = setByName('admin_full_access');
    expect(admin).toBeTruthy();
    expect(Object.keys(admin.objects)).toEqual(['*']);
  });
});

/**
 * [#8095] The `sys_invitation` row scope — a DELETION TRIPWIRE, not the proof.
 *
 * The proof that the narrowing works lives over HTTP, in
 * `packages/qa/dogfood/test/invitation-ledger-row-scope.dogfood.test.ts`: an
 * assertion whose expectation and reality both come from this module cannot
 * fail, so nothing here is evidence that a member is actually narrowed. What
 * this block does buy is the one thing the HTTP fixture cannot — it names the
 * predicate and the sets it must appear in, so removing a carve-out (or adding
 * a managed object to `BETTER_AUTH_MANAGED_OBJECTS` and assuming the blanket
 * read is safe for it) fails HERE, in the file being edited, instead of in a
 * suite the author may not run.
 *
 * The predicate is written out rather than imported for the same reason.
 */
describe('sys_invitation is row-scoped to its addressee (#8095)', () => {
  const SELF_PREDICATE = 'email == current_user.email';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const policiesFor = (setName: string, object: string): any[] =>
    (setByName(setName)?.rowLevelSecurity ?? []).filter((p: any) => p.object === object);

  it.each(['member_default', 'viewer_readonly'])(
    '%s scopes sys_invitation to the addressee — the blanket managed read is NOT the whole story',
    (setName) => {
      // The object-level read bit stays open: it is what makes the invitee's OWN
      // row reachable, and closing it would break the accept flow rather than
      // narrow it. The narrowing is the row predicate.
      expect(setByName(setName).objects.sys_invitation.allowRead).toBe(true);

      // Named, not counted: `member_default` gained the #8240 issuer sibling
      // and `viewer_readonly` did not, so an exact-array assertion over both
      // would have to encode that asymmetry and would go red for the wrong
      // reason. What each set must carry is the addressee scope; the issuer
      // policy has its own block below.
      const scoped = policiesFor(setName, 'sys_invitation');
      const self = scoped.find((p) => p.name === 'sys_invitation_self');
      expect(self, `${setName} must keep sys_invitation_self`).toBeTruthy();
      expect(self.using).toBe(SELF_PREDICATE);
      // Read the operation off THIS policy. The same-named carve-outs across
      // these sets do not all agree (`sys_api_key_self` is spelled three times
      // at two different operations), so a sibling's value is not evidence.
      expect(self.operation).toBe('select');
      expect(self.enabled).not.toBe(false);
      // The addressee scope is UNDOMAINED, and that is load-bearing: it is the
      // narrowing as well as the carve-out, so a `positions` domain on it would
      // mean "no matching position ⇒ no policy ⇒ no row filter at all" — the
      // wide read #8095 is about. Only the WIDENING policies carry a domain.
      expect(self.positions ?? []).toEqual([]);
      // No other set-level policy may quietly re-open the object here. Both
      // sets are capped at the addressee scope plus (member_default only) the
      // scope-bounded issuer sibling.
      expect(scoped.map((p) => p.name).sort()).toEqual(
        setName === 'member_default'
          ? ['sys_invitation_issuer', 'sys_invitation_self']
          : ['sys_invitation_self'],
      );
    },
  );

  it('organization_admin keeps the ORG-wide ledger — the ruling narrowed members, not admins', () => {
    // The other half of the ruling, and the half that is easy to get wrong:
    // `member_default` resolves for admins too, so the member-side scope reaches
    // them, and the two mechanisms that look like they already protect an admin
    // are both absent on the DEFAULT `single` posture — the `viewAllRecords`
    // short-circuit is withheld from `organization_admin_no_bypass` (ADR-0105
    // D4), and `sys_invitation_org` is stripped as a platform tenant policy when
    // org isolation is inactive (ADR-0105 D3). Only `sys_invitation_org_admin`
    // survives both, which is why it must be present on BOTH variants.
    for (const setName of ['organization_admin', 'organization_admin_no_bypass']) {
      const scoped = policiesFor(setName, 'sys_invitation');
      expect(scoped.map((p) => p.name).sort(), `${setName} sys_invitation policies`).toEqual([
        'sys_invitation_org',
        'sys_invitation_org_admin',
      ]);

      const admission = scoped.find((p) => p.name === 'sys_invitation_org_admin');
      // No tenant token — that is what keeps the strip from taking it.
      expect(admission.using).not.toContain('current_user.organization_id');
      expect(admission.using).toBe('id != null');
      // Domained to the org-administration identities, so it can only WIDEN.
      // A principal it does not match keeps the addressee scope and fails
      // closed; putting the domain on the narrowing instead would make "no
      // matching position" mean "no policy" — i.e. no row filter at all.
      expect(admission.positions.sort()).toEqual(['org_admin', 'org_owner']);
      expect(admission.operation).toBe('select');
    }
  });

  /**
   * [#8240] The issuer carve-out — again a TRIPWIRE, not the proof. The proof is
   * the four-persona matrix in the dogfood file, which is the only place the
   * ruled option and the rejected one look different over the wire.
   *
   * What this block adds that the HTTP matrix cannot: the matrix is blind to a
   * dropped `positions` domain (measured — mutation M3 of this card's ablation
   * left all four personas green, because only owner/admin/delegated_admin can
   * ever be an `inviter_id` and the first two already read everything). The
   * domain exists for the principal DEMOTED out of an administrative grade, a
   * state no fixture in this repo constructs. So it is pinned here, structurally.
   */
  it('member_default lets a delegated_admin read the invitations THEY issued — #8240, option C', () => {
    const issuer = policiesFor('member_default', 'sys_invitation').find(
      (p) => p.name === 'sys_invitation_issuer',
    );
    expect(issuer, 'member_default must carry the #8240 issuer carve-out').toBeTruthy();

    // The predicate IS the ruling. Option B — `delegated_admin` reads the whole
    // ledger — was REJECTED, and its shape (`id != null`, or anything else that
    // does not bind a row to this caller) passes every "the delegate can see an
    // invitation" assertion just as well. Written out rather than imported so
    // that editing the module cannot edit the expectation with it.
    expect(issuer.using).toBe('inviter_id == current_user.id');
    expect(issuer.using).toContain('current_user.id');
    expect(issuer.using).not.toBe('id != null');

    // Scope-bounded issuance is about the ISSUING GRADE, not about everyone who
    // ever held one. Without the domain a demoted ex-admin keeps a permanent
    // window onto what they issued.
    expect(issuer.positions).toEqual(['delegated_admin']);
    // The domain must not have silently acquired the admin identities — that is
    // option B wearing this policy's name, and it would widen the ledger's
    // audience exactly as the ruling refused.
    expect(issuer.positions).not.toContain('org_admin');
    expect(issuer.positions).not.toContain('org_owner');

    // Read-only, like every other policy on this object: the write classes are
    // closed at the object layer, by the ADR-0092 D2 identity write guard, and
    // by `apiMethods: ['get', 'list']`.
    expect(issuer.operation).toBe('select');
    expect(issuer.enabled).not.toBe(false);

    // Owner/admin visibility is UNCHANGED by this card — the ruling said so in
    // those words. Their admission still comes from `sys_invitation_org_admin`,
    // which must not have been touched to make the delegate's case work.
    for (const setName of ['organization_admin', 'organization_admin_no_bypass']) {
      const names = policiesFor(setName, 'sys_invitation').map((p) => p.name).sort();
      expect(names, `${setName} must be untouched by #8240`).toEqual([
        'sys_invitation_org',
        'sys_invitation_org_admin',
      ]);
    }
  });
});
