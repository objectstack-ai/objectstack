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
// The SINGLE source of the ADR-0028 object-name prefix rule, shared verbatim
// with `defineStack()` (compile time) and `MetadataManager.publishPackage`
// (runtime). Imported rather than re-implemented: a generator that hand-rolled
// its own `startsWith` would be free to drift from the check that refuses its
// output, which is the shape of this whole defect.
import { validateObjectNamespacePrefix } from '@objectstack/spec/kernel';

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
  /**
   * Resolve the package namespace that generated object names must be
   * prefixed with — `${namespace}_${shortName}`, ADR-0028. Injected for the
   * same reason every other read here is: the service stays kernel-free, and
   * the plugin decides where a namespace comes from (it reads the
   * datasource's own owning package — see `plugin.ts`).
   *
   * Optional, and allowed to resolve nothing. A deployment whose datasource
   * carries no package provenance, or whose package declares no `namespace`,
   * gets a draft with the BARE remote-table name plus a loud TODO in the
   * rendered source. That is deliberate and mirrors `defineStack`, which
   * skips the prefix check entirely when `manifest.namespace` is absent
   * rather than inventing a prefix on the author's behalf. Emitting
   * `_customers` on a blank namespace would trade one invalid draft for
   * another, so a blank/whitespace value is treated as absent.
   */
  getNamespace?: (datasource: string) => Promise<string | undefined> | string | undefined;
  logger?: Logger;
}

/** Columns ObjectStack manages itself — never validated against the remote. */
const BUILTIN_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

