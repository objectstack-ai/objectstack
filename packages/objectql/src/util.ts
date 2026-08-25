// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ServiceObject } from '@objectstack/spec/data';
import type {
  IntrospectedColumn as SpecIntrospectedColumn,
  IntrospectedSchema as SpecIntrospectedSchema,
  IntrospectedTable as SpecIntrospectedTable,
} from '@objectstack/spec/contracts';

// ── Introspection Types ──────────────────────────────────────────────────────

/**
 * Column metadata from database introspection.
 *
 * DERIVED from `packages/spec/src/contracts/schema-diff-service.ts` — the one
 * introspection contract — rather than declared a second time next to it.
 *
 * This file used to carry an independent declaration spelling primary-key
 * membership `isPrimary?`, while `packages/spec` spells it `primaryKey`. A
 * driver result flowed from one contract into a consumer typed against the
 * other with no compiler between them, and the remote primary key was dropped
 * on the way. Maintainer ruling, 2026-08-22 (live session, 「同意所有」 item 9
 * = 驱动侧对齐 spec 契约): `packages/spec` is the one contract, producers align
 * to it, and this local declaration converges on the spec import rather than
 * keeping a second contract.
 *
 * The `Omit` carve-out that used to keep `defaultValue` diverging from the
 * spec's `string` is RETIRED (#11122): the spec itself now declares the raw
 * `unknown` producers actually report, so the key is inherited. `isUnique` /
 * `maxLength` are extra facts SQL introspection carries and the spec's
 * diff-facing contract does not declare.
 */
export interface IntrospectedColumn extends SpecIntrospectedColumn {
  /**
   * Whether this column ALONE carries a single-column unique constraint —
   * true iff some unique constraint covers this column and nothing else.
   *
   * Membership of a COMPOSITE constraint is deliberately not represented
   * (#11202): `UNIQUE (a, b)` constrains the pair, and a per-column boolean
   * cannot say that. The producer's declaration —
   * `SqlDriver`'s `IntrospectedColumn.isUnique` in `@objectstack/driver-sql`
   * — is the contract sentence; this is the consumer-side copy of the same
   * key and must not drift from it. An absent flag on a composite member
   * means "not single-column unique", never "no constraint".
   */
  isUnique?: boolean;
  /**
   * Maximum length for string types — raw as knex `columnInfo()` reports it:
   * a number on some dialects, a STRING on SQLite (measured: `"255"`).
   */
  maxLength?: number | string;
}

/**
 * Foreign key relationship metadata.
 */
export interface IntrospectedForeignKey {
  /** Column name in the source table */
  columnName: string;
  /**
   * Referenced table name — always the BARE name, never schema-qualified
   * (#11377). When the parent lives outside the introspecting session's
   * resolution scope, the qualification arrives as {@link referencedSchema}.
   */
  referencedTable: string;
  /** Referenced column name */
  referencedColumn: string;
  /** Constraint name */
  constraintName?: string;
  /**
   * The parent table's schema, present when — and only when — the parent
   * lives OUTSIDE the introspecting session's resolution scope, i.e. when the
   * bare {@link referencedTable} name is NOT what that session would resolve
   * to the parent (#11377). Absent (never `undefined`) for an in-scope
   * parent. The producer's declaration — `SqlDriver`'s
   * `IntrospectedForeignKey.referencedSchema` in `@objectstack/driver-sql` —
   * is the contract sentence; this is the consumer-side copy of the same key
   * and must not drift from it.
   *
   * A consumer that turns `referencedTable` into an object reference must
   * read this key: a bare name the session cannot resolve either points at
   * nothing or — the #11201 collision family — at a same-named table in the
   * current schema. {@link convertIntrospectedSchemaToObjects} refuses to
   * wire a lookup for such a key and says so loudly.
   */
  referencedSchema?: string;
}

/**
 * Table metadata from database introspection.
 *
 * DERIVED from the spec contract, like {@link IntrospectedColumn}. `indexes`
 * is inherited as the spec's OPTIONAL key (#11122): a producer that did not
 * read indexes omits the key, and an empty array is a positive claim that a
 * table HAS none — so nothing here emits `[]` for "not asked".
 * `foreignKeys` / `primaryKeys` are extras the spec's diff-facing contract
 * does not declare.
 */
export interface IntrospectedTable extends SpecIntrospectedTable {
  /** List of columns */
  columns: IntrospectedColumn[];
  /** List of foreign key relationships */
  foreignKeys: IntrospectedForeignKey[];
  /** Primary key columns */
  primaryKeys: string[];
}

/**
 * Complete database schema introspection result.
 *
 * DERIVED from the spec contract, so `dialect` and the REQUIRED
 * `introspectedAt` come from the one declaration rather than being omitted
 * here and read downstream — which is how a producer shipped `{ tables }`
 * alone while consumers read two keys nobody set.
 */
export interface IntrospectedSchema extends SpecIntrospectedSchema {
  /** Map of table name to table metadata */
  tables: Record<string, IntrospectedTable>;
}

// ── Utility Functions ────────────────────────────────────────────────────────

/**
 * Convert a snake_case or plain string to Title Case.
 *
 * @example
 * toTitleCase('first_name')   // => 'First Name'
 * toTitleCase('project_task') // => 'Project Task'
 */
