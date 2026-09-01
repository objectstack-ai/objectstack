// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// #3325 — pin the better-auth managed-object deny-list against the real schemas
// so it can never silently drift again (ADR-0092: registry-driven, no rot).

import { describe, it, expect } from 'vitest';
import * as PlatformObjects from '@objectstack/platform-objects';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';
import { defaultPermissionSets, BETTER_AUTH_MANAGED_OBJECTS } from './default-permission-sets.js';
import { applyManagedWriteDenies, MANAGED_DENY_TARGET_SETS } from '../managed-object-write-denies.js';

// Every object schema the platform-objects package exports whose bucket is
// `better-auth` — the ground truth the static baseline must mirror.
const betterAuthSchemaNames = Object.values(PlatformObjects as Record<string, any>)
  .filter((v) => v && typeof v === 'object' && typeof v.name === 'string' && v.managedBy === 'better-auth')
  .map((v) => v.name as string)
  .sort();

// `string[]`, not the literal union `BETTER_AUTH_MANAGED_OBJECTS` carries: this
// pin compares the list against names read off the shipped schemas, which are
// plain strings, and the comparison runs in BOTH directions. Left as the union,
// `listNames.includes(<a schema name>)` is a type error rather than the
// membership question the pin asks.
const listNames: string[] = [...BETTER_AUTH_MANAGED_OBJECTS].sort();
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

/**
 * [#8839] The `sys_comment` moderation carve-out — again a TRIPWIRE, not the
 * proof. The proof is over HTTP, in
 * `packages/qa/dogfood/test/comments-permission-matrix.dogfood.test.ts`, which
 * boots org-bound and arms itself: an assertion whose expectation and reality
 * both come from this module cannot fail, so nothing here shows that a
 * moderator can actually delete anything.
 *
 * What this block buys is what the HTTP matrix cannot see. The matrix is blind
 * to the `positions` DOMAIN — drop it and every case there stays green, because
 * every principal it constructs holds `org_member` anyway. The domain exists for
 * the principals the fixture does not build (an org-less session, an
 * `everyone`-only anchor), where an undomained twin would carry a `using` into a
 * delete class that is EMPTY today and thereby switch off #7665's
 * derive-from-select rule — handing those principals a WIDER delete scope than
 * they have now. So it is pinned here, structurally, next to the declaration.
 */
describe('sys_comment delete is moderation-shaped, not ownership-shaped (#8839)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const policiesFor = (setName: string, object: string): any[] =>
    (setByName(setName)?.rowLevelSecurity ?? []).filter((p: any) => p.object === object);

  it('member_default contributes the alternate match that stops the floor pre-empting the gate', () => {
    const scoped = policiesFor('member_default', 'sys_comment');
    expect(scoped.map((p) => p.name).sort()).toEqual(['sys_comment_moderation']);

    const [policy] = scoped;
    // The predicate IS the ruling, and its shape is deliberate: the
    // parent-editor limb lives on ANOTHER record (the one `thread_id` names)
    // and RLS has no join, so this policy contributes the alternate match and
    // plugin-audit's gate keeps deciding. Written out rather than imported so
    // that editing the module cannot edit the expectation with it.
    expect(policy.using).toBe('id != null');
    expect(policy.operation).toBe('delete');
    expect(policy.enabled).not.toBe(false);

    // The DOMAIN. Exactly the principals `owner_only_deletes` binds — no more.
    expect(policy.positions).toEqual(['org_member']);
  });

  it('the wildcard delete floor itself is untouched — the widening is scoped to sys_comment', () => {
    // ⛔ The ruling's explicit boundary. If this fails, the fix left the card:
    // the floor must still be a wildcard `created_by` policy over the same
    // domain, and `sys_comment` must be widened BESIDE it, never by loosening it.
    const floor = (setByName('member_default').rowLevelSecurity ?? []).find(
      (p: any) => p.name === 'owner_only_deletes',
    );
    expect(floor, 'member_default must keep the wildcard delete floor').toBeTruthy();
    expect(floor.object).toBe('*');
    expect(floor.operation).toBe('delete');
    expect(floor.using).toBe('created_by == current_user.id');
    expect(floor.positions).toEqual(['org_member']);

    // The update limb is deliberately NOT widened: #8839 ruled on delete, which
    // is the limb it measured. A `sys_comment` update policy appearing here is a
    // second access-widening riding in on this one's ruling.
    expect(policiesFor('member_default', 'sys_comment').map((p) => p.operation)).toEqual(['delete']);
  });

  it('no OTHER set quietly re-opens sys_comment', () => {
    // The carve-out belongs to the one set that ships the floor. `viewer_readonly`
    // and the admin sets must not have grown a twin — an admin already bypasses
    // Layer 1, and a read-only viewer holding a delete-class policy is nonsense
    // that would only ever be a mistake.
    for (const setName of ['viewer_readonly', 'admin_full_access', 'organization_admin', 'organization_admin_no_bypass']) {
      if (!setByName(setName)) continue;
      expect(policiesFor(setName, 'sys_comment'), `${setName} sys_comment policies`).toEqual([]);
    }
  });
});

