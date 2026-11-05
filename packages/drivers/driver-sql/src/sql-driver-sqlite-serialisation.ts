// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "SQLite serialisation" section of `SqlDriver`: the
 * bodies of `formatInput`, `formatOutput` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link SqliteSerialisationFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link SqliteSerialisationHost}: exactly
 * the `SqlDriver` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `sqliteSerialisationHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import {
  AUDIT_TIMESTAMP_COLUMNS, canonicalTimeOfDay, normalizeSqliteDatetimeOutput, presentAuditTimestampOutput,
} from './sql-driver-top-level.js';
import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link SqliteSerialisationFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface SqliteSerialisationHost {
  readonly booleanFields: SqlDriver['booleanFields'];
  readonly columnFieldByObject: SqlDriver['columnFieldByObject'];
  readonly dateFields: SqlDriver['dateFields'];
  readonly datetimeFields: SqlDriver['datetimeFields'];
  readonly fileColumnsMoved: SqlDriver['fileColumnsMoved'];
  readonly isMysql: SqlDriver['isMysql'];
  readonly isSqlite: SqlDriver['isSqlite'];
  readonly jsonFields: SqlDriver['jsonFields'];
  readonly mediaFields: SqlDriver['mediaFields'];
  readonly numericFields: SqlDriver['numericFields'];
  readonly numericValueFields: SqlDriver['numericValueFields'];
  storageDatetimeValue: SqlDriver['storageDatetimeValue'];
  readonly timeFields: SqlDriver['timeFields'];
  toDateOnly: SqlDriver['toDateOnly'];
  toTimeOnly: SqlDriver['toTimeOnly'];
  readonly undeclaredAuditTimestampFields: SqlDriver['undeclaredAuditTimestampFields'];
}

/** The bodies of the "SQLite serialisation" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class SqliteSerialisationFacet {
  /** The body of `SqlDriver#formatInput`; the method's docblock there is its contract. */
  static formatInput(this: Pick<SqliteSerialisationHost, 'dateFields' | 'datetimeFields' | 'fileColumnsMoved' | 'isSqlite' | 'jsonFields' | 'mediaFields' | 'storageDatetimeValue' | 'timeFields' | 'toDateOnly' | 'undeclaredAuditTimestampFields'>, object: string, data: any): any {
    let copy: any = data;
    let copied = false;

    // Insert/update-time safety net: any caller that passes the literal
    // string 'NOW()' (often because a field defaultValue leaked unresolved)
    // gets it replaced with a real ISO timestamp here, before it hits the
    // wire. Applies to every driver, not just SQLite.
    if (data && typeof data === 'object') {
      const now = new Date().toISOString();
      for (const key of Object.keys(data)) {
        const v = (data as any)[key];
        if (typeof v === 'string' && /^now\(\)$/i.test(v.trim())) {
          if (!copied) { copy = { ...data }; copied = true; }
          copy[key] = now;
        }
      }
    }

    // ADR-0053: a `Field.datetime` is an instant stored as UTC. Make the STORAGE
    // say so — collapse every accepted input shape (JS `Date`, epoch number, ISO
    // string, zone-naive wall clock, bare calendar day) to one canonical
    // `YYYY-MM-DDTHH:MM:SS.sssZ` before it hits the wire (#3912).
    //
    // This is the write half of the fix; `coerceFilterValue` applies the SAME
    // function to comparands, so the two sides of a comparison can no longer
    // disagree about shape. It runs on EVERY dialect, for two different reasons:
    //   - SQLite has no temporal type, so whatever is bound is what is stored. A
    //     `Date` landed as INTEGER epoch and a REST/JSON write as ISO TEXT, in
    //     the same column — the mixed storage that made every window filter
    //     return the wrong rows, and that still makes ORDER BY sort all INTEGER
    //     rows before all TEXT ones (#3928).
    //   - Postgres/MySQL do have one, but a zone-NAIVE string bound into it is
    //     interpreted in the SERVER's timezone, not UTC — measured at 8 hours off
    //     on an `Asia/Shanghai` server. Sending an explicit `Z` removes the
    //     server's timezone from the write path entirely.
    const datetimeFields = this.datetimeFields[object];
    if (datetimeFields && datetimeFields.size > 0 && copy && typeof copy === 'object') {
      for (const field of datetimeFields) {
        const v = copy[field];
        if (v == null) continue;
        // `NOW()` was already replaced with an ISO instant above; anything else
        // that is not interpretable as a time passes through untouched.
        const normalized = this.storageDatetimeValue(v);
        if (normalized !== v) {
          if (!copied) { copy = { ...copy }; copied = true; }
          copy[field] = normalized;
        }
      }
    }

    // [#21259] The same rule for a builtin audit timestamp the object does NOT
    // declare (see {@link undeclaredAuditTimestampFields}). Its column is the
    // `DATETIME(3)` / `timestamptz` / canonical-text column this driver created,
    // and the engine's audit hook stamps it as `toISOString()` text, which
    // MySQL refuses as a datetime literal. Measured on live MySQL 8.0.46: every
    // insert into `sys_jwks` (declares `created_at` only) and `sys_member` was
    // refused on `updated_at`, so no JWT signing key was ever stored. On SQLite
    // and Postgres the hook's text is already the canonical form and is bound
    // unchanged; a `Date` lands as that same text instead of an epoch INTEGER.
    const undeclaredAudit = this.undeclaredAuditTimestampFields[object];
    if (undeclaredAudit && undeclaredAudit.length > 0 && copy && typeof copy === 'object') {
      for (const field of undeclaredAudit) {
        const v = copy[field];
        if (v == null) continue;
        const normalized = this.storageDatetimeValue(v);
        if (normalized !== v) {
          if (!copied) { copy = { ...copy }; copied = true; }
          copy[field] = normalized;
        }
      }
    }

    // ADR-0053 Phase 1: a `Field.date` is a timezone-naive calendar day, not
    // an instant. Collapse any `Date` or full-ISO value to `YYYY-MM-DD` before
    // it hits the wire so storage matches the date-only contract the filter
    // layer (`coerceFilterValue`) already enforces — the write/filter
    // asymmetry was the root cause of the silent date-equality miss.
    const dateFields = this.dateFields[object];
    if (dateFields && dateFields.size > 0 && copy && typeof copy === 'object') {
      for (const field of dateFields) {
        const v = copy[field];
        if (v == null) continue;
        const normalized = this.toDateOnly(v);
        if (normalized !== v) {
          if (!copied) { copy = { ...copy }; copied = true; }
          copy[field] = normalized;
        }
      }
    }

    // #3994: a `Field.time` is a wall-clock time-of-day. Collapse every accepted
    // input shape (bare `HH:MM[:SS[.fff]]`, JS `Date`, epoch number, full ISO or
    // zone-naive timestamp) to the canonical `HH:MM:SS[.fff]` before it hits the
    // wire — the write half of the same fix `coerceFilterValue` applies to
    // comparands. On SQLite this ends the mixed TEXT/INTEGER storage that broke
    // window filters and ORDER BY; on Postgres/MySQL it turns shapes the native
    // TIME type rejects outright (full ISO — measured failing on both) or
    // resolves against the process's local timezone (a bound `Date` on pg) into
    // the one literal every dialect parses the same way.
    const timeFields = this.timeFields[object];
    if (timeFields && timeFields.size > 0 && copy && typeof copy === 'object') {
      for (const field of timeFields) {
        const v = copy[field];
        if (v == null) continue;
        const normalized = canonicalTimeOfDay(v);
        if (normalized !== v) {
          if (!copied) { copy = { ...copy }; copied = true; }
          copy[field] = normalized;
        }
      }
    }

    // ── JSON field serialisation: ONE encoding, every dialect (commit 4045b954d) ──────
    //
    // `JSON.stringify` unconditionally, which is what Postgres and MySQL have
    // always done here. This DELETES the SQLite branch rather than adding one,
    // and the reason is the declared contract, not strictness: `json`'s stored
    // contract is `z.unknown()` (`spec/src/data/field-value.zod.ts`, "openness
    // is now an explicit decision, not an accident of nobody checking"), so
    // `123` the number and `'123'` the string are BOTH legal values of one
    // field and no driver has license to collapse them onto one representation.
    //
    // What the deleted branch did, measured on live SQLite/PG 16.13/MySQL
    // 8.0.46 before this change (PG and MySQL: 17/17 faithful; SQLite: 13/17
    // type-changed). It stored a non-object AS-IS, which broke the round trip
    // through two INDEPENDENT mechanisms:
    //
    //  1. READ-side. `formatOutput` `JSON.parse`s every string in a json
    //     column, so a stored string whose CONTENT is valid JSON came back
    //     type-changed: `'true'` → boolean, `'null'` → null, `'[]'` → array,
    //     `'{"a":1}'` → object. Reversible — the bytes were still on disk.
    //  2. WRITE-side, and NOT reversible. The column is declared type `json`,
    //     which contains none of `INT`/`CHAR`/`CLOB`/`TEXT`/`BLOB`/`REAL`/
    //     `FLOA`/`DOUB`, so SQLite's affinity rules fall through to **NUMERIC**
    //     — and a bound number-like string is converted to INTEGER/REAL BEFORE
    //     storage. `'0123'`, `'  123  '`, `'1e5'`, `'1.0'` and `'-0'` were
    //     destroyed on disk, indistinguishable from the numbers they became.
    //
    // Stringifying closes BOTH without touching the DDL, because the encoded
    // form of a string carries its quotes (`'123'` → `"123"`) and `"123"` is
    // not a well-formed numeric literal, so NUMERIC affinity leaves it TEXT.
    // Measured, not reasoned — see `sql-driver-12380-json-roundtrip.test.ts`.
    //
    // The on-disk delta for NEW writes is therefore exactly two classes:
    // strings (now quoted) and booleans (now TEXT `true`/`false` instead of
    // INTEGER 1/0, which is mechanism (3) the read path could never repair —
    // `formatOutput`'s `booleanFields` pass is keyed to declared
    // `Field.boolean` COLUMNS, not to booleans living inside a json payload).
    // Objects, arrays and null are byte-identical to before, and so are
    // numbers: `123` bound as a number and `"123"` bound as text both land as
    // INTEGER 123 under NUMERIC affinity. Existing rows are converged by
    // {@link backfillCanonicalJsonEncoding}.
    const jsonFields = this.jsonFields[object];
    if (jsonFields && jsonFields.length > 0) {
      for (const field of jsonFields) {
        if (copy[field] === undefined || copy[field] === null) continue;
        if (!copied) { copy = { ...copy }; copied = true; }
        copy[field] = JSON.stringify(copy[field]);
      }
    }

    // ── ADR-0104: the MOVED media arm ───────────────────────────────────────
    //
    // On a deployment whose media columns have moved, a single-value media
    // field is NOT in `jsonFields` (see {@link isJsonField}), so the loop above
    // did not touch it and the id reaches the wire BARE — which is the whole
    // point of the ruling: the column holds the actual `sys_file` id.
    //
    // What is left to do is the one value shape the moved column cannot hold.
    // A legacy INLINE metadata object can still be handed to a write on a
    // deployment that admits lax media values (`OS_ALLOW_LAX_MEDIA_VALUES`),
    // and binding a plain object to a `varchar` column is a raw driver-level
    // TypeError on SQLite and an unusable `[object Object]` on the server
    // dialects. Serialising it degrades that write to a stored string — the
    // SAME safety-net posture the SQLite arm below has always taken, applied
    // on every dialect because after the move every dialect holds this family
    // in a character column. `formatOutput`'s media pass reads it straight back
    // as the object it was, so the round trip is unchanged for that population.
    if (this.fileColumnsMoved) {
      const mediaFields = this.mediaFields[object];
      if (mediaFields && mediaFields.length > 0) {
        for (const field of mediaFields) {
          const v = copy[field];
          if (v === undefined || v === null || typeof v === 'string') continue;
          if (!copied) { copy = { ...copy }; copied = true; }
          copy[field] = JSON.stringify(v);
        }
      }
    }

    if (!this.isSqlite) return copy;

    // Safety net: better-sqlite3 can only bind numbers/strings/bigints/buffers/
    // null. Any value still an array or plain object here (a field type not
    // classified as JSON, a `Field.multiple` we didn't catch, or an ad-hoc
    // payload) would otherwise throw a raw TypeError mid-insert. Serialize it
    // to JSON so the write degrades to a stored string instead of a 500.
    for (const key of Object.keys(copy)) {
      const v = copy[key];
      if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
        if (!copied) { copy = { ...copy }; copied = true; }
        copy[key] = JSON.stringify(v);
      }
    }
    return copy;
  }

  /** The body of `SqlDriver#formatOutput`; the method's docblock there is its contract. */
  static formatOutput(this: Pick<SqliteSerialisationHost, 'booleanFields' | 'columnFieldByObject' | 'dateFields' | 'datetimeFields' | 'isMysql' | 'isSqlite' | 'jsonFields' | 'mediaFields' | 'numericFields' | 'numericValueFields' | 'timeFields' | 'toDateOnly' | 'toTimeOnly'>, object: string, data: any): any {
    if (!data) return data;

    // External columnMap (ADR-0015): rename physical remote-column keys to local
    // field names BEFORE coercion (which is keyed by local field). No-op for
    // managed objects and external objects without a columnMap.
    const colToField = this.columnFieldByObject[object];
    if (colToField && typeof data === 'object') {
      for (const [remoteCol, localField] of Object.entries(colToField)) {
        if (remoteCol !== localField && Object.prototype.hasOwnProperty.call(data, remoteCol)) {
          // Explicit columnMap wins: the remote column is the source of truth for
          // this local field, even if a same-named native column also exists.
          data[localField] = data[remoteCol];
          delete data[remoteCol];
        }
      }
    }

    if (this.isSqlite) {
      // The exact inverse of `formatInput`'s `JSON.stringify` (commit 4045b954d). Postgres
      // and MySQL need no arm here because their clients already parse a native
      // `json`/`jsonb` column; SQLite hands back the stored TEXT, so the driver
      // parses it. One codec, three dialects, same answer.
      //
      // Only strings are parsed, and that is load-bearing rather than
      // incidental: a json NUMBER is stored under NUMERIC affinity as INTEGER/
      // REAL and comes back as a JS number, which is already the value that was
      // written — parsing is neither possible nor needed for it.
      //
      // ── Why the catch survives, and what it now means ───────────────────────
      //
      // Nothing this driver writes can reach it: every new value on disk is the
      // output of `JSON.stringify`, so it parses by construction. It is the
      // READ-SIDE REPAIR for rows written before commit 4045b954d — a pre-fix plain string
      // was stored raw (`America/New_York`), and re-quoting it is exactly what
      // {@link backfillCanonicalJsonEncoding} does on the next `syncSchema`.
      // Keeping it here is the same posture `backfillCanonicalDatetimes` takes:
      // correctness must NEVER be contingent on a migration having run, so an
      // un-migrated (or un-migratable, e.g. `skipSchemaSync`) deployment reads a
      // legacy plain string back as that same string — byte-identical to what it
      // read before this change — instead of throwing mid-row.
      //
      // ⚠️ It cannot repair the two classes the pre-fix encoding made ambiguous,
      // and must not pretend to: a legacy TEXT cell that DOES parse (a stored
      // object, or a stored string whose content was valid JSON) and a legacy
      // INTEGER/REAL cell (a number, a boolean, or a number-like string eaten by
      // NUMERIC affinity) are collisions already resolved on disk. Those rows
      // read exactly as they read before this change — the class stops growing;
      // it is not retroactively repaired. See the decision recorded in commit 4045b954d's message.
      const jsonFields = this.jsonFields[object];
      if (jsonFields && jsonFields.length > 0) {
        for (const field of jsonFields) {
          if (data[field] !== undefined && typeof data[field] === 'string') {
            try {
              data[field] = JSON.parse(data[field]);
            } catch {
              // Row from before commit 4045b954d: keep the raw string, which IS its value.
            }
          }
        }
      }

    }

    // ── ADR-0104: the media family reads BOTH encodings, on every dialect ────
    //
    // The addendum's dual-encoding window requires the driver to read a bare id
    // and a legacy JSON-quoted id throughout, on every dialect. SQLite already
    // did — its `jsonFields` pass above parses a quoted cell and its `catch`
    // keeps a bare one, which is why the gap was never a three-dialect one —
    // but Postgres and MySQL had no arm at all: MEASURED on live PG 16.13, a
    // JSON-quoted id sitting in a `varchar` column reads back WITH ITS QUOTES.
    // That column is not hypothetical: `os generate migration --format sql`
    // emits `VARCHAR(2048)` for this family, so a generator-built deployment on
    // a server dialect has been storing `"file_01HXYZ"` and handing it back
    // verbatim (#15771's silent corruption, reproduced on a live cell).
    //
    // ⚠️ Runs on BOTH arms, and it is a REPAIR rather than an arm:
    //
    //   - moved deployment  — the cell is bare, no leading delimiter, no-op;
    //     a cell step 3 has not converted yet still reads correctly.
    //   - unmoved, json column — the client (or the pass above) already parsed
    //     it, so the value here is not a string, no-op.
    //   - unmoved, character column — the corrupt population above. THIS is
    //     the only place the pass changes an answer, and the answer it changes
    //     it to is the id that was written.
    //
    // ⛔ The delimiter test is load-bearing and must not be relaxed to "try
    // parsing everything": a `sys_file` id is word characters and `-`
    // (`isFileIdToken`), so an all-digit id would `JSON.parse` to a NUMBER and
    // `null` / `true` / `false` to non-strings. Only a leading `"`, `{` or `[`
    // can be a JSON encoding of a media value, and none of the three can begin
    // an id, a resolver URL (`https:` / `/api/` / `data:` / `blob:`) or a
    // `data:` URI. A cell that starts with one and does NOT parse keeps its raw
    // string, exactly as the SQLite arm above does.
    const mediaFields = this.mediaFields[object];
    if (mediaFields && mediaFields.length > 0) {
      for (const field of mediaFields) {
        const v = data[field];
        if (typeof v !== 'string' || v.length === 0) continue;
        const head = v[0];
        if (head !== '"' && head !== '{' && head !== '[') continue;
        try {
          data[field] = JSON.parse(v);
        } catch {
          // Not an encoding after all — the raw string IS its value.
        }
      }
    }

    // Numeric scalars handed back as STRINGS are coerced to numbers, on EVERY
    // dialect, so the declared type wins regardless of which dialect stored the
    // value or when the column was created. Only strings are touched — a
    // REAL/INTEGER column already yields a number — and a genuinely non-numeric
    // value (junk legacy data) is left intact rather than turned into NaN.
    // See NUMERIC_SCALAR_TYPES.
    //
    // ⚠️ [#16318] This pass was SQLite-only until the numeric family moved to an
    // exact-decimal column, on the stated premise that string-valued numerics
    // "exist for legacy TEXT-affinity columns, which no other dialect has".
    // That premise is now false and it is THIS change that falsified it, so it
    // is corrected here rather than left as a fossil: measured on live
    // PostgreSQL 16.13, node-postgres parses `real` to a JS `number` and
    // `numeric` to a STRING (`1234567.89` arrives as
    // `'1234567.890000000000000000000000000000'`), and mysql2 does the same for
    // `DECIMAL`. Without this line every `number` / `currency` / `percent` /
    // `slider` / `progress` / `summary` field would start reading back as a
    // string on the two server dialects — a wire-contract break, since
    // `valueSchemaFor` gives the whole class `z.number().finite()`.
    //
    // Two SQLite readings stay exactly as they were: the legacy TEXT-affinity
    // repair this pass was written for, and a fresh column, which knex declares
    // `float` for both the old float arm and the new decimal one.
    //
    // ⚠️ [#16318] The registry is chosen PER DIALECT, and the narrowing is the
    // "new tables only" bound, not a taste. `numericFields` carries the
    // driver-internal aliases `integer` / `int` / `float`, which is how an
    // EXTERNAL, introspected table's columns reach this driver. A PostgreSQL
    // `bigint` is handed back by node-postgres as a STRING precisely because it
    // does not fit a JS double, so running it through `Number()` would silently
    // round it above 2^53 — on a table this change never created. SQLite is the
    // one dialect where the wider set is right, because there the pass exists
    // for legacy TEXT-affinity columns of exactly those alias types.
    //
    // ⚠️ The repair is bounded by the wire contract it restores, and that bound
    // is binary64: `valueSchemaFor` gives this whole class `z.number().finite()`
    // (ADR-0104 D1), so a `find()` result is a JS double however exact the
    // COLUMN is. Measured: a value the driver itself wrote from a JS number
    // round-trips exactly ('1234567.890000000000000000000000000000' → 1234567.89),
    // because the shortest representation is what was stored; a value that was
    // never a double does not ('1234567890123456.123' → 1234567890123456,
    // 2^53+1 → 2^53). ⇒ the exactness this change buys is exact-column-through-
    // a-double: SQL-side writers, `summary` roll-ups computed in SQL and any
    // magnitude at or above 2^53 are bounded by the read seam, not by the
    // column. Widening that is a wire-contract change and is NOT in #16318.
    const numericFields = this.isSqlite
      ? this.numericFields[object]
      : this.numericValueFields[object];
    if (numericFields && numericFields.length > 0) {
      for (const field of numericFields) {
        const v = data[field];
        if (typeof v === 'string' && v.trim() !== '') {
          const n = Number(v);
          if (!Number.isNaN(n)) data[field] = n;
        }
      }
    }

    // [ADR-0053 D-F1] (#13973) — the two instant classes present as ONE shape
    // on EVERY dialect: the canonical `YYYY-MM-DDTHH:MM:SS.sssZ` text. Both
    // loops below sat inside the `if (this.isSqlite)` arm above until #13973,
    // and that gate WAS the divergence the card's census measured: on
    // Postgres and MySQL the client library's `Date` left this door as-is,
    // while SQLite handed out text — one value, two runtime types, through the
    // same `any`-shaped record, invisible to the type system. Eight consumers
    // were wrong under it (#13382 in production, #13993–#13999 by reading),
    // all in the direction "expected the text, received a `Date`", none the
    // reverse. The client parsers are NOT touched ([ADR-0053 D-F2]); the
    // driver canonicalises at its own read boundary, here and in
    // `presentReadValue` for the `aggregate()`/`distinct()` doors.

    // Builtin audit timestamps. On SQLite: repair any legacy/raw row stored as
    // a zone-naive, space-separated string (CURRENT_TIMESTAMP or the pre-fix
    // UPDATE stamp) to canonical ISO-8601 with `Z`, idempotent on
    // already-canonical values (ADR-0074). On Postgres/MySQL: fold the
    // client's `Date`. See `presentAuditTimestampOutput`.
    for (const col of AUDIT_TIMESTAMP_COLUMNS) {
      if (data[col] !== undefined) data[col] = presentAuditTimestampOutput(data[col]);
    }

    // Present every `Field.datetime` value as one canonical instant —
    // ISO-8601 with an explicit `Z` — regardless of its on-disk storage form.
    // A SQLite `datetime` column mixes forms: an explicit value bound as a JS
    // `Date` is stored as INTEGER epoch ms, while a `defaultValue: 'NOW()'`
    // slot is TEXT (canonical ISO-`Z` post-fix, or a legacy timezone-naive
    // `CURRENT_TIMESTAMP` string). Without this, reads leak the raw integer or
    // a zone-naive string that `Date.parse` mis-reads as LOCAL time. Folds all
    // shapes to UTC ISO-`Z` and transparently repairs legacy rows with no data
    // migration — mirroring the `Field.date`/numeric read-repairs above and
    // the audit-column repair just above. A Postgres/MySQL `Date` takes the
    // same fold. See `normalizeSqliteDatetimeOutput`.
    const datetimeFields = this.datetimeFields[object];
    if (datetimeFields && datetimeFields.size > 0) {
      for (const field of datetimeFields) {
        if (data[field] !== undefined) {
          data[field] = normalizeSqliteDatetimeOutput(data[field]);
        }
      }
    }

    // [#11782] Present a declared `Field.boolean` as a JSON boolean on the
    // dialects whose STORAGE form is a number: SQLite (INTEGER 0/1) and MySQL
    // (`tinyint(1)`, which mysql2 hands back as a JS number). Postgres stores a
    // real `boolean` and node-pg already parses it, so its stored form IS the
    // presented form and it deliberately stays outside the gate — the same
    // per-dialect posture {@link readPresentationKind} takes for the read doors
    // that return raw builder output (`distinct`; `aggregate` tracks its own
    // result columns per #11635). Before this, the gate was SQLite-only and a
    // declared boolean answered `1`/`0` on MySQL's row-read door while
    // answering `true`/`false` on the other two dialects — and, once #11635
    // presented `min`/`max` everywhere, `find()` and `aggregate()` gave
    // OPPOSITE answers for the same column on the same MySQL connection.
    if (this.isSqlite || this.isMysql) {
      const booleanFields = this.booleanFields[object];
      if (booleanFields && booleanFields.length > 0) {
        for (const field of booleanFields) {
          if (data[field] !== undefined && data[field] !== null) {
            data[field] = Boolean(data[field]);
          }
        }
      }
    }

    // ADR-0053 Phase 1: present `Field.date` as a timezone-naive `YYYY-MM-DD`
    // string, slicing any stored time component. This transparently repairs
    // legacy rows written as a full timestamp before this normalization, so
    // date-equality works without a data migration. Runs for every dialect.
    const dateFields = this.dateFields[object];
    if (dateFields && dateFields.size > 0) {
      for (const field of dateFields) {
        const v = data[field];
        if (v == null) continue;
        const normalized = this.toDateOnly(v);
        if (normalized !== v) data[field] = normalized;
      }
    }

    // Present `Field.time` as the canonical wall-clock time-of-day (#2004,
    // #3994) — the same `canonicalTimeOfDay` the write and filter paths apply,
    // so storage, comparand and presentation are one shape. On read this
    // transparently repairs legacy rows (full-timestamp text from the old
    // `CURRENT_TIMESTAMP` default, epoch ms from a bound `Date`) with no data
    // migration, and re-pads the fraction Postgres trims (`.5` → `.500`). Runs
    // for every dialect. See `toTimeOnly`.
    const timeFields = this.timeFields[object];
    if (timeFields && timeFields.size > 0) {
      for (const field of timeFields) {
        const v = data[field];
        if (v == null) continue;
        const normalized = this.toTimeOnly(v);
        if (normalized !== v) data[field] = normalized;
      }
    }

    return data;
  }
}
