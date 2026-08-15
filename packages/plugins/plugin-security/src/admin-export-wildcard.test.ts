// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8681] The shipped ADMIN sets carry NO `'*'.allowExport` — the export axis's
 * half of #5491.
 *
 * #5491 removed `member_default`'s `'*'` wildcard because a wildcard in a set
 * every principal resolves is not a default but a FLOOR no app can get under.
 * The export axis kept its wildcard by omission rather than by decision, and the
 * consequence is the same shape one layer up. Measured on 17.0.0 GA
 * (hotcrm#1152, 40 export probes, real Bearer tokens): an org owner holding
 * `admin_full_access` + `organization_admin_no_bypass` exported `crm_quote`,
 * `crm_campaign` and `crm_task` with 200 and full rows — three objects on which
 * NO app permission set grants `allowExport`. The app had no way to say no:
 * editing a code-package set answers `403 [not_overridable]`, and the org admin
 * holds no app-authored set to put the per-object `false` into.
 *
 * The same run proved this is NOT an admin bypass: the gate is exact for every
 * other principal (C1 a refused token exports a different object on the same
 * route; C2 granting `allowExport` flips 403 to 200; C3 revoking flips it back),
 * and a plain member with `'*'.allowExport = true` exports too. The wildcard was
 * simply doing what it said.
 *
 * Maintainer ruling (2026-08-15): drop `allowExport` from the `'*'` entry of the
 * shipped admin sets. An org admin then exports exactly what app-authored sets
 * grant — a posture the card measured to be already precise (an app
 * `system_admin` set gets declared-false ⇒ 403, declared-true ⇒ 200).
 *
 * ⚠️ Every behavioural assertion below is stated PER SET, not only on the union
 * an org owner actually holds. Partial enforcement was rejected explicitly —
 * "a half-closed export boundary reads as closed and is not" — and a union-only
 * pin is satisfiable by fixing one set of the pair, which is exactly the
 * outcome the ruling forbids.
 *
 * ⚠️ This is NOT a retirement of wildcard export. `allowExport` on a `'*'` entry
 * remains a supported, honoured authoring shape (pinned below) — an app that
 * wants blanket export writes it in its OWN set. What is removed is the
 * platform SHIPPING that grant to every org admin.
 */

import { describe, it, expect } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';

import { PermissionEvaluator } from './permission-evaluator';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const evaluator = new PermissionEvaluator();

function shipped(name: string): PermissionSet {
  const ps = defaultPermissionSets.find((s) => s.name === name);
  expect(ps, `shipped permission set '${name}' not found — re-anchor this pin`).toBeDefined();
  return ps as PermissionSet;
}

/**
 * Every shipped set that carries a `'*'` entry AND administrative reach.
 *
 * `organization_admin` is here alongside the two the card names because
 * `organization_admin_no_bypass` is DERIVED from it (`deriveWallLessOrgAdmin`
 * removes the superuser bits and copies the rest), so the parent is where the
 * grant physically lives — and because a wall-ENFORCING deployment grants the
 * parent. Fixing only the derived variant would leave the default posture
 * leaking while every pin naming the card's two sets went green.
 */
const ADMIN_SETS = ['admin_full_access', ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS] as const;

/** The three objects hotcrm#1152 measured leaking, by name. */
const FORMERLY_LEAKING = ['crm_quote', 'crm_campaign', 'crm_task'] as const;

/** The org-owner principal the card actually measured. */
const ORG_OWNER_SETS = (): PermissionSet[] => [
  shipped('admin_full_access'),
  shipped(ORGANIZATION_ADMIN_NO_BYPASS),
];

const canExport = (sets: PermissionSet[], object: string, opts: { isPrivate?: boolean } = {}) =>
  evaluator.checkObjectPermission('export', object, sets, opts);
const canFind = (sets: PermissionSet[], object: string, opts: { isPrivate?: boolean } = {}) =>
  evaluator.checkObjectPermission('find', object, sets, opts);

/** An app-authored set, as an app would ship it. */
const appSet = (name: string, objects: Record<string, unknown>): PermissionSet =>
  ({ name, objects } as unknown as PermissionSet);

describe('[#8681] shipped admin sets carry no wildcard export grant', () => {
  it.each(ADMIN_SETS)("%s: objects['*'] declares no export grant", (name) => {
    const wildcard = shipped(name).objects?.['*'];
    expect(wildcard, `${name} lost its '*' entry entirely — that is a different change`).toBeDefined();
    expect(wildcard?.allowExport ?? false).toBe(false);
  });

  it.each(ADMIN_SETS)("%s: the '*' entry keeps every OTHER bit it had", (name) => {
    // Guard rail on the shape of the edit: this is an export-axis removal, not a
    // wildcard retirement. A future "cleanup" that drops the whole entry would
    // silently take an admin's read/write with it.
    const wildcard = shipped(name).objects?.['*'];
    expect(wildcard?.allowRead).toBe(true);
    expect(wildcard?.allowCreate).toBe(true);
    expect(wildcard?.allowEdit).toBe(true);
    expect(wildcard?.allowDelete).toBe(true);
  });

  it('the superuser bits are untouched where they belong (and still absent where D4 removed them)', () => {
    for (const name of ['admin_full_access', ORGANIZATION_ADMIN]) {
      const wildcard = shipped(name).objects?.['*'];
      expect(wildcard?.viewAllRecords, name).toBe(true);
      expect(wildcard?.modifyAllRecords, name).toBe(true);
    }
    // [ADR-0105 D4] the wall-less variant drops exactly these two, and nothing
    // about #8681 changes which bits the derivation removes.
    const noBypass = shipped(ORGANIZATION_ADMIN_NO_BYPASS).objects?.['*'];
    expect(noBypass?.viewAllRecords ?? false).toBe(false);
    expect(noBypass?.modifyAllRecords ?? false).toBe(false);
  });
});

describe('[#8681] an admin set alone no longer confers export', () => {
  // Per-set, so ablating the grant back into ANY ONE of them turns this red.
  it.each(ADMIN_SETS)('%s alone: export denied on an object it does not name', (name) => {
    const sets = [shipped(name)];
    for (const object of FORMERLY_LEAKING) {
      expect(canExport(sets, object), `${name} / ${object}`).toBe(false);
    }
  });

  it.each(ADMIN_SETS)('%s alone: READ is untouched — this is an export-only narrowing', (name) => {
    const sets = [shipped(name)];
    for (const object of FORMERLY_LEAKING) {
      expect(canFind(sets, object), `${name} / ${object}`).toBe(true);
    }
  });

  it('the measured org-owner principal (admin_full_access + no_bypass) is denied on all three', () => {
    // The union is where most-permissive merging would hide a half-fix: either
    // set keeping the grant answers `true` here.
    for (const object of FORMERLY_LEAKING) {
      expect(canExport(ORG_OWNER_SETS(), object), object).toBe(false);
    }
  });

  it('holds for a PRIVATE object too (the wildcard reached those via viewAllRecords)', () => {
    // [ADR-0066 D2] a superuser wildcard DOES cover a private object, so before
    // the removal this was the widest cell of all.
    expect(canExport([shipped('admin_full_access')], 'crm_quote', { isPrivate: true })).toBe(false);
  });
});

describe('[#8681] what the removal deliberately does NOT do', () => {
  it('an app set granting export explicitly still exports — for the admin principal', () => {
    // The ruling's migration prescription, executed: "grant `allowExport`
    // explicitly in an app permission set where admin export is intended".
    // Without this case the pins above would also pass on a total export ban.
    const sets = [
      ...ORG_OWNER_SETS(),
      appSet('crm_exporters', { crm_quote: { allowRead: true, allowExport: true } }),
    ];
    expect(canExport(sets, 'crm_quote')).toBe(true);
    // …and only there: the grant is per object, not a restored blanket.
    expect(canExport(sets, 'crm_campaign')).toBe(false);
  });

  it('a WILDCARD export grant is still an honoured authoring shape (S1)', () => {
    // The mechanism survives; only the platform's own use of it is withdrawn.
    const sets = [...ORG_OWNER_SETS(), appSet('blanket', { '*': { allowRead: true, allowExport: true } })];
    expect(canExport(sets, 'crm_campaign')).toBe(true);
  });

  it('specific-over-wildcard precedence is unchanged (S2b)', () => {
    // The shape the card proved already works, and the one an app uses to carve
    // an object OUT of its own blanket grant: an explicit per-object entry is
    // returned INSTEAD of the wildcard (lookup, not merge), so it withholds the
    // export the wildcard would have given.
    const sets = [
      ...ORG_OWNER_SETS(),
      appSet('blanket_with_carve_out', {
        '*': { allowRead: true, allowExport: true },
        crm_quote: { allowRead: true, allowExport: false },
      }),
    ];
    expect(canExport(sets, 'crm_quote')).toBe(false);
    expect(canFind(sets, 'crm_quote')).toBe(true);
    expect(canExport(sets, 'crm_campaign')).toBe(true);
  });

  it("an app's own `system_admin` set gets exactly its declared posture", () => {
    // The card's decisive measurement (probe `46-707-sysadmin.mjs`), reproduced
    // at the evaluator: declared-false ⇒ denied, declared-true ⇒ allowed — and
    // now that answer no longer depends on which platform sets ride along.
    const systemAdmin = appSet('system_admin', {
      crm_quote: { allowRead: true, allowExport: false },
      crm_campaign: { allowRead: true, allowExport: false },
      crm_task: { allowRead: true, allowExport: false },
      crm_account: { allowRead: true, allowExport: true },
      crm_lead: { allowRead: true, allowExport: true },
    });
    const asPlainMember = [systemAdmin];
    const asOrgOwner = [...ORG_OWNER_SETS(), systemAdmin];

    for (const sets of [asPlainMember, asOrgOwner]) {
      expect(canExport(sets, 'crm_quote')).toBe(false);
      expect(canExport(sets, 'crm_campaign')).toBe(false);
      expect(canExport(sets, 'crm_task')).toBe(false);
      expect(canExport(sets, 'crm_account')).toBe(true);
      expect(canExport(sets, 'crm_lead')).toBe(true);
    }
  });
});
