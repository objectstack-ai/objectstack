// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21237] The identity object's `Admin` field group is served to an org peer
// only when the reader holds an admin set — the shipped sets' half, pinned
// against the identity object's DECLARATION rather than against a list.
//
// What the card measured: `member_default` opens every org peer's identity row
// (`sys_user_org_members`) and declared no field-level security on it, so an
// org member was served the whole `Admin` group of a colleague's row — and,
// through the activity field redaction that reads the same served projection,
// every colleague's history of those fields. The ruling (triage, direction A):
// the permission set's existing `fields` → `readable: false`, on the shipped
// non-admin sets, with the admin sets keeping the group. ⛔ No hand-kept list:
// the withheld set is held EQUAL to the declared group here, so a field the
// declaration adds to the group cannot slip through.
//
// Three pins, each read off a source the module under test does not own:
//
//   1. GROUP EQUALITY — every shipped set's identity-object field entries are
//      exactly the group the declaration names, read here from `SysUser`
//      itself (never from the module's own helper), with the posture each set
//      class must carry;
//   2. COMPLETENESS — every shipped set that opens an org peer's identity row
//      is classified by an INDEPENDENT property (does it carry an org-peer
//      `sys_user` select policy?), so a new non-admin set opening that read
//      without withholding the group is red here, not silently served;
//   3. COMPOSITION — the evaluator's REAL most-permissive merge, over the sets
//      each persona resolves. `member_default` is the additive `everyone`
//      baseline (ADR-0090 D5): an admin resolves it too, so the admin half is
//      only real if the merge keeps the group for them.
//
// The HTTP door (direct read, the activity metadata through the field
// redaction, the member's own row, the field-level write gate and the user
// picker's candidate query) is pinned on a real boot in
// `packages/qa/dogfood/test/identity-admin-fields-org-peer.dogfood.test.ts`.

import { describe, it, expect } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { ADMIN_FULL_ACCESS, ORGANIZATION_ADMIN_GRANTS } from '@objectstack/spec';
import { SysUser } from '@objectstack/platform-objects/identity';
import { PermissionEvaluator } from './permission-evaluator.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const IDENTITY = 'sys_user';

/** The declared group, read off the declaration — the pin's independent side. */
const DECLARED_ADMIN_GROUP: string[] = Object.entries(SysUser.fields as Record<string, { group?: string }>)
  .filter(([, field]) => field.group === 'Admin')
  .map(([name]) => name)
  .sort();

/**
 * Fields a member already reads on a peer's row — the controls that must stay
 * served. `banned` is among them by ruling (triage on #21237, Q1 = B): the
 * deactivation flag is directory status, declared outside the `Admin` group,
 * because every user picker filters candidates on it and a filter on a withheld
 * field is refused. Moving it back into the group is red here.
 */
const PEER_DIRECTORY_FIELDS = ['name', 'email', 'image', 'banned'];

const ADMIN_SETS = [ADMIN_FULL_ACCESS, ...ORGANIZATION_ADMIN_GRANTS];
const WITHHOLDING_SETS = ['member_default', 'viewer_readonly'];

const setByName = (name: string): PermissionSet => {
  const set = defaultPermissionSets.find((s) => s.name === name);
  if (!set) throw new Error(`shipped set ${name} not found`);
  return set;
};

/** One set's identity-object field entries, keyed by field name. */
const identityFieldEntries = (set: PermissionSet): Record<string, { readable?: boolean; editable?: boolean }> =>
  Object.fromEntries(
    Object.entries(set.fields ?? {})
      .filter(([key]) => key.startsWith(`${IDENTITY}.`))
      .map(([key, perm]) => [key.slice(IDENTITY.length + 1), perm]),
  );

/** Does this set open an org peer's identity row? Read off its row-level security. */
const opensOrgPeerIdentityRead = (set: PermissionSet): boolean =>
  (set.rowLevelSecurity ?? []).some(
    (p) => p.object === IDENTITY && (p.operation === 'select' || p.operation === 'all') && /org_user_ids/.test(p.using ?? ''),
  );

