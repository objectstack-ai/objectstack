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
  IntrospectedColumn,
} from '@objectstack/spec/contracts';
import type { SchemaDiffEntry } from '@objectstack/spec/shared';
import {
  suggestFieldTypeForSqlType,
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

/**
 * Read "is this column part of the remote primary key" across the TWO
 * introspection contracts that meet at this service.
 *
 * `plugin.ts` hands the driver's `introspectSchema()` result to this service
 * unmodified, and the driver does not speak the contract this file is typed
 * against:
 *
 * | producer                                       | per-column     | table-level    |
 * | ---------------------------------------------- | -------------- | -------------- |
 * | `SqlDriver` (+ `SqliteWasmDriver`, which extends it) | `isPrimary`    | `primaryKeys`  |
 * | `packages/spec` `IntrospectedColumn` (what this file's types say) | `primaryKey`   | —              |
 *
 * Measured against a live SQLite database at `368e7a06f`: the driver's column
 * for a `primary key (id)` table carries `isPrimary: true` and the table
 * carries `primaryKeys: ['id']`, while `primaryKey` is `undefined`. Reading
 * only `col.primaryKey` therefore reads a key no in-tree driver ever sets, and
 * the remote key is silently lost.
 *
 * This reads the UNION of all three signals rather than picking one:
 *
 *  - No in-tree producer uses `primaryKey: false` / `isPrimary: false` to
 *    NEGATE a key another signal asserts — the falses are just "not a key",
 *    written by producers that fill exactly one of the three. A precedence
 *    chain would therefore drop a real key whenever the winning signal is the
 *    one its producer left blank, which is the defect being repaired here.
 *  - A producer that fills only `table.primaryKeys` (the shape a table-level
 *    reader would naturally emit) is covered without needing a per-column flag,
 *    and vice versa.
 *
 * When the per-column flag and the table-level list DISAGREE, the union takes
 * both. That is deliberate: for a federated table, under-reporting the key
 * costs the caller its addressing key, and no in-tree consumer treats a
 * column's PK-ness as an exclusive claim. Note that no in-tree driver produces
 * such a disagreement today — `SqlDriver` derives `isPrimary` FROM
 * `primaryKeys`, so the two always agree, including where both are wrong (a
 * SQLite composite key reports only its first column, because
 * `introspectPrimaryKeys` filters `PRAGMA table_info` on `pk === 1` while
 * SQLite numbers composite members `1, 2, ...`). That truncation is upstream
 * of this seam and is not repaired here.
 *
 * Deliberately structural: the extra spellings are read off the value without
 * widening any declared contract, because reconciling
 * `packages/objectql/src/util.ts` with
 * `packages/spec/src/contracts/schema-diff-service.ts` is a spec-owned change.
 */
function primaryKeyReader(table: IntrospectedTable): (col: IntrospectedColumn) => boolean {
  const declared = (table as unknown as { primaryKeys?: unknown }).primaryKeys;
  const listed = new Set(
    Array.isArray(declared) ? declared.filter((n): n is string => typeof n === 'string') : [],
  );
  return (col) =>
    col.primaryKey === true ||
    (col as { isPrimary?: unknown }).isPrimary === true ||
    listed.has(col.name);
}

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

  /**
   * Probe a *saved* datasource by name with a live round-trip. Reuses the
   * introspection path (driver connect + schema read) as a cheap connectivity
   * check, so the secret is resolved through the same wired pool as the rest of
   * the introspection surface — the caller never handles cleartext. Returns a
   * structured result rather than throwing so the route can render ok/error
   * uniformly. This backs the `datasource` `test_connection` action
   * (`POST /datasources/:name/test`).
   */
  async testConnection(
    datasource: string,
  ): Promise<{ ok: boolean; latencyMs?: number; tableCount?: number; error?: string }> {
    const started = Date.now();
    try {
      const schema = await this.config.introspect(datasource);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        tableCount: Object.keys(schema.tables).length,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
      const suggested = suggestFieldTypeForSqlType(col.type, dialect);
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
        // The introspection seam: a real driver spells this `isPrimary` /
        // `primaryKeys`, never `primaryKey`. `ExternalCatalogSchema` defaults
        // the key to `false`, so reading only `c.primaryKey` persisted a
        // catalog in which EVERY column claimed not to be part of the remote
        // key — including the ones that are.
        const isPk = primaryKeyReader(t);
        return {
          remoteSchema: s,
          remoteName: name,
          columns: t.columns.map((c) => ({
            name: c.name,
            sqlType: c.type,
            nullable: c.nullable,
            primaryKey: isPk(c),
            suggestedFieldType: suggestFieldTypeForSqlType(c.type, schema.dialect as SqlDialect),
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

  /**
   * Is this object part of the federated sweep at all?
   *
   * ONE spelling of the predicate, deliberately — {@link validateAll} and
   * {@link validateDatasource} select from the same population, and the scoped
   * one exists to do LESS WORK, not to answer a different question. Two copies
   * would be two answers to "is this object federated" waiting to diverge.
   */
  private isFederated(o: ObjectLike): boolean {
    return o.external !== undefined || Boolean(o.datasource && o.datasource !== 'default');
  }

  /**
   * Validate a chosen set of objects, one report.
   *
   * A per-object throw becomes a `missing_table` row carrying the thrower's
   * message rather than rejecting the whole report: one unreachable remote (or
   * one object whose definition vanished mid-sweep) must not erase the verdicts
   * of the objects that did validate.
   */
  private async validateEach(objects: ObjectLike[]): Promise<SchemaValidationReport> {
    const results = await Promise.all(
      objects.map((o) =>
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

  async validateAll(): Promise<SchemaValidationReport> {
    const objects = await this.config.listObjects();
    return this.validateEach(objects.filter((o) => this.isFederated(o)));
  }

  /**
   * [#10537] Validate the federated objects bound to ONE datasource.
   *
   * The scoped twin of {@link validateAll}, composed from the same primitives
   * (`listObjects` → filter → `validateObject`) so a caller that asked about
   * one datasource drives live remote introspection against THAT datasource
   * only. `POST /api/v1/datasources/:name/external/validate` used to reach this
   * by running the whole-farm sweep and post-filtering the report: the rows
   * were right, but a request scoped by its URL paid for every OTHER federated
   * datasource's remote round-trips and discarded the results — and an
   * unreachable *unrelated* remote slowed the answer for the datasource that
   * was actually asked about.
   *
   * Row-for-row identical to that composition, by construction: the same
   * federation predicate, the same `validateObject`, the same per-object catch,
   * and a selection keyed on `o.datasource ?? 'default'` — which is exactly the
   * value `validateObject` reports back as `result.datasource`, so "the rows
   * the sweep would have kept" and "the objects this selects" are the same set
   * (pinned in `__tests__/external-datasource-service.test.ts`).
   *
   * A name nothing is bound to selects nothing and answers an empty, vacuously
   * `ok` report — the sweep-then-filter answer for an unknown name, kept rather
   * than upgraded to a throw: whether an unknown datasource is an error is a
   * separate question from this one, and this method must not decide it in
   * passing.
   *
   * NOT on `IExternalDatasourceService` (spec): the route composition this
   * serves was authorized as a service-side helper, while adding a
   * per-datasource validate to the contract is a spec-surface change that has
   * to be decided on its own. `packages/rest`'s federation registrar therefore
   * probes for this method and answers `503` when the wired service has no
   * scoped spelling, rather than silently falling back to the fan-out.
   */
  async validateDatasource(datasource: string): Promise<SchemaValidationReport> {
    const objects = await this.config.listObjects();
    return this.validateEach(
      objects.filter((o) => this.isFederated(o) && (o.datasource ?? 'default') === datasource),
    );
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
    `import type { ServiceObject } from '@objectstack/spec/data';`,
    ``,
    `const ${definition.name as string}: ServiceObject = {`,
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
