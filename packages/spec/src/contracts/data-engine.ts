// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  BaseEngineOptions,
  EngineQueryOptions,
  DataEngineInsertOptions,
  EngineUpdateOptions,
  EngineDeleteOptions,
  EngineAggregateOptions,
  EngineCountOptions,
  DroppedFieldsEvent,
} from '../data/index.js';
import type { IDataDriver } from './data-driver.js';
import type { IntrospectedSchema } from './schema-diff-service.js';

/**
 * In-process write-observability hooks for `insert`/`update` (#3407).
 *
 * `onFieldsDropped` is invoked by the engine when caller-supplied write fields
 * are LEGALLY stripped from the payload before the driver write — static
 * `readonly` (#2948), a TRUE `readonlyWhen` predicate (#3042), an
 * implicitly-readonly runtime-owned type (#5503; `RUNTIME_OWNED_FIELD_TYPES`,
 * today `autonumber` — the one strip that also runs on INSERT), or the
 * primary-key strip of a payload `id` the update dispatch has ruled is not an
 * identifier (#6437). The write still succeeds; the listener exists so callers
 * that report per-field success (e.g. a flow's `update_record` step) can
 * surface a warning instead of a silent success (#3356's masked stage
 * write-backs).
 *
 * ## What is NOT a drop: the address of a single-record write (#8093)
 *
 * A drop is a field the CALLER SUPPLIED and the engine REFUSED. On a by-id
 * update the payload's `id`, when it equals the row the call is bound to, is
 * the write's ADDRESS rather than part of its payload — it was refused nothing
 * — so it is never reported here, even on the many objects that declare `id`
 * as `readonly: true` and even though the strip does still remove it from the
 * SET clause. Callers that FOLD an address into the payload get the same
 * answer: `metadata-protocol`'s `updateData` appends the path id so a body
 * `id` cannot bind a row other than the one the URL and the OCC check name
 * (#6479), and that fold must not read back as a refused field.
 *
 * This is a report boundary, not a strip boundary, and the distinction is
 * load-bearing in both directions: an `id` the update dispatch has RULED is
 * not an identifier is a real drop and is still reported (`primary_key`,
 * #6437), and a predicate/multi write — which addresses nothing by key — still
 * reports a caller-supplied `id` in full.
 *
 * Why it matters more than one spurious warning: consumers render these events
 * to end users, so an event nobody can act on teaches users that the channel
 * is noise. #8093 was measured as a warning toast on every org switch, from an
 * internal preference write; #3431 / #3794 were the same failure one field over
 * (`updated_at`), and the lesson recorded there is the one that applies —
 * a warning about a field the user never touched drowns the real signal the
 * warning exists for.
 *
 * Lives on the TS contract — NOT in the serializable Zod options schemas
 * (`EngineUpdateOptionsSchema` etc.): a function is unrepresentable in JSON
 * Schema and cannot cross the RPC (Virtual Data Engine) boundary, so remote
 * callers simply never receive these events. The event payload itself is
 * Zod-first: `DroppedFieldsEventSchema` in `data/data-engine.zod.ts`.
 *
 * A listener that throws must never break the write — engines catch and log.
 */
export interface WriteObservabilityOptions {
  /** Called once per strip pass that dropped ≥1 caller-supplied field. */
  onFieldsDropped?: (event: DroppedFieldsEvent) => void;

