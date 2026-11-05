// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Column creation helper" section of `SqlDriver`: the
 * bodies of `createAuditTimestampColumn`, `declaredVarcharLength`,
 * `keyableTextLength`, `explainUnkeyableTextColumn`, `hashShadowColumnFor`,
 * `createHashShadowUniqueIndex`, `hashShadowColumnState`,
 * `dropOrphanedHashShadowColumn`, `explainHashShadowDuplicate`,
 * `decorateHashShadowDuplicate`, `hashShadowSourceColumns`,
 * `varcharPackLength`, `varcharColumnChars`, `rowWidthProfile`,
 * `schemaBytesPerChar`, `explainRowSizeOverflow`,
 * `rethrowWithRowSizeExplanation`, `jsonColumn`, `createColumn` moved out of
 * `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. {@link ColumnCreationFacet} is a stateless facet of `SqlDriver`
 * (ruling 6624345766): each static method of it is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SqlDriver`.
 *
 * The bodies reach the class through {@link ColumnCreationHost}: exactly the
 * `SqlDriver` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `columnCreationHost` in
 * `sql-driver-facet-hosts.ts`, built once per driver by the class's static
 * block. Methods go as closures that call them on the driver at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * driver.
 *
 * `SqlDriver` here is `SqlDriverStatics` (imported AS `SqlDriver`): forwarders to the
 * statics the bodies read, private ones included, which the class fills in a
 * static block; the class as a type is `SqlDriverClass`.
 *
 * Values that stayed in `sql-driver.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { FILE_REFERENCE_TYPES, numericColumnFor } from '@objectstack/spec/data';
import { GLOBAL_TENANT, canonicalIndexKey, hashShadowColumnFor, parseHashShadowKeyParts } from './schema-drift.js';
import type { HashShadowKeyPart } from './schema-drift.js';
import type { Knex } from 'knex';
import {
  AUDIT_TIMESTAMP_COLUMNS, JSON_COLUMN_TYPES, MEDIA_ID_VARCHAR_CHARS, MYSQL_DATETIME_PRECISION, declaresColumnNotNull,
  isDeclaredFieldType, isMultiValuedColumn, refuseRejectedReferenceAlias, refuseUndeclaredFieldType,
} from './sql-driver-top-level.js';
import type { RowWidthContribution } from './sql-driver-top-level.js';
import { SqlDriverStatics as SqlDriver } from './sql-driver.js';
import type { SqlDriver as SqlDriverClass } from './sql-driver.js';

/**
 * The `SqlDriver` members the bodies of {@link ColumnCreationFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface ColumnCreationHost {
  applyDeclaredColumnDefault: SqlDriverClass['applyDeclaredColumnDefault'];
  declaredFieldsFor: SqlDriverClass['declaredFieldsFor'];
  declaredVarcharLength: SqlDriverClass['declaredVarcharLength'];
  explainHashShadowDuplicate: SqlDriverClass['explainHashShadowDuplicate'];
  explainRowSizeOverflow: SqlDriverClass['explainRowSizeOverflow'];
  hashShadowColumnState: SqlDriverClass['hashShadowColumnState'];
  hashShadowSourceColumns: SqlDriverClass['hashShadowSourceColumns'];
  readonly isMysql: SqlDriverClass['isMysql'];
  readonly isSqlite: SqlDriverClass['isSqlite'];
  jsonColumn: SqlDriverClass['jsonColumn'];
  keyableTextLength: SqlDriverClass['keyableTextLength'];
  readonly knex: SqlDriverClass['knex'];
  logDurabilityFailure: SqlDriverClass['logDurabilityFailure'];
  readonly logger: SqlDriverClass['logger'];
  mediaColumnIsJson: SqlDriverClass['mediaColumnIsJson'];
  nowColumnDefault: SqlDriverClass['nowColumnDefault'];
  rowWidthProfile: SqlDriverClass['rowWidthProfile'];
  schemaBytesPerChar: SqlDriverClass['schemaBytesPerChar'];
  varcharColumnChars: SqlDriverClass['varcharColumnChars'];
}

/** The bodies of the "Column creation helper" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class ColumnCreationFacet {
  /** The body of `SqlDriver#createAuditTimestampColumn`; the method's docblock there is its contract. */
  static createAuditTimestampColumn(this: Pick<ColumnCreationHost, 'isMysql' | 'isSqlite' | 'knex' | 'nowColumnDefault'>, table: Knex.CreateTableBuilder, name: string): void {
    if (this.isMysql) {
      table.datetime(name, { precision: MYSQL_DATETIME_PRECISION }).defaultTo(this.nowColumnDefault('datetime'));
      return;
    }
    if (this.isSqlite) {
      table.timestamp(name).defaultTo(this.nowColumnDefault('datetime'));
      return;
    }
    table.timestamp(name).defaultTo(this.knex.fn.now());
  }

  /** The body of `SqlDriver#declaredVarcharLength`; the method's docblock there is its contract. */
  static declaredVarcharLength(field: any): number | null {
    const declared = (field as { maxLength?: unknown }).maxLength;
    const n = typeof declared === 'string' ? Number(declared) : declared;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
      return SqlDriver.DEFAULT_STRING_VARCHAR_CHARS;
    }
    return n > SqlDriver.MAX_VARCHAR_CHARS ? null : n;
  }

  /** The body of `SqlDriver#keyableTextLength`; the method's docblock there is its contract. */
  static keyableTextLength(field: any): number | null {
    const declared = (field as { maxLength?: unknown }).maxLength;
    const n = typeof declared === 'string' ? Number(declared) : declared;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return null;
    if (n > SqlDriver.MAX_KEYABLE_VARCHAR_CHARS) return null;
    return n;
  }

  /** The body of `SqlDriver#explainUnkeyableTextColumn`; the method's docblock there is its contract. */
  static async explainUnkeyableTextColumn(this: Pick<ColumnCreationHost, 'declaredFieldsFor' | 'keyableTextLength' | 'knex'>, tableName: string, indexName: string, columns: string[], cause: unknown): Promise<string | null> {
    const code = (cause as { code?: string } | undefined)?.code;
    if (code !== 'ER_BLOB_KEY_WITHOUT_LENGTH' && code !== 'ER_TOO_LONG_KEY') return null;
    let offenders: string[] = [];
    try {
      const info: Record<string, { type?: string }> = await this.knex(tableName).columnInfo();
      offenders = columns.filter((c) => /text|blob/i.test(String(info?.[c]?.type ?? '')));
    } catch {
      // Introspection is a nicety here; the advice below holds without it.
    }
    const named =
      offenders.length > 0
        ? `Column(s) ${offenders.map((c) => `"${c}"`).join(', ')} are stored as TEXT`
        : 'One or more of its key columns is stored as TEXT';

    // Commit ebcc34e89: the SAME refusal has two causes, and the message below is true of
    // only one of them. On CREATE the field really declares no usable bound, so
    // "declare `maxLength`" is the fix. On an UPGRADE the bound IS declared —
    // the additive sync never rewrites a column's type (#3728), so a column
    // created before the declaration stays TEXT forever — and that same sentence
    // tells the operator to do what they already did, once per boot, in
    // production, which reads as the release they just deployed being broken.
    //
    // The discriminator is per COLUMN and needs BOTH halves, which is why it is
    // computed here rather than inferred from the error code: a bounded
    // declaration alone does not imply a stale column, because `ER_TOO_LONG_KEY`
    // can refuse a COMPOSITE whose parts are each individually keyable (see
    // {@link MAX_KEYABLE_VARCHAR_CHARS} — the bound is per KEY, not per column).
    // So the branch fires only where the physical column is TEXT *and*
    // {@link keyableTextLength} says a fresh create would have emitted
    // `varchar(n)` for it. When `columnInfo()` fails, `offenders` is empty and
    // this map stays empty, so the CREATE-path message stands — the honest
    // reading, since without introspection the two causes are indistinguishable.
    //
    // `declaredFieldsFor` returns `undefined` for a table this driver does not
    // own the column set of, and misses a SHARD table (registered under the base
    // name). Both degrade to the message below rather than guessing.
    const declaredFields = this.declaredFieldsFor(tableName);
    const staleBounds = new Map<string, number>();
    for (const c of offenders) {
      const field = declaredFields?.[c];
      const bound = field ? this.keyableTextLength(field) : null;
      if (bound !== null) staleBounds.set(c, bound);
    }

    if (staleBounds.size > 0) {
      const staleNamed = [...staleBounds]
        .map(([c, n]) => `"${c}" (declares \`maxLength: ${n}\`)`)
        .join(', ');
      const [firstColumn, firstBound] = [...staleBounds][0];
      // Named in full, deliberately. The mirror case in `schema-drift.ts` (the
      // unbounded field over a stale `varchar`) already had to derive this, and
      // the two MySQL `MODIFY` hazards it names are recorded twice more in this
      // file, on the datetime and time widenings: MODIFY does NOT repeat a
      // `NOT NULL`, and it DROPS a `DEFAULT` it does not restate. An operator
      // who follows an abbreviated version of this remedy ends up worse off than
      // the no-op they started with — a column that lost its default.
      const others =
        offenders.length > staleBounds.size
          ? ` Column(s) ${offenders
              .filter((c) => !staleBounds.has(c))
              .map((c) => `"${c}"`)
              .join(', ')} in the same key declare no usable bound and DO need \`maxLength\` ` +
            `declared on the field.`
          : '';
      return (
        `[sql-driver] cannot create index '${indexName}' on "${tableName}" — MySQL refuses a TEXT/BLOB ` +
        `column in a key without a key length. Column(s) ${staleNamed} are stored as TEXT even though the ` +
        `field ALREADY declares a usable \`maxLength\` — the column was created before that bound was ` +
        `declared, and the additive sync never rewrites a column's type, so re-declaring \`maxLength\` ` +
        `changes nothing here. REMEDY: convert the column(s) to varchar(n) by hand, with a backup ` +
        `taken first, restating the FULL column definition on MySQL (MODIFY drops a NOT NULL or DEFAULT you ` +
        `do not repeat) — e.g. ALTER TABLE \`${tableName}\` MODIFY \`${firstColumn}\` ` +
        `varchar(${firstBound}) plus that column's existing NOT NULL / DEFAULT clauses, restated verbatim; ` +
        `— and let the next boot create this index. ObjectStack does NOT rewrite the column for you: that ` +
        `ALTER needs an exclusive metadata lock on the table, which makes it a destructive, hard-to-roll-back ` +
        `action and a deliberate manual floor rather than a boot-time one.${others} The table exists but this ` +
        `index does NOT, so any uniqueness it declared is currently unenforced. A prefix index is deliberately ` +
        `not substituted: on a UNIQUE index it constrains the prefix rather than the value, and rejects two ` +
        `different values that share one.`
      );
    }

    return (
      `[sql-driver] cannot create index '${indexName}' on "${tableName}" — MySQL refuses a TEXT/BLOB ` +
      `column in a key without a key length. ${named} because the field declares no \`maxLength\` (or one ` +
      `wider than ${SqlDriver.MAX_KEYABLE_VARCHAR_CHARS} characters, the most a utf8mb4 key part can hold). ` +
      `Declare \`maxLength\` on the field(s) so the column is emitted as varchar(n) and can be keyed. ` +
      `The table exists but this index does NOT, so any uniqueness it declared is currently ` +
      `unenforced. A prefix index is deliberately not substituted: on a UNIQUE index it constrains the ` +
      `prefix rather than the value, and rejects two different values that share one.`
    );
  }

  /** The body of `SqlDriver#hashShadowColumnFor`; the method's docblock there is its contract. */
  static hashShadowColumnFor(indexName: string): string {
    // Commit cd1348802: DELEGATES rather than re-deriving. The differ has to look for
    // exactly the column the sync creates, and the two halves of that question
    // lived in different modules — which is how a healthy shadow-carried
    // UNIQUE came to be reported as destructive drift while the shadow column
    // itself was protected as driver-owned. One derivation, both readers.
    return hashShadowColumnFor(indexName);
  }

  /** The body of `SqlDriver#createHashShadowUniqueIndex`; the method's docblock there is its contract. */
  static async createHashShadowUniqueIndex(this: Pick<ColumnCreationHost, 'hashShadowColumnState' | 'isMysql' | 'knex' | 'logDurabilityFailure' | 'logger'>, tableName: string, indexName: string, columns: string[], nullSafeColumns?: ReadonlySet<string>): Promise<boolean> {
    if (!this.isMysql) return false;
    const shadow = SqlDriver.hashShadowColumnFor(indexName);
    const ref = (c: string) => `\`${c.replace(/`/g, '``')}\``;
    // The DECLARED key part: NULL-safe parts in their COALESCE form (commit df1c75c4b),
    // plain parts as the bare column.
    const part = (c: string) =>
      nullSafeColumns?.has(c) ? `COALESCE(${ref(c)}, '${GLOBAL_TENANT}')` : ref(c);
    // ONE argument needs no separator, and CONCAT of one value would only add
    // a chance to get the encoding wrong.
    const expr =
      columns.length === 1
        ? part(columns[0]!)
        : `CONCAT(${columns.map(part).join(', 0x1f, ')})`;
    const addColumn =
      `ADD COLUMN ${ref(shadow)} VARBINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(${expr}, 256))) STORED`;
    const addKey = `ADD UNIQUE KEY ${ref(indexName)} (${ref(shadow)})`;
    // Commit cd1348802: the shadow column OUTLIVES the index it carries. Dropping a
    // UNIQUE key by name does not drop the generated column keyed by it, so
    // every path that drops and re-syncs — `recreate_index` above all — arrives
    // back here with the survivor still on the table. The unconditional
    // `ADD COLUMN` then failed with a duplicate-COLUMN error, which is matched
    // by NEITHER the "already exists" absorb (that spells index names) nor the
    // unique-violation branch, so the apply ended with the constraint DROPPED
    // and not re-created: an operator following the differ's own advice removed
    // a live uniqueness guarantee. The survivor is therefore inspected, never
    // assumed absent.
    const state = await this.hashShadowColumnState(tableName, indexName, columns, nullSafeColumns);
    if (state === 'foreign') {
      // A real, non-generated column already owns the name. It is not ours to
      // drop — it may hold data — so this route is refused and the caller falls
      // through to the refusal commit d0e3a885b named, which is the honest outcome.
      this.logDurabilityFailure(
        `[sql-driver] cannot carry UNIQUE index '${indexName}' on "${tableName}" on a hash shadow — the ` +
          `column "${shadow}" already exists and is NOT a generated column, so it is not the driver's to ` +
          `replace: it may hold data. The declared constraint is NOT enforced; rename or drop that column.`,
      );
      return false;
    }
    if (state === 'reusable') {
      // The survivor already hashes exactly the declared key — re-key it rather
      // than rebuild the table for a column that is byte-for-byte what we want.
      await this.knex.raw(`ALTER TABLE ${ref(tableName)} ${addKey}`);
    } else if (state === 'stale') {
      // The survivor hashes a DIFFERENT key than metadata now declares — the
      // raw-column shadow from before commit df1c75c4b is exactly this case. Reusing it would
      // re-enforce the old constraint under the new name, which is the silent
      // wrong answer; the column carries no user data (it is derived), so it is
      // dropped and re-generated. Two statements rather than one ALTER: the
      // index it carried is already gone by the time we are here, and a single
      // `DROP COLUMN c, ADD COLUMN c` is a shape not worth relying on.
      await this.knex.raw(`ALTER TABLE ${ref(tableName)} DROP COLUMN ${ref(shadow)}`);
      await this.knex.raw(`ALTER TABLE ${ref(tableName)} ${addColumn}, ${addKey}`);
    } else {
      await this.knex.raw(`ALTER TABLE ${ref(tableName)} ${addColumn}, ${addKey}`);
    }
    // The boot log describes the key the shadow actually enforces — the
    // NULL-safe parts in their COALESCE spelling — so "carried" can be read
    // literally (commit df1c75c4b).
    const described = columns
      .map((c) => (nullSafeColumns?.has(c) ? `COALESCE(${c}, '${GLOBAL_TENANT}')` : c))
      .join(', ');
    this.logger.warn(
      `[sql-driver] UNIQUE index '${indexName}' on "${tableName}" is carried by the hash-shadow column ` +
        `"${shadow}" (SHA-256 of ${described}), because MySQL cannot key ${columns.length > 1 ? 'this column set' : 'a column'} ` +
        `longer than ${SqlDriver.MAX_KEYABLE_VARCHAR_CHARS} characters directly. The declared ` +
        `constraint is enforced over the full value; only the physical key differs.` +
        (state === 'reusable'
          ? ` The shadow column already existed and hashes this exact key — re-keyed in place.`
          : state === 'stale'
            ? ` A surviving shadow column hashed a DIFFERENT key and was re-generated.`
            : ''),
      { tableName, indexName, columns, shadow, shadowColumnState: state },
    );
    return true;
  }

  /** The body of `SqlDriver#hashShadowColumnState`; the method's docblock there is its contract. */
  static async hashShadowColumnState(this: Pick<ColumnCreationHost, 'knex'>, tableName: string, indexName: string, columns: string[], nullSafeColumns?: ReadonlySet<string>): Promise<'absent' | 'reusable' | 'stale' | 'foreign'> {
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await this.knex
        .select('GENERATION_EXPRESSION')
        .from('information_schema.COLUMNS')
        .where({
          TABLE_SCHEMA: this.knex.client.database(),
          TABLE_NAME: tableName,
          COLUMN_NAME: SqlDriver.hashShadowColumnFor(indexName),
        });
    } catch {
      return 'absent';
    }
    if (rows.length === 0) return 'absent';
    const expr = String(rows[0]?.GENERATION_EXPRESSION ?? rows[0]?.generation_expression ?? '');
    if (expr.trim() === '') return 'foreign';
    const parts = parseHashShadowKeyParts(expr);
    if (parts.length === 0) return 'stale';
    const carried = canonicalIndexKey(
      parts.map((k) => k.column),
      parts.filter((k) => k.nullSafe).map((k) => k.column),
    );
    return carried === canonicalIndexKey(columns, [...(nullSafeColumns ?? [])])
      ? 'reusable'
      : 'stale';
  }

  /** The body of `SqlDriver#dropOrphanedHashShadowColumn`; the method's docblock there is its contract. */
  static async dropOrphanedHashShadowColumn(this: Pick<ColumnCreationHost, 'isMysql' | 'knex' | 'logger'>, tableName: string, indexName: string): Promise<boolean> {
    // Shadows are a MySQL-only construct: `createHashShadowUniqueIndex` refuses
    // every other dialect, so there is nothing to collect and no catalog read
    // worth paying for.
    if (!this.isMysql) return false;
    const shadow = SqlDriver.hashShadowColumnFor(indexName);

    let generationExpression: string;
    try {
      const rows = await this.knex
        .select('GENERATION_EXPRESSION')
        .from('information_schema.COLUMNS')
        .where({
          TABLE_SCHEMA: this.knex.client.database(),
          TABLE_NAME: tableName,
          COLUMN_NAME: shadow,
        });
      if (rows.length === 0) return false; // nothing survived; the ordinary case
      generationExpression = String(
        rows[0]?.GENERATION_EXPRESSION ?? rows[0]?.generation_expression ?? '',
      );
    } catch {
      return false;
    }
    if (generationExpression.trim() === '') {
      this.logger.warn(
        `[sql-driver] NOT dropping "${tableName}"."${shadow}" while collecting the retired index ` +
          `'${indexName}' — a column of that name exists and is NOT a generated column, so it is not ` +
          `the driver's to drop and may hold data. Remove it by hand if it is unwanted.`,
        { tableName, indexName, shadow },
      );
      return false;
    }

    let stillKeyedBy: string[];
    try {
      const rows = await this.knex
        .select('INDEX_NAME')
        .from('information_schema.STATISTICS')
        .where({
          TABLE_SCHEMA: this.knex.client.database(),
          TABLE_NAME: tableName,
          COLUMN_NAME: shadow,
        });
      stillKeyedBy = [
        ...new Set(rows.map((r: any) => String(r.INDEX_NAME ?? r.index_name ?? ''))),
      ].filter((n) => n !== '');
    } catch {
      return false;
    }
    if (stillKeyedBy.length > 0) {
      this.logger.warn(
        `[sql-driver] NOT dropping "${tableName}"."${shadow}" while collecting the retired index ` +
          `'${indexName}' — ${stillKeyedBy.length} index(es) still key that column ` +
          `(${stillKeyedBy.join(', ')}), so dropping it would remove them too.`,
        { tableName, indexName, shadow, stillKeyedBy },
      );
      return false;
    }

    await this.knex.raw('ALTER TABLE ?? DROP COLUMN ??', [tableName, shadow]);
    this.logger.warn(
      `[sql-driver] dropped the hash-shadow column "${shadow}" from "${tableName}" — the UNIQUE index ` +
        `'${indexName}' it carried is retired, so the STORED generated column was recomputed on every ` +
        `write for a constraint that no longer exists.`,
      { tableName, indexName, shadow },
    );
    return true;
  }

  /** The body of `SqlDriver#explainHashShadowDuplicate`; the method's docblock there is its contract. */
  static async explainHashShadowDuplicate(this: Pick<ColumnCreationHost, 'hashShadowSourceColumns' | 'isMysql' | 'knex'>, tableName: string, values: Record<string, unknown>, cause: unknown): Promise<string | null> {
    if (!this.isMysql) return null;
    if ((cause as { code?: string } | undefined)?.code !== 'ER_DUP_ENTRY') return null;
    const message = String((cause as { message?: string } | undefined)?.message ?? '');
    // MySQL names the key as `table.index` (8.0) or `index` (5.7) — take the
    // last path segment either way.
    const keyed = /for key '([^']+)'/.exec(message);
    if (!keyed) return null;
    const indexName = keyed[1]!.split('.').pop()!;
    const shadow = SqlDriver.hashShadowColumnFor(indexName);
    let shadowExists = false;
    try {
      shadowExists = await this.knex.schema.hasColumn(tableName, shadow);
    } catch {
      return null;
    }
    if (!shadowExists) return null;
    const sources = await this.hashShadowSourceColumns(tableName, indexName);
    if (sources.length === 0) return null;
    // Only the source columns the failing write actually supplied; a partial
    // update cannot be re-selected on columns it never mentioned. A NULL-safe
    // key part (commit df1c75c4b) is exempt: the enforced key COALESCEs an absent or
    // NULL value into the '__global__' bucket, so its key part is knowable
    // without the write mentioning the column.
    if (
      !sources.every(
        (s) => s.nullSafe || Object.prototype.hasOwnProperty.call(values, s.column),
      )
    ) {
      return null;
    }
    let existing = 0;
    try {
      // Re-select by the key the index ENFORCES, not by raw equality (commit df1c75c4b):
      // a NULL-safe part compares through the same COALESCE the generation
      // expression carries (NULL and absent both land in the global bucket),
      // and plain parts use `<=>` — MySQL's NULL-safe equality; this whole
      // route is inside `isMysql`. A bare `.where({col: null})` would compare
      // `= NULL`, match nothing, and misreport a genuine NULL-organization
      // duplicate as a HASH COLLISION.
      let q = this.knex(tableName);
      for (const s of sources) {
        q = s.nullSafe
          ? q.whereRaw(`COALESCE(??, '${GLOBAL_TENANT}') = COALESCE(?, '${GLOBAL_TENANT}')`, [
              s.column,
              (values[s.column] ?? null) as any,
            ])
          : q.whereRaw('?? <=> ?', [s.column, (values[s.column] ?? null) as any]);
      }
      const rows = await q.limit(1);
      existing = rows.length;
    } catch {
      return null;
    }
    // Describe the key parts as enforced — NULL-safe parts in their COALESCE
    // spelling — so the message names the actual constraint (commit df1c75c4b).
    const described = sources
      .map((s) => (s.nullSafe ? `COALESCE(${s.column}, '${GLOBAL_TENANT}')` : s.column))
      .join(', ');
    if (existing > 0) {
      // The ordinary case: a real duplicate. Say so in the declared terms
      // rather than leaving MySQL's binary digest as the only explanation.
      return (
        `[sql-driver] duplicate value for the UNIQUE constraint '${indexName}' on "${tableName}" ` +
        `(${described}). The constraint is physically carried by a hash-shadow column, so the ` +
        `server's own message quotes a binary digest instead of the value.`
      );
    }
    return (
      `[sql-driver] HASH COLLISION on the shadow-carried UNIQUE index '${indexName}' on "${tableName}" ` +
      `(${described}): the write was rejected as a duplicate, but NO existing row carries these ` +
      `values. Uniqueness on this index is enforced over a SHA-256 of them, so two different ` +
      `values produced the same digest. This is expected at a rate near 10^-59 for a billion rows — if ` +
      `you are reading this, please report it with the values above; the write itself is legitimate and ` +
      `is being refused.`
    );
  }

  /** The body of `SqlDriver#decorateHashShadowDuplicate`; the method's docblock there is its contract. */
  static async decorateHashShadowDuplicate(this: Pick<ColumnCreationHost, 'explainHashShadowDuplicate' | 'logDurabilityFailure'>, tableName: string, values: Record<string, unknown>, error: unknown): Promise<unknown> {
    let explanation: string | null = null;
    try {
      explanation = await this.explainHashShadowDuplicate(tableName, values, error);
    } catch {
      // The disambiguation is a diagnostic. If it cannot be made, the original
      // failure is still the failure — never mask it with this one.
      return error;
    }
    if (!explanation) return error;
    this.logDurabilityFailure(explanation);
    return Object.assign(new Error(`${explanation} (server said: ${String((error as { message?: string })?.message ?? error)})`), {
      code: (error as { code?: string })?.code,
      cause: error,
    });
  }

  /** The body of `SqlDriver#hashShadowSourceColumns`; the method's docblock there is its contract. */
  static async hashShadowSourceColumns(this: Pick<ColumnCreationHost, 'knex'>, tableName: string, indexName: string): Promise<HashShadowKeyPart[]> {
    try {
      const rows: Array<{ GENERATION_EXPRESSION?: string; generation_expression?: string }> =
        await this.knex
          .select('GENERATION_EXPRESSION')
          .from('information_schema.COLUMNS')
          .where({
            TABLE_SCHEMA: this.knex.client.database(),
            TABLE_NAME: tableName,
            COLUMN_NAME: SqlDriver.hashShadowColumnFor(indexName),
          });
      const expr = String(rows[0]?.GENERATION_EXPRESSION ?? rows[0]?.generation_expression ?? '');
      // `unhex(sha2(`a`,256))`, `unhex(sha2(concat(`a`,0x1f,`b`),256))`, or with
      // a NULL-safe part: `…concat(coalesce(`org`,_utf8mb4'__global__'),0x1f,`b`)…`
      // (commit df1c75c4b). Commit cd1348802 moved the parse itself next to the shadow vocabulary
      // in `schema-drift.ts`: the differ reads the same expression to decide
      // whether a shadow-carried index enforces what metadata declares, and two
      // copies of this regex would be two answers to one question.
      return parseHashShadowKeyParts(expr);
    } catch {
      return [];
    }
  }

  /** The body of `SqlDriver#varcharPackLength`; the method's docblock there is its contract. */
  static varcharPackLength(chars: number, bytesPerChar: number): number {
    const payload = chars * bytesPerChar;
    return payload + (payload < 256 ? 1 : 2);
  }

  /** The body of `SqlDriver#varcharColumnChars`; the method's docblock there is its contract. */
  static varcharColumnChars(this: Pick<ColumnCreationHost, 'declaredVarcharLength' | 'keyableTextLength' | 'mediaColumnIsJson'>, field: any, keyed?: { unique: boolean }): number | null {
    // Multi-value is decided before the type switch in `createColumn` — a JSON
    // column, whatever the element type would have been. [#17469] The question
    // is {@link isMultiValuedColumn}'s, exactly as it is there, so this mirror
    // cannot answer a different one.
    const type = field?.type || 'string';
    if (isMultiValuedColumn(String(type), field)) return null;
    switch (type) {
      case 'string':
      case 'email':
      case 'url':
      case 'phone':
      case 'password':
        return this.declaredVarcharLength(field);
      case 'text':
      case 'textarea':
      case 'html':
      case 'markdown':
      case 'richtext':
      case 'code':
      // #11875 — moved out of the catch-all together with `createColumn`'s
      // text-family case: the write seam now enforces their declared bound.
      case 'signature':
      case 'qrcode':
        return keyed ? this.keyableTextLength(field) : null;
      // Virtual — `createColumn` returns without emitting anything.
      case 'formula':
        return null;
      // The non-string primitives: INTEGER / REAL / DECIMAL / BOOLEAN / DATE /
      // DATETIME / TIME columns. None of them is a varchar, so none is sized
      // from `maxLength` — which is the only question this mirror answers.
      // ⚠️ Since #16318 the numeric members ARE sized, by `numericColumnFor`,
      // but from the field's TYPE and not from any declaration; `null` here
      // stays the correct answer to the question actually asked.
      case 'integer':
      case 'int':
      case 'float':
      case 'number':
      case 'currency':
      case 'percent':
      case 'rating':
      case 'slider':
      case 'progress':
      case 'summary':
      case 'boolean':
      case 'toggle':
      case 'date':
      case 'datetime':
      case 'time':
        return null;
      default:
        // `createColumn`'s catch-all, spelled the same way so the two cannot
        // disagree about which types are JSON: everything else is
        // `table.string(name)` at knex's default width.
        //
        // ⚠️ The FILE family first, and by the same deployment question the
        // emitter asks — this mirror is what the drift detector consults
        // INSTEAD of restating the emitter's cases, so a mirror that answered
        // `null` for a moved media column would tell the detector no varchar
        // exists where the emitter had just built one.
        if (FILE_REFERENCE_TYPES.has(type)) {
          return this.mediaColumnIsJson() ? null : MEDIA_ID_VARCHAR_CHARS;
        }
        return JSON_COLUMN_TYPES.has(type) ? null : SqlDriver.DEFAULT_STRING_VARCHAR_CHARS;
    }
  }

  /** The body of `SqlDriver#rowWidthProfile`; the method's docblock there is its contract. */
  static rowWidthProfile(this: Pick<ColumnCreationHost, 'varcharColumnChars'>, fields: Record<string, any> | undefined, keyedColumns: ReadonlyMap<string, { unique: boolean }>, bytesPerChar: number): { columns: RowWidthContribution[]; totalBytes: number } {
    const builtin = new Set<string>(['id', ...AUDIT_TIMESTAMP_COLUMNS]);
    const columns: RowWidthContribution[] = [];
    for (const [name, field] of Object.entries(fields ?? {})) {
      if (builtin.has(name)) continue;
      const chars = this.varcharColumnChars(field, keyedColumns.get(name));
      if (chars === null) continue;
      columns.push({ name, chars, bytes: SqlDriver.varcharPackLength(chars, bytesPerChar) });
    }
    columns.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    return { columns, totalBytes: columns.reduce((sum, c) => sum + c.bytes, 0) };
  }

  /** The body of `SqlDriver#schemaBytesPerChar`; the method's docblock there is its contract. */
  static async schemaBytesPerChar(this: Pick<ColumnCreationHost, 'knex'>): Promise<{ bytesPerChar: number; charset: string } | null> {
    try {
      const res: any = await this.knex.raw(
        'select cs.CHARACTER_SET_NAME as charset, cs.MAXLEN as maxlen ' +
          'from information_schema.CHARACTER_SETS cs ' +
          'where cs.CHARACTER_SET_NAME = @@character_set_database',
      );
      const row = (Array.isArray(res) ? res[0]?.[0] : (res?.rows?.[0] ?? res?.[0])) ?? null;
      const maxlen = Number(row?.maxlen ?? row?.MAXLEN);
      const charset = String(row?.charset ?? row?.CHARSET ?? '');
      if (!Number.isInteger(maxlen) || maxlen <= 0 || !charset) return null;
      return { bytesPerChar: maxlen, charset };
    } catch {
      // Introspection is a nicety here; the advice below holds without it.
      return null;
    }
  }

  /** The body of `SqlDriver#explainRowSizeOverflow`; the method's docblock there is its contract. */
  static async explainRowSizeOverflow(this: Pick<ColumnCreationHost, 'rowWidthProfile' | 'schemaBytesPerChar'>, tableName: string, fields: Record<string, any> | undefined, keyedColumns: ReadonlyMap<string, { unique: boolean }>, addedColumns: string[] | null, cause: unknown): Promise<string | null> {
    if ((cause as { code?: string } | undefined)?.code !== 'ER_TOO_BIG_ROWSIZE') return null;

    const server = await this.schemaBytesPerChar();
    const bytesPerChar = server?.bytesPerChar ?? SqlDriver.ASSUMED_BYTES_PER_CHAR;
    const charsetNote = server
      ? `${bytesPerChar} bytes/character (${server.charset}, this schema's charset)`
      : `${bytesPerChar} bytes/character (utf8mb4 assumed — the server's charset could not be read)`;
    const { columns, totalBytes } = this.rowWidthProfile(fields, keyedColumns, bytesPerChar);

    // Two DIFFERENT limits answer with this one code, and they quote different
    // numbers. Reading the server's own text keeps the message from asserting
    // the 65535 one over a refusal that was really InnoDB's page limit.
    const serverText = String((cause as { sqlMessage?: string; message?: string }).sqlMessage ?? '');
    const pageLimit = /row size too large \(>\s*(\d+)\)/i.exec(serverText)?.[1] ?? null;
    const limitClause = pageLimit
      ? `InnoDB's per-PAGE limit of ${pageLimit} bytes — which many NARROW bounded columns reach far below the ` +
        `${SqlDriver.MYSQL_ROW_BYTE_BUDGET}-byte one, because a column narrower than about 256 bytes is never ` +
        `stored off-page (measured on 8.0.46: 40 fields at \`maxLength: 63\` are refused)`
      : `the server's ${SqlDriver.MYSQL_ROW_BYTE_BUDGET}-byte budget for one ROW`;

    const SHOWN = 8;
    const listed = columns
      .slice(0, SHOWN)
      .map((c) => `"${c.name}" varchar(${c.chars}) = ${c.bytes} bytes`)
      .join(', ');
    const rest = columns.length > SHOWN ? `, and ${columns.length - SHOWN} more` : '';
    const inventory =
      columns.length === 0
        ? `This object produces no varchar column at all, so the width is in the built-in columns or in a ` +
          `type this diagnostic does not size — report it, because that is not a shape it was measured on.`
        : `Its ${columns.length} varchar column(s) take ${totalBytes} bytes at ${charsetNote}, on top of the ` +
          `built-in \`id\` (a varchar(${SqlDriver.DEFAULT_STRING_VARCHAR_CHARS})), \`created_at\` and ` +
          `\`updated_at\` columns. Widest first: ${listed}${rest}.`;

    const opening =
      addedColumns && addedColumns.length > 0
        ? `[sql-driver] cannot add column(s) ${addedColumns.map((c) => `"${c}"`).join(', ')} to "${tableName}"`
        : `[sql-driver] cannot create table "${tableName}"`;

    return (
      `${opening} — MySQL refuses the whole row: every bounded column's DECLARED width is charged against ` +
      `${limitClause}, whether or not a row ever holds that much. ${inventory} ` +
      `Fix it on the declarations: lower \`maxLength\` on the widest field(s), or drop the bound from a ` +
      `text-family field no index keys on so it is emitted as TEXT — an off-page TEXT column costs this ` +
      `budget a small pointer rather than its full declared width. Note that a field declaring NO ` +
      `\`maxLength\` still takes varchar(${SqlDriver.DEFAULT_STRING_VARCHAR_CHARS}) ` +
      `(${SqlDriver.varcharPackLength(SqlDriver.DEFAULT_STRING_VARCHAR_CHARS, bytesPerChar)} bytes here), and ` +
      `so do \`lookup\`, \`user\`, \`auto_number\` and the option types — an object can reach this limit ` +
      `without declaring a bound anywhere. The server's own error names no column, which is the whole reason ` +
      `this one does.`
    );
  }

  /**
   * Re-throw a schema-mutation failure carrying {@link explainRowSizeOverflow}'s
   * explanation, or the original untouched when it is not a row-size refusal.
   *
   * The SAME failure, re-worded — the boot still fails, loudly, and no object is
   * registered that MySQL declined to build. `sqlMessage` rather than `message`
   * for the quoted server text: knex prefixes `message` with the entire DDL
   * statement, which for the object that trips this is thousands of characters
   * of `varchar(...)` and buries the one sentence the server actually said.
   */
  static async rethrowWithRowSizeExplanation(this: Pick<ColumnCreationHost, 'explainRowSizeOverflow' | 'logDurabilityFailure'>, tableName: string, fields: Record<string, any> | undefined, keyedColumns: ReadonlyMap<string, { unique: boolean }>, addedColumns: string[] | null, e: any): Promise<never> {
    const overflow = await this.explainRowSizeOverflow(tableName, fields, keyedColumns, addedColumns, e);
    if (!overflow) throw e;
    const said = String(e?.sqlMessage ?? e?.message ?? e);
    this.logDurabilityFailure(overflow, said);
    throw Object.assign(new Error(`${overflow} (server said: ${said})`), {
      code: (e as { code?: string }).code,
      cause: e,
    });
  }

  /** The body of `SqlDriver#jsonColumn`; the method's docblock there is its contract. */
  static jsonColumn(this: Pick<ColumnCreationHost, 'isSqlite'>, table: Knex.CreateTableBuilder, name: string): any {
    return this.isSqlite ? table.text(name) : table.json(name);
  }

  /** The body of `SqlDriver#createColumn`; the method's docblock there is its contract. */
  static createColumn(this: Pick<ColumnCreationHost, 'applyDeclaredColumnDefault' | 'declaredVarcharLength' | 'isMysql' | 'jsonColumn' | 'keyableTextLength' | 'mediaColumnIsJson'>, table: Knex.CreateTableBuilder, name: string, field: any, keyed?: { unique: boolean }, tenantColumn: boolean = false) {
    // [#11567] Stated BEFORE the `multiple` short-circuit and before the type
    // switch, because the spec's refusal is gated on neither: `FieldSchema`
    // answers `unrecognized_keys` for `reference_to` on ANY field, whatever its
    // type, and a multi-value lookup (a JSON column, returning immediately
    // below) used to carry the key straight past this seam. One key, one
    // answer, wherever it appears.
    //
    // `!== undefined` rather than `'reference_to' in field`: it refuses every
    // value the key can actually carry — including the `null` and `''` the old
    // truthy gate ignored — while staying immune to a producer that spreads an
    // explicit `{ reference_to: undefined }`. Measured: `FieldSchema`'s own
    // canonical output does NOT carry `reference_to` as an own key, so key
    // presence would have been correct too; this is the narrower of two
    // correct predicates.
    if (field.reference_to !== undefined) refuseRejectedReferenceAlias(name);

    // [#17469] Was `if (field.multiple)`. The DDL writer and {@link isJsonField}
    // are one source by the {@link JSON_COLUMN_TYPES} header's own contract
    // ("so the two can't drift"), so the writer asks the same predicate the
    // reader now asks. A field whose `multiple` the spec does not recognise on
    // its type no longer gets a JSON column here — and `FieldSchema` refuses
    // that declaration at the authoring entrance in the same ruling.
    //
    // [#17231] The short-circuit decides the column TYPE; it does not decide
    // the column's CONSTRAINTS, and returning here used to mean it silently
    // did. ADR-0113 P0 names this site verbatim — 「the physical constraint now
    // keys off the explicitly-authored `storage.notNull` at that same
    // `#createColumn` site」 — and carves out no field type: `storage.notNull`'s
    // only declared exclusivity is `requiredWhen` (`FieldSchema.superRefine`),
    // so `multiple: true` + `storage: { notNull: true }` is an authorable
    // declaration this site was dropping on the floor. The differ, ADR-0113's
    // other named consumer in this package, never had the gap — `fieldHasColumn`
    // answers multi-value first and the nullability comparison then runs — so
    // the platform reported DESTRUCTIVE `tighten_not_null` drift against tables
    // it had itself just created, with no rows in them.
    //
    // ⚠️ NOT the drift ceremony this ADR routes around: `createColumn` runs on
    // `CREATE TABLE` and on `ALTER TABLE ADD COLUMN`, so the column constrained
    // here is always EMPTY — the same reason the string family's #11431 note
    // below gives for narrowing a varchar here. Imposing `NOT NULL` over
    // possibly-null data stays `tighten_not_null`, destructive, behind
    // `os migrate apply --allow-destructive`, untouched.
    //
    // The column DEFAULT is deliberately still NOT emitted on this path: the
    // multi-value shape has no scalar DDL form, and `os generate migration`
    // skips it for the same reason (`declaredColumnDefault`), so the two
    // producers already agree.
    if (isMultiValuedColumn(String(field.type ?? ''), field)) {
      const jsonCol = this.jsonColumn(table, name);
      if (declaresColumnNotNull(field) || tenantColumn) jsonCol.notNullable();
      return;
    }

    // [#16319] ⛔ Was `const type = field.type || 'string'`. See
    // {@link refuseUndeclaredFieldType} for what that default cost and why the
    // answer here is a refusal rather than a different guess. Asked after the
    // multi-value short-circuit, exactly where the default stood — and a field
    // with NO type is now refused rather than silently made a JSON column,
    // which is this ruling's own direction: a type the spec never saw cannot
    // carry a `multiple` the spec recognises.
    if (!isDeclaredFieldType(field)) refuseUndeclaredFieldType(name);
    const type: string = field.type;
    let col: any;
    switch (type) {
      case 'string':
      case 'email':
      case 'url':
      case 'phone':
      case 'password': {
        // #11431: the string family takes its declared `maxLength`, instead of
        // knex's invented default of 255.
        //
        // The bound is the field's OWN — nothing is guessed. `schema-drift.ts`
        // has always treated `varchar(field.maxLength)` as the EXPECTED
        // physical shape of a bounded field (`widen_varchar` /
        // `narrow_varchar` say so in as many words), so before this branch the
        // differ and the emitter disagreed about every column the driver
        // itself had just created. Measured on live MySQL 8.0.46 and Postgres
        // 16 on the pre-fix tree: a `maxLength: 400` email, a `maxLength: 1024`
        // url and a `maxLength: 20` phone all landed as `varchar(255)`, and the
        // same table reported two `widen_varchar` (warning/safe) plus one
        // `narrow_varchar` (error/DESTRUCTIVE) findings against itself, on a
        // table with no rows in it.
        //
        // The write half is the reported defect. A 300-character value —
        // legal under the declaration, and accepted by the record validator's
        // own `max_length` check — was refused by BOTH enforcing dialects:
        // MySQL `ER_DATA_TOO_LONG` under `STRICT_TRANS_TABLES`, Postgres
        // `22001 value too long for type character varying(255)`.
        //
        // ⚠️ Both directions, and the narrowing one is NOT a destructive
        // migration — a point worth stating because it reads like one:
        // `createColumn` runs on `CREATE TABLE` and on `ALTER TABLE ADD
        // COLUMN`, so the column it sizes is always EMPTY. Narrowing an
        // EXISTING `varchar(255)` that holds rows stays exactly where it was
        // before this change: the `narrow_varchar` drift op, category
        // `destructive`, behind `os migrate apply --allow-destructive`.
        // Nothing here plans an ALTER on an existing column, and the differ is
        // untouched. What this removes is the permanent, self-inflicted drift
        // report a fresh table used to raise against itself.
        const declared = this.declaredVarcharLength(field);
        col = declared === null ? table.text(name) : table.string(name, declared);
        break;
      }
      case 'text':
      case 'textarea':
      case 'html':
      case 'markdown':
      // #11794: `richtext` and `code` join the text family, and membership is
      // decided by a MEASURED test rather than by "this type's values look
      // long".
      //
      // ## What makes an unbounded TEXT column correct for a type
      //
      // That the WRITE SEAM enforces the type's declared `maxLength` — the
      // invariant the rest of this driver already rests on, stated in
      // `schema-drift.ts` in as many words: "A TEXT column refuses nothing a
      // `maxLength` allows … the bound is enforced at the write seam." So the
      // question is not whether a value can be long, it is whether the
      // declaration still binds once the column stops binding.
      //
      // objectql's record-validator applies its `max_length` / `min_length`
      // branch to exactly the spec's BOUNDED_STRING_FIELD_TYPES — measured,
      // not read off it: a `maxLength: 64` field of each member refuses a
      // 100-character value with a field-named ADR-0112 envelope, before any
      // column is reached. So membership here RESTORES the declared contract
      // (any string, as `valueSchemaFor` says) instead of widening past it.
      //
      // `richtext` is the headline member: the spec groups `markdown` / `html`
      // / `richtext` together as "Rich Content" (`field.zod.ts`) and two of
      // the three already landed here — the third fell through to the
      // catch-all's `table.string(name)`, knex's varchar(255), so an ordinary
      // rich-text body over 255 characters was refused by both enforcing
      // dialects while the same body in a `markdown` field on the same table
      // was accepted. Measured at 1000 characters on live MySQL 8.0.46
      // (`ER_DATA_TOO_LONG` under `STRICT_TRANS_TABLES`) and Postgres 16
      // (`22001`). `code` is the same defect on the same evidence — a code
      // editor's contents, refused identically on both dialects.
      case 'richtext':
      case 'code':
      // #11875 (maintainer ruling 2026-08-25, option 1): `signature` and
      // `qrcode` join under exactly the invariant above. #11794 measured them
      // (same live refusal: a 1000-char data-URI landed varchar(255) and was
      // refused `22001` on PG, `ER_DATA_TOO_LONG` on MySQL) and deliberately
      // left them in the catch-all, because at that point NOTHING enforced
      // their declared `maxLength` — an unbounded TEXT would have accepted
      // values the declaration forbids. That gap is now closed at both seams:
      // `FieldSchema` admits `maxLength` on them (BOUNDED_STRING_FIELD_TYPES)
      // and the record-validator's `max_length` branch reads the same set, so
      // a TEXT column here refuses nothing the declaration allows — the bound
      // is enforced at the write seam, and the data-URI refusal goes away.
      case 'signature':
      case 'qrcode': {
        // Commit d0e3a885b: a text-family column that some declared index KEYS ON is
        // emitted as `varchar(maxLength)` rather than TEXT, whenever the field
        // declared a bound this dialect can key on.
        //
        // MySQL refuses a TEXT/BLOB column in a key without a prefix length
        // (`ER_BLOB_KEY_WITHOUT_LENGTH`), so an unbounded TEXT is not merely a
        // slower key there — it is not a key at all: `CREATE TABLE` succeeds and
        // the following `ALTER TABLE … ADD [UNIQUE] INDEX` fails, leaving the
        // table on disk WITHOUT the constraint it declared. Measured on MySQL
        // 8.0.46 before this branch existed: 36 of the 44 platform objects
        // failed schema-sync that way, so an auth stack could not stand up its
        // own schema on a driver `createDefaultDatasourceDriverFactory` maps
        // `mysql`/`mysql2` onto.
        //
        // The bound is the field's OWN `maxLength` — nothing is invented here.
        // `schema-drift.ts` already treats `varchar(field.maxLength)` as the
        // expected physical shape of a bounded field (its `widen_varchar` /
        // `narrow_varchar` ops say so in as many words); this is the emitter
        // finally agreeing with the differ. There is no `Field.string`
        // builder: none of `Field`'s keys is named `string`, `FieldType.options`
        // omits it too, and `FieldSchema.safeParse({ type: 'string', … })`
        // fails at `[type]` (#12593). What IS true of knex: its bare
        // `table.string(name)` call (no length argument) is `varchar(255)`.
        // This branch never calls it bare — `table.string(name, keyable)`,
        // where `keyable` is the field's own declared `maxLength`, up to
        // `MAX_KEYABLE_VARCHAR_CHARS` (768 chars, wider than knex's
        // 255-char default).
        //
        // Applied on every dialect rather than under `isMysql`, deliberately:
        // the alternative is one declaration with two enforcement answers, so
        // the same app would refuse an over-length write on MySQL and accept it
        // on Postgres. Dialect-divergent enforcement of one declared bound is
        // the defect class this repo's conformance matrices exist to close, and
        // a `varchar(n)` is exactly what the SQLite and Postgres columns land
        // as for a field declared `Field.text({ maxLength: n })` on a keyed
        // column — the nearest authorable spelling to this shape; there is no
        // `Field.string` (#12593).
        //
        // ⚠️ Scope, both halves load-bearing:
        //   - KEYED only. A non-indexed `Field.text({ maxLength: 65000 })` stays
        //     TEXT: `varchar(65000)` on utf8mb4 is 260000 bytes and blows MySQL's
        //     65535-byte ROW limit, which would turn a working table into an
        //     un-creatable one. Off-page TEXT has no such cost, and a column no
        //     index keys on has nothing to gain from a bound.
        //   - BOUNDED only. `maxLength` absent, or wider than a key part can be
        //     ({@link keyableTextLength}), leaves the column TEXT — see
        //     {@link explainUnkeyableTextColumn} for what happens next, which is
        //     a named refusal and never a silently weaker constraint.
        const keyable = keyed ? this.keyableTextLength(field) : null;
        col = keyable === null ? table.text(name) : table.string(name, keyable);
        break;
      }
      case 'integer':
      case 'int':
        col = table.integer(name);
        break;
      // `float` is a DRIVER-SIDE ALIAS, not a `FieldType`: there is no
      // `Field.float` builder and `NUMERIC_VALUE_TYPES` does not carry it, so
      // #16318's table has no opinion about it and it keeps the column it has
      // always had.
      case 'float':
        col = table.float(name);
        break;
      // [#16318] The seven members of `NUMERIC_VALUE_TYPES` take the physical
      // representation `packages/spec` states for them ({@link
      // numericColumnFor}) — the same table both `os generate migration`
      // formats read, so one declaration can no longer produce three different
      // columns (measured on live PostgreSQL 16.13: this arm's `real`, the sql
      // format's `numeric(18,2)`/`numeric(5,2)`, and the typescript format's
      // `numeric(8,2)`). The spec module carries the measurements, the ruling
      // and the residual bound; ⛔ do not restate its numbers here.
      //
      // What this arm still owes its reader is the SQLite half, because that is
      // why three of these types were put in a float arm in the first place:
      //
      // `rating`/`slider`/`progress` are authored as numeric scalars (a star
      // count, a slider position, a percent-of-completion). Without an explicit
      // case they fell to `default → table.string`, giving the column TEXT
      // affinity so SQLite coerced the written number to a string ('4' not 4) —
      // a silent type-fidelity leak the value-loss tests didn't catch. REAL
      // affinity round-trips them as JS numbers (#field-zoo).
      //
      // That leak stays defeated, and MEASURED rather than argued: knex
      // compiles `table.decimal(name, p, s)` and `table.float(name)` to the
      // IDENTICAL `float` column on SQLite
      // (`ColumnCompiler_SQLite3.prototype.decimal` is the literal `'float'`),
      // so the six exact-decimal members emit byte-identical SQLite DDL to what
      // this arm emitted before and keep REAL affinity. `rating` moves to
      // INTEGER affinity, where SQLite stores `4` as an integer and still
      // accepts `4.5` as a REAL — it refuses no fractional value — so nothing
      // this dialect accepts today stops being accepted.
      //
      // ⚠️ The read path is what makes the move safe on the server dialects:
      // node-postgres parses `numeric` to a STRING and `real` to a number, and
      // it is `NUMERIC_SCALAR_TYPES`' existing `numericFields` coercion —
      // already registered for all seven of these types — that turns it back
      // into a JS number on the way out.
      case 'number':
      case 'currency':
      case 'percent':
      case 'rating':
      case 'slider':
      case 'progress':
      case 'summary': {
        const numeric = numericColumnFor(type);
        // ⛔ Not `?? table.float(name)`: an undefined answer for a type named
        // in these very case labels would mean the labels and
        // `NUMERIC_VALUE_TYPES` have parted, and a silent fallback is exactly
        // the drift #16318 exists to close. The spec-side pin
        // (`numeric-column-representation.test.ts`) holds the two equal, and
        // `NUMERIC_VALUE_TYPES` is the single membership authority both read.
        col =
          numeric === undefined || numeric.kind === 'integer'
            ? table.integer(name)
            : table.decimal(name, numeric.precision, numeric.scale);
        break;
      }
      // `toggle` is a boolean rendered as a switch. Same leak as above (TEXT
      // affinity stored '1'); a boolean column gives NUMERIC affinity and the
      // `booleanFields` read-coercion below converts the stored 1/0 back to a
      // real JS boolean.
      case 'boolean':
      case 'toggle':
        col = table.boolean(name);
        break;
      case 'date':
        col = table.date(name);
        break;
      case 'datetime':
        // MySQL's `TIMESTAMP` is a 32-bit epoch: it cannot represent an instant
        // outside 1970-01-01..2038-01-19 (a contract end date, a subscription
        // expiry, a retention horizon — all rejected outright), it carries no
        // fractional seconds by default so the canonical form's milliseconds are
        // silently truncated, and it CONVERTS on read/write using the session
        // timezone, which makes the stored instant depend on server config.
        // `DATETIME(3)` has none of those properties: 1000..9999, milliseconds
        // kept, and stored verbatim — so the column holds the UTC wall clock the
        // driver writes, exactly as ServiceNow stores its MySQL timestamps
        // (#3942). Postgres deliberately keeps `table.timestamp` → `timestamptz`:
        // asking for precision 3 there would REDUCE it from microseconds.
        col = this.isMysql ? table.datetime(name, { precision: MYSQL_DATETIME_PRECISION }) : table.timestamp(name);
        break;
      case 'time':
        // MySQL's bare `TIME` is zero-precision and ROUNDS a fractional literal
        // (`'14:30:00.500'` → `14:30:01`), so the canonical form's milliseconds
        // would change the stored wall clock. `TIME(3)` keeps them — the
        // `DATETIME(3)` precedent (#3942) applied to time-of-day (#3994). Knex's
        // `time()` takes no precision, hence the explicit type.
        col = this.isMysql ? table.specificType(name, 'time(3)') : table.time(name);
        break;
      // `user` is a lookup specialized to sys_user (ADR: lookup → sys_user). Same
      // physical storage as any lookup: a string column holding the related row id
      // (multiple ⇒ JSON, handled at the top of createColumn). No bespoke storage
      // primitive — it shares this exact DDL path so reads/$expand/FK stay uniform.
      case 'lookup':
      case 'user':
        // ⛔ #11431 deliberately STOPS at the string family and does not reach
        // here, even though these branches spell the same `table.string(name)`.
        // A lookup column does not hold the declared value — it holds the
        // REFERENCED ROW'S ID, whose width is the parent table's `id` column,
        // not anything this field declared. Measured on MySQL 8.0.46: the FK
        // itself is content with mismatched widths (`varchar(20)` child →
        // `varchar(255)` parent `id` creates cleanly, and Postgres 16 accepts
        // it too), so the type system gives no warning — the refusal arrives on
        // the first write too wide for the child, as `ERROR 1406 Data too long`.
        //
        // [#15522] ⛔ An id's width is NOT a fixed number, and it is NOT this
        // field's to declare. Both halves are this driver's own behaviour: when
        // the caller supplies no id it mints `nanoid(DEFAULT_ID_LENGTH)` — 16
        // characters, from the constant above and the three mint sites it feeds
        // — and when the caller DOES supply one it is stored verbatim at
        // whatever width the caller chose (measured on this arm's own driver:
        // 10-, 17- and 18-character ids all landed unaltered). Nothing on this
        // path bounds an id's width at all, so `maxLength: 20` already cannot
        // hold a 24-character supplied id, and any `maxLength` under 16 cannot
        // hold even a minted one. Honouring it here would make the column
        // structurally incapable of holding ids it will be asked to hold — a
        // strictly worse defect than the one #11431 fixes.
        //
        // ⛔ Do not restore the number this sentence used to carry. It called a
        // platform id 26 characters long and spelled out a ULID
        // (`01JQ8XKZ9M4N7P2R5T6V8W0Y3B`). `DEFAULT_ID_LENGTH` has been 16 for the
        // whole life of this file and no ULID is minted anywhere in this repo, so
        // at the real numbers the worked example did not hold either — 16
        // characters FIT in `varchar(20)`. Four `packages/cli` sites still cite
        // this arm BY NAME for that number; they are filed as #16114, not fixed
        // here.
        //
        // [#11567] ⛔ This arm emits NO `FOREIGN KEY`, and that is the ruled
        // contract rather than an omission. It used to carry
        // `if (field.reference_to) table.foreign(name)...` — gated on a key
        // the spec REFUSES (see {@link refuseRejectedReferenceAlias}), so it
        // could not fire for any spec-conformant lookup and never had: zero FK
        // constraints existed across all 44 exported platform objects on live
        // Postgres 16.13 and MySQL 8.0.46. Retiring it is therefore a no-op for
        // every authored deployment, and it is pinned in the retiring direction
        // by `sql-driver-11567-lookup-no-foreign-key.test.ts`.
        //
        // ⛔ Do NOT "restore" this by re-reading the canonical `reference`.
        // Measured on a PRISTINE EMPTY database: doing so takes Postgres from
        // 44/44 objects synced to 18/44 and MySQL from 37/44 to 15/44, with
        // `relation "sys_user" does not exist` — no data involved. Two
        // structural causes: `syncSchema` has no topological ordering, so a
        // child reaches DDL before its parent; and three of the ten FK targets
        // (`sys_file`, `sys_environment`, `sys_package_version`) are not among
        // the platform objects at all (ADR-0003 puts them in `service-tenant` /
        // `service-storage`). Referential integrity is the ENGINE's, via
        // `deleteBehavior` — which is what `content/docs/protocol/objectql/
        // types.mdx` has told authors since 2026-07-30.
        col = table.string(name);
        break;
      case 'auto_number':
      case 'autonumber':
        // ⛔ Also out of #11431's scope, for a different reason than `lookup`
        // above: the value is issued by the RUNTIME from its sequence, not
        // supplied by a caller. `maxLength` has no write-time counterpart on
        // this type — the record validator's `max_length` check covers the
        // textual types only, and an autonumber never reaches it at all
        // (runtime-owned types are excluded from its door) — so binding the
        // DDL to it would create a refusal with nothing declaring it: the
        // platform's own generated record number rejected by a column, with no
        // author to hand the error to. Widening `maxLength` to a second
        // meaning ("how wide is the generated number") is a spec decision, not
        // a driver one.
        col = table.string(name);
        break;
      case 'formula':
        return; // Virtual — no column
      default:
        // Array/object-valued types are stored as a JSON column. Driven by the
        // single `JSON_COLUMN_TYPES` source so this DDL switch and `isJsonField`
        // (the read-side deserializer) can never drift — the drift between them
        // is exactly what let array-valued fields reach the binder un-serialized
        // (#field-zoo). Everything else is a plain string.
        //
        // ⛔ The third branch #11431 leaves alone. This is the CATCH-ALL, and
        // MOST of what lands in it is the set of types whose stored value is
        // NOT the declared value, or is short by construction: `secret`
        // persists an opaque `sys_secret` ref rather than the credential it was
        // given (ADR-0100), `select` / `radio` / `checkboxes` / `tree` store
        // option machine names or ids, and `color` holds a color code. Sizing
        // any of those from the author's `maxLength` would size the wrong
        // string. (`code` used to be mis-listed here among the option-valued
        // ones — measured in field-zoo it stores the editor's contents
        // verbatim, which is why #11794 moved it to the text family above.
        // `signature` / `qrcode` sat here as a measured OPEN DEFECT — their
        // stored value IS the declared value, routinely a data-URI far past
        // 255 chars, refused by both enforcing dialects — until #11875 gave
        // the write seam their bound and moved them to the text family too.)
        //
        // A type that genuinely wants the bound belongs in the string-family
        // case above, named — never acquired by falling through to here.
        //
        // ⚠️ The FILE family is asked separately, because its answer is a
        // DEPLOYMENT fact rather than a property of the type (ADR-0104
        // addendum): a json column until this deployment's columns have moved,
        // and then a `varchar` at the width the SQL generator already emits for
        // it ({@link MEDIA_ID_VARCHAR_CHARS}) — not knex's default 255, which
        // would be a new divergence between the two producers of this column.
        // `multiple: true` media never reaches here: `createColumn`
        // short-circuits on `multiple` above the type switch.
        if (FILE_REFERENCE_TYPES.has(type)) {
          col = this.mediaColumnIsJson()
            ? this.jsonColumn(table, name)
            : table.string(name, MEDIA_ID_VARCHAR_CHARS);
          break;
        }
        col = JSON_COLUMN_TYPES.has(type) ? this.jsonColumn(table, name) : table.string(name);
    }

    if (col) {
      // NOTE: field-level `unique` is deliberately NOT emitted here (#3696).
      // A column builder can only express a SINGLE-column constraint, but on a
      // tenant-scoped object `unique: true` means unique *within the tenant* —
      // a composite `(tenantField, field)` index. Emitting `col.unique()` here
      // is what made every tenant share one global namespace, which collided
      // head-on with the per-tenant autonumber sequence (each tenant counts
      // from 1, so the second tenant's `PROD-00001` was rejected by an index it
      // could not see). All unique materialization now goes through the single
      // tenancy-aware path — {@link uniqueIndexesFromFields} +
      // {@link syncDeclaredIndexes} — which runs after the table exists and can
      // therefore build composites. `createColumn` owns type/nullability/
      // defaults only.
      //
      // ADR-0113: the physical NOT NULL comes from the EXPLICIT storage
      // constraint, not from `required` — `required` is the write-time
      // contract enforced by the record validator at the engine seam, and
      // binding the DDL to it made every post-deploy tightening a
      // destructive migration.
      //
      // ⚠️ NOTHING supplies `storage.notNull` on an author's behalf. The
      // sentence that used to close this block said the opposite — that
      // pre-17 sources "carry `storage.notNull` explicitly via the
      // `field-required-notnull-explicit` conversion, so their columns come
      // out exactly as they always did" — and it was measured false from both
      // ends (#16693): a real `^17.0.0` app logged that conversion and got
      // NULLABLE columns anyway, and the conversion itself has since been
      // WITHDRAWN (maintainer ruling 2026-09-08), because stamping the
      // constraint wherever `required: true` appears is the implication
      // ADR-0113 abolished. So a column reaches `notNullable()` here because
      // its author wrote `storage: { notNull: true }`, and for no other
      // reason; a `required: true` field with no `storage` block gets a
      // nullable column, at every protocol floor, on every dialect.
      //
      // [#17231] Asked through {@link declaresColumnNotNull} — the same
      // question the multi-value short-circuit above now asks, stated once so
      // this method's two exits cannot answer it differently again.
      //
      // ADR-0131 D1 (execution record 6285122667 on the v18 step 7 card): the
      // table's tenant column is the one column NOT NULL WITHOUT a declaration
      // — "there is no nullable tenant column anywhere". `tenantColumn` is
      // passed only by the two CREATE TABLE sites ({@link initObjects}' create
      // branch, {@link ensureShardTable}'s), never by an ADD COLUMN: a column
      // added to a table that already holds rows is the organization-ownership
      // ceremony's to tighten (ruling ② A, 6269955919), and no metadata says
      // it — the injected tenant field stays `required: false` with no
      // `storage`, and the differ's `ceremonyOwnedNullability` reads the
      // difference as no drift.
      if (declaresColumnNotNull(field) || tenantColumn) col.notNullable();
      this.applyDeclaredColumnDefault(col, field, type);
    }
  }
}
