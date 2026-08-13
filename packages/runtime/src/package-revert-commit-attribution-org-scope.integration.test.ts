// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-engine regression for #7860 — `protocol.revertCommit` recorded its
// compensating commit under the REQUEST's organization
// (`recordPackageCommit({ orgId: request.organizationId ?? null })`) rather
// than under the scope of the commit it was reverting.

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
 * The invariant, stated once: a revert commit is visible to exactly the
 * readers who can see the commit it reverts.
 *
 * ---------------------------------------------------------------------------
 * Why this was a REPORTING defect and not a design question
 * ---------------------------------------------------------------------------
 * The card (#7860) was filed explicitly NOT as a defect — the behaviour is
 * self-consistent for the caller who performed the revert, and it asked for a
 * measurement first: after an org-scoped revert of an env-wide commit, what
 * does a DIFFERENT organization's `listCommits` show, and what does the no-org
 * (direct-mount REST) door see? Measured here, on a real driver, before any
 * edit:
 *
 *   actor (`org_active`)  → [revert, apply]   coherent
 *   different org         → [apply]           the env-wide publish, with NO
 *                                             compensation anywhere after it
 *   no-org REST           → [revert, apply]   coherent
 *
 * The middle row is the defect, and what makes it more than cosmetic is the
 * artifact state measured alongside it: `sys_metadata` held NO row for the
 * reverted view afterwards. `revertCommit` resolves each item's scope from the
 * ROW (#7559), so the artifact really was removed ENV-WIDE — the effect is
 * global while the record documenting it was private. A reader in another
 * organization saw an `apply` commit that was never compensated, for an
 * artifact that had in fact already been withdrawn underneath it. And since
 * #7814, `rollbackToPackageCommit` PLANS from `listCommits`, so this list is
 * not merely an observability surface.
 *
 * The mirror direction is the same mismatch pointed the other way and is
 * pinned below: a no-org caller reverting an ORG-SCOPED commit stamped the
 * revert env-wide, so every other organization read a dangling `Revert: …`
 * whose `parentCommitId` names a commit that door cannot see.
 *
 * ---------------------------------------------------------------------------
 * Why a REAL engine and a REAL driver
 * ---------------------------------------------------------------------------
 * Every assertion here turns on whether `organization_id = 'org'` matches a
 * NULL column — a property of the driver's SQL, not of a stub's `filter()`.
 * The suites in this family that stub `engine.find` are structurally unable to
 * see any of it. This file seeds through the REAL publish path, exactly as its
 * siblings `package-revert-commit-org-scope.integration.test.ts` (#7819) and
 * `package-list-commits-org-scope.integration.test.ts` (#7814), and lives in
 * `packages/runtime` for the same reason they do: `metadata-protocol` cannot
 * import `objectql` (dependency cycle).
 *
 * ⚠️ These suites resolve `metadata-protocol` through its `dist` while stack
 * traces are source-mapped back to `src`, so an edited-but-unbuilt `src` looks
 * like it is running while the old bytes execute. Every number above was taken
 * with a rebuild between measurements.
 *
 * ---------------------------------------------------------------------------
 * Reachability
 * ---------------------------------------------------------------------------
 * Only since #7819 tier 1. Before it the target lookup answered
 * `COMMIT_NOT_FOUND` (404) for an env-wide row, so an org-scoped caller could
 * not reach the attribution line with a mismatched scope at all.
 */

const PKG = 'com.repro.attrib';
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
  const dir = mkdtempSync(join(tmpdir(), 'os-7860-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
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
  for (const o of objects) engine.registry.registerObject(o, PLATFORM_PKG);
  cleanup.push(() => { void engine.destroy(); });

  // `'package-author'` is the control-plane assembly's channel — the #4463
  // runtime authoring gate would otherwise refuse the seeding saves below.
  const protocol = new ObjectStackProtocolImplementation(
    engine as any, undefined, undefined, 'package-author',
  );
  return { engine, protocol };
}

const viewBody = (name: string) => ({
  name,
  label: name,
  type: 'grid',
  object: 'anything', // [#7741] the inline arm requires the object binding pair
  viewKind: 'list',
  data: { provider: 'object', object: 'anything' },
  columns: ['id'],
});

/**
 * Author one draft and publish it — what records ONE commit row. The commit's
 * `organization_id` is the PUBLISH REQUEST's org (`?? null`), so omitting
 * `organizationId` reproduces exactly what the dispatcher sends when the
 * session has no active organization.
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

const ops = (commits: any[]) => commits.map((c) => c.operation);

describe('#7860 — a revert commit is attributed to what it reverted, not to who asked', () => {
  it('an org caller reverting an ENV-WIDE commit records the revert env-wide', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    const envWide = await publishOne(p, {
      view: 'attr_env', packageId: PKG, message: 'env-wide publish',
    });

    const result = await p.revertCommit({ commitId: envWide, organizationId: ACTIVE_ORG });
    expect(result.success).toBe(true);

    // Straight out of SQLite. Pre-fix this row carried `org_active`.
    const rows = (await engine.find('sys_metadata_commit', { where: {} })) as any[];
    expect(rows.map((r) => ({ op: r.operation, org: r.organization_id ?? null }))).toEqual([
      { op: 'apply', org: null },
      { op: 'revert', org: null },
    ]);
  });

  it('a DIFFERENT organization sees the compensation, not a bare uncompensated publish', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    const envWide = await publishOne(p, {
      view: 'attr_env', packageId: PKG, message: 'env-wide publish',
    });
    await p.revertCommit({ commitId: envWide, organizationId: ACTIVE_ORG });

    // THE defect this card was opened to measure. Pre-fix: `['apply']` — the
    // env-wide publish alone, with nothing recording that it was undone.
    const asOther = await p.listCommits({ packageId: PKG, organizationId: OTHER_ORG });
    expect(ops(asOther)).toEqual(['revert', 'apply']);
    expect(asOther[0].parentCommitId).toBe(envWide);

    // Why the omission mattered: the artifact really is gone ENV-WIDE (items
    // revert in the ROW's scope, #7559), so the reader above was being shown
    // an `apply` that had already been withdrawn underneath it.
    const meta = (await engine.find('sys_metadata', { where: { name: 'attr_env' } })) as any[];
    expect(meta).toEqual([]);
  });

  it('the actor and the no-org REST door keep the timeline they already had', async () => {
    const { protocol } = await boot();
    const p = protocol as any;
    const envWide = await publishOne(p, {
      view: 'attr_env', packageId: PKG, message: 'env-wide publish',
    });
    await p.revertCommit({ commitId: envWide, organizationId: ACTIVE_ORG });

    // Both were coherent BEFORE the fix and must stay so after it — the change
    // may only ADD the missing reader, never trade one blind spot for another.
    expect(ops(await p.listCommits({ packageId: PKG, organizationId: ACTIVE_ORG })))
      .toEqual(['revert', 'apply']);
    expect(ops(await p.listCommits({ packageId: PKG }))).toEqual(['revert', 'apply']);
  });

  it('mirror — the no-org door reverting an ORG-SCOPED commit records the revert in THAT org', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    const owned = await publishOne(p, {
      view: 'attr_owned', packageId: PKG, organizationId: ACTIVE_ORG, message: 'org_active publish',
    });

    const result = await p.revertCommit({ commitId: owned });
    expect(result.success).toBe(true);

    const rows = (await engine.find('sys_metadata_commit', { where: {} })) as any[];
    expect(rows.map((r) => ({ op: r.operation, org: r.organization_id ?? null }))).toEqual([
      { op: 'apply', org: ACTIVE_ORG },
      { op: 'revert', org: ACTIVE_ORG },
    ]);

    // Pre-fix the revert was stamped env-wide, so an unrelated organization
    // read a DANGLING `Revert: …` whose parent it cannot see. The owning org
    // and the no-org door still see the pair.
    expect(await p.listCommits({ packageId: PKG, organizationId: OTHER_ORG })).toEqual([]);
    expect(ops(await p.listCommits({ packageId: PKG, organizationId: ACTIVE_ORG })))
      .toEqual(['revert', 'apply']);
    expect(ops(await p.listCommits({ packageId: PKG }))).toEqual(['revert', 'apply']);
  });
});
