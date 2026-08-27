// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12121 — a TEXT-family field that declares NO bound, over a PRE-EXISTING
 * `varchar` column, was reported by nothing.
 *
 * ## The defect, as measured on the pre-fix tree
 *
 * The varchar differ's whole branch required `declaredMaxLength !== undefined`.
 * On a pre-existing table that split the text family in two by whether its
 * author had written a number:
 *
 * ```
 * Field.signature({ maxLength: 4096 })  over varchar(255)  ->  widen_varchar   ✅ reported
 * Field.signature()      — no bound     over varchar(255)  ->  (nothing)       ⛔ silent
 * ```
 *
 * One `diffManagedTable` call per type on the pre-fix tree, dialect `postgres`,
 * column `varchar(255)`: `text` / `textarea` / `html` / `markdown` / `richtext` /
 * `code` / `signature` / `qrcode` with no `maxLength` each returned **zero**
 * entries — and `{ type: 'signature', maxLength: 4096 }` over the same column
 * returned exactly one `widen_varchar` in the same run. So the differ was
 * working; this shape was simply invisible to it.
 *
 * ⭐ **A drift op that reports nothing is indistinguishable from no drift**,
 * which is the whole hazard: after #11875/#12119 a NEWLY created column for
 * these types is TEXT and holds a data URI correctly, but the additive sync
 * never revisits an existing one — so a deployment upgrading into that release
 * gets no change AND no diagnostic, while the server keeps refusing the same
 * write. That refusal is a poor substitute for a report: the live probe behind
 * `objectql`'s `driver-fault-redaction.ts` measured Postgres's `22001` as
 * identifier-only and naming the TYPE rather than the column (`value too long
 * for type character varying(255)`).
 *
 * ## What each block below is worth
 *
 * 1. **The emission**, over every member, with the declared-bound row as the
 *    POSITIVE CONTROL in the same run — the thing that proves the differ can
 *    emit at all here, so a green count is a measurement rather than a mood.
 * 2. **The silences**, which are what make the emission a detector rather than
 *    a blanket. Each one is a shape where the emitter and the column already
 *    AGREE, so a finding would be a false positive.
 * 3. **The set pin.** `UNBOUNDED_TEXT_FIELD_TYPES` is a hand-written list, and
 *    a hand-written copy of `createColumn`'s case list is the exact defect
 *    #11794 was filed about. It is therefore held equal to the driver's OWN
 *    dispatch over every `FieldType` the spec declares, both directions, with
 *    this file writing down neither list.
 * 4. **The keyedness-independence pin**, which is the licence for the branch's
 *    predicate: it decides without being told which columns are keyed, and that
 *    is only sound because the emitter answers TEXT for these fields either way.
 * 5. **The two couplings that would be silent if broken** — the boot gate reads
 *    `category`, and `os migrate multi-value-columns` selects its entire
 *    population by `op.type`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FieldType } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import {
  diffManagedTable,
  UNBOUNDED_TEXT_FIELD_TYPES,
  type ManagedDriftEntry,
  type PhysicalColumn,
  type SqlDialectName,
} from './schema-drift.js';
import { dialectCell } from './live-dialect-matrix.testkit.js';

const T = 'os12121_probe';
const C = 'body';

/** The column a long-lived deployment still carries, in a dialect's own spelling. */
const staleColumn = (type: string, maxLength?: number): PhysicalColumn[] => [
  { name: C, type, nullable: true, ...(maxLength === undefined ? {} : { maxLength }) },
];

const diffBody = (
  field: Record<string, unknown>,
  columns: PhysicalColumn[],
  dialect: SqlDialectName = 'postgres',
): ManagedDriftEntry[] => diffManagedTable({ table: T, fields: { [C]: field } as never, columns, dialect });

/** The two dialects that physically enforce a varchar width (SQLite does not). */
const ENFORCING: readonly SqlDialectName[] = ['postgres', 'mysql'];

