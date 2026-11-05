// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Column creation helper" section of `SqlDriver`: the
 * bodies of `declaredVarcharLength`, `keyableTextLength`,
 * `hashShadowColumnFor`, `createHashShadowUniqueIndex`,
 * `hashShadowColumnState`, `dropOrphanedHashShadowColumn`,
 * `decorateHashShadowDuplicate`, `hashShadowSourceColumns`,
 * `varcharPackLength`, `rowWidthProfile`, `schemaBytesPerChar`,
 * `explainRowSizeOverflow`, `rethrowWithRowSizeExplanation`, `jsonColumn` moved
 * out of `sql-driver.ts` whole by `scripts/codemod-split-sql-driver.mjs`.
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

import { GLOBAL_TENANT, canonicalIndexKey, hashShadowColumnFor, parseHashShadowKeyParts } from './schema-drift.js';
import type { HashShadowKeyPart } from './schema-drift.js';
import type { Knex } from 'knex';
import { AUDIT_TIMESTAMP_COLUMNS } from './sql-driver-top-level.js';
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
  explainHashShadowDuplicate: SqlDriverClass['explainHashShadowDuplicate'];
  explainRowSizeOverflow: SqlDriverClass['explainRowSizeOverflow'];
  hashShadowColumnState: SqlDriverClass['hashShadowColumnState'];
  readonly isMysql: SqlDriverClass['isMysql'];
  readonly isSqlite: SqlDriverClass['isSqlite'];
  readonly knex: SqlDriverClass['knex'];
  logDurabilityFailure: SqlDriverClass['logDurabilityFailure'];
  readonly logger: SqlDriverClass['logger'];
  rowWidthProfile: SqlDriverClass['rowWidthProfile'];
  schemaBytesPerChar: SqlDriverClass['schemaBytesPerChar'];
  varcharColumnChars: SqlDriverClass['varcharColumnChars'];
}

/** The bodies of the "Column creation helper" section of `SqlDriver`: a stateless facet, called by the class's stubs. */
export class ColumnCreationFacet {
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
}