export function toTitleCase(str: string): string {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Map a native database column type to an ObjectStack FieldType.
 */
function mapDatabaseTypeToFieldType(
  dbType: string
): 'text' | 'textarea' | 'number' | 'boolean' | 'datetime' | 'date' | 'time' | 'json' {
  const type = dbType.toLowerCase();

  // Text types
  if (type.includes('char') || type.includes('varchar') || type.includes('text')) {
    if (type.includes('text')) return 'textarea';
    return 'text';
  }

  // Numeric types
  if (
    type.includes('int') || type === 'integer' || type === 'bigint' || type === 'smallint'
  ) {
    return 'number';
  }
  if (
    type.includes('float') || type.includes('double') || type.includes('decimal') ||
    type.includes('numeric') || type === 'real'
  ) {
    return 'number';
  }

  // Boolean
  if (type.includes('bool')) {
    return 'boolean';
  }

  // Date / Time types
  if (type.includes('timestamp') || type === 'datetime') {
    return 'datetime';
  }
  if (type === 'date') {
    return 'date';
  }
  if (type === 'time') {
    return 'time';
  }

  // JSON types
  if (type === 'json' || type === 'jsonb') {
    return 'json';
  }

  // Default to text
  return 'text';
}

/**
 * Convert an introspected database schema to ObjectStack object definitions.
 *
 * This allows using existing database tables without manually defining metadata.
 *
 * ## A foreign key whose target carries `referencedSchema` is NOT wired (#11377)
 *
 * `referencedSchema` present means the parent lives outside the introspecting
 * session's resolution scope, so the bare `referencedTable` name is not an
 * address: as an object `reference` it either points at nothing or — the
 * #11201 collision family — at a same-named table in the current schema,
 * silently. Maintainer ruling (2026-08-24, on the card): such a key is LOUDLY
 * skipped and flagged, never wired to the bare name. The column itself is
 * kept — converted as a plain field from its database type, exactly as a
 * column with no foreign key — so the data stays visible while the false
 * address does not ship. The flag goes through `options.logger` (defaults to
 * `console`, so a bare call is loud by default).
 *
 * @param introspectedSchema - The schema returned from driver.introspectSchema()
 * @param options            - Optional filtering / conversion settings
 * @returns Array of ServiceObject definitions that can be registered with ObjectQL
 *
 * @example
 * ```typescript
 * const schema = await driver.introspectSchema();
 * const objects = convertIntrospectedSchemaToObjects(schema);
 * for (const obj of objects) {
 *   engine.registerObject(obj);
 * }
 * ```
 */
export function convertIntrospectedSchemaToObjects(
  introspectedSchema: IntrospectedSchema,
  options?: {
    /** Tables to exclude from conversion */
    excludeTables?: string[];
    /** Tables to include (if specified, only these will be converted) */
    includeTables?: string[];
    /** Whether to skip system columns like id, created_at, updated_at (default: true) */
    skipSystemColumns?: boolean;
    /**
     * Where the unresolvable-foreign-key flag is delivered (#11377) — the
     * minimal logger surface, matching `PluginContext.logger`. Defaults to
     * `console`: the flag exists to be seen, so a caller that passes nothing
     * still gets it loudly.
     */
    logger?: { warn(message: string, meta?: Record<string, unknown>): void };
  }
): ServiceObject[] {
  const objects: ServiceObject[] = [];
  const excludeTables = options?.excludeTables || [];
  const includeTables = options?.includeTables;
  const skipSystemColumns = options?.skipSystemColumns !== false;
  const logger = options?.logger ?? console;

  for (const [tableName, table] of Object.entries(introspectedSchema.tables)) {
    if (excludeTables.includes(tableName)) continue;
    if (includeTables && !includeTables.includes(tableName)) continue;

    const fields: Record<string, any> = {};

    for (const column of table.columns) {
      // Skip system columns if requested
      if (skipSystemColumns && ['id', 'created_at', 'updated_at'].includes(column.name)) {
        continue;
      }

      // Check for foreign key → lookup field
      const foreignKey = table.foreignKeys.find((fk) => fk.columnName === column.name);

      if (foreignKey && foreignKey.referencedSchema !== undefined) {
        // #11377: the parent lives outside the introspecting session's
        // resolution scope — the bare name is not an address (nothing, or the
        // #11201 wrong-object collision). Refuse the wiring loudly; the
        // column falls through to the plain-field path below, so the data
        // stays visible while the false reference does not ship.
        logger.warn(
          `[convert-introspected-schema] foreign key ${foreignKey.constraintName ?? '(unnamed)'} ` +
            `on ${tableName}.${column.name} references ` +
            `${foreignKey.referencedSchema}.${foreignKey.referencedTable}, a table OUTSIDE the ` +
            `introspecting session's resolution scope — the bare name ` +
            `"${foreignKey.referencedTable}" cannot be trusted to resolve to it, so NO lookup ` +
            `field was created for this column; it is converted as a plain field instead. ` +
            `Re-introspect with the parent's schema on the session's search path to wire this ` +
            `lookup.`,
          {
            table: tableName,
            column: column.name,
            constraint: foreignKey.constraintName,
            referencedSchema: foreignKey.referencedSchema,
            referencedTable: foreignKey.referencedTable,
          },
        );
      }

      if (foreignKey && foreignKey.referencedSchema === undefined) {
        fields[column.name] = {
          name: column.name,
          type: 'lookup' as const,
          reference: foreignKey.referencedTable,
          label: toTitleCase(column.name),
          required: !column.nullable,
        };
      } else {
        const fieldType = mapDatabaseTypeToFieldType(column.type);

        const field: Record<string, any> = {
          name: column.name,
          type: fieldType,
          label: toTitleCase(column.name),
          required: !column.nullable,
        };

        if (column.isUnique) {
          field.unique = true;
        }
        if (column.maxLength && (fieldType === 'text' || fieldType === 'textarea')) {
          field.maxLength = column.maxLength;
        }
        if (column.defaultValue != null) {
          field.defaultValue = column.defaultValue;
        }

        fields[column.name] = field;
      }
    }

    objects.push({
      name: tableName,
      label: toTitleCase(tableName),
      fields,
    } as ServiceObject);
  }

  return objects;
}