  /**
   * Refuse the write instead of stripping (#5126). Default `false` — off.
   *
   * ## Semantics
   *
   * When `true`, a write whose payload WOULD have caller-supplied fields
   * stripped throws before the driver is touched, instead of committing the
   * remainder. Nothing is written: not the stripped fields, not the fields that
   * would have survived. The strip passes still run — that is how the engine
   * learns WHICH fields would go — but their result is discarded.
   *
   * It covers every drop `onFieldsDropped` reports — coverage DERIVED from the
   * reported set, never an enumeration frozen at #5126. Today that is all three
   * `DroppedFieldsEvent['reason']` arms: static `readonly: true` (#2948, which
   * only runs for non-system callers), a TRUE `readonlyWhen` predicate (#3042,
   * which runs for every API-BOUNDARY caller, `isSystem` included — but judges
   * only the keys the caller supplied at engine entry, so a value a
   * `beforeUpdate` hook derived or overwrote is never stripped, #9107), and the
   * `primary_key`
   * strip (#6437) — plus, since #5503, the implicitly-readonly runtime-owned
   * strip, which reports under the same `'readonly'` arm rather than adding one
   * (see the INSERT section below). Covering only the static arm would leave a
   * trusted caller — the very caller this option exists for, one that already
   * passes `{ context: { isSystem: true } }` and is therefore exempt from the
   * static strip — still losing `readonlyWhen` fields in silence, which is the
   * bug this option exists to abolish.
   *
   * ⚠️ **A new `reason` therefore adds a new REFUSAL, by construction** — the
   * price of the derived coverage above, paid deliberately when `primary_key`
   * landed (#6437). Since that change a `strictReadonlyWrites` caller that puts
   * a ruled-non-key value in `data.id` is REFUSED, where it previously got a
   * success whose `id` had been silently dropped. That is this option's whole
   * promise ("don't half-apply my payload") reaching one more strip class, not
   * a second policy: the strip already ran and already discarded the key.
   *
   * The flag's NAME is narrower than its coverage and stays that way on
   * purpose — renaming a shipped in-process option is a separate acceptance
   * decision, and the coverage sentence above, not the name, is the contract.
   * The refusal error names what actually happened PER REASON, so a
   * `primary_key` refusal never claims the field was read-only.
   *
   * `onFieldsDropped` does NOT fire on a write this option refuses. The two are
   * alternative outputs of one seam, not a sequence: `DroppedFieldsEvent` is
   * documented as "fields dropped and the write completed without them", and
   * under strict the write does not complete. Quiet-and-observable or loud —
   * pick one per call.
   *
   * ## The error
   *
   * `ERR_READONLY_FIELD_REJECTED` (registered in `ERROR_CODE_LEDGER` under
   * `@objectstack/objectql`), carrying the FULL list of rejected fields
   * accumulated across every strip pass the operation runs — one error naming
   * everything, so a caller fixes its payload once instead of one round-trip
   * per field. Engines identify it by `code`, not `instanceof`, so it survives
   * package boundaries. The code is stable across reasons deliberately: a
   * caller catches ONE code and reads `drops` for the per-reason breakdown,
   * which is why adding a reason does not add an error code (#6437).
   *
   * ## In-process only — what a REMOTE caller observes
   *
   * This is an IN-PROCESS option, exactly like its neighbour above, and for the
   * same structural reason: `WriteObservabilityOptions` is not the serializable
   * `EngineUpdateOptionsSchema` bag, so nothing here crosses the RPC / Virtual
   * Data Engine boundary or is reachable from a REST/wire body. A remote caller
   * cannot set it, and gets NEITHER behaviour: its write is stripped and
   * committed, silently from its side, exactly as before this option existed —
   * a 200 whose read-only columns kept their stored values. That is deliberate
   * (#5126 ruling): putting the flag in the serializable bag would let any
   * client toggle write-refusal on a security-adjacent path. Widening strict to
   * the wire is a SEPARATE decision, not a side effect of this one.
   *
   * ## INSERT — refuses runtime-owned values (since #5503)
   *
   * Until #5503 this paragraph declared the option inert on insert — true
   * when written (#5126 predates the runtime-owned strip), false since. At
   * this seam insert remains deliberately exempt from the two AUTHOR-DECLARED
   * strips (#3413: an in-process create may seed a `readonly: true` field's
   * initial value, and `readonlyWhen` cannot lock anything on a create at
   * all), but the implicitly-readonly runtime-owned strip #5503 added runs on
   * insert too — and it is exactly the one strict refuses. An insert whose
   * payload carries a runtime-owned value (`RUNTIME_OWNED_FIELD_TYPES`, today
   * `autonumber` — a caller-supplied record number) behaves like update at
   * this seam: with this option `true` it throws `ReadonlyFieldRejectedError`
   * (`operation: 'insert'`) and nothing is written; without it the value is
   * stripped, the write completes, and `onFieldsDropped` fires with
   * `reason: 'readonly'`. The engine-level writers exempt from that strip —
   * and therefore never refused — are the two the error message itself names:
   * `isSystem`, and the `preserveAudit` historical import reinstating legacy
   * record numbers (#3493). Layer note: that exemption pair is THIS
   * in-process seam's. The DataProtocol ingress enforces its own
   * author-declared `readonly` policy on create (#3043), where
   * `preserveAudit` is UPDATE-only (#6640) — see `FieldSchema.readonly`;
   * nothing here widens or narrows it. `ReadonlyFieldRejectedError`'s own doc
   * records the same contract from the error's side: "Thrown by
   * `engine.update` — and, since #5503, by `engine.insert`".
   */
  strictReadonlyWrites?: boolean;
}

