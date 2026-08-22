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
 * `defaultValue` stays `unknown` rather than the spec's `string`: SQL
 * introspection reports whatever the driver read (`null`, a number, a boolean
 * literal), and narrowing the declaration without normalising the value would
 * move the lie rather than remove it. `isUnique` / `maxLength` are extra facts
 * SQL introspection carries and the spec's diff-facing contract does not
 * declare.
 */
export interface IntrospectedColumn extends Omit<SpecIntrospectedColumn, 'defaultValue'> {
  /** Default value if any — raw, as the driver reported it. */
  defaultValue?: unknown;
  /** Whether this column has a unique constraint */
  isUnique?: boolean;
  /** Maximum length for string types */
  maxLength?: number;
}

/**
 * Foreign key relationship metadata.
 */
export interface IntrospectedForeignKey {
  /** Column name in the source table */
  columnName: string;
  /** Referenced table name */
  referencedTable: string;
  /** Referenced column name */
  referencedColumn: string;
  /** Constraint name */
  constraintName?: string;
}

/**
 * Table metadata from database introspection.
 *
 * DERIVED from the spec contract, like {@link IntrospectedColumn}. `indexes`
 * is `Omit`ted rather than required: SQL introspection here does not read
 * indexes, and an empty array would claim a table HAS none when it merely was
 * not asked. `foreignKeys` / `primaryKeys` are extras the spec's diff-facing
 * contract does not declare.
 */
export interface IntrospectedTable extends Omit<SpecIntrospectedTable, 'columns' | 'indexes'> {
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
export interface IntrospectedSchema extends Omit<SpecIntrospectedSchema, 'tables'> {
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
  }
): ServiceObject[] {
  const objects: ServiceObject[] = [];
  const excludeTables = options?.excludeTables || [];
  const includeTables = options?.includeTables;
  const skipSystemColumns = options?.skipSystemColumns !== false;

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

      if (foreignKey) {
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