/**
 * [#11965 / #11663 Choice 6A] platform-admin re-anchor, L1 behaviour-neutrality
 * pin.
 *
 * `admin_full_access`'s capability CONTENT moved to `@objectstack/spec`
 * (`ADMIN_FULL_ACCESS_CAPABILITIES`) and is IMPORTED here — one list, one copy.
 * L1 is ruled behaviour-neutral, so the parsed declaration must be deep-equal
 * to what the previously-inline literal produced. The literal below is the
 * exact pre-#11965 inline value (comments elided); if this pin fails, the spec
 * export changed the declared capability set — that is a capability change
 * riding on a refactor card, and it must not land silently.
 */
describe('admin_full_access imports the kernel capability declaration unchanged (#11965)', () => {
  it('parsed declaration deep-equals the pre-#11965 inline literal', () => {
    const preMove = PermissionSetSchema.parse({
      name: 'admin_full_access',
      label: 'Administrator — Full Access',
      objects: {
        '*': {
          allowRead: true,
          allowCreate: true,
          allowEdit: true,
          allowDelete: true,
          viewAllRecords: true,
          modifyAllRecords: true,
          // [#8681] no `allowExport` — deliberate, see the spec declaration.
        },
      },
      systemPermissions: [
        'manage_users',
        'manage_metadata',
        'manage_platform_settings',
        'manage_sharing',
        'setup.access',
        'setup.write',
        'studio.access',
      ],
    });
    expect(setByName('admin_full_access')).toEqual(preMove);
  });

  it('the imported spec constant is the declaration content — no local fork', () => {
    const admin = setByName('admin_full_access');
    // Same values, sourced from the one spec-exported copy.
    expect(admin.objects).toEqual(
      PermissionSetSchema.parse({ name: 'admin_full_access', ...ADMIN_FULL_ACCESS_CAPABILITIES }).objects,
    );
    expect(admin.systemPermissions).toEqual(ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions);
  });
});

/**
 * [#14029] The managed-deny target list, pinned against an INDEPENDENT
 * property instead of against itself.
 *
 * The old shape of this pin iterated `MANAGED_DENY_TARGET_SETS` to assert
 * membership, so it was structurally unable to see a set that SHOULD have been
 * a member — which is exactly how `organization_admin_no_bypass` (a shallow
 * copy of `organization_admin` taken at module load, write-granting wildcard
 * intact) sat outside the list while `applyManagedWriteDenies` walked it and
 * skipped it at `kernel:ready`. The floor is therefore derived here from the
 * REAL seeded sets — "holds a `'*'` wildcard granting any generic write
 * class" — and diffed against the list; a non-empty difference is red.
 */