/**
 * Read "is this column part of the remote primary key" across the
 * introspection spellings that can arrive at this service.
 *
 * `plugin.ts` hands the driver's `introspectSchema()` result to this service
 * unmodified. There is now ONE declared contract on both sides of that
 * handoff — `packages/spec`'s `IntrospectedColumn` — and the in-tree driver
 * speaks it:
 *
 * | producer                                                              | per-column   | table-level   |
 * | --------------------------------------------------------------------- | ------------ | ------------- |
 * | `SqlDriver` (+ `SqliteWasmDriver` / `TursoDriver`, which extend it)    | `primaryKey` | `primaryKeys` |
 * | `packages/spec` `IntrospectedColumn` (what this file's types say)      | `primaryKey` | —             |
 *
 * That agreement is NEW, and this reader predates it. Measured against a live
 * SQLite database at `368e7a06f`, the driver's column for a `primary key (id)`
 * table carried `isPrimary: true` and no `primaryKey` key at all, so reading
 * only `col.primaryKey` lost the remote key — the defect this reader was
 * written for. `95437e7d2d` (#10676 / #10998) retired that spelling at the
 * producer: `introspectSchema` now derives `col.primaryKey` FROM `primaryKeys`
 * and emits no `isPrimary`.
 *
 * This still reads the UNION of three signals rather than picking one, and
 * each arm is here for its own reason:
 *
 *  - `col.primaryKey` — the spec spelling, what every in-tree producer writes.
 *  - `table.primaryKeys` — LIVE and INDEPENDENT, not a legacy arm. A
 *    per-column boolean cannot express key ORDER, and since #10997 (PR #11104)
 *    this list reports every member of a COMPOSITE key in declared key order.
 *    It is the only signal here that carries one. ⛔ Collapsing it away drops
 *    composite-key handling at this seam.
 *  - `col.isPrimary` — a RETIRED spelling, kept as a compatibility belt. See
 *    the note below before touching it.
 *
 * No producer uses `primaryKey: false` / `isPrimary: false` to NEGATE a key
 * another signal asserts — the falses are just "not a key", written by
 * producers that fill one signal and leave the others blank. A precedence
 * chain would therefore drop a real key whenever the winning signal is the one
 * its producer left blank, which is the defect being repaired here. When the
 * per-column flag and the table-level list DISAGREE the union takes both: for
 * a federated table, under-reporting the key costs the caller its addressing
 * key, and no in-tree consumer treats a column's PK-ness as an exclusive
 * claim. (The SQLite composite-key truncation this note used to disclaim is
 * gone — #10997 repaired `introspectPrimaryKeys` upstream, so the driver's two
 * signals now agree on the WHOLE key rather than agreeing on a truncated one.)
 *
 * WHY THE `isPrimary` ARM STAYS, with no producer left in this tree — measured
 * for #11123 on `52a41b72ee`, so the next reader need not re-derive it:
 *
 *  - Nothing in-tree writes it. Every surviving whole-identifier hit is prose,
 *    and `objectql`'s `isPrimaryKeyField` merely CONTAINS the substring.
 *  - It is still not dead code, because the producer population here is open
 *    by design. `contracts/datasource-driver-factory.ts` says the framework
 *    "ships no universal driver-by-id registry" — concrete drivers are built
 *    by the HOST. Since #11381 (option C of the #11123 ruling) the handle
 *    types `introspectSchema?(): Promise<IntrospectedSchema>` — the spec
 *    contract — so the retirement's stated migration channel, the compiler,
 *    finally reaches a host-built TypeScript driver "precisely and at every
 *    site" the moment it RECOMPILES against this version. Whom no compiler
 *    reaches, ever: drivers already built against older versions, plain-JS
 *    drivers, and casts. For that population the old spelling still arrives
 *    here at runtime, and this belt is what absorbs it.
 *  - The belt's clock HAS started: the union (#11001) and the retirement
 *    (#11124) were consumed into `17.2.0` (version-packages commit
 *    `e7d2cc67fd`, 2026-08-23), so the "unconsumed changesets at 17.1.0"
 *    argument this bullet used to carry is expired. Whether option B's gate —
 *    the retirement actually PUBLISHED — is met is a release-record question
 *    (npm, not this tree); B also waits on the #11381 tightening being
 *    released. Re-judge both there before touching the arm.
 *
 * Dropping the arm is therefore a NARROWING OF ACCEPTED INPUT rather than a
 * dead-code deletion, and wants the contract-review gate. Its only exercise is
 * the staged-disagreement pair in
 * `__tests__/external-introspection-seam.test.ts`; those cases go with it.
 *
 * Deliberately structural: the retired spelling is read off the value without
 * widening any declared contract — no declared type carries it any more, so
 * there is nothing left to read it through.
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

/**
 * The org-wide default every generated federated object declares.
 *
 * NOT a judgement call made here — it is the shape #9666 settled for the
 * CLI's own `os init` scaffolds (`packages/cli/src/commands/init.ts`), which
 * hit this same rule family: declare the value explicitly, and pick the one
 * `security-owd-unset`'s own hint calls the recommended default. It is also
 * what ADR-0090 D1 already resolves an unset OWD to at runtime, so a draft
 * carrying it describes the posture the platform would apply anyway — the
 * change is that the baseline becomes an AUTHORED decision instead of an
 * accident, which is the entire point of the rule.
 *
 * It is the most restrictive of the four canonical values, so a generated
 * federated object can never be published wider than its author intended by
 * this default alone; widening it is a one-line edit the review-before-commit
 * flow exists to invite.
 */
const GENERATED_SHARING_MODEL = 'private';

/**
 * The lead-in of the comment that carries the introspected remote primary key
 * into the generated source — and the one place the reason is written down.
 *
 * `fields.<f>.primaryKey` is **not a key of the spec field schema**. Emitting
 * it produced a `*.object.ts` the platform's own toolchain refused on both
 * instruments it is annotated for: `tsc --noEmit` against `ServiceObject`
 * (`TS2353 … 'primaryKey' does not exist in type`) and
 * `ObjectSchema.safeParse` (`unrecognized_keys` at `["fields","<f>"]`). So the
 * generator had a pinned path that produced a draft neither the compiler nor
 * the validator would take (#11000).
 *
 * Maintainer ruling, 2026-08-22 live session (「同意所有」, item 8) — **D**:
 *
 * > `generateObjectDraft`/`renderObjectSource` stop emitting
 * > `fields.<f>.primaryKey`; the introspected key survives **as a comment** in
 * > the generated source (information preserved for the reader, zero contract
 * > face); the existing pin tests that assert the invalid emission are updated
 * > as part of the fix.
 *
 * Both halves are load-bearing, and the second is the one an implementation
 * can silently skip: simply dropping `opts.primaryKey` on the floor would make
 * every parse-and-compile assertion green while discarding exactly what the
 * ruling said to keep.
 *
 * The rejected alternatives, so they are not re-litigated from scratch:
 * routing the key to `fields.<f>.externalId` was refused as semantically
 * different and itself of unproven enforcement, and an authorable spelling on
 * the binding (`external.primaryKey: string[]`) is **deferred, not rejected** —
 * it returns as its own `packages/spec` card once federated upsert has a live
 * runtime consumer to justify the surface.
 */
