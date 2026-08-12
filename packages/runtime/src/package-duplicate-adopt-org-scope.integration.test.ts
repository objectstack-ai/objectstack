// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-engine regression for #7819 tier 2 — `protocol.duplicatePackage` and
// `protocol.reassignOrphanedMetadata` each scanned `sys_metadata` with a strict
// `organization_id` equality, so an org-scoped caller could not see any row
// recorded env-wide (`organization_id IS NULL`).

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
 * Why this suite exists at all, and why "the mechanism transfers" was NOT
 * enough to justify the fix it pins.
 *
 * #7819 carried four strict-equality sites. Tier 1 (`revertCommit`,
 * `rollbackToPackageCommit`) shipped in #7857 on measured evidence. These two
 * were filed as UNVERIFIED — a grep match with a plausible mechanism — on a
 * DIFFERENT table (`sys_metadata`, not `sys_metadata_commit`) with different
 * callers nobody had driven. The card was explicit that "latent, not live"
 * would be a complete outcome and that a fix for an unreachable state is worse
 * than no fix. So step one here was a measurement, and reachability has two
 * halves; both were checked before a line was edited.
 *
 * (a) DOES ANY CALLER PASS AN ORG? Yes — one production caller each, both in
 *     `packages/runtime/src/domains/packages.ts`:
 *     `POST /packages/:id/duplicate` (:696) and
 *     `POST /packages/:id/adopt-orphans` (:669). Each forwards
 *     `await deps.resolveActiveOrganizationId(_context)`, the same door tier 1
 *     measured.
 *
 * (b) CAN ENV-WIDE ROWS EXIST IN `sys_metadata` BY THEN? Yes, and this is the
 *     half that could have killed the card. It does not merely happen to be
 *     possible — it is the ordinary state:
 *       - a `saveMetaItem` from a session with no active org writes
 *         `organization_id = NULL` (`protocol.ts` §2 "env-wide overlays are
 *         written with organization_id = NULL"), and
 *         `resolveActiveOrganizationId` answers `undefined` both for such a
 *         session and for ANY throw on the auth seam, and
 *       - for the orphan site specifically, a `saveMetaItem` naming no package
 *         at all still succeeds TODAY and lands `package_id = null,
 *         organization_id = null` — the current write path mints exactly the
 *         orphan the scan could not see. That is pinned below, because it is
 *         what makes the orphan population live rather than a legacy residue
 *         the docstring could be read as describing.
 *
 * Both projected symptoms then reproduced on a real engine, and both were
 * WORSE than projected — see the two "measured before the fix" notes on the
 * positive cases.
 *
 * ---------------------------------------------------------------------------
 * Why the family's `$or`, and why that needed checking rather than assuming
 * ---------------------------------------------------------------------------
 * Tier 1 found its own sites were NOT the family's plain scan scoping — they
 * were primary-key lookups, so the predicate read like an authorization filter
 * and the remedy needed an argument. These two are the opposite: `where` is
 * `{ package_id, state }` and `{}` respectively, both genuine scans, so this is
 * the same shape #7705 (`deletePackage`) and #7779 (`listCommits`) already
 * carry and the family remedy applies directly.
 *
 * ---------------------------------------------------------------------------
 * Why a REAL engine and a REAL driver
 * ---------------------------------------------------------------------------
 * The question is whether `organization_id = 'org'` matches a NULL column — a
 * property of the driver's SQL, not of a stub's `filter()`. Every existing
 * suite over these two methods stubs `engine.find`
 * (`packages/objectql/src/protocol-package-lifecycle.test.ts`) or never passes
 * an org at all (`packages/qa/dogfood/.../package-first-authoring.dogfood.test.ts`),
 * which is exactly why none of them could see this family. This file lives in
 * `packages/runtime` for the same reason its tier-1 sibling
 * `package-revert-commit-org-scope.integration.test.ts` does: `metadata-protocol`
 * cannot import `objectql` (dependency cycle).
 *
 * ⚠️ For the next author: this suite resolves `@objectstack/metadata-protocol`
 * through its **`dist`**, and stack traces are source-mapped back to `src`. A
 * source-only revert therefore measures NOTHING while looking like it measured
 * something — rebuild the package between reverse-verification runs.
 */

const SRC = 'app.iojn';
const DST = 'app.iojn2';
const OTHER_PKG = 'app.other';
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
  const dir = mkdtempSync(join(tmpdir(), 'os-7819t2-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  // `sys_metadata` holds the rows under test; the other three are what the
  // real publish path writes through on its way there.
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
  // Registered under the PLATFORM package, never under `SRC`, so the tables
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

const viewBody = (name: string, label = name, object = 'anything') => ({
  name,
  label,
  type: 'grid',
  data: { provider: 'object', object },
  columns: ['id'],
});

const objectBody = (name: string) => ({
  name,
  label: name,
  fields: { title: { type: 'text', label: 'Title' } },
});

/**
 * Publish one item. Omitting `organizationId` reproduces exactly what the
 * dispatcher sends when the session has no active organization — and lands the
 * row env-wide.
 */
async function publish(
  p: any,
  args: { type: 'view' | 'object'; name: string; packageId: string; organizationId?: string; item?: unknown },
): Promise<void> {
  const res = await p.saveMetaItem({
    type: args.type,
    name: args.name,
    item: args.item ?? (args.type === 'object' ? objectBody(args.name) : viewBody(args.name)),
    packageId: args.packageId,
    mode: 'publish',
    ...(args.organizationId ? { organizationId: args.organizationId } : {}),
  });
  expect(res?.success ?? true).toBeTruthy();
}

/** Every `sys_metadata` row, straight out of SQLite. */
async function rowsOf(engine: any): Promise<Array<Record<string, any>>> {
  const rows = (await engine.find('sys_metadata', { where: {} })) as any[];
  return rows.map((r) => ({
    type: r.type,
    name: r.name,
    org: r.organization_id ?? null,
    pkg: r.package_id ?? null,
    body: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
  }));
}

const namesIn = (rows: Array<Record<string, any>>, pkg: string): string[] =>
  rows.filter((r) => r.pkg === pkg).map((r) => r.name).sort();

describe('#7819 tier 2 — duplicatePackage must copy the source’s env-wide rows', () => {
  it('the premise, measured: a no-org publish really does land an env-wide row', async () => {
    const { engine, protocol } = await boot();
    await publish(protocol as any, { type: 'view', name: 'iojn_env', packageId: SRC });
    await publish(protocol as any, {
      type: 'view', name: 'iojn_own', packageId: SRC, organizationId: ACTIVE_ORG,
    });

    // Straight out of SQLite: the column really is NULL on the first row, so
    // the strict equality this card removes really had nothing to match.
    expect((await rowsOf(engine)).map((r) => ({ name: r.name, org: r.org }))).toEqual([
      { name: 'iojn_env', org: null },
      { name: 'iojn_own', org: ACTIVE_ORG },
    ]);
  });

  it('copies BOTH the env-wide and the org-scoped rows (was: a partial copy reporting success)', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    await publish(p, { type: 'view', name: 'iojn_env', packageId: SRC });
    await publish(p, { type: 'view', name: 'iojn_own', packageId: SRC, organizationId: ACTIVE_ORG });

    const res = await p.duplicatePackage({
      sourcePackageId: SRC, targetPackageId: DST, targetNamespace: 'iojn2',
      organizationId: ACTIVE_ORG,
    });

    // MEASURED BEFORE THE FIX: `{success: true, copiedCount: 1, failedCount: 0}`
    // with only `iojn2_own` present — the env-wide row silently absent from a
    // copy that reported itself complete. The CONSEQUENCE, not the call: both
    // items exist in the duplicate.
    expect(res.failed).toEqual([]);
    expect(res.success).toBe(true);
    expect(res.copiedCount).toBe(2);

    // Each copy lands in the scope of the row it came from, not the request's
    // — see the object case below for why that is load-bearing rather than
    // tidy.
    const copied = (await rowsOf(engine)).filter((r) => r.pkg === DST);
    expect(copied.map((r) => ({ name: r.name, org: r.org }))).toEqual([
      { name: 'iojn2_env', org: null },
      { name: 'iojn2_own', org: ACTIVE_ORG },
    ]);
  });

  it('rewrites references INTO the copy — the rename map is built from the scan (the sharper defect)', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    // The realistic split: the object published before an org was selected,
    // the view that references it published after.
    await publish(p, { type: 'object', name: 'iojn_widget', packageId: SRC });
    await publish(p, {
      type: 'view', name: 'iojn_list', packageId: SRC, organizationId: ACTIVE_ORG,
      item: viewBody('iojn_list', 'List', 'iojn_widget'),
    });

    const res = await p.duplicatePackage({
      sourcePackageId: SRC, targetPackageId: DST, targetNamespace: 'iojn2',
      organizationId: ACTIVE_ORG,
    });

    // MEASURED BEFORE THE FIX: `{success: true, copiedCount: 1}` — the env-wide
    // OBJECT row was skipped, so `renameMap` (built ONLY from the rows the scan
    // returns) came out EMPTY, and the copied view was renamed `iojn2_list`
    // while its `data.object` still read `iojn_widget`: a duplicate silently
    // wired back to the base it was cloned from, reporting success. This is the
    // case that makes the defect a corruption rather than an omission.
    //
    // ⭐ And this case is why widening the SCAN alone was not a fix. `object`
    // is declared `allowOrgOverride=false`, so stamping the request's org on
    // the copy is refused outright with `NOT_OVERRIDABLE` — measured, with the
    // scan widened and the write still request-scoped, this answered
    // `failed: [{type: 'object', name: 'iojn_widget', …}]`. An `object` cannot
    // exist org-scoped at all, so EVERY object row is env-wide and an
    // org-scoped `duplicatePackage` could never copy one: ADR-0070 D4's
    // "duplicate base" could not duplicate what a base is mostly made of
    // whenever an org was active. The copy therefore inherits its source row's
    // scope, asserted below.
    expect(res.failed).toEqual([]);
    expect(res.success).toBe(true);
    const copied = (await rowsOf(engine)).filter((r) => r.pkg === DST);
    expect(copied.map((r) => ({ name: r.name, org: r.org })).sort((a, b) => a.name.localeCompare(b.name)))
      .toEqual([
        { name: 'iojn2_list', org: ACTIVE_ORG },
        { name: 'iojn2_widget', org: null },
      ]);
    const list = copied.find((r) => r.name === 'iojn2_list');
    expect(list?.body?.data?.object).toBe('iojn2_widget');
  });

  it('the caller’s own org SHADOWS env-wide when both scopes carry the same item', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    // A collision that could not occur while the scan was a strict equality,
    // and therefore a hazard this fix introduces rather than inherits: one item
    // present twice. Both copies would be written under the SAME target key
    // (`type, name, organization_id, COALESCE(package_id, '')`), so without the
    // precedence rule the surviving body would be decided by driver row order.
    // ADR-0005 order — the caller's own org shadows env-wide — is what
    // `resolveMetaItemOrgScope` applies to history lineages, and what this
    // caller already reads everywhere else.
    await publish(p, {
      type: 'view', name: 'iojn_dup', packageId: SRC,
      item: viewBody('iojn_dup', 'ENV BODY'),
    });
    await publish(p, {
      type: 'view', name: 'iojn_dup', packageId: SRC, organizationId: ACTIVE_ORG,
      item: viewBody('iojn_dup', 'ORG BODY'),
    });

    const res = await p.duplicatePackage({
      sourcePackageId: SRC, targetPackageId: DST, targetNamespace: 'iojn2',
      organizationId: ACTIVE_ORG,
    });

    expect(res.copiedCount).toBe(1);
    const copied = (await rowsOf(engine)).filter((r) => r.pkg === DST);
    expect(copied).toHaveLength(1);
    expect(copied[0]?.body?.label).toBe('ORG BODY');
  });

  it('does NOT copy another organization’s rows', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    await publish(p, { type: 'view', name: 'iojn_own', packageId: SRC, organizationId: ACTIVE_ORG });
    await publish(p, { type: 'view', name: 'iojn_foreign', packageId: SRC, organizationId: OTHER_ORG });

    // The direction that must not widen. `$or` admits env-wide rows and refuses
    // this one; dropping the predicate outright would have copied it.
    const res = await p.duplicatePackage({
      sourcePackageId: SRC, targetPackageId: DST, targetNamespace: 'iojn2',
      organizationId: ACTIVE_ORG,
    });

    expect(res.copiedCount).toBe(1);
    expect(namesIn(await rowsOf(engine), DST)).toEqual(['iojn2_own']);
  });

  it('does NOT reach into another package’s rows', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    await publish(p, { type: 'view', name: 'iojn_own', packageId: SRC, organizationId: ACTIVE_ORG });
    // Env-wide AND in a different package, so it clears the org filter the fix
    // widened and is refused by the package one alone.
    await publish(p, { type: 'view', name: 'iojn_elsewhere', packageId: OTHER_PKG });

    const res = await p.duplicatePackage({
      sourcePackageId: SRC, targetPackageId: DST, targetNamespace: 'iojn2',
      organizationId: ACTIVE_ORG,
    });

    expect(res.copiedCount).toBe(1);
    expect(namesIn(await rowsOf(engine), DST)).toEqual(['iojn2_own']);
  });

  it('a caller with NO org still copies org-scoped rows (the other door, un-narrowed)', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    await publish(p, { type: 'view', name: 'iojn_env', packageId: SRC });
    await publish(p, { type: 'view', name: 'iojn_own', packageId: SRC, organizationId: ACTIVE_ORG });

    // The no-org branch is deliberately NOT narrowed to `organization_id IS
    // NULL`, exactly as #7705 / #7779 / tier 1 left theirs. Narrowing it would
    // drop every org-scoped row from this door's copy — the same bug pointed
    // the other way.
    const res = await p.duplicatePackage({
      sourcePackageId: SRC, targetPackageId: DST, targetNamespace: 'iojn2',
    });

    expect(res.success).toBe(true);
    expect(namesIn(await rowsOf(engine), DST)).toEqual(['iojn2_env', 'iojn2_own']);
  });
});

