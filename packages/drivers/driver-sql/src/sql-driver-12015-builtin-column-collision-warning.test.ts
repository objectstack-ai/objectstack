// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12015 — a declared field named after a builtin column loses its STORAGE
 * half, and until now it lost it in silence.
 *
 * `initObjects` emits `id`, `created_at` and `updated_at` itself, then skips
 * any declared field colliding with one. The driver is right to own its
 * primary key and audit stamps; the defect was that it disagreed with the
 * author without saying so — an object declaring `id: { type: 'text' }` boots
 * green and gets `varchar(255)`, and nothing recorded that the declared type
 * was discarded.
 *
 * Maintainer ruling 2026-08-25, twice: a **named, loud load-time warning** on
 * all three paths that drop such a declaration, then **narrowed** to the
 * declarations that actually lose something — those asking for storage the
 * platform's own column does not deliver. A presentation-only declaration
 * (`label`, `readonly`, the ADR-0113 write contract in `required`) is honoured
 * on the platform's column exactly as anywhere else, so warning about it was
 * not merely noisy but false, and its advice ("remove the declaration") would
 * have deleted a label four locales are generated from. Explicitly NOT a
 * rejection door and NOT "make the declaration meaningful".
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
 * Three non-presence cases carry the rest of the claim: a presentation-only
 * declaration boots **silently** end-to-end (the narrowing, measured through
 * the real driver rather than through the classifier alone — that module's own
 * split is pinned in `builtin-column-collision.test.ts`); an object declaring
 * no builtin name is silent; and the accept set is untouched — the object
 * still boots and the physical column is still the platform's, which is also
 * this file's SQLite measurement of the defect itself (the card measured
 * PostgreSQL 16.13 only).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlDriver } from './index.js';

/** Every line this file cares about; the `[sql-driver]` prefix alone is shared with much else. */
const COLLISION_WARNINGS = /asks for storage the platform's own/;

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

  it('CREATE path: names the field, the object, the attribute lost and what the column really is', async () => {
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
    // The line owes the author four things: WHICH field, on WHICH object, WHAT
    // was lost, and what the platform's column actually is.
    expect(lines[0]).toContain("declared field 'id'");
    expect(lines[0]).toContain('collide_create');
    expect(lines[0]).toContain("asks for storage the platform's own 'id' column does not provide");
    expect(lines[0]).toContain("type: 'text' (the column is 'string')");
    // ⛔ And it must NOT deny the half that IS applied, nor advise deleting it.
    expect(lines[0]).toContain('is honoured as written');
    expect(lines[0]).not.toContain('Remove the declaration');
    // Path identity, so a silent regression on THIS path cannot be masked by
    // the other two still warning.
    expect(lines[0]).toContain('while creating table "collide_create"');
    expect(warningMeta(driver)[0]).toMatchObject({
      table: 'collide_create', field: 'id', phase: 'create', undelivered: ['type'],
    });
  });

  it('CREATE path: one line per colliding field that loses something, and only those', async () => {
    await driver.initObjects([
      {
        name: 'collide_three',
        fields: {
          id: { type: 'text' },            // text ≠ the varchar(255) key
          created_at: { type: 'date' },    // date ≠ the timestamp column
          updated_at: { type: 'datetime', unique: true }, // the audit column carries no uniqueness
          // Declared, colliding, and losing NOTHING — the platform's column is
          // exactly this, and the label/readonly half is honoured.
          payload: { type: 'text' },
        },
      },
    ]);

    expect(warningMeta(driver).map((m) => m.field)).toEqual(['id', 'created_at', 'updated_at']);
    expect(warningMeta(driver).map((m) => m.undelivered)).toEqual([['type'], ['type'], ['unique']]);
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
        fields: { payload: { type: 'text' }, created_at: { type: 'date' }, note: { type: 'text' } },
      },
    ]);

    const lines = warnings(driver);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("declared field 'created_at'");
    expect(lines[0]).toContain("type: 'date' (the column is 'datetime')");
    expect(lines[0]).toContain('while syncing existing table "collide_alter"');
    expect(warningMeta(driver)[0]).toMatchObject({
      table: 'collide_alter', field: 'created_at', phase: 'alter', undelivered: ['type'],
    });

    // Non-vacuity: this really was the ADD COLUMN branch — the ordinary new
    // column landed, so the diff ran rather than the create branch.
    const info = await (driver as any).knex('collide_alter').columnInfo();
    expect(Object.keys(info)).toContain('note');
  });

  it('SHARD path: a rotation-declared object warns while its shard is column-synced', async () => {
    await driver.initObjects([
      {
        name: 'collide_rot',
        fields: {
          id: { type: 'text' },
          payload: { type: 'text' },
          // Declared AND colliding, but it describes the column the platform
          // emits — so it must not appear below.
          created_at: { type: 'datetime' },
        },
        lifecycle: { class: 'telemetry', storage: { strategy: 'rotation', shards: 3, unit: 'day' } },
      } as any,
    ]);

    const lines = warnings(driver);
    // One line: `id` only. The rotation path is also the ONLY path that ran —
    // the base name is a view, so the managed create/alter branches never saw
    // this object.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("declared field 'id'");
    expect(lines[0]).toContain('while syncing shard "collide_rot__r');
    expect(warningMeta(driver)[0]).toMatchObject({ field: 'id', phase: 'shard', undelivered: ['type'] });
    expect(String(warningMeta(driver)[0].table)).toMatch(/^collide_rot__r\d{6,8}$/);
  });

  it('THE NARROWING, end-to-end: a presentation-only declaration boots in silence', async () => {
    // `sys_presence` in shape — the population the pre-narrowing warning fired
    // on 116 times per stock boot of platform-objects while telling the author
    // something untrue about it.
    await driver.initObjects([
      {
        name: 'collide_presentation',
        fields: {
          id: { type: 'string', label: 'Presence ID', required: true, readonly: true },
          created_at: { type: 'datetime', label: 'Created At', defaultValue: 'NOW()', readonly: true },
          updated_at: { type: 'datetime', label: 'Updated At', defaultValue: 'NOW()', readonly: true },
          status: { type: 'text' },
        },
      },
    ]);

    expect(warnings(driver)).toHaveLength(0);
    // Non-vacuity: the object really did boot through the collision path.
    const info = await (driver as any).knex('collide_presentation').columnInfo();
    expect(Object.keys(info).sort()).toEqual(['created_at', 'id', 'status', 'updated_at']);
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
        // platform emits: TEXT, plus a length the driver never reads.
        fields: { id: { type: 'text', maxLength: 12 }, region: { type: 'text' } },
      },
    ]);

    // Booted, warned once naming BOTH lost attributes, and still fully usable —
    // a warning moves no door.
    const lines = warnings(driver);
    expect(lines).toHaveLength(1);
    expect(warningMeta(driver)[0].undelivered).toEqual(['type', 'maxLength']);
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
