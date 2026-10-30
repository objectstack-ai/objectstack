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
  IDataDriver,
} from '@objectstack/spec/contracts';
import type { SchemaDiffEntry } from '@objectstack/spec/shared';
import { DEFAULT_DATASOURCE_NAME, type DatasourceConnectionState } from './datasource-connection-service.js';
// [#27618] The package's one "no such datasource" refusal, shared with the
// admin service so every by-name door answers an unknown name alike.
import { datasourceNotFoundError } from './datasource-admin-service.js';
import {
  suggestFieldTypeForSqlType,
  isCompatible,
  ExternalCatalogSchema,
  unprovisionedInjectedColumns,
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
  /**
   * [#24772] The live driver registered for `datasource`, resolved by
   * ADR-0062's default-driver rule (`registeredDriverName` in
   * `datasource-connection-service.ts`), or `undefined` when none is
   * registered. {@link ExternalDatasourceService.testConnection} reads it to
   * probe a datasource that `introspect` cannot answer for: the platform's
   * primary datasource, and a driver with no `introspectSchema`.
   *
   * Optional. A host that wires only `introspect` keeps Test as the
   * introspection round trip it always was.
   */
  liveDriver?: (datasource: string) => Pick<IDataDriver, 'checkHealth' | 'introspectSchema'> | undefined;
  /**
   * [#27100] The retained verdict of `datasource`'s last connect attempt
   * (`DatasourceConnectionService.getConnectionState`), or `undefined` when
   * none was made. {@link ExternalDatasourceService.testConnection} answers a
   * failed verdict's `reason` for a datasource with no live driver: the
   * text the admin list and the create answer serve as `statusReason`.
   *
   * Optional. A host that does not wire it keeps the engine's answer.
   */
  connectionState?: (
    datasource: string,
  ) => Pick<DatasourceConnectionState, 'availability' | 'reason'> | undefined;
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

/**
 * The schemas a listed remote table may belong to, from the two filters
 * `listRemoteTables` answers to: the caller's `?schema=` and the datasource's
 * `external.allowedSchemas`. `undefined` means neither filter is in force. An
 * EMPTY set means no table can pass whatever its schema is (an empty allow-list,
 * or a requested schema the allow-list leaves out), so that answer needs no
 * per-table schema at all.
 */
function admittedSchemas(
  requested: string | undefined,
  allowed: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (requested === undefined) return allowed === undefined ? undefined : new Set(allowed);
  if (allowed === undefined || allowed.includes(requested)) return new Set([requested]);
  return new Set();
}

/**
 * The refusal `listRemoteTables` answers when a schema filter is in force and
 * the driver's introspection named no schema for some of the tables it listed.
 *
 * A table's schema reaches this service only as a qualified name
 * (`schema.table`): `IntrospectedTable` declares no schema of its own. The
 * in-tree SQL driver emits bare names on every dialect. Measured on PostgreSQL
 * 16 with tables in `public` and `sales`: on the default search path it lists
 * `customers` only, and with `searchPath: ['sales']` it lists `orders` and
 * `customers` with no schema, so a bare name cannot be attributed. Answering
 * anyway is what this replaces. Both filters were skipped for an unattributed
 * table, so `?schema=sales` answered 200 with the `public` tables and an
 * `allowedSchemas` list let every table through.
 *
 * ⛔ Never an attribution guessed from the dialect (SQLite's `main`, MySQL's
 * connection database, Postgres's search path): that is a second source of
 * truth about the driver, kept in a consumer. A driver that reports
 * schema-qualified names is narrowed below, unchanged.
 *
 * The throw carries `status` and `code`, like `importNameRefusedError` above:
 * both route spellings answer a throw from this method as
 * `400 EXTERNAL_DATASOURCE_ERROR`, the code registered for a refusal from this
 * service, so the declaration and the served envelope agree.
 */
function unattributedSchemaFilterError(args: {
  datasource: string;
  dialect: string | undefined;
  requested: string | undefined;
  allowed: readonly string[] | undefined;
  unattributed: readonly string[];
  total: number;
}): Error {
  const { datasource, dialect, requested, allowed, unattributed, total } = args;
  const allowList = allowed ? `external.allowedSchemas (${allowed.map((s) => `'${s}'`).join(', ')})` : undefined;
  const target =
    requested !== undefined && allowList
      ? `schema '${requested}' and to ${allowList}`
      : requested !== undefined
        ? `schema '${requested}'`
        : (allowList as string);
  const driver = dialect ? `its driver's introspection (dialect '${dialect}')` : `its driver's introspection`;
  const remedies: string[] = [];
  if (requested !== undefined) {
    remedies.push(`Drop the 'schema' parameter to list every table the connection reaches.`);
  }
  if (allowList) {
    remedies.push(
      `This driver cannot enforce external.allowedSchemas: limit what the connection itself can reach, ` +
        `and remove external.allowedSchemas from datasource '${datasource}'.`,
    );
  }
  const err = new Error(
    `Cannot narrow the remote tables of datasource '${datasource}' to ${target}: ` +
      `${driver} named no schema for ${unattributed.length} of its ${total} table(s), ` +
      `for example '${unattributed[0]}', so whether they belong there is unknown, ` +
      `and listing them anyway could show tables the filter excludes. ${remedies.join(' ')}`,
  ) as Error & { code?: string; status?: number };
  err.code = 'EXTERNAL_DATASOURCE_ERROR';
  err.status = 400;
  return err;
}

/**
 * Normalise a remote table name into a snake_case object name: the name
 * itself when it already is one, else its snake_case spelling
 * ({@link toFieldName}'s rule) — an OData entity set is PascalCase
 * (`Products`, `OrderDetails` → `products`, `order_details`). [#27745] The
 * leading capital used to be prefixed before the name was lower-cased, so
 * `Products` drafted as `_products`.
 */
function toObjectName(remoteName: string): string {
  const { name } = parseQualified(remoteName);
  return toFieldName(name);
}

/** The field-name grammar `ObjectSchema` admits (a snake_case machine name). */
const FIELD_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * A remote column's field name: the column's own name when it is already a
 * field name (the SQL path, unchanged), else its snake_case spelling —
 * `CustomerID` → `customer_id`, `FirstName` → `first_name`. An OData
 * property is PascalCase by convention, and `ObjectSchema` refuses a field
 * key that is not snake_case, so a draft that kept the remote spelling could
 * not be saved. The remote name survives in `external.columnMap`.
 */
function toFieldName(column: string): string {
  if (FIELD_NAME.test(column)) return column;
  const snake = column
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!snake) return '_';
  return /^[0-9]/.test(snake) ? `_${snake}` : snake;
}

