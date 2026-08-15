// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8692 — what provenance a REAL `bootstrapPlatformAdmin` run leaves on the
 * platform default permission sets, and what `os meta resync` then does with it.
 *
 * ## Why this file exists at all
 *
 * `bootstrap-platform-admin.test.ts` covers the resync branch three ways —
 * `managed_by` hand-seeded to `null`, to `'user'`, to `'package'` — and every
 * one of them hand-builds the pre-image. That is correct unit coverage of the
 * BRANCH, and it is deliberately left untouched here. What none of them can
 * answer is which pre-image the seeder itself produces, because a fake `ql`
 * stores exactly the columns it is handed and a declared field `defaultValue`
 * never runs. So the one row shape the platform actually creates was the one
 * row shape nothing exercised, and the drift was invisible in both directions.
 *
 * This file closes that by seeding through the REAL shipped
 * `defaultPermissionSets` against a real `ObjectQL` engine over a real
 * better-sqlite3 `SqlDriver` — the same wiring `security-plugin.ts` and
 * `os meta resync` use, which hand the bare engine straight to the seeder.
 *
 * ## ⚠️ What these assertions ARE
 *
 * A **recording of measured behaviour, pinned as-is and NOT endorsed.** The
 * measurement below shows the platform's own default sets taking the resync
 * SKIP branch — the opposite of what #2705 built the flag for. Whether that is
 * a defect or the intent is an OPEN PRODUCT QUESTION, stated in #8692 and not
 * decided here:
 *
 *   > are the platform default permission sets meant to be platform-owned
 *   > (and therefore resyncable), or env-authored (and therefore deliberately
 *   > left alone)?
 *
 * The source argues both ways and the file that would settle it says both
 * things: the resync condition's `!row.managed_by ||` limb reads as though NULL
 * was expected for seeded rows, while the comment directly above the insert
 * calls the posture one that "keeps the platform defaults env-authored". Both
 * cannot be true. ⛔ So do NOT "fix" a failure here by editing these
 * assertions to taste — if one of them goes red, some deliberate change moved
 * the answer, and #8692 (or whatever superseded it) is where that change gets
 * recorded. The counterfactual in section 2 is what tells you WHICH link moved.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
// `sys_user` is what the promotion half enumerates. Registered as the REAL
// declaration so its verdict ("no human users yet") is a genuine reading of an
// empty table rather than a table-missing error `tryFind` swallowed into `[]` —
// the two are indistinguishable from the outside and only one of them is the
// first-boot ordering this file means to reproduce.
import { SysUser } from '@objectstack/platform-objects/identity';
// The REAL shipped seeder and the REAL shipped declarations. A local
// re-implementation of either would make this a test of the copy, which is
// precisely the gap the file exists to close.
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYSTEM_CTX = { isSystem: true };

const engines: ObjectQL[] = [];

afterEach(async () => {
  while (engines.length) {
    try {
      await engines.pop()?.destroy();
    } catch {
      /* noop */
    }
  }
});

/**
 * A fresh engine on its own `:memory:` database, carrying the permission-set
 * declaration passed in. `declaration` exists for section 2's counterfactual;
 * every case in section 1 boots the shipped declaration unmodified.
 */
async function boot(declaration: any = SysPermissionSet): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.security-objects',
    name: 'Security Objects',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [declaration, SysUserPermissionSet, SysUser],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

/**
 * The row as it is physically STORED, read at the driver past every engine-side
 * projection. The resync branch reads the engine's view, so both are asserted
 * where it matters — a default applied only on read and a default applied on
 * insert are different facts about the database, and only one of them survives
 * a restart.
 */
async function storedRow(engine: ObjectQL, name: string): Promise<any> {
  const driver: any = (engine as any).getDriver('sys_permission_set');
  const rows: any[] = await driver.knex('sys_permission_set').select('*').where({ name });
  return rows[0];
}

/** The row as the seeder's own `tryFind` sees it — the value resync branches on. */
async function rowViaEngine(engine: ObjectQL, name: string): Promise<any> {
  const rows: any[] = await (engine as any).find(
    'sys_permission_set',
    { where: { name }, limit: 1 },
    { context: SYSTEM_CTX },
  );
  return rows[0];
}

function collectingLogger() {
  const info: string[] = [];
  const warn: string[] = [];
  return {
    info,
    warn,
    logger: {
      info: (m: string) => info.push(m),
      warn: (m: string) => warn.push(m),
    },
  };
}

