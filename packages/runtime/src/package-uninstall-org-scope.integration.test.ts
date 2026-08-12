// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-engine regression for #7705 — `protocol.deletePackage` found ZERO
// `sys_metadata` rows the data plane found three of, and uninstall left them
// orphaned (the persistence half of #7557; PR #7700 shipped the envelope half
// and deliberately did not patch this from the consumer side).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
} from '@objectstack/metadata-core';

/**
 * The mechanism, MEASURED (not the one the card guessed at first).
 *
 * `deletePackage` selected its rows with a strict `organization_id` equality:
 *
 *     const where = { package_id: request.packageId };
 *     if (request.organizationId) where.organization_id = request.organizationId;
 *
 * Two candidates were live when this was dispatched, and the second is
 * FALSIFIED by measurement, so it is recorded here rather than left implied:
 *
 *  (a) the caller supplies an `organizationId` and strict equality drops rows
 *      stored env-wide (`organization_id IS NULL`);
 *  (b) the protocol's `this.engine` is scoped differently from the data
 *      plane's — an org-injecting wrapper, a separate registration for
 *      `sys_metadata`, or a visibility rule — so an IDENTICAL `where` returns
 *      different rows on the two seams.
 *
 * (b) is false. `findData` — the `GET /api/v1/data/sys_metadata` path that
 * returned three rows — issues `this.engine.find(object, options)` on the very
 * same engine instance this method uses, and the engine injects no org
 * predicate of its own: a bare `new ObjectQL()` carries zero middlewares, and
 * the driver receives the author-supplied `where` verbatim. So (a) is the
 * mechanism, and it is what these tests pin.
 *
 * Why the miss is the COMMON case rather than a corner: env-wide is where a
 * package's metadata normally lands (the REST `PUT /meta/:type/:name` save
 * path does not thread the session's active org, and AI-authored metadata is
 * written env-wide too), while the door that resolves an org and passes it —
 * the dispatcher twin at `packages/runtime/src/domains/packages.ts`, the door
 * whose `persisted:` envelope the issue quotes — is the one users hit with an
 * active session. So the uninstall selected only whichever rows happened to be
 * org-scoped and reported `success: true` over the survivors.
 *
 * The remedy is the shape this codebase already uses for exactly this defect
 * class: `$or [{organization_id: oid}, {organization_id: null}]`, from the
 * #3115 "orphaned draft" fix in `SysMetadataRepository.listDrafts`
 * (`packages/metadata-protocol/src/sys-metadata-repository.ts`). The SQL
 * driver's own implicit tenant wall already reads this way too (`field =
 * :tenant OR field IS NULL`, #2734) — only author-supplied predicates are
 * strict, which is what made this silent.
 *
 * ---------------------------------------------------------------------------
 * Why this suite uses the REAL engine and the REAL driver
 * ---------------------------------------------------------------------------
 * `{success: true, deletedCount: 0}` against a package that has no rows is
 * indistinguishable from this bug, so an assertion on the CALL — "was
 * `deleteMetaItem` invoked with these arguments" — proves nothing here. Both
 * existing `deletePackage` suites are call-shaped for that reason and neither
 * could have caught this: they stub `engine.find` to hand back the rows the
 * test wants and mock `deleteMetaItem` so nothing is ever deleted. This suite
 * therefore SEEDS rows through the real `saveMetaItem` write path, runs the
 * real uninstall, and asserts on WHICH ROWS SURVIVE in SQLite afterwards.
 * A hand-built double is specifically what cannot answer this: the whole
 * question is whether `organization_id = 'org'` matches a NULL column, which
 * is a property of the driver's SQL, not of a stub's `filter()`.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE the revert was run
 * ---------------------------------------------------------------------------
 * Restoring `where.organization_id = request.organizationId` in place of the
 * `$or` was predicted to turn ONLY the org-scoped-uninstall case red —
 * `deletedCount` 4 → 1 with the three env-wide rows surviving — and to leave
 * every negative case green, because strict equality is NARROWER than the
 * `$or`: it cannot reach another org's rows or another package's rows, and it
 * does not touch the no-org branch at all. Measured on revert: exactly that.
 * `deletedCount` came back 1, `reprob_a` / `reprob_b` / `reprob_v` survived,
 * and the three negative cases stayed green. The negatives are the control
 * that keeps a future "fix" from over-widening the predicate — deleting rows
 * that should have stayed is worse than the orphaning this closes.
 */