/**
 * The type vocabulary the matrix reads a driver's columns in, from the
 * introspection's `dialect`. A driver reports its own dialect name; the OData
 * driver adds its protocol version (`odata-4.0`), and every OData version
 * names its primitives in the one EDM vocabulary the matrix's `odata` arm
 * holds.
 */
function typeVocabulary(dialect: string | undefined): SqlDialect | undefined {
  if (dialect === undefined) return undefined;
  if (dialect === 'odata' || dialect.startsWith('odata-')) return 'odata';
  return dialect as SqlDialect;
}

/**
 * A single-valued navigation the introspection offers as a lookup candidate.
 * The OData driver's `introspectSchema` lists them on each table beside its
 * columns (`ODataIntrospectedTable.navigationProperties`); a SQL table has
 * none. Read structurally, because `IntrospectedTable` declares no such key.
 */
interface NavigationCandidate {
  name: string;
  targetEntitySet?: string;
  referentialConstraints: Array<{ property: string; referencedProperty: string }>;
}

function navigationCandidates(table: IntrospectedTable): NavigationCandidate[] {
  const raw = (table as unknown as { navigationProperties?: unknown }).navigationProperties;
  if (!Array.isArray(raw)) return [];
  const out: NavigationCandidate[] = [];
  for (const nav of raw) {
    if (!nav || typeof nav !== 'object' || typeof (nav as { name?: unknown }).name !== 'string') continue;
    const { name, targetEntitySet, referentialConstraints } = nav as {
      name: string;
      targetEntitySet?: unknown;
      referentialConstraints?: unknown;
    };
    out.push({
      name,
      ...(typeof targetEntitySet === 'string' ? { targetEntitySet } : {}),
      referentialConstraints: Array.isArray(referentialConstraints)
        ? referentialConstraints.filter(
            (rc): rc is { property: string; referencedProperty: string } =>
              !!rc &&
              typeof (rc as { property?: unknown }).property === 'string' &&
              typeof (rc as { referencedProperty?: unknown }).referencedProperty === 'string',
          )
        : [],
    });
  }
  return out;
}