const REMOTE_PRIMARY_KEY_COMMENT = '// Remote primary key: ';

/**
 * Normalise an injected namespace. Blank / whitespace-only reads as ABSENT:
 * `validateObjectNamespacePrefix` skips a falsy namespace, but `'  '` is
 * truthy and would render `  _customers` — one invalid draft traded for
 * another, which is the failure this card is closing.
 */
function normaliseNamespace(raw: string | undefined): string | undefined {
  const ns = raw?.trim();
  return ns ? ns : undefined;
}

/**
 * Apply the ADR-0028 package prefix to a derived object name.
 *
 * The decision is delegated to `validateObjectNamespacePrefix` — the same
 * function `defineStack` and the runtime publish gate call — so "is this name
 * already compliant?" has exactly one answer in the tree. `null` means the
 * name is already acceptable (no namespace to apply, a `sys_*` reserved name,
 * or a remote table that is ALREADY prefixed, e.g. `crm_accounts` under
 * namespace `crm` — which must not become `crm_crm_accounts`).
 */
function applyNamespacePrefix(objectName: string, namespace: string | undefined): string {
  if (!namespace) return objectName;
  return validateObjectNamespacePrefix(objectName, namespace) === null
    ? objectName
    : `${namespace}_${objectName}`;
}

/**
 * The refusal `importObject` answers when an explicit `opts.name` violates the
 * ADR-0028 namespace-prefix rule.
 *
 * REFUSED, never silently rewritten: the derived path above may prefix its own
 * invention (`applyNamespacePrefix` adjusts a name the service itself derived),
 * but an override is the caller's explicit input, and every other gate on this
 * rule — `defineStack()` at compile time, the publish pre-flight at runtime
 * (`NAMESPACE_PREFIX`) — refuses a violating name rather than editing it.
 * Persisting a rewritten name behind a 201 would leave the caller holding a
 * name that does not exist, which is worse than the 400 (and exactly the
 * tolerant-consumer accommodation Prime Directive #12 forbids).
 *
 * `message` is `validateObjectNamespacePrefix`'s own authored text, verbatim —
 * the same prescription the publish gate serves for the identical violation,
 * so one rule keeps one message everywhere it fires.
 *
 * The throw carries its own `status`/`code` — the #8016 declaration shape
 * (`resolveThrownHttpError` reads them): this is a *refusal*, not a fault.
 * `EXTERNAL_IMPORT_ERROR` is the ledger's registered code for a refused
 * federated import, and 400 + that code is also exactly what the REST import
 * route answers for any `importObject` throw, so the declaration and the
 * served envelope agree by construction.
 */
