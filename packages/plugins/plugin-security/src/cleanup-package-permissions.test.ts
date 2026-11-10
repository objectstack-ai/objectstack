// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// #2747 — uninstall-time revocation of a package's data-plane permission rows
// (ADR-0086 D3 provenance consumed at last; ADR-0090 D5 "no ghost grants").

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanupPackagePermissions } from './cleanup-package-permissions';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { SecurityPlugin } from './security-plugin.js';

/**
 * The permission-set names the uninstalling door read off the package before
 * its withdrawal (`UninstallDeclared`, ADR-0131 D4). Since C3 stage 8 they are
 * the only way the sweep reaches the package's sets: no catalog row stands for
 * a set.
 */
const DECLARED = { permission: ['crm_readonly', 'crm_admin'] };

/**
 * A store holding both shapes a grant has carried: every grant names its set
 * (ADR-0131 D4) and still carries the legacy id of the set's catalog row. The
 * catalog rows themselves are here too — what a release before the row objects
 * were retired (C3 stage 8) wrote — and the sweep reads and deletes none of
 * them: it finds the package's sets by their declared names alone.
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

    expect(out).toEqual({ ...NOTHING, userGrants: 2, suggestions: 2 });

    // no ghost grants: no grant naming the package's sets survives
    expect(ql.tables.sys_user_permission_set.map((r: any) => r.id)).toEqual(['ups_env', 'ups_other']);
    expect(ql.tables.sys_audience_binding_suggestion.map((r: any) => r.id)).toEqual(['sug_other']);
  });

  it('never touches env-authored or foreign-package sets or their grants (ADR-0086 D4 provenance)', async () => {
    const ql = makeQl();
    await cleanupPackagePermissions(ql, 'com.example.crm', undefined, DECLARED);
    // No catalog row is touched, the package's own legacy rows included.
    expect(ql.tables.sys_permission_set.map((r: any) => r.id)).toEqual(['ps_crm_ro', 'ps_crm_admin', 'ps_other', 'ps_env', 'ps_legacy']);
    const grants = ql.tables.sys_user_permission_set.map((r: any) => r.permission_set);
    expect(grants).toEqual(['member_default', 'other_set']);
  });

  it('is idempotent — a second run revokes nothing', async () => {
    const ql = makeQl();
    await cleanupPackagePermissions(ql, 'com.example.crm', undefined, DECLARED);
    const second = await cleanupPackagePermissions(ql, 'com.example.crm', undefined, DECLARED);
    expect(second).toEqual(NOTHING);
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

      // The 2 grants and the 2 suggestion rows.
      expect(refused.refused).toBe(4);
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
      expect(out.refused).toBe(4);
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

    // The two grants naming the sets the fixture also holds legacy rows for,
    // and the two naming the set that never had one.
    expect(out.userGrants).toBe(4);
    expect(ql.tables.sys_user_permission_set.map((r: any) => r.id)).toEqual(['ups_env', 'ups_other', 'ups_named_other']);
  });

  it('control — handed no names, the sweep revokes no grant', async () => {
    const ql = withNamedGrants();
    const out = await cleanupPackagePermissions(ql, 'com.example.crm');

    expect(out).toEqual({ ...NOTHING, suggestions: 2 });
    // No grant is revoked: the legacy rows the fixture holds for the package's
    // sets are not a way in.
    expect(ql.tables.sys_user_permission_set.map((r: any) => r.id)).toEqual(
      ['ups_1', 'ups_2', 'ups_env', 'ups_other', 'ups_named_1', 'ups_named_2', 'ups_named_other'],
    );
  });
});

/**
 * [ADR-0150 D8] A permission-set name may have two holders (two packages of two
 * namespaces, D3/D4), and a grant names its holder in `permission_set_package`.
 * Uninstalling one holder revokes only the grants bound to it, or bound to none;
 * an empty-column grant of a name another holder still serves is revoked and
 * reported, never bound to that holder (red line 1).
 *
 * Install refuses a second holder until the narrowing lands, so the rows and the
 * holder reader are seeded here directly. The reader stands for the security
 * catalog AFTER the door withdrew `gamma`: only `delta` still holds the name.
 */