describe('#7819 tier 2 — reassignOrphanedMetadata must see env-wide orphans', () => {
  it('a package-less saveMetaItem still mints an env-wide orphan TODAY (why this is live, not legacy)', async () => {
    const { engine, protocol } = await boot();

    // The docstring on `reassignOrphanedMetadata` describes orphans as a
    // pre-package-first residue, and ADR-0070 D1 does reject a new orphan that
    // names a READ-ONLY package (`WRITABLE_PACKAGE_REQUIRED`). But naming no
    // package at all is still accepted, and lands both columns NULL — so the
    // population this method exists to find is still being produced, in exactly
    // the scope an org-scoped caller could not see. This case is the reason the
    // measurement came back live instead of latent.
    const res = await (protocol as any).saveMetaItem({
      type: 'view',
      name: 'loose_view',
      item: viewBody('loose_view'),
      mode: 'publish',
    });
    expect(res?.success ?? true).toBeTruthy();

    expect((await rowsOf(engine)).map((r) => ({ name: r.name, org: r.org, pkg: r.pkg }))).toEqual([
      { name: 'loose_view', org: null, pkg: null },
    ]);
  });

  it('adopts the env-wide orphan as well as its own (was: structurally invisible)', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    await publish(p, { type: 'view', name: 'iojn_owned', packageId: SRC, organizationId: ACTIVE_ORG });
    // Two orphans, one per scope. The env-wide one is minted through the real
    // write path pinned above, not hand-inserted.
    await p.saveMetaItem({ type: 'view', name: 'orph_env', item: viewBody('orph_env'), mode: 'publish' });
    await p.saveMetaItem({
      type: 'view', name: 'orph_own', item: viewBody('orph_own'), mode: 'publish',
      organizationId: ACTIVE_ORG,
    });

    const res = await p.reassignOrphanedMetadata({
      targetPackageId: DST, organizationId: ACTIVE_ORG,
    });

    // MEASURED BEFORE THE FIX: `{success: true, reassignedCount: 1}` — only
    // `orph_own` moved, with the env-wide orphan left at `package_id = null`
    // and nothing reporting that it had been skipped. Finding orphans is this
    // method's entire purpose, so a class of orphan it cannot see is a wrong
    // answer rather than a partial one.
    expect(res.reassignedCount).toBe(2);
    expect(res.reassigned.map((r: any) => r.name).sort()).toEqual(['orph_env', 'orph_own']);
    expect(namesIn(await rowsOf(engine), DST)).toEqual(['orph_env', 'orph_own']);
  });

  it('does NOT adopt another organization’s orphans', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    await p.saveMetaItem({ type: 'view', name: 'orph_env', item: viewBody('orph_env'), mode: 'publish' });
    await p.saveMetaItem({
      type: 'view', name: 'orph_foreign', item: viewBody('orph_foreign'), mode: 'publish',
      organizationId: OTHER_ORG,
    });

    const res = await p.reassignOrphanedMetadata({
      targetPackageId: DST, organizationId: ACTIVE_ORG,
    });

    // The direction that must not widen.
    expect(res.reassigned.map((r: any) => r.name)).toEqual(['orph_env']);
    const rows = await rowsOf(engine);
    expect(namesIn(rows, DST)).toEqual(['orph_env']);
    expect(rows.find((r) => r.name === 'orph_foreign')?.pkg).toBeNull();
  });

  it('leaves OWNED rows alone — an env-wide row bound to a real package is not an orphan', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    // Env-wide, so the widened scan now RETURNS it; it must still be filtered
    // out by the orphan test rather than adopted. Widening the scan must not
    // widen what counts as an orphan.
    await publish(p, { type: 'view', name: 'iojn_env', packageId: SRC });
    await p.saveMetaItem({ type: 'view', name: 'orph_env', item: viewBody('orph_env'), mode: 'publish' });

    const res = await p.reassignOrphanedMetadata({
      targetPackageId: DST, organizationId: ACTIVE_ORG,
    });

    expect(res.reassigned.map((r: any) => r.name)).toEqual(['orph_env']);
    expect((await rowsOf(engine)).find((r) => r.name === 'iojn_env')?.pkg).toBe(SRC);
  });

  it('a caller with NO org still adopts every scope’s orphans (the widest door, un-narrowed)', async () => {
    const { engine, protocol } = await boot();
    const p = protocol as any;
    await p.saveMetaItem({ type: 'view', name: 'orph_env', item: viewBody('orph_env'), mode: 'publish' });
    await p.saveMetaItem({
      type: 'view', name: 'orph_a', item: viewBody('orph_a'), mode: 'publish', organizationId: ACTIVE_ORG,
    });
    await p.saveMetaItem({
      type: 'view', name: 'orph_b', item: viewBody('orph_b'), mode: 'publish', organizationId: OTHER_ORG,
    });

    // ⛔ `where` stays `{}` for this door — the card named it the family's worst
    // exposure precisely because it already scans EVERY organization's rows,
    // and narrowing it to `organization_id IS NULL` would re-create this bug
    // pointed the other way. This case pins the behaviour as it stands so the
    // door cannot drift silently; whether it SHOULD be this wide is #7780's
    // open product question, which is a maintainer call and not decided here.
    const res = await p.reassignOrphanedMetadata({ targetPackageId: DST });

    expect(res.reassignedCount).toBe(3);
    expect(namesIn(await rowsOf(engine), DST)).toEqual(['orph_a', 'orph_b', 'orph_env']);
  });
});
