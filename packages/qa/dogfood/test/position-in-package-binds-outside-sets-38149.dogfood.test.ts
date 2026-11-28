// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0070 D3, ADR-0084 amendment of 2026-11-26, ADR-0150 D3/D7] A position
// the console creates INTO a writable package still confers the permission
// sets an administrator binds from outside that package: a set another
// package holds, a set a code package ships, and a loose (package-less) set.
//
// ## Why this file exists
//
// Setup's Positions and Permission sets pages create through the environment
// scope today, so a new position and a new set name no package and the set is
// written live. The App Studio create ask moves those creates into a package:
// the administrator picks a writable package (or creates one) before the
// first save, and the item is saved there as a draft and published. The
// premise that move rests on is measured here, on a real booted showcase and
// through the same REST doors the console's editor uses (`PUT
// /meta/:type/:name?mode=draft&package=ID`, then `POST
// /meta/:type/:name/publish?package=ID`): a holder of such a position is
// granted every set the position names, whatever package (or none) holds it.
//
// The read that decides it is the security catalog's `referenceCaller`
// (core `security-catalog.ts`): a position a package SHIPS resolves its
// `permissionSets` from that package's closure, while a position authored
// at runtime is the environment's reference, resolved environment-wide. A
// change that made a runtime package's position resolve from its own closure
// would refuse the loose set and the other package's set; the first case
// below goes red on that.
//
// Controls: the position really is held under the new package (the catalog
// says so), the holder really holds it, and a set the position does NOT name
// is not granted.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveUserAuthzGrants, securityCatalogReaderOf } from '@objectstack/core';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

/** Infrastructure rows, not tenant data: the store's own posture. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** The new writable package the position is created into. */
const HOME = 'app.pickprobe-home';
/** A second writable package, holding a set of its own. */
const OTHER = 'app.pickprobe-other';

const POSITION = 'pkhome_reviewer';
/** A set saved into the position's own package, as the editor saves one. */
const OWN_SET = 'pkhome_reviewer_set';
/** A set the second runtime package holds. */
const OTHER_SET = 'pkother_shared_set';
/** A set the showcase (a code package) ships (`src/security`). */
const SHIPPED_SET = 'showcase_auditor';
/** A set saved through the environment scope: no package holds it. */
const LOOSE_SET = 'pickprobe_loose_set';
/** A loose set the position does not name: never granted to its holder. */
const UNNAMED_SET = 'pickprobe_unnamed_set';

const HOLDER_EMAIL = 'pick.probe.holder@example.com';