describe('managed-deny targets — independent-property floor + registry union reaches the derived variant (#14029)', () => {
  // Derived from `defaultPermissionSets`, never from the list under test.
  // "Grants a write" in the evaluator's own terms: the three CRUD flags OR
  // `modifyAllRecords` — the super-user bypass grants edit/delete and the
  // destructive class by a second route (`MODIFY_ALL_WRITE_KEYS`,
  // `permission-evaluator.ts`), so `'*': { modifyAllRecords: true }` is
  // write-granting even with all three CRUD flags false. Value tests
  // (`=== true`), not key-existence: Zod materialises the superuser bits with
  // `.default(false)` (`permission.zod.ts`), so they are present-as-false.
  const writeGrantingWildcardSets: string[] = defaultPermissionSets
    .filter((s: any) => {
      const wc = s.objects?.['*'];
      return (
        !!wc &&
        (wc.allowCreate === true ||
          wc.allowEdit === true ||
          wc.allowDelete === true ||
          wc.modifyAllRecords === true)
      );
    })
    .map((s) => s.name)
    .sort();

  /**
   * The one documented exclusion: `admin_full_access` keeps its unqualified
   * wildcard so an admin can rescue data directly (recorded in the
   * `MANAGED_DENY_TARGET_SETS` docblock; runtime guards are its boundary).
   * Pinned exactly, like `EDIT_EXCEPTIONS` above: widening it is an edit HERE,
   * which is the moment a reviewer is asked why the new set may keep raw CRUD
   * on identity tables.
   */
  const WILDCARD_DENY_EXCLUSIONS = ['admin_full_access'];

  it('the property derivation is live (found the known write-granting sets)', () => {
    // If the filter silently matched nothing, the difference below would be
    // vacuously empty — guard the probe itself.
    expect(writeGrantingWildcardSets).toContain('organization_admin');
    expect(writeGrantingWildcardSets).toContain('organization_admin_no_bypass');
    expect(writeGrantingWildcardSets.length).toBeGreaterThanOrEqual(3);
  });

  it('every write-granting wildcard set is a managed-deny target or a documented exclusion', () => {
    const missing = writeGrantingWildcardSets.filter(
      (name) => !MANAGED_DENY_TARGET_SETS.includes(name) && !WILDCARD_DENY_EXCLUSIONS.includes(name),
    );
    expect(missing, 'write-granting sets missing from MANAGED_DENY_TARGET_SETS').toEqual([]);
  });

  it('the exclusion list is exactly admin_full_access, and it really is outside the target list', () => {
    expect(WILDCARD_DENY_EXCLUSIONS).toEqual(['admin_full_access']);
    expect([...MANAGED_DENY_TARGET_SETS]).not.toContain('admin_full_access');
  });

  // ── The behaviour the membership buys, measured on the REAL derived set ──
  // (clones so the module-level instances other tests read stay unmutated;
  // the kernel path hands the same objects to the same function in place).

  const FUTURE = 'sys_future_identity_table';
  const DENY = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };

  it('a managedBy:better-auth object OUTSIDE the static list now reaches the variant (the card)', () => {
    const sets: any[] = structuredClone(defaultPermissionSets as any);
    const variant = sets.find((s) => s.name === 'organization_admin_no_bypass');
    const parent = sets.find((s) => s.name === 'organization_admin');
    expect(variant.objects[FUTURE]).toBeUndefined(); // genuinely not in the compile-time baseline
    applyManagedWriteDenies(sets, [{ name: FUTURE, managedBy: 'better-auth' }]);
    expect(variant.objects[FUTURE]).toEqual(DENY);
    // The fix ADDS a target; the parent keeps receiving its injection too.
    expect(parent.objects[FUTURE]).toEqual(DENY);
  });

  it('reverse control: the variant pre-existing explicit entries survive the injection unchanged', () => {
    const sets: any[] = structuredClone(defaultPermissionSets as any);
    const variant = sets.find((s) => s.name === 'organization_admin_no_bypass');
    const before = structuredClone(variant.objects);
    const registry = [
      ...BETTER_AUTH_MANAGED_OBJECTS.map((n) => ({ name: n, managedBy: 'better-auth' })),
      { name: FUTURE, managedBy: 'better-auth' },
    ];
    applyManagedWriteDenies(sets, registry);
    for (const name of BETTER_AUTH_MANAGED_OBJECTS) {
      expect(variant.objects[name], `variant entry ${name}`).toEqual(before[name]);
    }
    // Wildcard and the anti-escalation RBAC read-only block untouched as well.
    expect(variant.objects['*']).toEqual(before['*']);
    expect(variant.objects.sys_position).toEqual(before.sys_position);
    // Only the future table was new on the variant.
    expect(variant.objects[FUTURE]).toEqual(DENY);
    expect(Object.keys(variant.objects).sort()).toEqual([...Object.keys(before), FUTURE].sort());
  });

  it('control: admin_full_access is untouched by the injection (admin rescue path)', () => {
    const sets: any[] = structuredClone(defaultPermissionSets as any);
    const admin = sets.find((s) => s.name === 'admin_full_access');
    const before = structuredClone(admin);
    applyManagedWriteDenies(sets, [{ name: FUTURE, managedBy: 'better-auth' }]);
    expect(admin).toEqual(before);
  });
});
