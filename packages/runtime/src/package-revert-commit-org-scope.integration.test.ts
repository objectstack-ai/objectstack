// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-engine regression for #7819 tier 1 — `protocol.revertCommit` and
// `protocol.rollbackToPackageCommit`'s target lookup each resolved their
// target commit with a strict `organization_id` equality, so an org-scoped
// caller got `COMMIT_NOT_FOUND` (404) for a commit row that demonstrably
// exists and that the very same caller's `listCommits` hands back.

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
  SysMetadataCommitObject,
} from '@objectstack/metadata-core';

/**
 * The mechanism, and why the remedy here is NOT self-evidently the family's.
 *
 * Both sites carried the predicate the rest of this family carried:
 *
 *     const where = { id: request.commitId };
 *     if (request.organizationId) where.organization_id = request.organizationId;
 *
 * `organization_id = 'org'` matches no row whose column is NULL, so an
 * org-scoped caller could not resolve any commit recorded env-wide.
 *
 * ---------------------------------------------------------------------------
 * Why this site needed a decision the earlier cards did not face
 * ---------------------------------------------------------------------------
 * `where` is keyed on `id` — a primary-key lookup. The org predicate is not
 * scoping a scan the way {@link listCommits} (#7779) or {@link deletePackage}
 * (#7705) were; it reads like an authorization filter layered on a unique key.
 * If it WERE one, widening it would be widening an authorization boundary, and
 * "consistent with the family" would be the wrong reason to do it.
 *
 * Measured against the only door, it is not one:
 *
 *   1. Authorization on both routes is `requireManageMetadata(deps, _context)`
 *      in `packages/runtime/src/domains/packages.ts`, checked BEFORE the
 *      protocol is called. The org never gates the call.
 *   2. The `organizationId` those routes pass comes from
 *      `resolveActiveOrganizationId` (`packages/runtime/src/http-dispatcher.ts`),
 *      which reads the session's `activeOrganizationId` — a "which org am I
 *      looking at" selection — and whose whole body is `catch`-wrapped so ANY
 *      throw on the auth seam answers `undefined`.
 *   3. `undefined` omits the predicate entirely, which is the WIDEST reading:
 *      every organization's commits. A boundary that fails OPEN is not a
 *      boundary. That single fact rules out reading these lines as authz, and
 *      with it rules out remedy 3 (keep the check, distinguish "not yours"
 *      from "no such commit") — there is no authz here to make precise.
 *
 * So the choice was between mirroring the family's `$or` and dropping the
 * predicate outright. The `$or` is what landed, because dropping it would let
 * an org-scoped caller revert ANOTHER organization's commit by id — a genuine
 * widening this card never asked for — while the `$or` refuses exactly that
 * (pinned below) and admits only the env-wide rows.
 *
 * ---------------------------------------------------------------------------
 * The decisive in-code evidence: the body already accepts what the lookup refused
 * ---------------------------------------------------------------------------
 * #7559 changed `revertCommit` to resolve each item's scope FROM THE ROW rather
 * than from the request ({@link resolveMetaItemOrgScope}), with the in-code
 * rationale that "a batch legitimately mixes an env-wide artifact with an org
 * overlay". Verified here rather than taken on faith: that helper answers
 * `null` — env scope — for an item whose history is env-wide, even when the
 * request carries an org. The design therefore already accepts an org caller
 * operating on env-wide artifacts; a target lookup that refuses the same row
 * contradicted the body that would have processed it.
 *
 * `rollbackToPackageCommit` closes the argument. It derives its work list from
 * `listCommits`, which since #7814 returns org-scoped AND env-wide rows to an
 * org caller — then fed each id straight back into a lookup that refused half
 * of them. One function contradicted itself inside a single call.
 *
 * ---------------------------------------------------------------------------
 * Why a REAL engine and a REAL driver
 * ---------------------------------------------------------------------------
 * The question is whether `organization_id = 'org'` matches a NULL column, a
 * property of the driver's SQL rather than of a stub's `filter()`. Both
 * `deletePackage` suites and the ADR-0067 commit-history suites stub
 * `engine.find`, which is precisely why none of them could see any member of
 * this family. This file seeds through the REAL publish path, exactly as its
 * sibling `package-list-commits-org-scope.integration.test.ts` (#7814) does,
 * and for the same reason it lives in `packages/runtime`: `metadata-protocol`
 * cannot import `objectql` (dependency cycle).
 *
 * ---------------------------------------------------------------------------
 * Measured BEFORE the fix, on this branch's base
 * ---------------------------------------------------------------------------
 * Every positive case below was run against the unfixed protocol first:
 * `revertCommit` on the env-wide commit threw `COMMIT_NOT_FOUND` / 404, and
 * `rollbackToPackageCommit` answered `{success: false, failed: [c2]}` — the
 * state the sibling suite pinned as KNOWN-INCOMPLETE and handed to this card.
 * Reverse verification (restoring the strict equality after the fix) was
 * predicted to turn exactly the positive cases red and leave both negative
 * directions and the no-org door green, since strict equality is NARROWER than
 * the `$or`; measured on revert: exactly that. Numbers in the changeset.
 */