const PKG = 'com.repro.b';
const OTHER_PKG = 'com.other';
const PLATFORM_PKG = '@objectstack/platform-objects';
const ACTIVE_ORG = 'org_active';
const OTHER_ORG = 'org_other';

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

/** REAL ObjectQL wired to a REAL SqlDriver over on-disk better-sqlite3. */
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'os-7705-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  // `sys_metadata` is the table under test; the history/audit tables are the
  // ones `saveMetaItem` and `deleteMetaItem` write through on the real path.
  const objects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
  await driver.initObjects(objects);

  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  // Registered under the PLATFORM package, which must not be the package under
  // test: `deletePackage` also unregisters its package from the live registry,
  // and owning `sys_metadata` from `PKG` would tear the table out from under
  // the post-uninstall assertions that read the surviving rows back.
  for (const o of objects) engine.registry.registerObject(o, PLATFORM_PKG);
  cleanup.push(() => { void engine.destroy(); });

  // `'package-author'` is the genuine control-plane assembly's channel — the
  // #4463 runtime authoring gate is for environment-channel writes and would
  // otherwise refuse the seeding saves below.
  const protocol = new ObjectStackProtocolImplementation(engine as any, undefined, undefined, 'package-author');
  return { engine, protocol };
}

const viewBody = (name: string) => ({
  name,
  label: name,
  type: 'grid',
  data: { provider: 'object', object: 'anything' },
  columns: ['id'],
});

/**
 * Seed through the REAL write path so every row carries the checksum and
 * history the real uninstall reads back. Views (not objects) so the assertions
 * stay on row survival rather than on physical-table teardown, which
 * `deleteMetaItem` handles separately and which #7705 is not about.
 */
async function seed(protocol: any) {
  const save = (name: string, packageId: string, organizationId?: string) =>
    protocol.saveMetaItem({
      type: 'view',
      name,
      item: viewBody(name),
      packageId,
      ...(organizationId ? { organizationId } : {}),
    });

  // The suspected — and confirmed — miss: env-wide rows, `organization_id IS NULL`.
  await save('reprob_a', PKG);
  await save('reprob_b', PKG);
  await save('reprob_v', PKG);
  // Same package, the caller's OWN org: the only rows the strict equality found.
  await save('reprob_own', PKG, ACTIVE_ORG);
  // Negative 1 — same package, ANOTHER org. Must survive an org-scoped uninstall.
  await save('reprob_foreign', PKG, OTHER_ORG);
  // Negative 2 — ANOTHER package, env-wide. Must survive either way.
  await save('other_a', OTHER_PKG);
}

/** Every surviving row, as `name[pkg,org]`, read straight back out of SQLite. */
async function survivors(engine: any): Promise<string[]> {
  const rows = (await engine.find('sys_metadata', { where: {} })) as any[];
  return rows.map((r) => `${r.name}[${r.package_id},${r.organization_id ?? 'ENV'}]`).sort();
}

const namesFor = async (engine: any, packageId: string): Promise<string[]> => {
  const rows = (await engine.find('sys_metadata', { where: { package_id: packageId } })) as any[];
  return rows.map((r) => r.name).sort();
};