/**
 * A datasource *definition* as the engine retains it (ADR-0015) — the
 * declarative facts a datasource states about itself, never a live driver
 * connection (that is `registerDriver`).
 *
 * Named because two members share it: {@link IDataEngine.registerDatasourceDef}
 * writes it and {@link IDataEngine.listDatasourceDefs} reads it back. Two
 * inline copies of one shape on one contract is the de-facto-contract drift
 * the #11833 sweep exists to retire — and a name here is what lets a consumer
 * type its sweep without re-declaring a consumer-local structural element
 * type, the same pattern one member over. Naming follows the contract's
 * existing `Engine*` family (`EngineQueryOptions`, `EngineUpdateOptions`, …);
 * `@objectstack/objectql` exports its own structurally-identical
 * `DatasourceDef`, which this contract cannot import (dependency direction),
 * so the distinct name keeps the two declarations tellable apart until the
 * engine converges on this one.
 *
 * The keys are a deliberate SUBSET of the spec's authored datasource surface
 * (`ExternalDatasourceSettingsSchema` in `data/datasource.zod.ts`) — the
 * engine retains only what it has a use for. ⛔ Not a mirror of the authored
 * block and not a place to grow one: `validation` and `queryTimeoutMs` are
 * absent because nothing in the engine reads them ([#12805] mirrors engine
 * reality, it does not invent surface).
 */
export interface EngineDatasourceDef {
  name: string;
  schemaMode?: string;
  external?: {
    /** Datasource-wide write gate — ADR-0015 §5.3 Gate 3. */
    allowWrites?: boolean;
    /**
     * Reference into the secrets store, never an inline credential
     * (`credentialsRef` on `ExternalDatasourceSettingsSchema`). Valid in
     * EVERY `schemaMode` — it is the one `external` key a managed datasource
     * may carry (#8153) — so a reader sweeping for handles must not filter
     * by schema mode. [#12805] The engine has accepted and retained this key
     * since #12758; this contract is the catch-up, not a widening beyond
     * engine reality.
     */
    credentialsRef?: string;
  };
}

/**
 * IDataEngine - Standard Data Engine Interface
 *
 * Abstract interface for data persistence capabilities.
 * Following the Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete database implementations.
 *
 * All query methods use standard QueryAST parameter names
 * (where/fields/orderBy/limit/offset/expand) to eliminate mechanical translation
 * between the Engine and Driver layers.
 *
 * Aligned with 'src/data/data-engine.zod.ts' in @objectstack/spec.
 */