const PKG = 'com.repro.revert';
const OTHER_PKG = 'com.other.revert';
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
  const dir = mkdtempSync(join(tmpdir(), 'os-7819-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  // `sys_metadata_commit` holds the rows under test; the other three are what
  // the real publish path writes through on its way to recording a commit,
  // and what the revert then reads back and rewrites.
  const objects = [
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
    SysMetadataCommitObject,
  ] as any[];
  await driver.initObjects(objects);

  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  // `registerObject(schema, packageId)` — the second argument is REQUIRED.
  // Registered under the PLATFORM package, never under `PKG`, so the tables
  // cannot be torn out from under the assertions that read them back.
  for (const o of objects) engine.registry.registerObject(o, PLATFORM_PKG);
  cleanup.push(() => { void engine.destroy(); });

  // `'package-author'` is the genuine control-plane assembly's channel — the
  // #4463 runtime authoring gate is for environment-channel writes and would
  // otherwise refuse the seeding saves below.
  const protocol = new ObjectStackProtocolImplementation(
    engine as any, undefined, undefined, 'package-author',
  );
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
 * Author one draft and publish it, which is what records ONE commit row. The
 * commit's `organization_id` is the PUBLISH REQUEST's org (`?? null`), so
 * omitting `organizationId` reproduces exactly what the dispatcher sends when
 * the session has no active organization.
 */
async function publishOne(
  protocol: any,
  args: { view: string; packageId: string; organizationId?: string; message: string },
): Promise<string> {
  await protocol.saveMetaItem({
    type: 'view',
    name: args.view,
    item: viewBody(args.view),
    packageId: args.packageId,
    mode: 'draft',
  });
  const res = await protocol.publishPackageDrafts({
    packageId: args.packageId,
    ...(args.organizationId ? { organizationId: args.organizationId } : {}),
    message: args.message,
  });
  expect(res.success).toBe(true);
  expect(res.commitId).toBeTruthy();
  return res.commitId as string;
}

/** Distinct `created_at` values — the timeline is sorted by that ISO string. */
const tick = () => new Promise((r) => setTimeout(r, 5));

/**
 * ADR-0112 refusal shape. A bare `toThrow()` goes green against an
 * implementation that throws anything at all, including a bare `Error`, so
 * every refusal below is asserted on `code` AND `status` — the pair the
 * dispatcher's `errorFromThrown` turns into the HTTP answer.
 */
async function expectRefusal(run: () => Promise<unknown>, code: string, status: number) {
  const err = await run().then(
    () => { throw new Error(`expected ${code} (${status}), but the call resolved`); },
    (e: any) => e,
  );
  expect({ code: err?.code, status: err?.status }).toEqual({ code, status });
}

describe('#7819 tier 1 — an org-scoped caller must be able to revert an env-wide commit', () => {
  it('a no-org publish really does record an env-wide commit row (the premise, measured)', async () => {
    const { engine, protocol } = await boot();
    const id = await publishOne(protocol as any, {
      view: 'revert_env', packageId: PKG, message: 'env-wide publish',
    });

    // Straight out of SQLite: the column really is NULL, so the strict
    // equality this card removes really had nothing to match.
    const rows = (await engine.find('sys_metadata_commit', { where: {} })) as any[];
    expect(rows.map((r) => ({ id: r.id, org: r.organization_id ?? null }))).toEqual([
      { id, org: null },
    ]);
  });

  it('revertCommit resolves an env-wide commit for an org caller (was: COMMIT_NOT_FOUND 404)', async () => {
    const { protocol } = await boot();
    const p = protocol as any;
    const envWide = await publishOne(p, {
      view: 'revert_env', packageId: PKG, message: 'env-wide publish',
    });

    const result = await p.revertCommit({ commitId: envWide, organizationId: ACTIVE_ORG });

    // The CONSEQUENCE, not the call: the artifact the env-wide commit created
    // is gone. Before the fix this line was never reached — the lookup threw
    // 404 for a row the caller's own `listCommits` returns.
    expect(result.success).toBe(true);
    expect(result.reverted).toEqual([
      { type: 'view', name: 'revert_env', action: 'removed' },
    ]);
    expect(result.failed).toEqual([]);
  });

  it('revertCommit still REFUSES another organization’s commit', async () => {
    const { protocol } = await boot();
    const p = protocol as any;
    const foreign = await publishOne(p, {
      view: 'revert_foreign', packageId: PKG, organizationId: OTHER_ORG, message: 'other-org publish',
    });

    // The direction that must not widen. Dropping the predicate outright —
    // remedy 2, defensible on an id lookup — would have made this resolve, so
    // this case is what chose the `$or` over it.
    await expectRefusal(
      () => p.revertCommit({ commitId: foreign, organizationId: ACTIVE_ORG }),
      'COMMIT_NOT_FOUND',
      404,
    );
  });

  it('a caller with NO org can still revert an org-scoped commit (the other door)', async () => {
    const { protocol } = await boot();
    const p = protocol as any;
    const own = await publishOne(p, {
      view: 'revert_own', packageId: PKG, organizationId: ACTIVE_ORG, message: 'own-org publish',
    });

    // The no-org branch is deliberately left un-narrowed, exactly as #7705 and
    // #7779 left theirs. Narrowing it to `organization_id IS NULL` would hide
    // every org-scoped commit from this door — the same bug pointed the other
    // way. The direct-mount REST registrar passes no `organizationId` at all.
    const result = await p.revertCommit({ commitId: own });
    expect(result.success).toBe(true);
    expect(result.reverted.map((r: any) => r.name)).toEqual(['revert_own']);
  });

  it('rollbackToPackageCommit resolves an env-wide TARGET for an org caller', async () => {
    const { protocol } = await boot();
    const p = protocol as any;
    // The target itself env-wide, with a strictly newer org-scoped commit to
    // undo — the mirror image of the handoff case, exercising the second of
    // the two sites in isolation. Pre-fix the TARGET lookup threw 404 before
    // any planning happened.
    const envTarget = await publishOne(p, {
      view: 'roll_env_target', packageId: PKG, message: 'env-wide target',
    });
    await tick();
    await publishOne(p, {
      view: 'roll_newer', packageId: PKG, organizationId: ACTIVE_ORG, message: 'newer',
    });

    const rollback = await p.rollbackToPackageCommit({
      commitId: envTarget, organizationId: ACTIVE_ORG,
    });

    expect(rollback.failed).toEqual([]);
    expect(rollback.success).toBe(true);
    expect(rollback.revertedCommits).toHaveLength(1);
  });

  it('rollbackToPackageCommit still REFUSES another organization’s target commit', async () => {
    const { protocol } = await boot();
    const p = protocol as any;
    const foreign = await publishOne(p, {
      view: 'roll_foreign', packageId: PKG, organizationId: OTHER_ORG, message: 'other-org target',
    });

    await expectRefusal(
      () => p.rollbackToPackageCommit({ commitId: foreign, organizationId: ACTIVE_ORG }),
      'COMMIT_NOT_FOUND',
      404,
    );
  });

  it('rollbackToPackageCommit does NOT reach into another package’s commits', async () => {
    const { protocol } = await boot();
    const p = protocol as any;
    const target = await publishOne(p, {
      view: 'roll_target', packageId: PKG, organizationId: ACTIVE_ORG, message: 'target',
    });
    await tick();
    // Strictly NEWER than the target and env-wide, so it clears both filters
    // the planner applies except the package one. If widening the target
    // lookup had leaked package scope, this commit would be reverted too.
    const otherPkg = await publishOne(p, {
      view: 'roll_other_pkg', packageId: OTHER_PKG, message: 'other package, newer',
    });

    const rollback = await p.rollbackToPackageCommit({
      commitId: target, organizationId: ACTIVE_ORG,
    });

    expect(rollback.success).toBe(true);
    expect(rollback.revertedCommits).toEqual([]);
    expect(rollback.revertedCommits).not.toContain(otherPkg);
  });

  it('a caller with NO org can still roll back to an org-scoped target (the other door)', async () => {
    const { protocol } = await boot();
    const p = protocol as any;
    const target = await publishOne(p, {
      view: 'roll_own_target', packageId: PKG, organizationId: ACTIVE_ORG, message: 'own-org target',
    });
    await tick();
    await publishOne(p, { view: 'roll_after', packageId: PKG, message: 'after' });

    const rollback = await p.rollbackToPackageCommit({ commitId: target });

    expect(rollback.failed).toEqual([]);
    expect(rollback.success).toBe(true);
    expect(rollback.revertedCommits).toHaveLength(1);
  });
});