describe('[ADR-0150 D8] uninstall revokes by (package, name)', () => {
  const GAMMA = 'com.qa.gamma';
  const DELTA = 'com.qa.delta';
  const SET = 'qa_removal_set';
  const declared = { permission: [SET] };

  /** The security catalog's `list` after the withdrawal: the holders left. */
  const catalogOf = (...holders: Array<string | undefined>) => ({
    list: vi.fn(async () => holders.map((packageId) => ({ name: SET, ...(packageId ? { packageId } : {}) }))),
  });

  function twoHolderQl(extra: any[] = []) {
    const ql = makeQl();
    ql.tables.sys_user_permission_set.push(
      { id: 'ups_y_gamma', user_id: 'usr_y', organization_id: 'org_1', permission_set: SET, permission_set_package: GAMMA },
      { id: 'ups_z_delta', user_id: 'usr_z', organization_id: 'org_1', permission_set: SET, permission_set_package: DELTA },
      ...extra,
    );
    // A revocation is a delete: a write that binds a grant to another holder
    // is the thing this card forbids, so any update here fails the test.
    ql.update = vi.fn(async () => { throw new Error('the uninstall cleanup must never rebind a grant'); });
    return ql;
  }

  const ids = (ql: any) => ql.tables.sys_user_permission_set.map((r: any) => r.id);

  it('two holders, each with a bound grant: uninstalling one leaves the other\'s grant', async () => {
    const ql = twoHolderQl();
    const out = await cleanupPackagePermissions(ql, GAMMA, undefined, declared, { catalog: catalogOf(DELTA) });

    expect(out.userGrants).toBe(1);
    expect(out.reportedGrants).toBeUndefined();
    // Delta's user keeps delta's set; gamma's grant is gone.
    expect(ids(ql)).toContain('ups_z_delta');
    expect(ids(ql)).not.toContain('ups_y_gamma');
    expect(ql.tables.sys_user_permission_set.find((r: any) => r.id === 'ups_z_delta')).toMatchObject({
      user_id: 'usr_z', permission_set: SET, permission_set_package: DELTA,
    });
  });

  it('control — uninstalling the other holder takes its own grant and leaves the first', async () => {
    const ql = twoHolderQl();
    const out = await cleanupPackagePermissions(ql, DELTA, undefined, declared, { catalog: catalogOf(GAMMA) });

    expect(out.userGrants).toBe(1);
    expect(ids(ql)).toContain('ups_y_gamma');
    expect(ids(ql)).not.toContain('ups_z_delta');
  });

  it('a null-column grant with one holder is revoked, as today — nothing reported', async () => {
    const ql = makeQl();
    ql.tables.sys_user_permission_set.push(
      { id: 'ups_null', user_id: 'usr_n', organization_id: 'org_1', permission_set: SET, permission_set_package: null },
      { id: 'ups_blank', user_id: 'usr_b', organization_id: 'org_1', permission_set: SET, permission_set_package: '  ' },
    );
    const warns: string[] = [];
    const out = await cleanupPackagePermissions(ql, GAMMA, { warn: (m) => { warns.push(m); } }, declared, {
      // After gamma's withdrawal nobody holds the name.
      catalog: catalogOf(),
    });

    expect(out.userGrants).toBe(2);
    expect(out.reportedGrants).toBeUndefined();
    expect(ids(ql)).not.toContain('ups_null');
    expect(ids(ql)).not.toContain('ups_blank');
    expect(warns).toEqual([]);
  });

  it('a null-column grant with two holders is revoked and reported — never bound to the remaining holder', async () => {
    const ql = twoHolderQl([
      { id: 'ups_w_null', user_id: 'usr_w', organization_id: 'org_2', permission_set: SET, permission_set_package: null },
    ]);
    const warns: Array<{ msg: string; meta?: any }> = [];
    const out = await cleanupPackagePermissions(ql, GAMMA, {
      warn: (msg, meta) => { warns.push({ msg, meta }); },
    }, declared, { catalog: catalogOf(DELTA) });

    // Revoked: gamma's bound grant and the unbound one.
    expect(out.userGrants).toBe(2);
    expect(ids(ql)).not.toContain('ups_w_null');
    // Never bound: no write but the deletes, and delta's own grant is the only
    // grant of the name left, still bound to delta.
    expect(ql.update).not.toHaveBeenCalled();
    expect(ql.tables.sys_user_permission_set.filter((r: any) => r.permission_set === SET).map((r: any) => r.id))
      .toEqual(['ups_z_delta']);
    // Reported on the outcome (the receipt) …
    expect(out.reportedGrants).toEqual([{ user: 'usr_w', organization: 'org_2', permission_set: SET }]);
    // … and in ONE warning naming the user, the organization, the set and the remedy.
    expect(warns).toHaveLength(1);
    expect(warns[0]!.msg).toContain('"usr_w"');
    expect(warns[0]!.msg).toContain('"org_2"');
    expect(warns[0]!.msg).toContain(`"${SET}"`);
    expect(warns[0]!.msg).toContain(DELTA);
    expect(warns[0]!.msg).toContain('grant it again with the package named');
    expect(warns[0]!.meta).toMatchObject({ packageId: GAMMA, reportedGrants: out.reportedGrants });
  });

  it('a holder reader that cannot answer reports every revoked null-column grant — nobody could say it had one holder', async () => {
    const ql = twoHolderQl([
      { id: 'ups_w_null', user_id: 'usr_w', organization_id: null, permission_set: SET },
    ]);
    const out = await cleanupPackagePermissions(ql, GAMMA, undefined, declared, {
      catalog: { list: async () => { throw new Error('registry unreadable'); } },
    });

    expect(ids(ql)).toEqual(expect.arrayContaining(['ups_z_delta']));
    expect(ids(ql)).not.toContain('ups_w_null');
    expect(out.reportedGrants).toEqual([{ user: 'usr_w', organization: null, permission_set: SET }]);
  });

  it('a body still naming the withdrawn package is not another holder', async () => {
    const ql = makeQl();
    ql.tables.sys_user_permission_set.push({ id: 'ups_null', user_id: 'usr_n', permission_set: SET });
    const out = await cleanupPackagePermissions(ql, GAMMA, undefined, declared, { catalog: catalogOf(GAMMA) });

    expect(out.userGrants).toBe(1);
    expect(out.reportedGrants).toBeUndefined();
  });

  it('the catalog is read once per uninstall, and not at all when no null-column grant was revoked', async () => {
    const bound = catalogOf(DELTA);
    await cleanupPackagePermissions(twoHolderQl(), GAMMA, undefined, declared, { catalog: bound });
    expect(bound.list).not.toHaveBeenCalled();

    const unbound = catalogOf(DELTA);
    const ql = twoHolderQl([
      { id: 'ups_a', user_id: 'usr_a', permission_set: SET },
      { id: 'ups_b', user_id: 'usr_b', permission_set: 'qa_second_set' },
    ]);
    await cleanupPackagePermissions(ql, GAMMA, undefined, { permission: [SET, 'qa_second_set'] }, { catalog: unbound });
    expect(unbound.list).toHaveBeenCalledTimes(1);
  });
});

