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
 * ## The ruling these assertions now pin (2026-08-15, Option A)
 *
 * The original version of this file recorded a MEASUREMENT and explicitly
 * refused to endorse it: a seeded row stored `'admin'` (the declaration's
 * `defaultValue`), so `os meta resync` returned `resynced 0 / resyncSkipped 8`
 * and skipped every platform default set — the inverse of what #2705 built the
 * flag for. It left the product question open:
 *
 *   > are the platform default permission sets meant to be platform-owned
 *   > (and therefore resyncable), or env-authored (and therefore deliberately
 *   > left alone)?
 *
 * ⛔ That question is CLOSED. The maintainer ruled **Option A** on 2026-08-15:
 * the platform default sets are platform-owned and resyncable, and the seeder
 * stamps `managed_by: 'platform'` on its insert. This file no longer records an
 * undecided state — it pins the ruling, on BOTH sides of the line the ruling
 * drew:
 *
 *  1. **Forward (section 1)** — a fresh install stores `'platform'` and a real
 *     resync reconciles every default set.
 *  2. **Legacy (section 2)** — a row from a PRE-ruling install still carries
 *     `'admin'` and is still SKIPPED, forever and on purpose. The ruling
 *     forbids a migration: a stored `'admin'` cannot be told apart from a
 *     genuine Setup takeover, so restamping could silently overwrite a real
 *     admin's edits on the next resync. Report, don't rewrite.
 *
 * Section 2 is the half that is easy to lose. Deleting it would leave the
 * upgrade path — the one every existing deployment is actually on — with no
 * coverage at all, and a later "cleanup" that restamps legacy rows would then
 * go green.
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
 * declaration passed in. `declaration` exists for section 3's counterfactual;
 * every case in sections 1 and 2 boots the shipped declaration unmodified.
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
 * where it matters — a default applied only on read and a value written on
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

/**
 * A row exactly as a PRE-#8692 install holds it — written the way the old
 * seeder wrote it, which is to say WITHOUT `managed_by`, so the value comes
 * from the declaration's `defaultValue: 'admin'` by the very mechanism that
 * produced it on every install created before the ruling.
 *
 * Reproducing the legacy pre-image through its original mechanism rather than
 * hand-writing `'admin'` is deliberate: it keeps the case anchored to the real
 * declaration, and each case asserts the resulting value before relying on it,
 * so a moved default shows up as a failure here instead of quietly turning the
 * legacy pin into a test of something else.
 */
