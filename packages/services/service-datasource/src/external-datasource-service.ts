// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ExternalDatasourceService — implements {@link IExternalDatasourceService}
 * (ADR-0015 §6) on top of driver introspection.
 *
 * The service is intentionally decoupled from the kernel: all I/O
 * (introspection, metadata reads) is injected via
 * {@link ExternalDatasourceServiceConfig}, so the introspection/draft/validate
 * logic is pure and unit-testable. The kernel plugin wires the real
 * `IDataEngine` + `IMetadataService` callbacks in.
 */

import type {
  IExternalDatasourceService,
  RemoteTable,
  GenerateDraftOpts,
  ObjectDraft,
  ImportObjectOpts,
  ImportObjectResult,
  SchemaValidationResult,
  SchemaValidationReport,
  IntrospectedSchema,
  IntrospectedTable,
} from '@objectstack/spec/contracts';
import type { SchemaDiffEntry } from '@objectstack/spec/shared';
import {
  suggestFieldType,
  isCompatible,
  ExternalCatalogSchema,
  type ExternalCatalog,
  type SqlDialect,
  type FieldType,
} from '@objectstack/spec/data';

/** Minimal datasource shape the service reads (subset of `Datasource`). */
export interface DatasourceLike {
  name: string;
  schemaMode?: 'managed' | 'external' | 'validate-only';
  external?: {
    allowedSchemas?: string[];
    validation?: { onMismatch?: 'fail' | 'warn' | 'ignore' };
  };
}

/** Minimal object shape the service reads (subset of `ServiceObject`). */
export interface ObjectLike {
  name: string;
  label?: string;
  datasource?: string;
  external?: {
    remoteName?: string;
    remoteSchema?: string;
    columnMap?: Record<string, string>;
    ignoreColumns?: string[];
  };
  fields?: Record<string, { type?: string; required?: boolean }>;
}

export interface Logger {
  warn: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
}

/**
 * Injected dependencies. The plugin supplies real implementations backed by
 * the driver registry and `IMetadataService`; tests supply fakes.
 */
export interface ExternalDatasourceServiceConfig {
  /** Introspect a datasource's live schema via its driver. */
  introspect: (datasource: string) => Promise<IntrospectedSchema>;
  /** Resolve a datasource definition by name. */
  getDatasource: (name: string) => Promise<DatasourceLike | undefined>;
  /** Resolve one object definition by name. */
  getObject: (name: string) => Promise<ObjectLike | undefined>;
  /** List all object definitions (for `validateAll`). */
  listObjects: () => Promise<ObjectLike[]>;
  /**
   * Persist a refreshed catalog snapshot as an `external_catalog` metadata
   * record. Optional: when absent, `refreshCatalog` still returns the snapshot
   * but does not cache it (e.g. dev runs without a writable metadata store).
   */
  persistCatalog?: (catalog: ExternalCatalog) => Promise<void>;
  /**
   * Persist an imported object definition as a live (runtime-origin) `object`
   * metadata record. Optional: when absent, {@link ExternalDatasourceService.importObject}
   * throws (the deployment is GitOps-only / has no writable metadata store).
   */
  persistObject?: (name: string, definition: Record<string, unknown>) => Promise<void>;
  logger?: Logger;
}

/** Columns ObjectStack manages itself — never validated against the remote. */
const BUILTIN_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

/** Split a possibly schema-qualified name (`mart.fact_orders`). */
function parseQualified(raw: string): { schema?: string; name: string } {
  const idx = raw.indexOf('.');
  if (idx === -1) return { name: raw };
  return { schema: raw.slice(0, idx), name: raw.slice(idx + 1) };
}

/** Normalise a remote table name into a snake_case object name. */
function toObjectName(remoteName: string): string {
  const { name } = parseQualified(remoteName);
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[^a-z_]/, (c) => `_${c.toLowerCase()}`)
    .toLowerCase();
}