describe('#7705 — org-scoped uninstall must not orphan env-wide sys_metadata rows', () => {
  it('removes the env-wide rows too, and counts them (was: found 1 of 4, left 3 orphaned)', async () => {
    const { engine, protocol } = await boot();
    await seed(protocol);

    // Precondition: the rows the uninstall is supposed to remove really exist,
    // so a passing assertion below cannot be the vacuous "nothing was there".
    expect(await namesFor(engine, PKG)).toEqual(
      ['reprob_a', 'reprob_b', 'reprob_foreign', 'reprob_own', 'reprob_v'],
    );

    const res: any = await (protocol as any).deletePackage({
      packageId: PKG,
      organizationId: ACTIVE_ORG,
    });

    // The CONSEQUENCE: no row of this package survives in the caller's scope
    // (its own org + env-wide). Before the fix `reprob_a`, `reprob_b` and
    // `reprob_v` were all still here.
    expect(await namesFor(engine, PKG)).toEqual(['reprob_foreign']);

    // …and the receipt matches what was actually seeded in that scope — 3
    // env-wide + 1 own-org. It reported 1 before, while claiming success.
    expect(res.deletedCount).toBe(4);
    expect(res.failedCount).toBe(0);
    expect(res.success).toBe(true);
    expect(res.deleted.map((d: any) => d.name).sort()).toEqual(
      ['reprob_a', 'reprob_b', 'reprob_own', 'reprob_v'],
    );

    // The complete post-state, so nothing else moved either way.
    expect(await survivors(engine)).toEqual([
      `other_a[${OTHER_PKG},ENV]`,
      `reprob_foreign[${PKG},${OTHER_ORG}]`,
    ]);
  });

  it('does NOT sweep up another organization’s rows', async () => {
    const { engine, protocol } = await boot();
    await seed(protocol);

    await (protocol as any).deletePackage({ packageId: PKG, organizationId: ACTIVE_ORG });

    // `reprob_foreign` belongs to a different tenant and was never in scope.
    // Over-widening the predicate to catch the env-wide rows would delete data
    // that should have stayed — worse than the bug being closed here.
    const rows = (await engine.find('sys_metadata', {
      where: { package_id: PKG, organization_id: OTHER_ORG },
    })) as any[];
    expect(rows.map((r: any) => r.name)).toEqual(['reprob_foreign']);
  });

  it('does NOT sweep up another package’s rows', async () => {
    const { engine, protocol } = await boot();
    await seed(protocol);

    await (protocol as any).deletePackage({ packageId: PKG, organizationId: ACTIVE_ORG });

    expect(await namesFor(engine, OTHER_PKG)).toEqual(['other_a']);
  });

  // [#7780] REWRITTEN, not deleted — and the reason the original existed is
  // still pinned, in the second half below.
  //
  // The old single case pinned that an uninstall with NO org "still clears the
  // whole package", deliberately, so nobody would narrow the no-org branch to
  // `organization_id IS NULL` and re-create the #7705 orphan bug on the other
  // door. That branch is still NOT narrowed. What the maintainer ruled
  // (2026-08-12, 跨租户卸载必须显式声明,缺省缺参永远不等于「全部租户」) is
  // that REACHING it now requires saying so. So the one case becomes the two
  // halves of the ruled contract: the refusal, and the declared cross-tenant
  // uninstall that still clears exactly what it cleared before.
  it('an uninstall with NO org and NO explicit flag is REFUSED, and deletes nothing', async () => {
    const { engine, protocol } = await boot();
    await seed(protocol);

    await expect(
      (protocol as any).deletePackage({ packageId: PKG }),
    ).rejects.toMatchObject({ code: 'TENANT_SCOPE_REQUIRED', status: 400 });

    // A refusal, not a partial delete: the complete post-state is the seed,
    // untouched — including the foreign org's row, which is the row the old
    // no-org call took with it.
    expect(await survivors(engine)).toEqual([
      `other_a[${OTHER_PKG},ENV]`,
      `reprob_a[${PKG},ENV]`,
      `reprob_b[${PKG},ENV]`,
      `reprob_foreign[${PKG},${OTHER_ORG}]`,
      `reprob_own[${PKG},${ACTIVE_ORG}]`,
      `reprob_v[${PKG},ENV]`,
    ]);
  });

  it('an uninstall with an explicit allTenants clears the whole package (the other door)', async () => {
    const { engine, protocol } = await boot();
    await seed(protocol);

    // The direct-mount REST registrar (`packages/rest/src/package-routes.ts`)
    // has no organization to resolve — `packages/rest` carries no org plumbing
    // at all — so of the two doors the ruling allows it declares
    // `allTenants: true`. Narrowing THIS branch to `organization_id IS NULL`
    // would orphan every org-scoped row instead, i.e. re-create #7705 on the
    // other door. This case pins that the declared branch stays package-wide,
    // at exactly the count the pre-#7780 no-org call produced.
    const res: any = await (protocol as any).deletePackage({ packageId: PKG, allTenants: true });

    expect(await namesFor(engine, PKG)).toEqual([]);
    expect(res.deletedCount).toBe(5);
    expect(await namesFor(engine, OTHER_PKG)).toEqual(['other_a']);
  });

  // [#7780] `organizationId` + `allTenants: true` is CONTRADICTORY, not
  // redundant: one says "this tenant", the other says "every tenant". Both
  // silent resolutions are worse than a refusal — resolving narrow-first makes
  // `allTenants: true` silently inert, resolving explicit-first ignores a named
  // organization and deletes every tenant's rows (the original defect wearing a
  // flag). It is also the reading that stays correct when a request is COMPOSED
  // from two places, which is the accidental composition
  // `resolveActiveOrganizationId` makes real. Same code and status as the
  // undeclared case: one contract, two ways to violate it.
  it('REFUSES when BOTH organizationId and allTenants are supplied, deleting nothing', async () => {
    const { engine, protocol } = await boot();
    await seed(protocol);

    await expect(
      (protocol as any).deletePackage({ packageId: PKG, organizationId: ACTIVE_ORG, allTenants: true }),
    ).rejects.toMatchObject({ code: 'TENANT_SCOPE_REQUIRED', status: 400 });

    // Names BOTH offending parameters, so the caller is not left guessing which
    // pair conflicted.
    await expect(
      (protocol as any).deletePackage({ packageId: PKG, organizationId: ACTIVE_ORG, allTenants: true }),
    ).rejects.toThrow(/organizationId.*mutually exclusive|mutually exclusive.*organizationId/s);

    expect(await namesFor(engine, PKG)).toEqual(
      ['reprob_a', 'reprob_b', 'reprob_foreign', 'reprob_own', 'reprob_v'],
    );
  });

  // [#7780] An EXPLICIT `false` is not the same gesture as an absent flag, but
  // it must land on the same refusal: `false` is not an affirmative request for
  // cross-tenant semantics, so it cannot authorise them. Pinned so that a future
  // `!request.allTenants`-style rewrite (which would treat them identically by
  // accident rather than by decision) still has to face this case.
  it('treats an explicit allTenants:false as undeclared — same 400 as absent', async () => {
    const { engine, protocol } = await boot();
    await seed(protocol);

    await expect(
      (protocol as any).deletePackage({ packageId: PKG, allTenants: false }),
    ).rejects.toMatchObject({ code: 'TENANT_SCOPE_REQUIRED', status: 400 });

    expect(await namesFor(engine, PKG)).toEqual(
      ['reprob_a', 'reprob_b', 'reprob_foreign', 'reprob_own', 'reprob_v'],
    );
  });

  // …while an org-scoped call carrying the same explicit `false` is NOT a
  // violation — the org states the scope, and `false` agrees with it. This is
  // the row that keeps the refusal from over-firing on a legitimate caller that
  // spells its flags out.
  it('allows an org-scoped uninstall that spells allTenants:false explicitly', async () => {
    const { engine, protocol } = await boot();
    await seed(protocol);

    const res: any = await (protocol as any).deletePackage({
      packageId: PKG,
      organizationId: ACTIVE_ORG,
      allTenants: false,
    });

    expect(res.deletedCount).toBe(4);
    expect(await namesFor(engine, PKG)).toEqual(['reprob_foreign']);
  });
});
