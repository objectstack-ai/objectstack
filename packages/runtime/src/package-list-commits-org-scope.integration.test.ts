// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-engine regression for #7779 — `protocol.listCommits` asked for commit
// rows with a strict `organization_id` equality and therefore returned NONE of
// the rows stored env-wide, hiding whole stretches of a package's ADR-0067
// timeline from any session that had an active organization.

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
 * The mechanism, and why it is LIVE rather than latent.
 *
 * `listCommits` selected its rows with the predicate its sibling one function
 * above carried until #7705 (PR #7771) replaced it:
 *
 *     const where = { package_id: request.packageId };
 *     if (request.organizationId) where.organization_id = request.organizationId;
 *
 * `organization_id = 'org'` matches no row whose column is NULL, so an
 * org-scoped read returned nothing for every commit recorded env-wide.
 *
 * ---------------------------------------------------------------------------
 * Step one, MEASURED before the fix was written: are env-wide commit rows
 * actually WRITTEN?
 * ---------------------------------------------------------------------------
 * Yes — on the only door there is. {@link recordPackageCommit} persists
 * `organization_id: args.orgId`, and `orgId` is `request.organizationId ??
 * null`. The single door into a publish is the dispatcher's `POST
 * /packages/:id/publish-drafts`
 * (`packages/runtime/src/domains/packages.ts`), which forwards an org only
 * when `resolveActiveOrganizationId` yields one — and that resolver
 * (`packages/runtime/src/http-dispatcher.ts`) answers `undefined` both for a
 * session with no active organization and for ANY throw on the auth seam,
 * because its whole body is `catch`-wrapped. So a publish issued before an org
 * is selected, or during a transient auth failure, records its commit env-wide
 * — permanently, since the timeline is append-only.
 *
 * Driving that real path (no `organizationId`, real engine, real driver)
 * produced `organization_id: null` in SQLite, and the org-scoped read of the
 * same package then answered `[]`. This suite is that measurement.
 *
 * ---------------------------------------------------------------------------
 * Why this is not "just" an observability defect
 * ---------------------------------------------------------------------------
 * The card framed the blast radius as audit/observability, in contrast with
 * #7705's data-lifecycle one. Measurement widened it:
 * {@link rollbackToPackageCommit} derives the set of commits it must undo FROM
 * THIS LIST. A commit the list cannot see is a commit the rollback silently
 * skips — measured pre-fix, an org-scoped `rollbackToPackageCommit` past an
 * env-wide commit answered `{success: true, revertedCommits: []}` while that
 * commit's changes stayed live. A rollback that reports success and rolls back
 * nothing is a correctness defect, not a reporting one.
 *
 * ---------------------------------------------------------------------------
 * Why a REAL engine and a REAL driver
 * ---------------------------------------------------------------------------
 * The question is whether `organization_id = 'org'` matches a NULL column.
 * That is a property of the driver's SQL, not of a stub's `filter()` — a
 * hand-built double answers whatever its author assumed. Both existing
 * `deletePackage` suites stubbed `engine.find`, which is precisely why neither
 * could see the sibling defect, and the ADR-0067 commit-history suites stub
 * the store too. So this file seeds through the REAL publish path
 * (`publishPackageDrafts`, the same call the dispatcher makes) and reads back
 * what actually landed in SQLite.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE the revert was run
 * ---------------------------------------------------------------------------
 * Restoring the strict equality was predicted to turn the two positive cases
 * red — the env-wide commit disappearing from the org-scoped list — and to
 * leave both negative cases green, because strict equality is NARROWER than
 * the `$or`: it cannot reach another organization's rows or another package's,
 * and it does not touch the no-org branch at all. Measured on revert: exactly
 * that. See the changeset for the recorded numbers.
 */

const PKG = 'com.repro.commits';
const OTHER_PKG = 'com.other.commits';
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
  const dir = mkdtempSync(join(tmpdir(), 'os-7779-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  // `sys_metadata_commit` is the table under test; the other three are what
  // the real publish path writes through on its way to recording a commit.
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
  // Omitting it compiles under this package's own `typecheck` script (which
  // excludes `*.test.ts`) but is a raw TS2554 to the type-check-coverage
  // ratchet, which measures `tsc --noEmit` with the tests put back. Registered
  // under the PLATFORM package, never under `PKG`, so the table cannot be torn
  // out from under the assertions that read it back.
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

const viewBody = (name: string, label: string) => ({
  name,
  label,
  type: 'grid',
  data: { provider: 'object', object: 'anything' },
  columns: ['id'],
});

/**
 * Author one draft and publish it, which is what records ONE commit row. The
 * commit's `organization_id` is the PUBLISH REQUEST's org (`?? null`), so
 * omitting `organizationId` here reproduces exactly what the dispatcher sends
 * when the session has no active organization.
 */
async function publishOne(
  protocol: any,
  args: { view: string; packageId: string; organizationId?: string; message: string },
): Promise<string> {
  await protocol.saveMetaItem({
    type: 'view',
    name: args.view,
    item: viewBody(args.view, args.view),
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
 * Seed one commit in each scope that matters. Returns the ids by role so the
 * assertions name what they mean rather than an opaque position.
 */
async function seed(protocol: any) {
  // The miss: recorded env-wide, because the publishing session had no
  // active organization.
  const envWide = await publishOne(protocol, {
    view: 'commits_env', packageId: PKG, message: 'env-wide publish',
  });
  await tick();
  // The caller's OWN org — the only rows the strict equality ever found.
  const own = await publishOne(protocol, {
    view: 'commits_own', packageId: PKG, organizationId: ACTIVE_ORG, message: 'own-org publish',
  });
  await tick();
  // Negative 1 — same package, ANOTHER organization. Must stay invisible.
  const foreign = await publishOne(protocol, {
    view: 'commits_foreign', packageId: PKG, organizationId: OTHER_ORG, message: 'other-org publish',
  });
  await tick();
  // Negative 2 — ANOTHER package, env-wide. Must never appear.
  const otherPkg = await publishOne(protocol, {
    view: 'commits_other_pkg', packageId: OTHER_PKG, message: 'other package publish',
  });
  return { envWide, own, foreign, otherPkg };
}

const idsOf = (commits: any[]): string[] => commits.map((c) => c.id).sort();

describe('#7779 — org-scoped listCommits must not hide env-wide commit rows', () => {
  it('a no-org publish really does record an env-wide commit row (the premise, measured)', async () => {
    const { engine, protocol } = await boot();
    const id = await publishOne(protocol as any, {
      view: 'commits_env', packageId: PKG, message: 'env-wide publish',
    });

    // Straight out of SQLite: the column really is NULL, so the strict
    // equality below really has nothing to match.
    const rows = (await engine.find('sys_metadata_commit', { where: {} })) as any[];
    expect(rows.map((r) => ({ id: r.id, org: r.organization_id ?? null }))).toEqual([
      { id, org: null },
    ]);
  });

  it('returns the env-wide commits to an org-scoped caller (was: returned none of them)', async () => {
    const { protocol } = await boot();
    const { envWide, own } = await seed(protocol as any);

    const commits = await (protocol as any).listCommits({
      packageId: PKG,
      organizationId: ACTIVE_ORG,
    });

    // The CONSEQUENCE: the caller's own commit AND the env-wide one. Before
    // the fix this was `[own]` alone — `envWide` was missing outright.
    expect(idsOf(commits)).toEqual([envWide, own].sort());

    // Newest-first is the contract the timeline UI and
    // `rollbackToPackageCommit` both rely on, and widening the predicate must
    // not disturb it: `own` was published after `envWide`.
    expect(commits[0].id).toBe(own);
    expect(commits.map((c: any) => c.message)).toEqual(['own-org publish', 'env-wide publish']);
  });

  it('does NOT surface another organization’s commits', async () => {
    const { protocol } = await boot();
    const { foreign } = await seed(protocol as any);

    const commits = await (protocol as any).listCommits({
      packageId: PKG,
      organizationId: ACTIVE_ORG,
    });

    // The direction that must not widen. A commit timeline that leaked
    // another tenant's authoring history would be a worse defect than the
    // under-reporting this closes.
    expect(idsOf(commits)).not.toContain(foreign);
  });

  it('does NOT surface another package’s commits', async () => {
    const { protocol } = await boot();
    const { otherPkg } = await seed(protocol as any);

    const commits = await (protocol as any).listCommits({
      packageId: PKG,
      organizationId: ACTIVE_ORG,
    });

    expect(idsOf(commits)).not.toContain(otherPkg);
  });

  it('a caller with NO org still sees the package’s whole timeline (the other door)', async () => {
    const { protocol } = await boot();
    const { envWide, own, foreign } = await seed(protocol as any);

    // The no-org branch is deliberately left package-wide. Narrowing it to
    // `organization_id IS NULL` — mirroring only half the #3115 shape — would
    // hide every org-scoped commit from this door instead, re-creating the
    // bug pointed the other way. #7705 left its own no-org branch alone for
    // the same reason and this pins the equivalent here.
    const commits = await (protocol as any).listCommits({ packageId: PKG });

    expect(idsOf(commits)).toEqual([envWide, own, foreign].sort());
  });

  it('the timeline the rollback planner reads now contains the env-wide commit', async () => {
    const { protocol } = await boot();
    const p = protocol as any;

    // C1 under an active org, then C2 env-wide and strictly newer — the shape
    // a session hits when its org resolution lapses between two publishes.
    const c1 = await publishOne(p, {
      view: 'roll_a', packageId: PKG, organizationId: ACTIVE_ORG, message: 'c1',
    });
    await tick();
    const c2 = await publishOne(p, { view: 'roll_b', packageId: PKG, message: 'c2' });

    // `rollbackToPackageCommit` filters THIS list to decide what to undo, so
    // the fix is what makes C2 reachable by the planner at all. Before it, the
    // list was `[c1]` and an org-scoped rollback to C1 answered
    // `{success: true, revertedCommits: []}` — reporting a rollback it had not
    // performed, with C2's changes still live.
    const commits = await p.listCommits({ packageId: PKG, organizationId: ACTIVE_ORG });
    expect(idsOf(commits)).toEqual([c1, c2].sort());

    // [#7819 tier 1] ⭐ THE GAP THIS SUITE HANDED ON IS NOW CLOSED — these
    // lines are the handoff, and they changed exactly as it predicted.
    //
    // What they asserted until #7819: `revertCommit` (its own `findOne`) and
    // `rollbackToPackageCommit` (its target lookup) still carried the
    // byte-identical strict equality, because `protocol.ts` is serialized and
    // #7779 held it for `listCommits` alone. So the planner SAW C2 and asked
    // `revertCommit` to undo it, and that lookup could not resolve an env-wide
    // row — the rollback answered `success: false` naming C2. Already strictly
    // better than the silent `success: true` of before #7814 (loud,
    // attributable, non-destructive), but still a legitimate operation
    // blocked; the assertion existed so the remaining half could not drift
    // unnoticed before its own card landed.
    //
    // #7819 tier 1 widened both lookups to the same `$or` this suite pinned
    // for `listCommits`, so C2 now resolves and is actually undone. The case
    // survives as the family's END-TO-END pin: the planner sees the env-wide
    // commit (asserted above) AND can now act on it — the only combination
    // under which an org-scoped rollback past an env-wide publish does what it
    // reports. Its own negative directions live in the sibling
    // `package-revert-commit-org-scope.integration.test.ts`.
    const rollback = await p.rollbackToPackageCommit({ commitId: c1, organizationId: ACTIVE_ORG });
    expect(rollback.failed).toEqual([]);
    expect(rollback.success).toBe(true);
    expect(rollback.revertedCommits).toEqual([c2]);
  });
});