/** snake_case → Title Case label. */
function toLabel(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export class ExternalDatasourceService implements IExternalDatasourceService {
  constructor(private readonly config: ExternalDatasourceServiceConfig) {}

  private get logger(): Logger | undefined {
    return this.config.logger;
  }

  private findTable(schema: IntrospectedSchema, remoteName: string): IntrospectedTable | undefined {
    const want = parseQualified(remoteName).name;
    for (const table of Object.values(schema.tables)) {
      if (table.name === remoteName) return table;
      if (parseQualified(table.name).name === want) return table;
    }
    return undefined;
  }

  async listRemoteTables(
    datasource: string,
    opts?: { schema?: string },
  ): Promise<RemoteTable[]> {
    const [schema, ds] = await Promise.all([
      this.config.introspect(datasource),
      this.config.getDatasource(datasource),
    ]);
    const allowed = ds?.external?.allowedSchemas;

    const tables: RemoteTable[] = [];
    for (const table of Object.values(schema.tables)) {
      const { schema: tableSchema, name } = parseQualified(table.name);
      if (opts?.schema && tableSchema && tableSchema !== opts.schema) continue;
      // allowedSchemas only filters tables we can attribute to a schema.
      if (allowed && tableSchema && !allowed.includes(tableSchema)) continue;
      tables.push({ schema: tableSchema, name, columnCount: table.columns.length });
    }
    return tables;
  }

  async generateObjectDraft(
    datasource: string,
    remoteName: string,
    opts: GenerateDraftOpts = {},
  ): Promise<ObjectDraft> {
    const schema = await this.config.introspect(datasource);
    const table = this.findTable(schema, remoteName);
    if (!table) {
      throw new Error(
        `Remote table '${remoteName}' not found on datasource '${datasource}'.`,
      );
    }
    const dialect = schema.dialect as SqlDialect | undefined;
    // Derive the remote schema from the matched table's qualified name (the
    // caller may pass an unqualified `remoteName`).
    const matched = parseQualified(table.name);
    const remoteSchema = opts.remoteSchema ?? matched.schema;
    const resolvedRemoteName = matched.name;

    const include = opts.includeColumns ? new Set(opts.includeColumns) : undefined;
    const exclude = opts.excludeColumns ? new Set(opts.excludeColumns) : new Set<string>();
    const pkOverride = opts.primaryKey ? new Set(opts.primaryKey) : undefined;

    const fields: Record<string, { type: FieldType; primaryKey?: boolean }> = {};
    const review: ObjectDraft['review'] = [];

    for (const col of table.columns) {
      if (include && !include.has(col.name)) continue;
      if (exclude.has(col.name)) continue;

      const fieldName = opts.rename?.[col.name] ?? col.name;
      const suggested = suggestFieldType(col.type, dialect);
      const fieldType: FieldType = suggested ?? 'text';
      if (!suggested) {
        review.push({
          column: col.name,
          remoteType: col.type,
          note: `unrecognised remote type — defaulted to 'text', verify`,
        });
      } else if (isCompatible(col.type, fieldType, dialect) === 'lossy') {
        review.push({
          column: col.name,
          remoteType: col.type,
          note: `mapped lossy to '${fieldType}'`,
        });
      }

      const isPk = pkOverride ? pkOverride.has(col.name) : col.primaryKey;
      fields[fieldName] = isPk ? { type: fieldType, primaryKey: true } : { type: fieldType };
    }

    const name = toObjectName(resolvedRemoteName);
    const definition: Record<string, unknown> = {
      name,
      label: toLabel(name),
      datasource,
      external: {
        ...(remoteSchema ? { remoteSchema } : {}),
        remoteName: resolvedRemoteName,
      },
      fields,
    };

    return {
      name,
      datasource,
      definition,
      source: renderObjectSource(definition, fields, review),
      review,
    };
  }

  async importObject(
    datasource: string,
    remoteName: string,
    opts: ImportObjectOpts = {},
  ): Promise<ImportObjectResult> {
    if (!this.config.persistObject) {
      throw new Error(
        `importObject requires a writable metadata store, but none is wired ` +
          `(datasource '${datasource}'). This deployment may be GitOps-only — ` +
          `use 'os datasource introspect' and commit the generated *.object.ts instead.`,
      );
    }

    // Reuse the draft pipeline (type mapping, review notes, external binding).
    const draft = await this.generateObjectDraft(datasource, remoteName, opts);

    // Apply the runtime-persona overrides on top of the draft definition.
    const name = opts.name ?? draft.name;
    const external = {
      ...(draft.definition.external as Record<string, unknown>),
      ...(opts.writable ? { writable: true } : {}),
    };
    const definition: Record<string, unknown> = {
      ...draft.definition,
      name,
      label: toLabel(name),
      external,
    };

    await this.config.persistObject(name, definition);
    this.logger?.info?.(`importObject: persisted '${name}' from ${datasource}.${remoteName}`, {
      writable: opts.writable === true,
      review: draft.review.length,
    });

    return { name, definition, review: draft.review };
  }

  async refreshCatalog(datasource: string): Promise<ExternalCatalog> {
    const schema = await this.config.introspect(datasource);
    // Parse through the Zod schema so the persisted record is canonical
    // (defaults applied, shape validated) and matches the `external_catalog`
    // metadata type the boot gate + Studio read back.
    const catalog = ExternalCatalogSchema.parse({
      name: `${datasource}_catalog`,
      datasource,
      snapshotAt: new Date().toISOString(),
      dialect: schema.dialect,
      tables: Object.values(schema.tables).map((t) => {
        const { schema: s, name } = parseQualified(t.name);
        return {
          remoteSchema: s,
          remoteName: name,
          columns: t.columns.map((c) => ({
            name: c.name,
            sqlType: c.type,
            nullable: c.nullable,
            primaryKey: c.primaryKey,
            suggestedFieldType: suggestFieldType(c.type, schema.dialect as SqlDialect),
          })),
        };
      }),
    }) as ExternalCatalog;

    // Best-effort cache: a failure to persist must not fail the refresh — the
    // caller still gets the live snapshot back.
    if (this.config.persistCatalog) {
      try {
        await this.config.persistCatalog(catalog);
      } catch (err) {
        this.logger?.warn?.(`refreshCatalog: failed to persist '${catalog.name}'`, err);
      }
    }

    return catalog;
  }

  async validateObject(objectName: string): Promise<SchemaValidationResult> {
    const obj = await this.config.getObject(objectName);
    if (!obj) {
      throw new Error(`Object '${objectName}' not found.`);
    }
    const datasource = obj.datasource ?? 'default';
    const ds = await this.config.getDatasource(datasource);

    // Not a federated object → nothing to validate.
    if (!ds || !ds.schemaMode || ds.schemaMode === 'managed') {
      return { ok: true, datasource, object: objectName, diffs: [] };
    }

    const schema = await this.config.introspect(datasource);
    const dialect = schema.dialect as SqlDialect | undefined;
    const remoteName = obj.external?.remoteName ?? obj.name;
    const table = this.findTable(schema, remoteName);

    const diffs: SchemaDiffEntry[] = [];

    if (!table) {
      diffs.push({
        kind: 'missing_table',
        remoteSchema: obj.external?.remoteSchema,
        remoteName,
        severity: 'error',
      });
      return { ok: false, datasource, object: objectName, diffs };
    }

    const columnsByName = new Map(table.columns.map((c) => [c.name, c]));
    const ignore = new Set(obj.external?.ignoreColumns ?? []);
    // columnMap is remoteColumn → fieldName; invert for field → remoteColumn.
    const fieldToRemote = new Map<string, string>();
    for (const [remoteCol, fieldName] of Object.entries(obj.external?.columnMap ?? {})) {
      fieldToRemote.set(fieldName, remoteCol);
    }

    for (const [fieldName, field] of Object.entries(obj.fields ?? {})) {
      if (BUILTIN_COLUMNS.has(fieldName)) continue;
      const remoteCol = fieldToRemote.get(fieldName) ?? fieldName;
      if (ignore.has(remoteCol)) continue;

      const col = columnsByName.get(remoteCol);
      if (!col) {
        diffs.push({
          kind: 'missing_column',
          remoteName,
          column: remoteCol,
          severity: 'error',
        });
        continue;
      }
      const fieldType = (field.type ?? 'text') as FieldType;
      const compat = isCompatible(col.type, fieldType, dialect);
      if (compat === false) {
        diffs.push({
          kind: 'type_mismatch',
          remoteName,
          column: remoteCol,
          expected: fieldType,
          actual: col.type,
          severity: 'error',
        });
      } else if (compat === 'lossy') {
        diffs.push({
          kind: 'type_mismatch',
          remoteName,
          column: remoteCol,
          expected: fieldType,
          actual: col.type,
          severity: 'warning',
        });
      }
    }

    const ok = !diffs.some((d) => d.severity === 'error');
    return { ok, datasource, object: objectName, diffs };
  }

  async validateAll(): Promise<SchemaValidationReport> {
    const objects = await this.config.listObjects();
    const federated = objects.filter(
      (o) => o.external !== undefined || (o.datasource && o.datasource !== 'default'),
    );

    const results = await Promise.all(
      federated.map((o) =>
        this.validateObject(o.name).catch((err): SchemaValidationResult => {
          this.logger?.warn(`validateObject('${o.name}') failed`, err);
          return {
            ok: false,
            datasource: o.datasource ?? 'default',
            object: o.name,
            diffs: [
              {
                kind: 'missing_table',
                remoteName: o.external?.remoteName ?? o.name,
                actual: err instanceof Error ? err.message : String(err),
                severity: 'error',
              },
            ],
          };
        }),
      ),
    );

    const ok = results.every((r) => r.ok);
    return { ok, results };
  }
}

/** Render a reviewable `*.object.ts` source string for an object draft. */
function renderObjectSource(
  definition: Record<string, unknown>,
  fields: Record<string, { type: FieldType; primaryKey?: boolean }>,
  review: ObjectDraft['review'],
): string {
  const reviewByColumn = new Map(review.map((r) => [r.column, r.note]));
  const external = definition.external as { remoteSchema?: string; remoteName?: string };

  const fieldLines = Object.entries(fields).map(([fieldName, f]) => {
    const note = reviewByColumn.get(fieldName);
    const pk = f.primaryKey ? ', primaryKey: true' : '';
    const comment = note ? ` // REVIEW: ${note}` : '';
    return `    ${fieldName}: { type: '${f.type}'${pk} },${comment}`;
  });

  const externalLine = external.remoteSchema
    ? `  external: { remoteSchema: '${external.remoteSchema}', remoteName: '${external.remoteName}' },`
    : `  external: { remoteName: '${external.remoteName}' },`;

  return [
    `// Generated by \`os datasource introspect\` (ADR-0015). Review before committing.`,
    `import type { ServiceObjectInput } from '@objectstack/spec/data';`,
    ``,
    `const ${definition.name as string}: ServiceObjectInput = {`,
    `  name: '${definition.name as string}',`,
    `  label: '${definition.label as string}',`,
    `  datasource: '${definition.datasource as string}',`,
    externalLine,
    `  fields: {`,
    ...fieldLines,
    `  },`,
    `};`,
    ``,
    `export default ${definition.name as string};`,
    ``,
  ].join('\n');
}