export interface IDataEngine {
  /**
   * Read methods take the execution context in a TRAILING options argument,
   * the same position the write methods take theirs.
   *
   * [#4251] Declared because the implementation and its callers were already
   * there: ObjectQL's `find`/`findOne`/`count`/`aggregate` have taken this
   * argument since the read/write split was unified, and its own doc explains
   * why — the same `{ context }` object was correct as the 3rd arg to `insert`
   * but SILENTLY DROPPED as the 3rd arg to `find`, so an intended `isSystem`
   * bypass just vanished (control-plane reads coming back empty once
   * org-scoping hooks landed). The contract kept only `query.context`, so
   * every caller passing the trailing one — the current-user endpoints'
   * permission-set loader among them — had to reach it through `any`, which is
   * exactly the erasure this issue is sweeping. `query.context` remains
   * supported; when both are given, `options.context` wins.
   *
   * [#6300] `query` is the AUTHOR state (`z.input`, ADR-0122): a key with a
   * declared `.default()` — `orderBy[].order` — is optional to write, exactly
   * as on `count`'s `EngineCountOptions`. #6083 had pinned these two methods
   * back to the parsed state because the engine built its `QueryAST` by spread
   * without filling any default; the engine now runs each defaulting node
   * through its own schema before the AST is built (ObjectQL's
   * `fillQueryAstDefaults`), so `find(obj, { orderBy: [{ field: 'updated_at' }] })`
   * compiles and sorts ascending — the schema's declared default, and the same
   * value every driver already coalesced a missing `order` to.
   */
  find(objectName: string, query?: EngineQueryOptions, options?: BaseEngineOptions): Promise<any[]>;
  /**
   * Read the ONE record the query selects, or `null`.
   *
   * The query MUST say which record it wants: a `where` (or a `search` that
   * expands to one), or an `orderBy` meaning "the FIRST record in this order".
   * A query with neither is REJECTED (#4419) — `findOne` reads a single row, so
   * an empty predicate does not return nothing, it returns the object's first
   * row: a real, plausible-looking record unrelated to the request, which no
   * caller's `if (!row)` can catch. When any row genuinely will do, that is
   * `find(objectName, { limit: 1 })`, which says so at the call site.
   *
   * No ordering is imposed when the caller supplies none: `findOne` promises
   * *a* matching record, never a position in a sequence (#4363).
   *
   * [#6300] `query` is the author state (`z.input`), same as `find` above.
   */
  findOne(objectName: string, query?: EngineQueryOptions, options?: BaseEngineOptions): Promise<any>;
  insert(objectName: string, data: any | any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<any>;
  update(objectName: string, data: any, options?: EngineUpdateOptions & WriteObservabilityOptions): Promise<any>;
  delete(objectName: string, options?: EngineDeleteOptions): Promise<any>;
  count(objectName: string, query?: EngineCountOptions, options?: BaseEngineOptions): Promise<number>;
  aggregate(objectName: string, query: EngineAggregateOptions, options?: BaseEngineOptions): Promise<any[]>;

  /**
   * Vector Search (AI/RAG)
   */
  vectorFind?(objectName: string, vector: number[], options?: { where?: any, limit?: number, fields?: string[], threshold?: number }): Promise<any[]>;

  // `batch?` was declared here until ADR-0119 D3 (#4618) retired it. It was
  // never implemented by any engine, never called by anyone, and its three-word
  // doc comment specified nothing about partial failure, ordering, cross-object
  // references or rollback scope — the questions a batch API exists to answer.
  // A declared capability that cannot be exercised is ADR-0049's enforce-or-
  // remove target. What it claimed is now covered by members that are real:
  // `IObjectQLEngine.transaction(cb)` in-process, the metadata protocol's
  // `batchData` with `options.atomic` for a batch over one object, and
  // `POST {basePath}/batch` on the wire.

  /**
   * Execute raw command (Escape hatch)
   */
  execute?(command: any, options?: Record<string, any>): Promise<any>;

  /**
   * Driver registry — optional: only engines that own a named-driver registry.
   *
   * [#4251] Declared because the binding is evidenced, not to fill the table:
   * ObjectQL implements both (`packages/objectql/src/engine.ts`, the `drivers`
   * map), and DefaultDatasourcePlugin reads them to re-register the default
   * driver as a `driver.<name>` kernel service — the surface `os migrate`
   * (SQL_DRIVER_SERVICES) and serve's storage detection locate drivers
   * through. Optional because `IDataEngine` is also satisfied by engines with
   * no such registry (test fakes, remote/virtual engines); callers probe with
   * `?.`, which is what the runtime caller already did while typed `any`.
   */
  getDefaultDriverName?(): string | undefined;
  getDriverByName?(name: string): IDataDriver | undefined;

  /**
   * Introspect a datasource's live remote schema (ADR-0015): resolve the
   * driver registered under `datasource` and delegate to its
   * `introspectSchema()` capability. Implementations throw when the
   * datasource has no registered driver, or its driver does not offer
   * introspection — absence is answered with a named error, never a guess.
   *
   * Optional for the same reason as the registry pair above: only an engine
   * that owns a named-driver registry can resolve a datasource to a driver;
   * test fakes and remote/virtual engines simply omit it.
   *
   * [#11493] Declared because the binding is evidenced, exactly as [#4251]
   * asks: ObjectQL has implemented this method since ADR-0015, and the
   * external-datasource service reads it off the `'data'` service — while
   * this contract stayed silent, that consumer had to re-declare a private
   * structural engine type to recover the spec return type from the
   * implementation's untyped `Promise`. The return type is the spec's ONE
   * introspection shape ({@link IntrospectedSchema}), the same contract
   * #11381 put on `DatasourceDriverHandle.introspectSchema` — this member
   * extends that ruling (#11123's population/channel argument) to the
   * engine-registration seam, so both roads into the runtime read now meet
   * a compiler.
   */
  introspectDatasource?(datasource: string): Promise<IntrospectedSchema>;

  /**
   * Which datasource is `objectName` BOUND to — the EFFECTIVE one, resolved
   * through the same five steps the engine's own query routing walks
   * (explicit `object.datasource` → `datasourceMapping` rules → the ADR-0057
   * §3.6 lifecycle split → the owning package's `defaultDatasource` → the
   * deployment default), computed as a NAME and without taking a driver.
   *
   * `undefined` means nothing binds the object anywhere and it rides the
   * deployment's default driver — deliberately NOT the string `'default'`,
   * because `ObjectSchema.datasource` carries `.default('default')` and in
   * the engine that value means "no explicit binding, keep looking", never
   * "the primary DB" (#5288: a diagnostic built on the declared value named
   * a database the rows were not in). Callers that need the default driver's
   * name have {@link getDefaultDriverName}. Implementations never throw here:
   * a binding whose datasource has no registered driver is still this
   * object's datasource, and a naming probe must be able to report the name
   * that is broken.
   *
   * Optional for the same reason as the registry pair above: only an engine
   * that owns datasource routing can answer; test fakes and remote/virtual
   * engines simply omit it, and callers probe with `?.`.
   *
   * [#12248] Declared under the [#4251]/[#11493] evidence bar, per the
   * 2026-08-25 maintainer ruling on #11833 (fork 1, option A): ObjectQL has
   * implemented this method since #5288, and `service-analytics` reads it
   * off the data engine for datasource-capability tiering — while this
   * contract stayed silent, that consumer had to carry a private structural
   * `DataEngineLike` re-declaration to name the member at all.
   */
  resolveEffectiveDatasource?(objectName: string): string | undefined;

  /**
   * Resolve the storage driver backing `objectName` — the public face of the
   * engine's internal per-operation driver routing, answering `undefined`
   * (instead of throwing) when no driver is available.
   *
   * Optional exactly like {@link getDriverByName}: only an engine that owns a
   * named-driver registry can resolve an object to a driver.
   *
   * [#12248] Declared under the same evidence bar, per the same #11833
   * ruling (fork 1, option A): ObjectQL implements it, and three packages
   * already consume it cross-package through structural re-declarations or
   * `any` — `service-analytics` (ADR-0053 temporal storage-form coercion,
   * via a local `getDriverForObject?` returning a picked temporal surface),
   * `metadata-protocol` (the partial-index probe's driver-ownership read),
   * and `plugin-audit` (schema-sync driver probe). Consumers that need only
   * a slice of the driver keep narrowing the RETURN at the call site
   * (`Pick<IDataDriver, …>` admits the full contract value); what this
   * member ends is each of them re-inventing the MEMBER.
   */
  getDriverForObject?(objectName: string): IDataDriver | undefined;

  /**
   * Datasource lifecycle writes — optional: only engines that own a
   * datasource registry (the same population as the driver-registry pair
   * above). All three are consumed today by `service-datasource`'s
   * `DatasourceConnectionService`, which drives the engine through the
   * `'data'` slot and, until [#12248], could name these members only through
   * its consumer-local structural `ConnectionEngineLike` re-declaration —
   * the third such type the #11833 sweep measured (#12010), adjudicated onto
   * the contract by the 2026-08-25 ruling's item 4.
   *
   * Register a datasource *definition* (ADR-0015) — the declarative
   * {@link EngineDatasourceDef}: `schemaMode` + `external.allowWrites` so the
   * engine's write gate can enforce external-datasource ownership, and
   * `external.credentialsRef` so {@link listDatasourceDefs} can hand a
   * credentials sweep the handle a code-declared datasource holds ([#12805]
   * — the engine accepts and retains the reference since #12758; before
   * this catch-up a caller typed against THIS contract was refused with
   * TS2353 for a value the runtime keeps). Distinct from registering a live
   * driver connection. Safe to call repeatedly; last write wins.
   */
  registerDatasourceDef?(def: EngineDatasourceDef): void;

  /**
   * Every datasource DEFINITION this engine holds — from BOTH entry routes,
   * {@link registerDatasourceDef} and the engine's package-manifest install
   * path. The read-back of the same registry the member above writes, so it
   * shares that member's population ("only engines that own a datasource
   * registry answer") and its optionality — the fourth member of the
   * lifecycle family the 2026-08-25 ruling's item 4 adjudicated onto this
   * contract, declared under the same [#4251]/[#11493] evidence bar
   * ([#12805]: implemented on `ObjectQL` since #12758, and the #12804
   * `sys_secret` reference sweep is the consumer that otherwise must name
   * the engine class concretely or re-declare the member structurally).
   *
   * Exists because a datasource declared IN CODE never reaches the metadata
   * store, so a `sys_secret` reference sweep reading `sys_metadata` alone
   * cannot see the handle such a datasource holds at
   * `external.credentialsRef` and must be handed the list by the engine.
   * Implementations answer UNFILTERED (every definition, whatever its
   * `schemaMode`, with or without a reference — `credentialsRef` is valid on
   * a managed datasource too, #8153) and answer FRESH copies: a reader must
   * not be able to reach through this accessor and mutate the write gate's
   * own input.
   */
  listDatasourceDefs?(): EngineDatasourceDef[];

  /**
   * Record that a **declared** datasource has no live driver, and why
   * (framework#3828): `'blocked'` — the host's connect policy refused it;
   * `'failed'` — the connect failed while the operator opted into a degraded
   * boot. Without this record the engine cannot distinguish either case from
   * a misspelled datasource name, and answers all three with the same bare
   * "is not registered". `publicDetail` is the only part safe to echo to an
   * end user; the operator-facing cause stays in logs and the admin surface.
   */
  markDatasourceUnavailable?(info: {
    name: string;
    kind: 'blocked' | 'failed';
    publicDetail?: string;
  }): void;

  /**
   * Drop a previous {@link markDatasourceUnavailable} record (successful
   * (re)connect, or pool removal).
   */
  clearDatasourceUnavailable?(name: string): void;
}
