// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12732 — the varchar differ's expected width disagreed with what
 * `createColumn` would actually emit, in two measured directions, over a
 * PRE-EXISTING `varchar(255)` column, dialect `postgres`:
 *
 * **Case A** — an UNKEYED, bounded TEXT-family field (`text` / `richtext` /
 * `signature` / `markdown` / …) reported `narrow_varchar` at severity
 * `error`, category `destructive` — a boot-refusing finding
 * (`runArtifactBootMigrationGate` refuses only `destructive`) demanding the
 * column be narrowed to a shape `createColumn` would never build: unkeyed,
 * `keyableTextLength` returns `null` and the emitter leaves the column TEXT.
 *
 * **Case B** — a base string-family field (`email` / `url` / `password` /
 * …) bounded PAST `SqlDriver.MAX_VARCHAR_CHARS` (16383) reported
 * `widen_varchar` at `warning`/`safe`, planning `ALTER … varchar(100000)` —
 * DDL MySQL refuses outright (`ERROR 1074`). `declaredVarcharLength` returns
 * `null` above the ceiling and the emitter leaves the column TEXT instead.
 *
 * ## The fix
 *
 * One predicate, not a third patch at the call site (after #11431 for
 * `multiple: true` and #11794/#11875 for genuine TEXT columns): ask
 * `SqlDriver.varcharColumnChars(field, keyed)` — the emitter's own read-only
 * mirror of `createColumn`'s switch, already pinned against `columnInfo()`
 * for every `FieldType` by `sql-driver-11565-row-byte-budget.test.ts` — what
 * width `createColumn` would actually build. `null` means "the emitter would
 * not make this a varchar", and the branch below simply does not fire.
 *
 * Keyedness matters: a KEYED bounded text-family field legitimately takes
 * `varchar(maxLength)` (`keyableTextLength` returns non-null when keyed), so
 * suppressing Case A unconditionally would be a second, opposite defect —
 * silence over a real divergence. `keyedColumns` (from `indexedKeyColumns()`)
 * is threaded through so the differ's expectation, not only the DDL, agrees
 * with keyed columns.
 *
 * ## What each block below is worth
 *
 * 1. **Case A and Case B fixed** — both stop firing, at the exact
 *    `maxLength` values the issue measured, over `postgres` AND `mysql` (the
 *    only two `enforcesVarcharLength` dialects).
 * 2. **Case A's keyed counter-case** — the fix must not suppress the branch
 *    unconditionally; a keyed bounded text field still gets `varchar(N)`.
 * 3. **Case B's ceiling boundary** — `16383` (the last legal width) must
 *    still fire; only `16384` and above are suppressed. A predicate that
 *    suppressed the boundary too would silently widen the tolerance.
 * 4. **The additive-default pin** — a caller that does not thread
 *    `varcharColumnChars` (an existing direct caller of the exported
 *    function this module cannot enumerate) keeps the PRE-#12732 behaviour
 *    unconditionally, so this change cannot silently alter a caller nobody
 *    updated. Documented on the parameter itself; pinned here as behaviour.
 * 5. **Unaffected shapes untouched** — the differ's other varchar branches
 *    (already-agreeing columns, SQLite, JSON columns) stay silent, so this
 *    predicate is a narrowing, not a broadening of what already worked.
 */

import { describe, it, expect } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { diffManagedTable, type PhysicalColumn, type SqlDialectName } from './schema-drift.js';
import { dialectCell } from './live-dialect-matrix.testkit.js';

const T = 'os12732_probe';
const C = 'body';

const staleColumn = (maxLength = 255): PhysicalColumn[] => [
  { name: C, type: 'varchar', nullable: true, maxLength },
];

/** The two dialects that physically enforce a varchar width (SQLite does not). */
const ENFORCING: readonly SqlDialectName[] = ['postgres', 'mysql'];

// A driver instance is only ever used here for its `varcharColumnChars`
// mirror — never connected, never queried. Dialect is irrelevant to that
// method (confirmed by reading it: no `this.dialectName` branch), so a
// single SQLite-configured instance serves every dialect row below, exactly
// as `sql-driver-11565-row-byte-budget.test.ts` and
// `schema-drift.unbounded-text-column.test.ts` already do.
const driver = new SqlDriver(dialectCell('sqlite').config());
const mirror = (field: Record<string, unknown>, keyed?: { unique: boolean }) =>
  (driver as any).varcharColumnChars(field, keyed) as number | null;

const diffWithMirror = (
  field: Record<string, unknown>,
  dialect: SqlDialectName,
  keyedColumns?: ReadonlyMap<string, { unique: boolean }>,
  maxLength = 255,
) =>
  diffManagedTable({
    table: T,
    fields: { [C]: field } as never,
    columns: staleColumn(maxLength),
    dialect,
    keyedColumns,
    varcharColumnChars: mirror,
  });

describe('diffManagedTable — expects what createColumn would emit (#12732)', () => {
  describe('Case A — unkeyed, bounded text-family field', () => {
    it('stops firing narrow_varchar once the emitter mirror is threaded, on both enforcing dialects', () => {
      for (const dialect of ENFORCING) {
        for (const type of ['text', 'richtext', 'signature', 'markdown']) {
          const found = diffWithMirror({ type, maxLength: 50 }, dialect);
          expect(found, `${type} on ${dialect}`).toHaveLength(0);
        }
      }
    });

    it('still fires — correctly — when the SAME field is KEYED, at the width createColumn would build', () => {
      const keyed = new Map([[C, { unique: true }]]);
      for (const dialect of ENFORCING) {
        for (const type of ['text', 'richtext', 'signature', 'markdown']) {
          const found = diffWithMirror({ type, maxLength: 50 }, dialect, keyed);
          expect(found, `${type} on ${dialect}`).toHaveLength(1);
          expect(found[0].op.type, type).toBe('narrow_varchar');
          expect(found[0].severity, type).toBe('error');
          expect(found[0].category, type).toBe('destructive');
          expect(found[0].expected, type).toBe('varchar(50)');
        }
      }
    });

    it('a field NOT in the keyedColumns map is treated as unkeyed, not as "unknown"', () => {
      // Only a DIFFERENT field is keyed — `body` itself must still read as
      // unkeyed, proving the lookup is per-field, not "any key present".
      const keyed = new Map([['other_column', { unique: true }]]);
      const found = diffWithMirror({ type: 'text', maxLength: 50 }, 'postgres', keyed);
      expect(found).toHaveLength(0);
    });
  });

  describe('Case B — base string-family field bounded past the varchar ceiling', () => {
    it('stops firing widen_varchar above MAX_VARCHAR_CHARS (16383), on both enforcing dialects', () => {
      for (const dialect of ENFORCING) {
        for (const type of ['email', 'url', 'password']) {
          for (const maxLength of [100000, 16384]) {
            const found = diffWithMirror({ type, maxLength }, dialect);
            expect(found, `${type}@${maxLength} on ${dialect}`).toHaveLength(0);
          }
        }
      }
    });

    it('still fires at the boundary — 16383, the last legal width — unaffected by the fix', () => {
      for (const dialect of ENFORCING) {
        const found = diffWithMirror({ type: 'email', maxLength: 16383 }, dialect);
        expect(found, dialect).toHaveLength(1);
        expect(found[0].op).toMatchObject({ type: 'widen_varchar', to: 16383, from: 255 });
        expect(found[0].severity).toBe('warning');
        expect(found[0].category).toBe('safe');
      }
    });
  });

  describe('additive default — a caller that does not thread the new args keeps pre-#12732 behaviour', () => {
    it('Case A still fires when varcharColumnChars is omitted entirely', () => {
      const found = diffManagedTable({
        table: T,
        fields: { [C]: { type: 'text', maxLength: 50 } } as never,
        columns: staleColumn(255),
        dialect: 'postgres',
      });
      expect(found).toHaveLength(1);
      expect(found[0].op.type).toBe('narrow_varchar');
    });

    it('Case B still fires when varcharColumnChars is omitted entirely', () => {
      const found = diffManagedTable({
        table: T,
        fields: { [C]: { type: 'email', maxLength: 100000 } } as never,
        columns: staleColumn(255),
        dialect: 'postgres',
      });
      expect(found).toHaveLength(1);
      expect(found[0].op.type).toBe('widen_varchar');
    });

    it('omitting keyedColumns alone (mirror threaded) reads every field as unkeyed', () => {
      // Same as the no-args case for Case A, via the OTHER omission path.
      const found = diffWithMirror({ type: 'text', maxLength: 50 }, 'postgres', undefined);
      expect(found).toHaveLength(0);
    });
  });

  describe('unaffected shapes stay silent (no broadening)', () => {
    it('an already-agreeing base string-family column reports nothing', () => {
      for (const type of ['string', 'email', 'url', 'phone', 'password']) {
        expect(diffWithMirror({ type }, 'postgres')).toHaveLength(0);
      }
    });

    it('SQLite (no length enforcement) reports nothing regardless of mirror', () => {
      expect(diffWithMirror({ type: 'text', maxLength: 50 }, 'sqlite')).toHaveLength(0);
      expect(diffWithMirror({ type: 'email', maxLength: 100000 }, 'sqlite')).toHaveLength(0);
    });
  });

  describe('the mirror itself, as a control', () => {
    it('confirms the two directions this fix relies on', () => {
      expect(mirror({ type: 'text', maxLength: 50 })).toBeNull(); // unkeyed text-family
      expect(mirror({ type: 'text', maxLength: 50 }, { unique: true })).toBe(50); // keyed
      expect(mirror({ type: 'email', maxLength: 100000 })).toBeNull(); // past ceiling
      expect(mirror({ type: 'email', maxLength: 16383 })).toBe(16383); // at ceiling
    });
  });
});