/** A field of a generated draft: a scalar, or a lookup over a foreign-key column. */
type DraftField = { type: FieldType; reference?: string };

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
 * it produced a `*.object.ts` the platform's own toolchain refused on both of
 * its instruments: `tsc --noEmit` against `ServiceObject`
 * (`TS2353 … 'primaryKey' does not exist in type`) and
 * `ObjectSchema.safeParse` (`unrecognized_keys` at `["fields","<f>"]`). So the
 * generator had a pinned path that produced a draft neither the compiler nor
 * the validator would take (#11000).
 *
 * Both instruments still judge it, and the second one moved CLOSER: the
 * emitted file is now the authorised `ObjectSchema.create({ … })` shape (see
 * {@link renderObjectSource}), so the validator's verdict arrives when the
 * committed module is evaluated rather than only when somebody runs a build.
 * Re-emitting the key would therefore throw in the author's own file.
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

/**
 * [#24772] The refusal every federation door answers for the platform's
 * primary datasource: listing its remote tables, drafting or importing one,
 * refreshing its catalog.
 *
 * ADR-0015 §1 puts federation on datasources whose `schemaMode` is not
 * `managed`. The primary datasource is the platform's own managed storage:
 * every table in it was created from an object the platform already serves.
 * These doors used to answer the engine's "has no registered driver to
 * introspect" for it, which is false (the driver is live; ADR-0062 registers
 * it under its natural name), while the Datasources page reads it as
 * connected. The answer is still a refusal, with the same status and code
 * these doors served before; only the reason is now the true one.
 *
 * ⛔ Not "make introspection reach the default". Listing and importing the
 * primary database's tables would let an import federate a platform table, and
 * the engine's write gate exempts the default datasource, so nothing would
 * stand behind it.
 *
 * The code is the one the calling door serves (see {@link FederationDoor}), so
 * the declaration and the served envelope agree, as for
 * `importNameRefusedError` above.
 */
function primaryDatasourceNotFederatedError(datasource: string, door: FederationDoor): Error {
  const code = door === 'import' ? 'EXTERNAL_IMPORT_ERROR' : 'EXTERNAL_DATASOURCE_ERROR';
  const err = new Error(
    `Datasource '${datasource}' is the platform's managed primary datasource, not a federation source: ` +
      `its tables are the platform's own objects, so there are no remote tables to list, draft or import ` +
      `from it. Sync objects from an external datasource instead.`,
  ) as Error & { code?: string; status?: number };
  err.code = code;
  err.status = 400;
  return err;
}

/**
 * [#24837] Which federation door is refusing, which decides the code its
 * refusal carries: the import serves its own registered code,
 * `EXTERNAL_IMPORT_ERROR`, and every door that only introspects (listing,
 * draft, catalog refresh) serves `EXTERNAL_DATASOURCE_ERROR`. Those are the
 * codes the two route families answer any refusal from these methods with.
 *
 * A door KIND, not a code parameter, on purpose: each refusal helper below
 * spells both codes as literals, so `check:dispatcher-error-vocabulary` reads
 * them at the stamp instead of reporting a helper whose codes it cannot see.
 */
type FederationDoor = 'import' | 'introspect';

/**
 * [#24837] Is `ds` a federation source: a datasource DEFINITION whose
 * `schemaMode` is declared and is not `managed`?
 *
 * ADR-0015 §1 puts a federated object on "the datasource it points to
 * (`schemaMode !== 'managed'`)", and §4.2 allows `object.external` only there.
 * `managed` is the spec's default (`DatasourceSchema.schemaMode`), so a
 * definition that declares no `schemaMode` is managed, and so is a name with no
 * definition at all: nothing declares it a federation source, and federation
 * has to be declared, never defaulted to.
 *
 * ONE spelling of the question for this service. The Sync doors refuse what it
 * rejects ({@link ExternalDatasourceService.assertFederationSource}), and the
 * validation skips the same population as "not federated"
 * ({@link ExternalDatasourceService.validateObject}), so the two cannot drift
 * into one datasource being importable and never validated.
 */
function isFederationSource(ds: DatasourceLike | undefined): ds is DatasourceLike {
  return Boolean(ds?.schemaMode) && ds?.schemaMode !== 'managed';
}

/**
 * [#24837] The refusal every federation door answers for a datasource that is
 * not a federation source by {@link isFederationSource}: a managed one, declared
 * or by default. [#27618] A name with no datasource definition is not refused
 * here: it does not exist, and is answered as every by-name door answers it
 * ({@link datasourceNotFoundError}).
 *
 * Until this guard, only the primary datasource was refused
 * ({@link primaryDatasourceNotFederatedError}). Every other managed datasource,
 * the runtime ones an administrator creates in Setup included, listed its
 * tables and drafted and imported them as federated objects, against ADR-0015
 * §4.2. Nothing behind these doors refuses either: the engine's write gate
 * (ADR-0015 §5.3) gates only non-managed datasources, so writes to an object
 * imported over a managed one would go through ungated.
 *
 * Same status and codes as the primary datasource's refusal, by the same
 * reasoning: the code is the one the calling door serves.
 */
function notAFederationSourceError(datasource: string, ds: DatasourceLike, door: FederationDoor): Error {
  const code = door === 'import' ? 'EXTERNAL_IMPORT_ERROR' : 'EXTERNAL_DATASOURCE_ERROR';
  const lead = ds.schemaMode
    ? `Datasource '${datasource}' is managed (schemaMode '${ds.schemaMode}'), not a federation source`
    : `Datasource '${datasource}' is managed (it declares no schemaMode, and 'managed' is the default), ` +
      `not a federation source`;
  const rule =
    `ADR-0015 reserves federation for a datasource whose schemaMode is not 'managed', ` +
    `because the platform owns a managed datasource's schema and its tables are the platform's own objects.`;
  const remedy =
    `To list, draft or import remote tables, use a datasource the platform does not own: ` +
    `one declared with schemaMode 'external' or 'validate-only'.`;
  const err = new Error(`${lead}: ${rule} ${remedy}`) as Error & {
    code?: string;
    status?: number;
  };
  err.code = code;
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

  /**
   * [#24837] The one guard every federation door runs first: listing remote
   * tables, drafting one, importing one, refreshing the catalog. Each door
   * names its {@link FederationDoor} kind, which decides the refusal's code.
   *
   * Three refusals, in this order, and nothing else:
   *
   *  - the platform's primary datasource, by name, with its own reason
   *    ({@link primaryDatasourceNotFederatedError}, #24772). No definition is
   *    read for it: no store configuration makes it a federation source.
   *  - [#27618] a name with no datasource definition: it does not exist, so it
   *    is the `404` every by-name door answers ({@link datasourceNotFoundError},
   *    the words `GET /datasources/:name` uses), which both route families
   *    relay as such. It was folded into the next refusal, a `400` that told
   *    the caller to re-declare a datasource that is not there.
   *  - any other datasource that is not a federation source by
   *    {@link isFederationSource}: managed, declared or by default
   *    ({@link notAFederationSourceError}).
   *
   * All come before any introspection, so a refused datasource is never
   * read: its tables are the platform's, and listing them is the very thing
   * refused.
   *
   * @returns the datasource's definition, which the listing reads next for
   *          `external.allowedSchemas`, so the door reads it once.
   */
  private async assertFederationSource(datasource: string, door: FederationDoor): Promise<DatasourceLike> {
    if (datasource === DEFAULT_DATASOURCE_NAME) throw primaryDatasourceNotFederatedError(datasource, door);
    const ds = await this.config.getDatasource(datasource);
    if (!ds) throw datasourceNotFoundError(datasource);
    if (!isFederationSource(ds)) throw notAFederationSourceError(datasource, ds, door);
    return ds;
  }

  /**
   * List the datasource's remote tables, narrowed by `opts.schema` and by the
   * datasource's `external.allowedSchemas`.
   *
   * A filter in force is applied to every table or the call refuses: a table
   * whose schema the driver did not name is never let through a filter it
   * cannot be judged by. With no filter, every introspected table is listed.
   * See {@link unattributedSchemaFilterError} for why the in-tree SQL driver
   * lands on the refusal. A datasource that is not a federation source (the
   * platform's primary one, and any other managed one) is refused outright:
   * see {@link assertFederationSource}.
   */
  async listRemoteTables(
    datasource: string,
    opts?: { schema?: string },
  ): Promise<RemoteTable[]> {
    const ds = await this.assertFederationSource(datasource, 'introspect');
    const schema = await this.config.introspect(datasource);
    const allowed = ds.external?.allowedSchemas;
    const requested = opts?.schema ? opts.schema : undefined;
    const admitted = admittedSchemas(requested, allowed);
    if (admitted?.size === 0) return [];

    const tables: RemoteTable[] = [];
    const unattributed: string[] = [];
    const introspected = Object.values(schema.tables);
    for (const table of introspected) {
      const { schema: tableSchema, name } = parseQualified(table.name);
      if (admitted) {
        if (!tableSchema) {
          unattributed.push(table.name);
          continue;
        }
        if (!admitted.has(tableSchema)) continue;
      }
      tables.push({ schema: tableSchema, name, columnCount: table.columns.length });
    }
    if (unattributed.length > 0) {
      throw unattributedSchemaFilterError({
        datasource,
        dialect: schema.dialect,
        requested,
        allowed,
        unattributed,
        total: introspected.length,
      });
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
   *
   * [#24772] Two datasources the introspection round trip cannot test, which
   * answered `ok: false` while the Datasources page read them as connected.
   * With a `liveDriver` wired, both take the driver's own connectivity probe,
   * `checkHealth()`, instead:
   *
   *  - the platform's PRIMARY datasource. Its driver is live under its natural
   *    name (ADR-0062), and it is not a federation source, so its tables are not
   *    introspected: that costs a round trip per table of the platform database
   *    and answers nothing the connection question needs. No `tableCount`.
   *  - a driver with no `introspectSchema` (memory, mongodb). Its connected
   *    datasource was called failed. It now answers the same health probe, and
   *    the missing `tableCount` is the whole of what it cannot say.
   *
   * Both answer `{ ok, latencyMs }`, the answer's existing keys: no key is added
   * to say why `tableCount` is absent, because nothing reads one (the console's
   * Test reads `ok`, `error` and `latencyMs`). Every other datasource is tested
   * exactly as before. So is one with no live driver: `introspect` names the
   * absence itself.
   *
   * [#27100] …unless the absence has a cause on record. A failed connect
   * registers no driver, so `introspect` answered "has no registered driver"
   * for a Postgres datasource that was refused at its host, pointing the
   * admin at installing a driver that is installed. With `connectionState`
   * wired, a datasource with no live driver and a FAILED verdict answers that
   * verdict's `reason`, the one `statusReason` carries: one message, never a
   * second one built here. Test does not re-attempt the connect; the edit's
   * rebuild does, and replaces the verdict either way. A datasource whose
   * failed rebuild kept its old pool serving has a live driver, so it is
   * probed as before.
   *
   * [#27510] A name that resolves no saved datasource is not a datasource that
   * failed its probe, so it is the one outcome that THROWS: the 404
   * {@link datasourceNotFoundError}, which the route answers exactly as
   * `GET /datasources/:name` answers the same name. It answered `ok: false`
   * with the engine's "has no registered driver" sentence, the answer a saved
   * datasource that is down gets, so a caller could not tell the two apart.
   * The name is resolved through `getDatasource`, the stored-record read the
   * sibling `:name` doors make (both plugins wire it to
   * `metadata.get('datasource', name)`). The primary datasource is not looked
   * up: it may have no stored record, and its live driver answers for it.
   */
  async testConnection(
    datasource: string,
  ): Promise<{ ok: boolean; latencyMs?: number; tableCount?: number; error?: string }> {
    if (datasource !== DEFAULT_DATASOURCE_NAME && !(await this.config.getDatasource(datasource))) {
      throw datasourceNotFoundError(datasource);
    }
    const started = Date.now();
    try {
      const driver = this.config.liveDriver?.(datasource);
      if (!driver) {
        const verdict = this.config.connectionState?.(datasource);
        if (verdict?.availability === 'failed' && verdict.reason) return { ok: false, error: verdict.reason };
      }
      const canIntrospect = typeof driver?.introspectSchema === 'function';
      if (driver && (datasource === DEFAULT_DATASOURCE_NAME || !canIntrospect)) {
        if (!(await driver.checkHealth())) {
          return { ok: false, error: `Datasource '${datasource}' is registered, but its driver failed its health check.` };
        }
        return { ok: true, latencyMs: Date.now() - started };
      }
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
    await this.assertFederationSource(datasource, 'introspect');
    return this.draftObject(datasource, remoteName, opts);
  }

  /**
   * The draft pipeline behind {@link generateObjectDraft} and
   * {@link importObject}, run once the calling door's
   * {@link assertFederationSource} has passed, so the import is judged once,
   * under its own code.
   */
  private async draftObject(
    datasource: string,
    remoteName: string,
    opts: GenerateDraftOpts,
    /** The name the object will be saved under, when the caller overrides the derived one. */
    nameOverride?: string,
  ): Promise<ObjectDraft> {
    const schema = await this.config.introspect(datasource);
    const table = this.findTable(schema, remoteName);
    if (!table) {
      throw new Error(
        `Remote table '${remoteName}' not found on datasource '${datasource}'.`,
      );
    }
    const dialect = typeVocabulary(schema.dialect);
    // Derive the remote schema from the matched table's qualified name (the
    // caller may pass an unqualified `remoteName`).
    const matched = parseQualified(table.name);
    const remoteSchema = opts.remoteSchema ?? matched.schema;
    const resolvedRemoteName = matched.name;

    const include = opts.includeColumns ? new Set(opts.includeColumns) : undefined;
    const exclude = opts.excludeColumns ? new Set(opts.excludeColumns) : new Set<string>();
    const pkOverride = opts.primaryKey ? new Set(opts.primaryKey) : undefined;

    const fields: Record<string, DraftField> = {};
    // The remote key is collected here rather than onto the field, because
    // there is no authorable field key to put it on — see
    // REMOTE_PRIMARY_KEY_COMMENT for the ruling and the measurements.
    const primaryKeyFields: string[] = [];
    const review: ObjectDraft['review'] = [];
    // remote column → local field, for every column whose field is named
    // differently: the binding the driver reads and Gate 2 inverts.
    const columnMap: Record<string, string> = {};

    for (const col of table.columns) {
      if (include && !include.has(col.name)) continue;
      if (exclude.has(col.name)) continue;

      let fieldName = opts.rename?.[col.name] ?? toFieldName(col.name);
      if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
        // Two remote columns that spell one field name (`OrderId`, `order_id`):
        // the later one is numbered, never merged into the earlier.
        let n = 2;
        while (Object.prototype.hasOwnProperty.call(fields, `${fieldName}_${n}`)) n += 1;
        review.push({
          column: col.name,
          remoteType: col.type,
          note: `its field name '${fieldName}' is taken by another column — named '${fieldName}_${n}', rename it`,
        });
        fieldName = `${fieldName}_${n}`;
      }
      if (fieldName !== col.name) columnMap[col.name] = fieldName;
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

    await this.draftLookups({
      datasource,
      schema,
      table,
      selfRemoteName: resolvedRemoteName,
      selfName: nameOverride ?? name,
      dialect,
      fields,
      columnMap,
      review,
    });

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
        ...(Object.keys(columnMap).length > 0 ? { columnMap } : {}),
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

  /**
   * [#27745] The lookups of a draft: one per single-valued navigation the
   * introspection offers ({@link navigationCandidates}) that a column can back
   * and whose target is imported. Each turns the column holding the target's
   * key into a `lookup` field referencing the target's object. Every other
   * navigation is left out of the draft and named in its review, with the
   * reason:
   *
   *  - it is bound to no entity set, or carries no `ReferentialConstraint`
   *    (TripPin's `BestFriend`): no column holds the target's key, and the
   *    driver never follows a navigation to read one;
   *  - its constraint spans more than one property, its dependent property is
   *    not a column of this draft, or the property it references is not the
   *    target's single key (a lookup holds the target's `id`, and the driver's
   *    `id` is the key only for a single-property key);
   *  - the dependent column's type cannot back a lookup by the type matrix,
   *    the verdict Gate 2 would reach on the saved object;
   *  - the target is not imported. Imported means an object on THIS datasource
   *    bound to the target entity set, or the object itself for a navigation
   *    onto its own entity set. Import the target first: a draft taken after
   *    it carries the lookup, while re-saving an object already imported with
   *    the column as a scalar is a retype the save door's destructive-change
   *    gate refuses.
   *
   * A left-out entry's `remoteType` is `navigation → <target entity set>`,
   * which Studio's batch import reads to save targets first.
   */
  private async draftLookups(args: {
    datasource: string;
    schema: IntrospectedSchema;
    table: IntrospectedTable;
    selfRemoteName: string;
    selfName: string;
    dialect: SqlDialect | undefined;
    fields: Record<string, DraftField>;
    columnMap: Record<string, string>;
    review: ObjectDraft['review'];
  }): Promise<void> {
    const { datasource, schema, table, selfRemoteName, selfName, dialect, fields, columnMap, review } = args;
    const candidates = navigationCandidates(table);
    if (candidates.length === 0) return;

    const columns = new Map(table.columns.map((c) => [c.name, c]));
    // Remote entity set → the object bound to it on this datasource, read once
    // and only when a candidate gets that far.
    let imported: Map<string, string> | undefined;
    const importedObject = async (entitySet: string): Promise<string | undefined> => {
      if (!imported) {
        imported = new Map();
        for (const o of await this.config.listObjects()) {
          if ((o.datasource ?? DEFAULT_DATASOURCE_NAME) !== datasource) continue;
          const bound = o.external?.remoteName ?? o.name;
          if (!imported.has(bound)) imported.set(bound, o.name);
        }
      }
      return imported.get(entitySet);
    };

    for (const nav of candidates) {
      const target = nav.targetEntitySet;
      const leftOut = (why: string) =>
        review.push({
          column: nav.name,
          remoteType: `navigation → ${target ?? '(unbound)'}`,
          note: `navigation left out of the draft: ${why}`,
        });
      if (!target) {
        leftOut(`$metadata binds it to no entity set`);
        continue;
      }
      if (nav.referentialConstraints.length !== 1) {
        leftOut(
          nav.referentialConstraints.length === 0
            ? `no ReferentialConstraint names a property holding the key of '${target}'`
            : `its ReferentialConstraint spans ${nav.referentialConstraints.length} properties (a composite reference)`,
        );
        continue;
      }
      const { property, referencedProperty } = nav.referentialConstraints[0]!;
      const column = columns.get(property);
      const field = columnMap[property] ?? property;
      if (!column || !Object.prototype.hasOwnProperty.call(fields, field)) {
        leftOut(`its foreign-key property '${property}' is not a column of this draft`);
        continue;
      }
      const targetTable = this.findTable(schema, target);
      const isTargetKey = targetTable ? primaryKeyReader(targetTable) : undefined;
      const targetKeys = targetTable && isTargetKey ? targetTable.columns.filter(isTargetKey).map((c) => c.name) : [];
      if (targetKeys.length !== 1 || targetKeys[0] !== referencedProperty) {
        leftOut(`it references '${referencedProperty}', which is not the single key of '${target}'`);
        continue;
      }
      if (isCompatible(column.type, 'lookup', dialect) !== true) {
        leftOut(`its foreign-key property '${property}' is ${column.type}, which cannot back a lookup`);
        continue;
      }
      const reference = target === selfRemoteName ? selfName : await importedObject(target);
      if (!reference) {
        leftOut(`'${target}' is not imported on datasource '${datasource}'; import it before this table to get the lookup`);
        continue;
      }
      fields[field] = { type: 'lookup', reference };
    }
  }

  async importObject(
    datasource: string,
    remoteName: string,
    opts: ImportObjectOpts = {},
  ): Promise<ImportObjectResult> {
    // [#24772, #24837] First: no store configuration makes the primary
    // datasource, or any other managed one, a federation source, so that
    // refusal is the true answer whatever else holds.
    await this.assertFederationSource(datasource, 'import');
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
    const draft = await this.draftObject(datasource, remoteName, opts, opts.name);

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
    await this.assertFederationSource(datasource, 'introspect');
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
            suggestedFieldType: suggestFieldTypeForSqlType(c.type, typeVocabulary(schema.dialect)),
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
   * [commit 29d067646] The body of {@link validateObject}, with the live-schema read
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

    // Not a federated object → nothing to validate. [#24837] The Sync doors'
    // predicate, so what they refuse is exactly what this skips.
    if (!isFederationSource(ds)) {
      return { ok: true, datasource, object: objectName, diffs: [] };
    }

    const schema = await readSchema(datasource);
    const dialect = typeVocabulary(schema.dialect);
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

    // [#21788] The anchors the platform injects with NO storage behind them
    // (`organization_id`, the audit pair, `owner_id`,
    // `owning_business_unit_id` on a federated object) are not remote columns
    // and never were: the remote owns the schema. An object read as the
    // registry holds it — every stored object the metadata door or the import
    // saved, rehydrated at boot — carries them in `fields`, and comparing them
    // reported each as a `missing_column` error, which aborted the boot under
    // the default `onMismatch: 'fail'`. The spec's own provenance verdict
    // (#7865) names exactly those anchors; an author-declared field of the same
    // name is the author's and is still compared.
    const unprovisioned = new Set(unprovisionedInjectedColumns(obj));
    for (const [fieldName, field] of Object.entries(obj.fields ?? {})) {
      if (BUILTIN_COLUMNS.has(fieldName) || unprovisioned.has(fieldName)) continue;
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
   * [commit 29d067646] One live schema read per datasource per SWEEP.
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
   * [commit 29d067646] All objects in one call share one live schema read per datasource
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
   * `packages/types/src/driver-error-classification.ts` (commit 6a180e42d moved it there
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
   * [commit e634ecf6a] Validate the federated objects bound to ONE datasource.
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

/** A single-quoted TypeScript string literal for `value`. */
function quoteTs(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Render a reviewable `*.object.ts` source string for an object draft.
 *
 * The output is the ONE authorised `*.object.ts` shape: a single named export
 * bound to `ObjectSchema.create({ … })` — director-seat ruling, decision batch
 * #122 item 1, maintainer 「同意」 2026-09-12. Its reasoning is what the two
 * halves of this renderer have to preserve:
 *
 * > The factory parses the object against `ObjectSchema` when the file is
 * > evaluated, so an error surfaces where it was written; the typed literal
 * > defers everything to a build the author may never run.
 *
 * ⇒ `tsc` over this string is NO LONGER the whole acceptance instrument, and a
 * renderer that emitted the factory CALL around a definition the factory
 * refuses would have moved the defect rather than fixed it. Both instruments
 * are owed a pin: the emitted call's shape, and an evaluation of the emitted
 * module body through the real `ObjectSchema.create`
 * (`external-object-draft-authorised-shape.test.ts` holds both).
 *
 * The export is NAMED, and there is deliberately no `export default` beside
 * it: the scaffolded barrel re-exports object modules by name
 * (`export { X } from './x.object.js'`), and a second export form in a
 * generated file is exactly the parallel shape the ruling closed.
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
  fields: Record<string, DraftField>,
  review: ObjectDraft['review'],
  namespace?: string,
  primaryKeyFields: readonly string[] = [],
): string {
  const external = definition.external as {
    remoteSchema?: string;
    remoteName?: string;
    columnMap?: Record<string, string>;
  };
  // A review entry names its REMOTE column; the field it lands on is that
  // column's mapped name. An entry naming no field (a navigation left out of
  // the draft) is rendered after the fields instead.
  const fieldOf = (column: string): string => external.columnMap?.[column] ?? column;
  const reviewByField = new Map<string, string>();
  const unplaced: ObjectDraft['review'] = [];
  for (const r of review) {
    const field = fieldOf(r.column);
    if (Object.prototype.hasOwnProperty.call(fields, field) && !reviewByField.has(field)) {
      reviewByField.set(field, r.note);
    } else {
      unplaced.push(r);
    }
  }

  const fieldLines = Object.entries(fields).map(([fieldName, f]) => {
    const note = reviewByField.get(fieldName);
    const comment = note ? ` // REVIEW: ${note}` : '';
    const reference = f.reference ? `, reference: ${quoteTs(f.reference)}` : '';
    return `    ${fieldName}: { type: '${f.type}'${reference} },${comment}`;
  });
  const unplacedLines = unplaced.map((r) => `    // REVIEW: ${r.column} (${r.remoteType}): ${r.note}`);

  // The whole of ruling D's second half: information for the reader, zero
  // contract face. Rendered only when a key was actually reported — with no
  // key there is nothing to preserve, and an empty "none reported" banner would
  // be noise in every draft of every keyless table.
  const primaryKeyComment =
    primaryKeyFields.length > 0
      ? [
          `  ${REMOTE_PRIMARY_KEY_COMMENT}${primaryKeyFields.join(', ')}`,
          `  // Preserved as a COMMENT because 'ServiceObject' has no authorable key for a`,
          `  // federated object's remote primary key: 'fields.<f>.primaryKey' is`,
          `  // not part of the field schema, so emitting it produced a draft that neither`,
          `  // 'tsc' nor 'ObjectSchema' accepted. Nothing below reads this line.`,
          `  // It names the column(s) THIS DRAFT WAS GIVEN as the key. For a COMPOSITE key`,
          `  // a driver's introspection can report only the first column, so treat the list as a`,
          `  // lower bound and check it against the remote table before relying on it.`,
        ]
      : [];

  const columnMapEntries = Object.entries(external.columnMap ?? {});
  const columnMapPart =
    columnMapEntries.length > 0
      ? `, columnMap: { ${columnMapEntries.map(([remote, field]) => `${quoteTs(remote)}: ${quoteTs(field)}`).join(', ')} }`
      : '';
  const externalLine = external.remoteSchema
    ? `  external: { remoteSchema: '${external.remoteSchema}', remoteName: '${external.remoteName}'${columnMapPart} },`
    : `  external: { remoteName: '${external.remoteName}'${columnMapPart} },`;

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
    // A VALUE import, not a type-only one: the factory runs when the committed
    // file is evaluated. `import type` here would be elided at compile time and
    // the emitted module would throw on its own first line.
    `import { ObjectSchema } from '@objectstack/spec/data';`,
    ``,
    `export const ${definition.name as string} = ObjectSchema.create({`,
    `  name: '${definition.name as string}',`,
    `  label: '${definition.label as string}',`,
    `  datasource: '${definition.datasource as string}',`,
    externalLine,
    ...primaryKeyComment,
    `  fields: {`,
    ...fieldLines,
    ...unplacedLines,
    `  },`,
    `  // Org-wide default (OWD): who can see records they do NOT own. ADR-0090 D1`,
    `  // requires this to be an authored decision rather than an accident — the`,
    `  // \`security-owd-unset\` author-time rule refuses an object without it, so a`,
    `  // draft that omitted it could not compile. '${GENERATED_SHARING_MODEL}' is the rule's own`,
    `  // recommended default: owner + explicit shares. Widen it deliberately.`,
    `  sharingModel: '${definition.sharingModel as string}',`,
    `});`,
    ``,
  ].join('\n');
}
