// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// #2747 — uninstall-time revocation of a package's data-plane permission rows
// (ADR-0086 D3 provenance consumed at last; ADR-0090 D5 "no ghost grants").

import { describe, it, expect } from 'vitest';
import { cleanupPackagePermissions } from './cleanup-package-permissions';

/**
 * The permission-set names the uninstalling door read off the package before
 * its withdrawal (`UninstallDeclared`, ADR-0131 D4). Handed to the sweep, they
 * revoke the same grants whether it also finds the package's sets by their
 * catalog rows (before C3 stage 8) or by these names alone (after it).
 */
const DECLARED = { permission: ['crm_readonly', 'crm_admin'] };

/**
 * A store holding both shapes a grant has carried: every grant names its set
 * (ADR-0131 D4) and still carries the legacy id of the set's catalog row. The
 * catalog rows themselves are here too — what a release before the row objects
 * were retired (C3 stage 8) wrote — so the sweep revokes the same grants
 * whether it finds the package's sets by its rows or by its declared names.
 */
function makeQl() {
  const tables: Record<string, any[]> = {
    sys_permission_set: [
      // the uninstalled package's own rows
      { id: 'ps_crm_ro', name: 'crm_readonly', package_id: 'com.example.crm', managed_by: 'package' },
      { id: 'ps_crm_admin', name: 'crm_admin', package_id: 'com.example.crm', managed_by: 'package' },
      // another package's row — must survive
      { id: 'ps_other', name: 'other_set', package_id: 'com.other', managed_by: 'package' },
      // env-authored rows — must survive even if a package_id is present
      { id: 'ps_env', name: 'member_default', managed_by: 'user' },
      { id: 'ps_legacy', name: 'admin_full_access' },
    ],
    sys_user_permission_set: [
      { id: 'ups_1', user_id: 'u1', permission_set: 'crm_admin', permission_set_id: 'ps_crm_admin' },
      { id: 'ups_2', user_id: 'u2', permission_set: 'crm_readonly', permission_set_id: 'ps_crm_ro' },
      { id: 'ups_env', user_id: 'u1', permission_set: 'member_default', permission_set_id: 'ps_env' },
      { id: 'ups_other', user_id: 'u2', permission_set: 'other_set', permission_set_id: 'ps_other' },
    ],
    sys_audience_binding_suggestion: [
      { id: 'sug_1', package_id: 'com.example.crm', permission_set_name: 'crm_readonly', anchor: 'everyone', status: 'confirmed' },
      { id: 'sug_2', package_id: 'com.example.crm', permission_set_name: 'crm_admin', anchor: 'everyone', status: 'dismissed' },
      { id: 'sug_other', package_id: 'com.other', permission_set_name: 'other_set', anchor: 'everyone', status: 'pending' },
    ],
  };
  return {
    tables,
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      return (tables[object] ?? []).filter((r) =>
        Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      );
    },
    async delete(object: string, opts: any) {
      const id = opts?.where?.id;
      const t = tables[object] ?? [];
      const i = t.findIndex((r) => r.id === id);
      if (i >= 0) t.splice(i, 1);
      return true;
    },
  } as any;
}

const NOTHING = { sets: 0, positionBindings: 0, userGrants: 0, suggestions: 0, refused: 0 };

