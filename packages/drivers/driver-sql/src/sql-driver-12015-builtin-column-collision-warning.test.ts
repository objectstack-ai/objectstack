// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12015 — a declared field named after a builtin column is DROPPED, and until
 * now it was dropped in silence.
 *
 * `initObjects` emits `id`, `created_at` and `updated_at` itself, then skips
 * any declared field colliding with one. The driver is right to own its
 * primary key and audit stamps; the defect was that it disagreed with the
 * author without saying so — an object declaring `id: { type: 'text' }` boots
 * green and gets `varchar(255)`, and nothing anywhere records that the
 * declaration was discarded.
 *
 * Maintainer ruling 2026-08-25: a **named, loud load-time warning** on all
 * three paths that drop such a declaration. Explicitly NOT a rejection door
 * (that needs an inventory of existing objects first) and explicitly NOT
 * "make the declaration meaningful" (capability expansion with no pull).
 *
 * ## What each case is worth
 *
 * The warning exists to be present, so these are presence pins — one **per
 * path**, because a warning on one path with silence on the others just moves
 * the trap. Each asserts the phase-specific phrasing, so a regression to a
 * silent `continue` on ONE path fails by name rather than being absorbed by a
 * sibling case:
 *
 *  - `while creating table "…"`          — the CREATE TABLE branch
 *  - `while syncing existing table "…"`  — the ADD COLUMN diff branch
 *  - `while syncing shard "…"`           — the rotation shard path
 *
 * Two non-presence cases carry the rest of the claim: the warning does NOT
 * fire for an object that declares no builtin name (a pin that fires on
 * everything is not a diagnostic), and the accept set is untouched — the
 * object still boots, and the physical column is still the platform's, which
 * is also this file's SQLite measurement of the defect itself (the card
 * measured PostgreSQL 16.13 only).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlDriver } from './index.js';

/** Every line this file cares about; the `[sql-driver]` prefix alone is shared with much else. */
const COLLISION_WARNINGS = /collides with a builtin column the platform owns/;

function warnings(driver: SqlDriver): string[] {
  return ((driver as any).logger.warn as ReturnType<typeof vi.fn>).mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((message: string) => COLLISION_WARNINGS.test(message));
}

/** The structured meta of every collision warning, in emission order. */
function warningMeta(driver: SqlDriver): Array<Record<string, unknown>> {
  return ((driver as any).logger.warn as ReturnType<typeof vi.fn>).mock.calls
    .filter((call: unknown[]) => COLLISION_WARNINGS.test(String(call[0])))
    .map((call: unknown[]) => call[1] as Record<string, unknown>);
}