interface Engine {
  find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

/** The organization a `single` session is active in (ADR-0131 D9). */
const sessionOrgOf = async (s: VerifyStack): Promise<string | undefined> =>
  (await (await s.kernel.getServiceAsync<{ defaultOrgId(): Promise<string | null> }>('tenancy')).defaultOrgId()) ?? undefined;

describe('a position created into a writable package binds sets from outside it', () => {
  let stack: VerifyStack;
  let admin: string;
  let ql: Engine;
  let holder: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(admin, method, path, body);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  /** The console editor's create: the item's draft in the package, then its own publish. */
  const createInPackage = async (type: string, name: string, body: Record<string, unknown>, pkg: string) => {
    const draft = await call('PUT', `/meta/${type}/${name}?mode=draft&package=${encodeURIComponent(pkg)}`, body);
    expect(draft.status, `draft ${type}/${name}: ${draft.text}`).toBe(200);
    const live = await call('POST', `/meta/${type}/${name}/publish?package=${encodeURIComponent(pkg)}`, {});
    expect(live.status, `publish ${type}/${name}: ${live.text}`).toBe(200);
  };
  /** The environment scope's create: a set written live, naming no package. */
  const createLoose = async (name: string) => {
    const saved = await call('PUT', `/meta/permission/${name}`, { name, label: name, objects: {} });
    expect(saved.status, `loose permission/${name}: ${saved.text}`).toBe(200);
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    admin = await stack.signIn();
    ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;

    for (const [id, ns] of [[HOME, 'pkhome'], [OTHER, 'pkother']] as const) {
      const created = await call('POST', '/packages', {
        manifest: { id, name: `Pick probe ${ns}`, version: '0.1.0', type: 'app', namespace: ns },
      });
      expect(created.status, created.text).toBe(201);
    }
    await createInPackage('permission', OTHER_SET, { name: OTHER_SET, label: 'Other package set', objects: {} }, OTHER);
    await createInPackage('permission', OWN_SET, { name: OWN_SET, label: 'Own package set', objects: {} }, HOME);
    await createLoose(LOOSE_SET);
    await createLoose(UNNAMED_SET);
    await createInPackage('position', POSITION, {
      name: POSITION,
      label: 'Pick probe reviewer',
      permissionSets: [OWN_SET, OTHER_SET, SHIPPED_SET, LOOSE_SET],
    }, HOME);

    await stack.signUp(HOLDER_EMAIL);
    const [user] = await ql.find('sys_user', { where: { email: HOLDER_EMAIL }, limit: 1, context: SYSTEM_CTX });
    expect(user?.id, `no sys_user row for ${HOLDER_EMAIL}`).toBeTruthy();
    holder = String(user.id);
    await ql.insert('sys_user_position', { id: 'usp_pick_probe', user_id: holder, position: POSITION }, { context: SYSTEM_CTX });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the position is held under the new package, and the sets under theirs', async () => {
    const reader = securityCatalogReaderOf(ql);
    expect(reader, 'no security catalog bound to the booted engine').toBeTruthy();
    const position = await reader!.resolve('position', POSITION);
    expect(position?.packageId).toBe(HOME);
    expect((position?.definition as { permissionSets?: string[] } | undefined)?.permissionSets)
      .toEqual([OWN_SET, OTHER_SET, SHIPPED_SET, LOOSE_SET]);
    expect((await reader!.resolve('permission', OTHER_SET))?.packageId).toBe(OTHER);
    expect((await reader!.resolve('permission', OWN_SET))?.packageId).toBe(HOME);
    expect((await reader!.resolve('permission', LOOSE_SET))?.packageId).toBeUndefined();
  });

  it('a holder is granted the own set, the other package\'s set, the shipped set and the loose set', async () => {
    const grants = await resolveUserAuthzGrants(ql as never, holder, { tenantId: await sessionOrgOf(stack) });
    expect(grants.positions).toContain(POSITION);
    expect(grants.permissions).toEqual(expect.arrayContaining([OWN_SET, OTHER_SET, SHIPPED_SET, LOOSE_SET]));
  });

  // Setup's permission matrix mounts with no package and saves the set live,
  // naming none (`PermissionMatrixEditPage` at the environment door). A set
  // the ask put in a package must take that edit in its own row: one row of
  // the name, still the package's, carrying the edit.
  it('a live edit naming no package lands on the set the package holds', async () => {
    const edited = await call('PUT', `/meta/permission/${OWN_SET}`, { name: OWN_SET, label: 'Own package set, edited', objects: {} });
    expect(edited.status, edited.text).toBe(200);
    const rows = await ql.find('sys_metadata', { where: { type: 'permission', name: OWN_SET }, context: SYSTEM_CTX });
    const live = rows.filter((r) => r.state !== 'draft');
    expect(live.map((r) => r.package_id ?? null), JSON.stringify(rows.map((r) => [r.package_id, r.state]))).toEqual([HOME]);
    const reader = securityCatalogReaderOf(ql);
    const set = await reader!.resolve('permission', OWN_SET);
    expect(set?.packageId).toBe(HOME);
    expect((set?.definition as { label?: string } | undefined)?.label).toBe('Own package set, edited');
  });

  it('control: a loose set the position does not name is not granted', async () => {
    const grants = await resolveUserAuthzGrants(ql as never, holder, { tenantId: await sessionOrgOf(stack) });
    expect(grants.permissions).not.toContain(UNNAMED_SET);
  });
});