describe('diffManagedTable — an unbounded text-family field over a pre-existing varchar (#12121)', () => {
  let driver: SqlDriver;
  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  /**
   * ⭐ THE ASSERTION. Every member of the text family, declaring no bound, over
   * a `varchar(255)` a previous release created — reported exactly once, on
   * both enforcing dialects.
   *
   * The declared-bound row rides along as the POSITIVE CONTROL: it is the case
   * that was ALREADY reported before this branch existed, so its `widen_varchar`
   * in this same run is what distinguishes "the differ found the new shape"
   * from "the differ is emitting for everything". Both counts are exact — a
   * `toBeGreaterThan(0)` here would pass just as well on a differ that reported
   * every column in the table.
   */
  it('reports every member exactly once, with the declared-bound row as the control in the same run', () => {
    const members = [...UNBOUNDED_TEXT_FIELD_TYPES].sort();
    expect(members.length).toBeGreaterThan(5); // the set is real, not an empty loop

    for (const dialect of ENFORCING) {
      for (const type of members) {
        const found = diffBody({ type }, staleColumn('varchar', 255), dialect);
        expect(found, `${type} on ${dialect}`).toHaveLength(1);
        const [d] = found;
        expect(d.op.type).toBe('manual_widen_varchar_to_text');
        expect(d.kind).toBe('type_mismatch');
        expect(d.expected).toBe('text');
        expect(d.actual).toBe('varchar(255)');
        expect(d.op).toMatchObject({ table: T, column: C, to: 'text', from: 'varchar' });

        // The message has to carry what an operator acts on: which declaration,
        // how wide the column actually is, and that nothing runs by itself.
        expect(d.message).toContain(`${T}.${C}`);
        expect(d.message).toContain(type);
        expect(d.message).toContain('varchar(255)');
        expect(d.message).toContain('os migrate apply');
        // ⛔ NOT the multi-value command: its remedy converts the column to
        // `json`, which is the wrong column type for every member here.
        expect(d.message).not.toContain('multi-value-columns');
      }

      // ── POSITIVE CONTROL, same shape, same run: a declared bound is still
      // the pre-existing `widen_varchar`, untouched by this branch.
      const control = diffBody({ type: 'signature', maxLength: 4096 }, staleColumn('varchar', 255), dialect);
      expect(control, `control on ${dialect}`).toHaveLength(1);
      expect(control[0].op).toMatchObject({ type: 'widen_varchar', to: 4096, from: 255 });
      expect(control[0].severity).toBe('warning');
      expect(control[0].category).toBe('safe');
    }
  });

  /**
   * The silences — every one of them a shape where the emitter and the physical
   * column already agree, so a finding would be a false positive rather than a
   * detection. Without this block the branch above is satisfied by a differ that
   * simply reports more.
   */
  it('stays silent wherever the emitter and the column already agree', () => {
    // A column the current driver would create: TEXT. Nothing to report.
    expect(diffBody({ type: 'signature' }, staleColumn('text'))).toHaveLength(0);

    // MySQL reports a TEXT column's `character_maximum_length` as 65535 — the
    // #11431 defect. `isCharacterColumn` is what keeps it out, and this is the
    // case that would re-open it one door to the left.
    expect(diffBody({ type: 'signature' }, staleColumn('text', 65535), 'mysql')).toHaveLength(0);

    // SQLite records a declared type and enforces nothing, so a `varchar(255)`
    // there refuses no value the declaration allows — the same exclusion
    // `enforcesVarcharLength` already makes for widen/narrow.
    expect(diffBody({ type: 'signature' }, staleColumn('varchar', 255), 'sqlite')).toHaveLength(0);

    // The varchar family. `createColumn` gives an unbounded `string` / `email` /
    // `url` / `phone` / `password` knex's varchar(255) — which is exactly the
    // column on disk, so there is no divergence.
    for (const type of ['string', 'email', 'url', 'phone', 'password']) {
      expect(diffBody({ type }, staleColumn('varchar', 255)), type).toHaveLength(0);
    }
    expect(diffBody({}, staleColumn('varchar', 255))).toHaveLength(0); // untyped -> 'string'

    // A multi-value field is a `json` column whatever its element type would
    // have been, and the base-type branch (#11535) already owns that shape.
    // Reporting it here too would give one column two contradictory remedies.
    const multi = diffBody({ type: 'signature', multiple: true }, staleColumn('varchar', 255));
    expect(multi).toHaveLength(1);
    expect(multi[0].op.type).toBe('manual_column_type_change');
  });

  /**
   * ⭐ THE SET PIN. `UNBOUNDED_TEXT_FIELD_TYPES` === the types the driver's own
   * dispatch puts in `createColumn`'s text-family branch, over the spec's whole
   * `FieldType` vocabulary.
   *
   * Both directions are load-bearing, and neither list is written down here:
   *
   *   - `⊇` — a type that JOINS the emitter's text family (as `signature` and
   *     `qrcode` did at #11875) and is not added here goes back to being
   *     silent, which is this card's defect re-entering by the door it came in.
   *   - `⊆` — a type listed here that the emitter does NOT make TEXT would be
   *     reported as needing a conversion to a column shape the platform would
   *     never create: a finding an operator can act on and be left with drift.
   *
   * The classification PROBES the driver rather than restating its cases — the
   * technique `sql-driver-12017-bounded-string-spec-parity.test.ts` introduced,
   * and the reason that file carries no case list either.
   */
  it('holds the set equal to the driver text-family branch over every FieldType', () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    const types = FieldType.options as readonly string[];
    expect(types.length).toBeGreaterThan(40); // the spec registry really was read

    const textFamily = types.filter((t) => shapeOf(driver, t) === 'text-family').sort();
    const declared = [...UNBOUNDED_TEXT_FIELD_TYPES].sort();

    // Non-vacuity: the probe resolved branches OTHER than the one under test,
    // so an equality between two empty-ish sets cannot pass for a measurement.
    const shapes = [...new Set(types.map((t) => shapeOf(driver, t)))];
    expect(shapes).toContain('varchar-from-declaration');
    expect(shapes).toContain('default-varchar-255');
    expect(shapes).toContain('not-sized-from-metadata');

    expect(textFamily).toEqual(declared);
  });

  /**
   * ⭐ THE LICENCE for the branch's predicate. `diffManagedTable` is never told
   * which columns an index keys, and the branch decides anyway. That is sound
   * only because, for a text-family field with NO usable bound, the emitter
   * answers TEXT either way:
   *
   *     createColumn:  keyable = keyed ? keyableTextLength(field) : null
   *     keyableTextLength(no positive-integer maxLength) === null
   *
   * Measured here instead of read off the source, and paired with its CONTRAST:
   * the same type WITH a keyable bound takes `varchar(bound)` when keyed, which
   * is precisely why the branch is gated on the declaration being ABSENT. Drop
   * that gate and a keyed, bounded text column — a column the emitter itself
   * would create as `varchar(n)` — starts being reported as drift.
   */
  it('pins that an unbounded text-family field is TEXT whether or not it is keyed', () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    const chars = (field: unknown, keyed?: { unique: boolean }) =>
      (driver as unknown as { varcharColumnChars(f: unknown, k?: { unique: boolean }): number | null })
        .varcharColumnChars(field, keyed);

    for (const type of UNBOUNDED_TEXT_FIELD_TYPES) {
      // No bound at all, and the malformed spellings the emitter treats as none
      // (#11431) — the differ's own `declaredMaxLength` uses the same predicate.
      for (const field of [{ type }, { type, maxLength: 0 }, { type, maxLength: 12.5 }]) {
        expect(chars(field, undefined), `${type} unkeyed`).toBeNull();
        expect(chars(field, { unique: false }), `${type} keyed`).toBeNull();
        expect(chars(field, { unique: true }), `${type} unique`).toBeNull();
      }
      // ⚠️ THE CONTRAST — a keyable bound IS honoured when keyed, so the gate on
      // "no declaration" is doing real work and is not a redundant condition.
      expect(chars({ type, maxLength: 700 }, { unique: true }), `${type} bounded+keyed`).toBe(700);
    }
  });

  /**
   * The two couplings that fail SILENTLY if this entry is spelled wrong. Neither
   * is visible from the emission assertions above.
   */
  it('cannot refuse a boot, and cannot be claimed by "os migrate multi-value-columns"', () => {
    const [d] = diffBody({ type: 'richtext' }, staleColumn('varchar', 255));

    // `runArtifactBootMigrationGate` refuses a boot for `category ===
    // 'destructive'` and nothing else. Every database this finding describes is
    // ALREADY SERVING, so `destructive` would turn a deployment that merely
    // refuses over-long values into a crash-loop on its next restart. `safe` is
    // wrong the other way: dev auto-reconcile applies those unattended, and
    // there is no reconciler arm to apply.
    expect(d.category).toBe('needs_confirm');
    expect(d.severity).toBe('error');

    // `os migrate multi-value-columns` selects its ENTIRE population by
    // `op.type === 'manual_column_type_change'` and then recovers the dialect by
    // matching the message against `manualJsonConversionSql`. Sharing that op
    // would hand this finding to a command whose remedy makes the column `json`,
    // and — the message carrying no json statement — have it refused as
    // `remedy_not_recognized` on every run.
    expect(d.op.type).not.toBe('manual_column_type_change');
  });
});