/**
 * [ADR-0150 D8] The call site: the cleanup the plugin registers with the
 * protocol reads the holders from the security catalog over the engine
 * registry (here, after `gamma`'s withdrawal, only `delta` holds the name) and
 * answers the reported grants on its outcome, which the runner relays onto the
 * uninstall's receipt.
 */
describe('[ADR-0150 D8] the registered uninstall cleanup answers the reported grants', () => {
  const SET = 'qa_removal_set';
  afterEach(() => { vi.restoreAllMocks(); });

  async function bootWithCleanup(registryItems: any[]) {
    const base = makeQl();
    base.tables.sys_user_permission_set.push(
      { id: 'ups_z_delta', user_id: 'usr_z', organization_id: 'org_1', permission_set: SET, permission_set_package: 'com.qa.delta' },
      { id: 'ups_w_null', user_id: 'usr_w', organization_id: 'org_2', permission_set: SET, permission_set_package: null },
    );
    const ql: any = {
      ...base,
      registerMiddleware: () => {},
      getSchema: (name: string) => (name === 'sys_user' || name === 'sys_member' ? { name, fields: {} } : undefined),
      registry: {
        listItems: (type: string) => (type === 'permission' ? registryItems : []),
        getItem: (type: string, name: string) => (type === 'permission' ? registryItems.find((i) => i.name === name) : undefined),
        isPackageDisabled: () => false,
      },
      findOne: async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; },
      count: async () => 0,
      insert: async (_object: string, data: any) => ({ id: 'row_1', ...data }),
      update: async (_object: string, data: any, options?: any) => { assertEngineUpdateDispatch(data, options); return 0; },
    };
    const cleanups = new Map<string, (args: any) => Promise<any>>();
    const protocol = {
      registerMutationProjector: vi.fn(),
      onMetadataMutation: () => () => {},
      registerUninstallCleanup: (name: string, fn: (args: any) => Promise<any>) => { cleanups.set(name, fn); },
    };
    const services: Record<string, any> = {
      manifest: { register: vi.fn() },
      objectql: ql,
      metadata: { get: async () => null, list: async () => [] },
      protocol,
    };
    const hook = vi.fn();
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => { if (!(name in services)) throw new Error(`no service: ${name}`); return services[name]; },
      hook,
    };
    vi.spyOn(SecurityPlugin.prototype as any, 'declareEveryone').mockResolvedValue(undefined);
    const plugin = new SecurityPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    for (const [, cb] of hook.mock.calls.filter((c: any[]) => c[0] === 'kernel:ready')) await cb();
    return { cleanup: cleanups.get('security.package-permissions')!, tables: base.tables, ctx };
  }

  it('another holder left: the null-column grant is revoked and named on the outcome; the bound one stays', async () => {
    const { cleanup, tables } = await bootWithCleanup([{ name: SET, _packageId: 'com.qa.delta' }]);
    expect(cleanup).toBeTypeOf('function');

    const outcome = await cleanup({ packageId: 'com.qa.gamma', declared: { permission: [SET] } });

    expect(outcome).toEqual({
      success: true,
      removed: 1,
      reportedGrants: [{ user: 'usr_w', organization: 'org_2', permission_set: SET }],
    });
    expect(tables.sys_user_permission_set.filter((r: any) => r.permission_set === SET).map((r: any) => r.id)).toEqual(['ups_z_delta']);
  });

  it('control — no holder left: the outcome answers as before, with no reported grants', async () => {
    const { cleanup } = await bootWithCleanup([]);
    const outcome = await cleanup({ packageId: 'com.qa.gamma', declared: { permission: [SET] } });
    expect(outcome).toEqual({ success: true, removed: 1 });
  });
});