describe('cleanupPackagePermissions (#2747)', () => {
  it('revokes every grant naming a set the package declared, and removes its suggestion rows', async () => {
    const ql = makeQl();
    const out = await cleanupPackagePermissions(ql, 'com.example.crm', undefined, DECLARED);

    expect(out).toMatchObject({ userGrants: 2, suggestions: 2, refused: 0 });

    // no ghost grants: no grant naming the package's sets survives
    expect(ql.tables.sys_user_permission_set.map((r: any) => r.id)).toEqual(['ups_env', 'ups_other']);
    expect(ql.tables.sys_audience_binding_suggestion.map((r: any) => r.id)).toEqual(['sug_other']);
  });

  it('never touches env-authored or foreign-package sets or their grants (ADR-0086 D4 provenance)', async () => {
    const ql = makeQl();
    await cleanupPackagePermissions(ql, 'com.example.crm', undefined, DECLARED);
    const names = ql.tables.sys_permission_set.map((r: any) => r.name);
    expect(names).toContain('other_set');
    expect(names).toContain('member_default');
    expect(names).toContain('admin_full_access');
    const grants = ql.tables.sys_user_permission_set.map((r: any) => r.permission_set);
    expect(grants).toEqual(['member_default', 'other_set']);
  });

  it('is idempotent — a second run revokes nothing', async () => {
    const ql = makeQl();
    await cleanupPackagePermissions(ql, 'com.example.crm', undefined, DECLARED);
    const second = await cleanupPackagePermissions(ql, 'com.example.crm', undefined, DECLARED);
    expect(second).toMatchObject({ userGrants: 0, suggestions: 0, refused: 0 });
  });

  it('no-ops safely on a missing package id or a non-engine handle', async () => {
    expect(await cleanupPackagePermissions(makeQl(), '', undefined, DECLARED)).toEqual(NOTHING);
    expect(await cleanupPackagePermissions(null, 'x', undefined, DECLARED)).toEqual(NOTHING);
  });

  // [#12981] The swallow family. `deleteRows` absorbs a refused delete so one
  // bad row cannot abort the sweep — correct, and it used to be the whole
  // story: the refusal reached no counter and no log, so an uninstall that
  // revoked NOTHING was byte-identical to an uninstall of a package that
  // granted nothing. ADR-0090 D5 promises an ABSENCE ("no ghost grants"), and
  // an absence cannot be read off a count of successes.
  describe('[#12981] a wholly refused sweep is distinguishable from a clean one', () => {
    function refusingQl() {
      const ql = makeQl();
      ql.delete = async () => { throw new Error('store is refusing writes'); };
      return ql;
    }

    it('counts the refusals instead of reporting a silent zero', async () => {
      const refused = await cleanupPackagePermissions(refusingQl(), 'com.example.crm', undefined, DECLARED);
      const nothingToDo = await cleanupPackagePermissions(makeQl(), 'com.unknown.pkg');

      // Both revoked nothing. ⛔ Before the repair these two were EQUAL, and
      // that equality is the defect — the assertion below is the pin.
      expect(refused.sets + refused.positionBindings + refused.userGrants + refused.suggestions).toBe(0);
      expect(nothingToDo.sets + nothingToDo.positionBindings + nothingToDo.userGrants + nothingToDo.suggestions).toBe(0);
      expect(refused).not.toEqual(nothingToDo);

      // At least the 2 grants and the 2 suggestion rows.
      expect(refused.refused).toBeGreaterThanOrEqual(4);
      expect(nothingToDo.refused).toBe(0);
    });

    it('reports the surviving grants once, naming the consequence and the remedy', async () => {
      const warns: Array<{ msg: string; meta?: any }> = [];
      const out = await cleanupPackagePermissions(refusingQl(), 'com.example.crm', {
        warn: (msg: string, meta?: any) => { warns.push({ msg, meta }); },
      }, DECLARED);

      // ONE line for the whole sweep, not one per refused row.
      expect(warns).toHaveLength(1);
      expect(warns[0].msg).toContain('REFUSED');
      // The CONSEQUENCE — the grants are still live — in the line itself.
      expect(warns[0].msg).toContain('SURVIVE the uninstall');
      expect(warns[0].msg).toContain('No ghost grants');
      // ...and the REMEDY.
      expect(warns[0].msg).toContain('re-run the uninstall');
      expect(warns[0].meta).toMatchObject({ packageId: 'com.example.crm', refused: out.refused });
    });

    it('says nothing when every delete lands — the repair adds no steady-state noise', async () => {
      const warns: string[] = [];
      const infos: string[] = [];
      const out = await cleanupPackagePermissions(makeQl(), 'com.example.crm', {
        warn: (m: string) => { warns.push(m); },
        info: (m: string) => { infos.push(m); },
      }, DECLARED);
      expect(out.refused).toBe(0);
      expect(warns).toEqual([]);
      expect(infos).toHaveLength(1);
    });

    it('survives a host sink that has no warn at all', async () => {
      // The `?.` on `warn` is the backstop for hosts the TYPE cannot reach.
      // A refusal report must never become the thing that breaks an uninstall.
      const out = await cleanupPackagePermissions(refusingQl(), 'com.example.crm', {}, DECLARED);
      expect(out.refused).toBeGreaterThanOrEqual(4);
    });
  });
});

describe('[ADR-0131 D4, ADR-0090 D5] the grants naming a set the package declared', () => {
  // A set served from the registry has no row: the door hands the cleanup the
  // names it captured before the withdrawal, and the grants naming them go.
  function withNamedGrants() {
    const ql = makeQl();
    ql.tables.sys_user_permission_set.push(
      { id: 'ups_named_1', user_id: 'u2', permission_set: 'crm_catalog_user' },
      { id: 'ups_named_2', user_id: 'u3', permission_set: 'crm_catalog_user' },
      { id: 'ups_named_other', user_id: 'u2', permission_set: 'other_catalog_set' },
    );
    return ql;
  }

  it('revokes every user grant naming a declared set, and only those', async () => {
    const ql = withNamedGrants();
    const out = await cleanupPackagePermissions(ql, 'com.example.crm', undefined, {
      permission: [...DECLARED.permission, 'crm_catalog_user'],
    });

    // The two grants naming the package's row-backed sets and the two naming
    // its registry-only set.
    expect(out.userGrants).toBe(4);
    expect(ql.tables.sys_user_permission_set.map((r: any) => r.id)).toEqual(['ups_env', 'ups_other', 'ups_named_other']);
  });

  it('control — handed no names, a grant naming a registry-only set survives', async () => {
    const ql = withNamedGrants();
    const out = await cleanupPackagePermissions(ql, 'com.example.crm');

    expect(out).toMatchObject({ suggestions: 2, refused: 0 });
    // Whatever the row legs reach while the catalog rows still exist, no grant
    // naming a set the sweep was not handed is revoked.
    expect(ql.tables.sys_user_permission_set.map((r: any) => r.id)).toEqual(
      expect.arrayContaining(['ups_env', 'ups_other', 'ups_named_1', 'ups_named_2', 'ups_named_other']),
    );
  });
});