/**
 * The bound every probe declares: past `DEFAULT_STRING_VARCHAR_CHARS` (255) so
 * an honoured declaration is distinguishable from the catch-all, and inside both
 * `MAX_KEYABLE_VARCHAR_CHARS` (768) and `MAX_VARCHAR_CHARS` (16383) so neither
 * ceiling turns the answer into `null` and mis-files the type.
 */
const PROBE_CHARS = 700;

type ColumnShape =
  | 'varchar-from-declaration'
  | 'text-family'
  | 'default-varchar-255'
  | 'not-sized-from-metadata';

/**
 * Which branch of `createColumn`'s switch a type takes, read off the driver's
 * own dispatch. The keyed probe is what separates `text-family` from
 * `not-sized-from-metadata` at all — unkeyed, both answer `null`.
 *
 * An answer outside the table is a THROW, never a default bucket: a switch that
 * grew a fifth behaviour must be classified on purpose, and filing it silently
 * under "not sized" would be this card's own defect committed by its own guard.
 */
function shapeOf(driver: SqlDriver, type: string): ColumnShape {
  const dflt = (SqlDriver as unknown as { DEFAULT_STRING_VARCHAR_CHARS: number }).DEFAULT_STRING_VARCHAR_CHARS;
  const mirror = (keyed?: { unique: boolean }) =>
    (driver as unknown as { varcharColumnChars(f: unknown, k?: { unique: boolean }): number | null })
      .varcharColumnChars({ type, maxLength: PROBE_CHARS }, keyed);
  const unkeyed = mirror(undefined);
  const keyed = mirror({ unique: false });

  if (unkeyed === PROBE_CHARS && keyed === PROBE_CHARS) return 'varchar-from-declaration';
  if (unkeyed === null && keyed === PROBE_CHARS) return 'text-family';
  if (unkeyed === dflt && keyed === dflt) return 'default-varchar-255';
  if (unkeyed === null && keyed === null) return 'not-sized-from-metadata';
  throw new Error(
    `#12121: varcharColumnChars answered (unkeyed=${String(unkeyed)}, keyed=${String(keyed)}) for ` +
      `type '${type}' at maxLength ${PROBE_CHARS} — a branch this guard does not classify. ` +
      `Classify it on purpose rather than widening a bucket.`,
  );
}