async function seedLegacyRow(engine: ObjectQL, ps: any): Promise<void> {
  await (engine as any).insert(
    'sys_permission_set',
    {
      id: `ps_legacy_${ps.name}`,
      name: ps.name,
      label: ps.label ?? ps.name,
      // A deliberately STALE payload: the resync would rewrite these if it ever
      // touched the row, so section 2 can prove "left untouched" by content and
      // not merely by a counter.
      object_permissions: '{}',
      field_permissions: '{}',
      system_permissions: '[]',
      row_level_security: '[]',
      tab_permissions: '{}',
      active: true,
    },
    { context: SYSTEM_CTX },
  );
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
  // 1. FORWARD — a fresh install after the ruling
  // ───────────────────────────────────────────────────────────────────────────

  it('ANTI-VACUITY: the shipped defaults are non-empty and really get seeded', async () => {
    // Every count below is relative to this set. If it were empty, "resync
    // reconciled all of them" would be trivially true of nothing — the shape in
    // which this whole file could pass while measuring air.
    expect(defaultPermissionSets.length).toBeGreaterThan(0);

    const engine = await boot();
    const out = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);
    expect(out.seeded).toBe(defaultPermissionSets.length);
  });

  it('a seeder-created row is stored `managed_by: "platform"` — stamped, not defaulted', async () => {
    // THE RULING, pinned (Option A, 2026-08-15). Before it, this row stored
    // `'admin'` — the declaration's `defaultValue` — because the insert omitted
    // `managed_by` entirely. The seeder now stamps provenance explicitly, in
    // line with `bootstrap-builtin-positions.ts` and
    // `bootstrap-system-capabilities.ts`, which always have.
    const engine = await boot();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    // Physically stored, not merely projected on read: the value survives a
    // restart, so every later boot reads it too.
    expect((await storedRow(engine, 'admin_full_access')).managed_by).toBe('platform');
    // …and the same value is what the seeder's own read sees, which is the one
    // the resync condition branches on.
    expect((await rowViaEngine(engine, 'admin_full_access')).managed_by).toBe('platform');
  });

  it('so `os meta resync` now reconciles EVERY platform default set', async () => {
    // The behaviour #2705 built the flag for, finally reachable: resynced == the
    // whole shipped set, resyncSkipped 0. Asserted against the live length so
    // the pin stays true if a default set is added or removed.
    const engine = await boot();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    const out = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { resync: true });

    expect(out.resynced).toBe(defaultPermissionSets.length);
    expect(out.resyncSkipped).toBe(0);
  });

  it('a resync of a fresh install warns about nothing', async () => {
    // The counterpart to the old measurement, which emitted one bogus
    // "intentional override" warn per shipped set. Nothing is skipped now, so
    // nothing is warned about.
    const engine = await boot();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    const { warn, logger } = collectingLogger();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { resync: true, logger });

    expect(warn).toEqual([]);
  });

  it('resync reconciles a STALE platform-owned row to the shipped declaration', async () => {
    // Counts alone cannot show the reconcile actually landed. Blank the payload
    // on a seeded row, resync, and read the declaration back out of storage.
    const engine = await boot();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    const driver: any = (engine as any).getDriver('sys_permission_set');
    await driver.knex('sys_permission_set')
      .where({ name: 'admin_full_access' })
      .update({ system_permissions: '[]' });
    expect((await storedRow(engine, 'admin_full_access')).system_permissions).toBe('[]');

    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { resync: true });

    const shipped = defaultPermissionSets.find((p) => p.name === 'admin_full_access')!;
    expect(JSON.parse((await storedRow(engine, 'admin_full_access')).system_permissions))
      .toEqual(shipped.systemPermissions ?? []);
    // …and the reconcile did NOT touch provenance: `platformOwnedFields` carries
    // no `managed_by`, which is what keeps a resync from restamping any row.
    expect((await storedRow(engine, 'admin_full_access')).managed_by).toBe('platform');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. LEGACY — a pre-ruling install, which keeps the skip forever
  // ───────────────────────────────────────────────────────────────────────────

  it('LEGACY: a pre-ruling `admin`-stamped row is still skipped, and its content survives', async () => {
    // ⛔ The ruling's load-bearing half: forward-stamp only, NO migration. A
    // stored `'admin'` is indistinguishable between "the old seeder's field
    // default" and "an administrator took this set over in Setup", so it must
    // never be reconciled on the strength of a guess.
    const engine = await boot();
    const legacy = defaultPermissionSets[0];
    await seedLegacyRow(engine, legacy);

    // The pre-image really is what a pre-ruling install holds — asserted, not
    // assumed, so this case cannot pass by testing some other row shape.
    expect((await storedRow(engine, legacy.name)).managed_by).toBe('admin');

    // An upgraded install: the seeder runs, finds the legacy row and leaves it,
    // and inserts the remaining sets freshly stamped `'platform'`.
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);
    expect((await storedRow(engine, legacy.name)).managed_by).toBe('admin');

    const out = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { resync: true });

    // The mixed shape an upgrade produces: everything the platform stamped is
    // reconciled, the one legacy row is not.
    expect(out.resyncSkipped).toBe(1);
    expect(out.resynced).toBe(defaultPermissionSets.length - 1);

    // "Left untouched" proven by CONTENT, not just by a counter: the stale
    // payload seeded above is still stale, and provenance was not restamped.
    const row = await storedRow(engine, legacy.name);
    expect(row.system_permissions).toBe('[]');
    expect(row.object_permissions).toBe('{}');
    expect(row.managed_by).toBe('admin');
  });

  it('LEGACY: the skip is logged neutrally — no claim of intent', async () => {
    // The warn used to end "(intentional override)", which is false for exactly
    // these rows: on a pre-ruling install the only writer may have been the
    // seeder itself one call earlier. The reworded line states the provenance
    // and the action and asserts nothing about anybody's intent.
    const engine = await boot();
    const legacy = defaultPermissionSets[0];
    await seedLegacyRow(engine, legacy);
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    const { warn, logger } = collectingLogger();
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { resync: true, logger });

    expect(warn).toEqual([
      `[security] resync left ${legacy.name} untouched — row is admin-owned`,
    ]);
    // Pinned as a substring too, so a future reword cannot quietly reintroduce
    // the intent claim in some other sentence shape.
    expect(warn.join('\n')).not.toContain('intentional override');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. ATTRIBUTION — which link actually supplies the value
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * A counterfactual, and note it runs the OPPOSITE way round from the one this
   * file carried before the ruling. Back then the seeder wrote no `managed_by`,
   * so respelling the declared default flipped the stored value — which is what
   * proved the default was the source. Now the seeder stamps explicitly, so the
   * declared default must no longer be able to move the value at all.
   *
   * Predicted direction, written down before running: boot a CLONE of the
   * declaration whose `managed_by` default is respelled to `'package'`, seed
   * with the same unmodified seeder, and the row must STILL store `'platform'`.
   *
   * That one reading establishes what section 1 cannot on its own: the value
   * comes from the seeder's stamp and not from a declaration that merely
   * happens to agree with it. Without this case, respelling
   * `defaultValue: 'admin'` to `'platform'` in the object file would make every
   * assertion in section 1 pass with the stamp deleted.
   */
  it('ATTRIBUTION: the seed stamp beats the declared default, so the default cannot move it', async () => {
    const respelled = {
      ...SysPermissionSet,
      fields: {
        ...(SysPermissionSet as any).fields,
        managed_by: { ...(SysPermissionSet as any).fields.managed_by, defaultValue: 'package' },
      },
    };
    // Guard: the clone is a copy, and the shipped declaration is untouched by
    // building it. Without this the case could be measuring a mutation it made.
    // The shipped default stays `'admin'` deliberately — it is the right default
    // for a set an admin creates in Setup, and the ruling changed the SEEDER,
    // not the declaration.
    expect((SysPermissionSet as any).fields.managed_by.defaultValue).toBe('admin');

    const engine = await boot(respelled);
    await bootstrapPlatformAdmin(engine as any, defaultPermissionSets);

    expect((await storedRow(engine, 'admin_full_access')).managed_by).toBe('platform');

    // And the consequence still holds under a default that would otherwise have
    // caused a skip: resync reconciles everything.
    const out = await bootstrapPlatformAdmin(engine as any, defaultPermissionSets, { resync: true });
    expect(out.resynced).toBe(defaultPermissionSets.length);
    expect(out.resyncSkipped).toBe(0);
  });
});