describe('#8692 — provenance of a seeder-created default permission set (measured, real engine)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. THE MEASUREMENT — recorded as it reads today, not as anyone wants it
  // ───────────────────────────────────────────────────────────────────────────

  it('ANTI-VACUITY: the shipped defaults are non-empty and really get seeded', async () => {
    // Every count below is relative to this set. If it were empty, "resync
    // skipped all of them" would be trivially true of nothing — the shape in
    // which this whole file could pass while measuring air.
    expect(defaultPermissionSets.length).toBeGreaterThan(0);

    const engine = await boot();
    const out = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);
    expect(out.seeded).toBe(defaultPermissionSets.length);
  });

  it('a seeder-created row is stored `managed_by: "admin"` — the declared default, NOT null', async () => {
    // ⚠️ MEASURED STATUS QUO, 2026-08-15. This is the single fact #8692 was
    // filed to establish, and the card explicitly did not know it: the seeder's
    // insert omits `managed_by` (`platformOwnedFields` returns label /
    // description / the four permission blobs / admin_scope, and the identity
    // and provenance columns are deliberately not among them), so the value
    // comes from the object declaration's `defaultValue: 'admin'`.
    //
    // The consequence is the next case. It is NOT endorsed here — see the file
    // header's open question.
    const engine = await boot();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    // Physically stored, not merely projected on read: the value survives a
    // restart, so every later boot reads it too.
    expect((await storedRow(engine, 'admin_full_access')).managed_by).toBe('admin');
    // …and the same value is what the seeder's own read sees, which is the one
    // the resync condition branches on.
    expect((await rowViaEngine(engine, 'admin_full_access')).managed_by).toBe('admin');
  });

  it('so `os meta resync` reconciles NOTHING — every platform default set takes the skip branch', async () => {
    // ⚠️ MEASURED STATUS QUO, 2026-08-15: resynced 0, resyncSkipped 8 (8 = the
    // whole shipped set at the time of measurement; asserted against the live
    // length so the pin stays true if a default set is added or removed).
    //
    // This is the exact inverse of what the `resync` flag was built for
    // (#2705: "reconcile the row to the shipped dist so a dev source edit takes
    // effect without `--fresh`"): the rows it exists to reconcile are the rows
    // it refuses to touch.
    const engine = await boot();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    const out = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { resync: true });

    expect(out.resynced).toBe(0);
    expect(out.resyncSkipped).toBe(defaultPermissionSets.length);
  });

  it('…and each skip is logged as an "intentional override" for a row no admin ever touched', async () => {
    // The half that misleads an operator rather than merely doing nothing: the
    // warn asserts a deliberate admin takeover, on rows whose only writer was
    // the seeder one call earlier. Pinned because a reader of the log has no
    // other signal — `resynced: 0` alone reads like "already up to date".
    const engine = await boot();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    const { warn, logger } = collectingLogger();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { resync: true, logger });

    expect(warn).toHaveLength(defaultPermissionSets.length);
    expect(warn).toContain(
      '[security] resync left admin_full_access untouched — row is admin-owned (intentional override)',
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. ATTRIBUTION — which link actually supplies the value
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * A counterfactual, NOT a proposed fix. It changes nothing shipped: it boots
   * a second engine on a CLONE of the declaration whose `managed_by` default is
   * respelled to `'platform'`, and runs the same unmodified seeder over the same
   * unmodified sets.
   *
   * Predicted direction, written down before it was run: if the declared default
   * is the whole source of the value, the clone must store `'platform'` and
   * resync must then reconcile every set — flipping BOTH counts. It does.
   *
   * That single flip establishes all three links at once, which no assertion in
   * section 1 can do on its own:
   *   - the seeder writes no `managed_by` of its own (otherwise it would beat
   *     the clone's default and the row would still read `'admin'`);
   *   - the engine really does apply a declared `defaultValue` on INSERT (the
   *     card's stated unknown);
   *   - the `!row.managed_by || row.managed_by === 'platform'` limb is live and
   *     working — the skip in section 1 is caused by the stored VALUE alone, not
   *     by a broken condition.
   *
   * ⛔ The last point is why this case must not be read as a recommendation.
   * That the shipped default COULD be respelled says nothing about whether it
   * SHOULD be; that is the maintainer call #8692 escalates.
   */
  it('ATTRIBUTION: respelling only the declared default to "platform" flips both counts', async () => {
    const respelled = {
      ...SysPermissionSet,
      fields: {
        ...(SysPermissionSet as any).fields,
        managed_by: { ...(SysPermissionSet as any).fields.managed_by, defaultValue: 'platform' },
      },
    };
    // Guard: the clone is a copy, and the shipped declaration is untouched by
    // building it. Without this the case could be measuring a mutation it made.
    expect((SysPermissionSet as any).fields.managed_by.defaultValue).toBe('admin');

    const engine = await boot(respelled);
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    expect((await storedRow(engine, 'admin_full_access')).managed_by).toBe('platform');

    const out = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { resync: true });
    expect(out.resynced).toBe(defaultPermissionSets.length);
    expect(out.resyncSkipped).toBe(0);
  });
});