function importNameRefusedError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = 'EXTERNAL_IMPORT_ERROR';
  err.status = 400;
  return err;
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

    const fields: Record<string, { type: FieldType }> = {};
    // The remote key is collected here rather than onto the field, because
    // there is no authorable field key to put it on — see
    // REMOTE_PRIMARY_KEY_COMMENT for the ruling and the measurements.
    const primaryKeyFields: string[] = [];
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
      fields[fieldName] = { type: fieldType };
      if (isPk) primaryKeyFields.push(fieldName);
    }

    // ADR-0028: every object a package defines must be named
    // `${namespace}_${shortName}`. `defineStack()` refuses an unprefixed name
    // outright, so a draft without the prefix cannot be committed into a
    // namespaced stack — the generator has to resolve the namespace itself.
    const namespace = normaliseNamespace(await this.config.getNamespace?.(datasource));
    const shortName = toObjectName(resolvedRemoteName);
    const name = applyNamespacePrefix(shortName, namespace);
    const definition: Record<string, unknown> = {
      name,
      // Derived from the SHORT name on purpose: the prefix is an addressing
      // requirement, not a display one, and keeping the label at 'Customers'
      // rather than 'Wh Customers' leaves this draft's human-facing text
      // exactly where it was before the prefix landed.
      label: toLabel(shortName),
      datasource,
      external: {
        ...(remoteSchema ? { remoteSchema } : {}),
        remoteName: resolvedRemoteName,
      },
      fields,
      // ADR-0090 D1 / `security-owd-unset` — see GENERATED_SHARING_MODEL.
      sharingModel: GENERATED_SHARING_MODEL,
    };

    return {
      name,
      datasource,
      definition,
      source: renderObjectSource(definition, fields, review, namespace, primaryKeyFields),
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

    // ADR-0028 invariant on the OVERRIDE path. The derived path below resolves
    // the datasource's package namespace and prefixes the name it generates;
    // `opts.name` used to be taken verbatim, so a caller could persist an
    // unprefixed federated object through the one runtime write path no gate
    // looks at (`metadata.register` applies no namespace check — the checks
    // live at `defineStack()` and the publish pre-flight, and an imported
    // object passes through neither). Same normalisation, same validator, so
    // the override answers to exactly the rule the derived name already obeys;
    // when no namespace resolves the rule is skipped, mirroring `defineStack`.
    // Checked BEFORE the draft on purpose: the verdict needs only the injected
    // namespace read, and a doomed request should not cost a live remote
    // introspection round trip.
    if (opts.name !== undefined) {
      const namespace = normaliseNamespace(await this.config.getNamespace?.(datasource));
      const violation = validateObjectNamespacePrefix(opts.name, namespace);
      if (violation) throw importNameRefusedError(violation);
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
        // The introspection seam. `ExternalCatalogSchema` defaults this key to
        // `false`, so when the in-tree driver still spelled it `isPrimary`,
        // reading only `c.primaryKey` persisted a catalog in which EVERY column
        // claimed not to be part of the remote key — including the ones that
        // are. The driver has since been aligned to the spec spelling
        // (`95437e7d2d`), but this must stay a `primaryKeyReader` call: see its
        // docblock for the two arms that are still load-bearing.
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
    // A direct call performs its own live read — no memo. Read reuse is the
    // sweep's per-call concern ({@link validateEach}), never this method's: a
    // long-lived service must answer every direct call from the remote's
    // schema as it is NOW (pinned: two direct calls are two live reads).
    return this.validateObjectUsing(objectName, (ds) => this.config.introspect(ds));
  }

  /**
   * [#10962] The body of {@link validateObject}, with the live-schema read
   * abstracted behind `readSchema` so one sweep can share a single read per
   * datasource across all of its objects. `readSchema` is either
   * `config.introspect` itself (the public single-object path above) or the
   * per-sweep memoised reader from {@link sweepScopedIntrospect} — never a
   * cache that outlives one call.
   */
  private async validateObjectUsing(
    objectName: string,
    readSchema: (datasource: string) => Promise<IntrospectedSchema>,
  ): Promise<SchemaValidationResult> {
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

    const schema = await readSchema(datasource);
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
   * [#10962] One live schema read per datasource per SWEEP.
   *
   * Returns a reader that memoises `config.introspect` by datasource name for
   * the lifetime of ONE {@link validateEach} call. The memo is a local of that
   * call — deliberately NOT an instance field — so a long-lived service can
   * never serve a stale schema to a later sweep: the next `validateAll()` /
   * `validateDatasource()` builds a fresh memo and reads live again (both
   * directions pinned in `__tests__/external-datasource-service.test.ts`).
   *
   * The PROMISE is memoised, not the resolved value: the sweep validates its
   * objects concurrently (`Promise.all`), so the first reader for a datasource
   * starts the read and every concurrent sibling awaits the same in-flight
   * promise. A rejected read is shared the same way — M objects on one
   * unreachable datasource produce M failure rows from ONE connection attempt.
   */
  private sweepScopedIntrospect(): (datasource: string) => Promise<IntrospectedSchema> {
    const memo = new Map<string, Promise<IntrospectedSchema>>();
    return (datasource) => {
      let read = memo.get(datasource);
      if (!read) {
        read = this.config.introspect(datasource);
        memo.set(datasource, read);
      }
      return read;
    };
  }

  /**
   * Validate a chosen set of objects, one report.
   *
   * A per-object throw becomes an `unreachable` row carrying the thrower's
   * message rather than rejecting the whole report: one unreachable remote (or
   * one object whose definition vanished mid-sweep) must not erase the verdicts
   * of the objects that did validate.
   *
   * [#10962] All objects in one call share one live schema read per datasource
   * (see {@link sweepScopedIntrospect}); the memo dies with this call.
   *
   * ## Why the row's kind is `unreachable` for EVERY throw — no error sniffing
   *
   * This catch used to invent `kind: 'missing_table'`, so a refused
   * connection, a DNS failure, an auth expiry or a timeout out of
   * `introspect(datasource)` was indistinguishable from a genuinely dropped
   * remote table — and the boot gate's default `onMismatch: 'fail'` turned a
   * 30-second network blip into a refusal to start (maintainer ruling
   * 2026-08-23: an unreachable remote is not a schema mismatch).
   *
   * The discrimination "connection failure or schema fact?" is STRUCTURAL
   * here, not an error-signature question. Every schema FACT this service
   * reports (`missing_table` included) is derived from an introspection that
   * **returned** — `validateObject`'s `!table` branch asserts `missing_table`
   * from a successfully read schema in which the table is absent. A throw
   * means the comparison never ran, and per the repo's read-failure
   * classification precedent (`READ_FAILURE_DISCRIMINATORS`,
   * `packages/types/src/driver-error-classification.ts` (#13279 moved it there
   * from `packages/metadata/src/utils/schema-sync-errors.ts`): a fact verdict must
   * be POSITIVELY EARNED, never defaulted to), no signature test on the thrown
   * value can earn a claim about a remote schema nobody read. Deliberately NOT
   * a hand-rolled `err.code` allowlist — an unrecognised connection error
   * would fall back to the wrong fact — and deliberately not a
   * missing-table-shaped rescue either: on this path a "no such table" error
   * would be about the METADATA store or the introspection machinery, not the
   * remote table this row names, so rescuing `missing_table` from it would
   * mislabel in a second direction.
   */
  private async validateEach(objects: ObjectLike[]): Promise<SchemaValidationReport> {
    const readSchema = this.sweepScopedIntrospect();
    const results = await Promise.all(
      objects.map((o) =>
        this.validateObjectUsing(o.name, readSchema).catch((err): SchemaValidationResult => {
          this.logger?.warn(`validateObject('${o.name}') failed`, err);
          return {
            ok: false,
            datasource: o.datasource ?? 'default',
            object: o.name,
            diffs: [
              {
                kind: 'unreachable',
                remoteName: o.external?.remoteName ?? o.name,
                actual: err instanceof Error ? err.message : String(err),
                // 'error', not 'warning': the object is NOT verified, `ok`
                // must stay false, and interactive consumers (CLI validate,
                // Studio) should present it at attention level. The
                // transient-vs-fact distinction consumers act on is the KIND
                // axis, not severity (see the kind's docblock in spec).
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

/**
 * Render a reviewable `*.object.ts` source string for an object draft.
 *
 * The output is annotated `ServiceObject`, which makes `tsc` over this string
 * a complete acceptance instrument for the draft's shape — use it that way.
 *
 * `namespace` is passed in rather than re-derived from `definition.name`,
 * because the two absent cases are NOT the same file: a name that is already
 * prefixed and a name that could not be prefixed both read as "starts with
 * something" from here, and only the second one needs the TODO.
 *
 * `primaryKeyFields` is rendered as a COMMENT and nowhere else — see
 * {@link REMOTE_PRIMARY_KEY_COMMENT}. It is passed separately from `fields` on purpose:
 * a field record that could carry the key at all is a field record something
 * could accidentally serialise into the definition again.
 */
function renderObjectSource(
  definition: Record<string, unknown>,
  fields: Record<string, { type: FieldType }>,
  review: ObjectDraft['review'],
  namespace?: string,
  primaryKeyFields: readonly string[] = [],
): string {
  const reviewByColumn = new Map(review.map((r) => [r.column, r.note]));
  const external = definition.external as { remoteSchema?: string; remoteName?: string };

  const fieldLines = Object.entries(fields).map(([fieldName, f]) => {
    const note = reviewByColumn.get(fieldName);
    const comment = note ? ` // REVIEW: ${note}` : '';
    return `    ${fieldName}: { type: '${f.type}' },${comment}`;
  });

  // The whole of ruling D's second half: information for the reader, zero
  // contract face. Rendered only when a key was actually reported — with no
  // key there is nothing to preserve, and an empty "none reported" banner would
  // be noise in every draft of every keyless table.
  const primaryKeyComment =
    primaryKeyFields.length > 0
      ? [
          `  ${REMOTE_PRIMARY_KEY_COMMENT}${primaryKeyFields.join(', ')}`,
          `  // Preserved as a COMMENT because 'ServiceObject' has no authorable key for a`,
          `  // federated object's remote primary key (#11000): 'fields.<f>.primaryKey' is`,
          `  // not part of the field schema, so emitting it produced a draft that neither`,
          `  // 'tsc' nor 'ObjectSchema' accepted. Nothing below reads this line.`,
          `  // It names the column(s) THIS DRAFT WAS GIVEN as the key. For a COMPOSITE key`,
          `  // some drivers report only the first column (#10997), so treat the list as a`,
          `  // lower bound and check it against the remote table before relying on it.`,
        ]
      : [];

  const externalLine = external.remoteSchema
    ? `  external: { remoteSchema: '${external.remoteSchema}', remoteName: '${external.remoteName}' },`
    : `  external: { remoteName: '${external.remoteName}' },`;

  // No namespace resolved → the name is bare. That is legal in a stack whose
  // manifest declares no `namespace` (`defineStack` skips the check), so the
  // draft is emitted rather than refused — but it is NOT legal in a namespaced
  // stack, and this generator cannot tell which one the author will paste it
  // into. Say so loudly in the file instead of guessing: the same
  // "emit it with a TODO the validator accepts" shape #9666 settled on.
  const namespaceTodo = namespace
    ? []
    : [
        `// TODO(namespace): no package namespace could be resolved for this`,
        `// datasource, so this object name is UNPREFIXED. If the stack you commit`,
        `// this into declares 'manifest.namespace', rename it to`,
        `// '<namespace>_${definition.name as string}' — 'defineStack()' refuses an`,
        `// unprefixed object name (ADR-0028).`,
      ];

  return [
    `// Generated by \`os datasource introspect\` (ADR-0015). Review before committing.`,
    ...namespaceTodo,
    `import type { ServiceObject } from '@objectstack/spec/data';`,
    ``,
    `const ${definition.name as string}: ServiceObject = {`,
    `  name: '${definition.name as string}',`,
    `  label: '${definition.label as string}',`,
    `  datasource: '${definition.datasource as string}',`,
    externalLine,
    ...primaryKeyComment,
    `  fields: {`,
    ...fieldLines,
    `  },`,
    `  // Org-wide default (OWD): who can see records they do NOT own. ADR-0090 D1`,
    `  // requires this to be an authored decision rather than an accident — the`,
    `  // \`security-owd-unset\` author-time rule refuses an object without it, so a`,
    `  // draft that omitted it could not compile. '${GENERATED_SHARING_MODEL}' is the rule's own`,
    `  // recommended default: owner + explicit shares. Widen it deliberately.`,
    `  sharingModel: '${definition.sharingModel as string}',`,
    `};`,
    ``,
    `export default ${definition.name as string};`,
    ``,
  ].join('\n');
}