describe('a declared field colliding with a builtin column is named at load time (#12015)', () => {
  let driver: SqlDriver;

  beforeEach(() => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    (driver as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('CREATE path: names the field, the object, and that the platform owns the column', async () => {
    await driver.initObjects([
      {
        name: 'collide_create',
        fields: {
          // The #11456 fixture's exact shape — the declaration that started this card.
          id: { type: 'text', name: 'id' },
          region: { type: 'text' },
        },
      },
    ]);

    const lines = warnings(driver);
    expect(lines).toHaveLength(1);
    // The line owes the author three things: WHICH field, on WHICH object, and
    // that the platform — not the author — owns that column.
    expect(lines[0]).toContain("declared field 'id'");
    expect(lines[0]).toContain('collide_create');
    expect(lines[0]).toContain('collides with a builtin column the platform owns');
    expect(lines[0]).toContain('the declaration is NOT applied');
    // Path identity, so a silent regression on THIS path cannot be masked by
    // the other two still warning.
    expect(lines[0]).toContain('while creating table "collide_create"');
    expect(warningMeta(driver)[0]).toMatchObject({ table: 'collide_create', field: 'id', phase: 'create' });
  });

  it('CREATE path: one line per colliding field, and only for the colliding ones', async () => {
    await driver.initObjects([
      {
        name: 'collide_three',
        fields: {
          id: { type: 'text' },
          created_at: { type: 'datetime' },
          updated_at: { type: 'datetime' },
          payload: { type: 'text' },
        },
      },
    ]);

    expect(warningMeta(driver).map((m) => m.field)).toEqual(['id', 'created_at', 'updated_at']);
  });

  it('ADD COLUMN diff path: an EXISTING table warns too — the diff never proposes the builtin', async () => {
    // Boot once with no collision so the table exists…
    await driver.initObjects([{ name: 'collide_alter', fields: { payload: { type: 'text' } } }]);
    expect(warnings(driver), 'the no-collision boot must be silent').toHaveLength(0);

    // …then re-register the same object WITH a colliding declaration. This is
    // the shape an upgrade takes: the table is already there, so the column
    // diff below is the only thing that runs.
    await driver.initObjects([
      {
        name: 'collide_alter',
        fields: { payload: { type: 'text' }, created_at: { type: 'datetime' }, note: { type: 'text' } },
      },
    ]);

    const lines = warnings(driver);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("declared field 'created_at'");
    expect(lines[0]).toContain('while syncing existing table "collide_alter"');
    expect(warningMeta(driver)[0]).toMatchObject({ table: 'collide_alter', field: 'created_at', phase: 'alter' });

    // Non-vacuity: this really was the ADD COLUMN branch — the ordinary new
    // column landed, so the diff ran rather than the create branch.
    const info = await (driver as any).knex('collide_alter').columnInfo();
    expect(Object.keys(info)).toContain('note');
  });

  it('SHARD path: a rotation-declared object warns while its shard is column-synced', async () => {
    await driver.initObjects([
      {
        name: 'collide_rot',
        fields: { payload: { type: 'text' }, created_at: { type: 'datetime' } },
        lifecycle: { class: 'telemetry', storage: { strategy: 'rotation', shards: 3, unit: 'day' } },
      } as any,
    ]);

    const lines = warnings(driver);
    // The rotation path is the ONLY one that ran — the base name is a view,
    // so the managed create/alter branches never saw this object.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("declared field 'created_at'");
    expect(lines[0]).toContain('while syncing shard "collide_rot__r');
    expect(warningMeta(driver)[0]).toMatchObject({ field: 'created_at', phase: 'shard' });
    expect(String(warningMeta(driver)[0].table)).toMatch(/^collide_rot__r\d{6,8}$/);
  });

  it('does not fire for an object that declares no builtin column name', async () => {
    await driver.initObjects([
      { name: 'no_collision', fields: { region: { type: 'text' }, score: { type: 'number' } } },
    ]);
    expect(warnings(driver)).toHaveLength(0);
  });

  it('⛔ ACCEPT SET UNCHANGED — the object boots, and the platform column is what lands (SQLite)', async () => {
    await driver.initObjects([
      {
        name: 'collide_accept',
        // A declaration that asks for something quite different from what the
        // platform emits: TEXT, unbounded, plus a length the driver never reads.
        fields: { id: { type: 'text', maxLength: 12 }, region: { type: 'text' } },
      },
    ]);

    // Booted, warned, and still fully usable — a warning moves no door.
    expect(warnings(driver)).toHaveLength(1);
    await driver.create('collide_accept', { id: 'r1', region: 'emea' }, { bypassTenantAudit: true });
    expect(await driver.count('collide_accept', {})).toBe(1);

    // The measurement the warning exists to announce, on SQLite: `id` is the
    // platform's `table.string('id')` — varchar(255) — NOT the declared TEXT,
    // and not the declared 12-char bound. (The card measured the same
    // substitution on PostgreSQL 16.13.)
    const info = await (driver as any).knex('collide_accept').columnInfo();
    expect(String(info.id.type).toLowerCase()).toBe('varchar');
    expect(Number(info.id.maxLength)).toBe(255);
    // …while the field that did NOT collide got its declared type.
    expect(String(info.region.type).toLowerCase()).toBe('text');
  });
});