describe('[#21237] the identity object Admin group — withheld from org peers, kept by admin sets', () => {
  it('the declared group is non-empty and names the field the card measured (vacuity guard)', () => {
    // Without this, a renamed group would make BOTH sides of the equality
    // below empty, and every pin in this file green over nothing.
    expect(DECLARED_ADMIN_GROUP.length).toBeGreaterThan(0);
    expect(DECLARED_ADMIN_GROUP).toContain('last_login_ip');
    for (const control of PEER_DIRECTORY_FIELDS) expect(DECLARED_ADMIN_GROUP).not.toContain(control);
  });

  it.each(WITHHOLDING_SETS)('%s withholds exactly the declared group (readable: false), and nothing else on the identity object', (name) => {
    const entries = identityFieldEntries(setByName(name));
    expect(Object.keys(entries).sort()).toEqual(DECLARED_ADMIN_GROUP);
    for (const field of DECLARED_ADMIN_GROUP) {
      expect(entries[field], field).toEqual({ readable: false, editable: false });
    }
  });

  it.each(ADMIN_SETS)('%s keeps exactly the declared group (readable: true, editable: true — the no-entry state)', (name) => {
    const entries = identityFieldEntries(setByName(name));
    expect(Object.keys(entries).sort()).toEqual(DECLARED_ADMIN_GROUP);
    for (const field of DECLARED_ADMIN_GROUP) {
      expect(entries[field], field).toEqual({ readable: true, editable: true });
    }
  });

  it('every other shipped set names no identity-object field at all', () => {
    const others = defaultPermissionSets
      .filter((s) => !ADMIN_SETS.includes(s.name) && !WITHHOLDING_SETS.includes(s.name))
      .filter((s) => Object.keys(identityFieldEntries(s)).length > 0)
      .map((s) => s.name);
    expect(others).toEqual([]);
  });

  it('completeness: every shipped set opening the identity row of an org peer is an admin set or withholds the group', () => {
    const openers = defaultPermissionSets.filter(opensOrgPeerIdentityRead).map((s) => s.name).sort();
    // The classification itself must have found something — an empty opener
    // list would make the loop below vacuous.
    expect(openers).toEqual(expect.arrayContaining(['member_default', 'viewer_readonly']));
    for (const name of openers) {
      const entries = identityFieldEntries(setByName(name));
      const expected = ADMIN_SETS.includes(name);
      for (const field of DECLARED_ADMIN_GROUP) {
        expect(entries[field]?.readable, `${name} → ${field}`).toBe(expected);
      }
    }
  });

  describe('composition — the real most-permissive merge of the evaluator over the sets each persona resolves', () => {
    const evaluator = new PermissionEvaluator();
    const mask = (names: string[]) => evaluator.getFieldPermissions(IDENTITY, names.map(setByName));

    it('an org member (the `everyone` baseline alone) is withheld every group field, and served the directory fields', () => {
      const perms = mask(['member_default']);
      for (const field of DECLARED_ADMIN_GROUP) expect(perms[field]?.readable, field).toBe(false);
      // The controls: no entry at all means the field masker serves them.
      for (const field of PEER_DIRECTORY_FIELDS) expect(perms[field], field).toBeUndefined();
    });

    it('a read-only viewer (baseline + viewer_readonly) is withheld every group field', () => {
      const perms = mask(['member_default', 'viewer_readonly']);
      for (const field of DECLARED_ADMIN_GROUP) expect(perms[field]?.readable, field).toBe(false);
    });

    it.each(ADMIN_SETS)('an admin holding %s on top of the baseline keeps every group field, readable and editable', (name) => {
      const perms = mask(['member_default', name]);
      for (const field of DECLARED_ADMIN_GROUP) {
        expect(perms[field], field).toEqual({ readable: true, editable: true });
      }
    });
  });
});
