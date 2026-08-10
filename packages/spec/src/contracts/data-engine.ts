// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  BaseEngineOptions,
  EngineQueryOptionsParsed,
  DataEngineInsertOptions,
  EngineUpdateOptions,
  EngineDeleteOptions,
  EngineAggregateOptions,
  EngineCountOptions,
  DroppedFieldsEvent,
} from '../data/index.js';
import type { IDataDriver } from './data-driver.js';

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
   * which runs for every caller, `isSystem` included), and the `primary_key`
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
   */
  find(objectName: string, query?: EngineQueryOptionsParsed, options?: BaseEngineOptions): Promise<any[]>;
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
   */
  findOne(objectName: string, query?: EngineQueryOptionsParsed, options?: BaseEngineOptions): Promise<any>;
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
}
