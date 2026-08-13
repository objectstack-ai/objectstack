// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { AsyncLocalStorage } from 'node:async_hooks';
import { QueryAST, QueryInput, HookContext, ServiceObject } from '@objectstack/spec/data';
// [#6300] The defaulting node schema `fillQueryAstDefaults` runs author input
// through — the declared `.default()` stays in `packages/spec`, the engine
// only invokes it.
import { SortNodeSchema } from '@objectstack/spec/data';
import {
  EngineQueryOptions,
  DataEngineInsertOptions,
  EngineUpdateOptions,
  EngineDeleteOptions,
  EngineAggregateOptions,
  EngineCountOptions,
  RPC_QUERY_ALIAS_SLOTS,
  foldQueryAliasSlots,
  QUERY_CURSOR_REMOVED,
  QUERY_DISTINCT_REMOVED,
  type QueryAliasSlot,
  type DroppedFieldsEvent
} from '@objectstack/spec/data';
import type { WriteObservabilityOptions } from '@objectstack/spec/contracts';
// The validate-only result IS the protocol's response shape (#6037): the
// engine is what `metadata-protocol.validateData` returns, so letting the two
// drift would put a translation layer between a verdict and its contract.
import type { ValidateDataIssue, ValidateDataResponse } from '@objectstack/spec/api';
import { parseAutonumberFormat, renderAutonumber, resolveAutonumberFormat, readAutonumberCounter, missingFieldValues, isTenancyDisabled, FILE_REFERENCE_TYPES, REFERENCE_VALUE_TYPES, referenceTargetOf, isFileIdToken, RAW_FILE_VALUES_CONTEXT_KEY, isCurrentUserDefaultToken, isNowDefaultToken } from '@objectstack/spec/data';
// [#5158] Door 2's lowering sink — the SAME pair the protocol face (Door 1)
// runs, so `FilterArray` has exactly one lowering in the product.
import {
  isFilterAST,
  parseFilterAST,
  normalizeFilterComparandTypes,
  VALID_AST_OPERATORS,
} from '@objectstack/spec/data';
// [#5574] D6, executable. The ceiling and the refusal message live in
// `packages/spec/src/data/bulk-write-hook-conformance.ts` so BOTH phases and
// both verbs enforce one definition; the engine raises, the contract decides.
import { MAX_BULK_PER_ROW_HOOK_ROWS, resolveBulkPerRowHookBudget } from '@objectstack/spec/data';
import { assertListComparandShapes, assertFilterIsMaterializable } from './filter-comparand-shape.js';
// Seek pagination for the walks that must read EVERY row — the autonumber seed
// scan is one (#6249). Shared with `summary-backfill` rather than re-rolled:
// the cursor merge is the part that is easy to get subtly wrong.
import { keysetWalk, type KeysetPageQuery } from '@objectstack/types';
import {
  DATA_MIGRATION_FLAG_OBJECT,
  FILE_REFERENCES_MIGRATION_ID,
  VALUE_SHAPES_MIGRATION_ID,
  isDataMigrationFlagVerified,
  renderOperationMessage,
  objectLabelKey,
} from '@objectstack/spec/system';
import { ExecutionContext, ExecutionContextSchema } from '@objectstack/spec/kernel';
import type { FlowFunctionEffect } from '@objectstack/spec/automation';
// Imported from spec directly rather than through `@objectstack/core`'s
// re-export block: that block is labelled backward-compatibility, and this
// contract is new (#5945).
import type { IScopedContext, IScopedObjectRepository } from '@objectstack/spec/contracts';
import {
  IDataDriver,
  IDataEngine,
  type IObjectQLEngine,
  type EngineTransactionInfo,
  type EngineTransactionOptions,
  Logger,
  createLogger,
  withTransientRetry,
  type RetryOptions,
  filterTokenContextFrom,
  resolveFilterTokens,
  // [#7867] The repo's ONE single-record 404 (#4435/#5138). It lives in
  // `@objectstack/core` precisely so this file can reach it: ADR-0076 D2's
  // boundary ratchet forbids the `/core` entry closure — engine.ts included —
  // from importing `@objectstack/metadata-protocol`, where it was written.
  recordNotFoundError,
} from '@objectstack/core';
import { SummaryRecomputeError, type SummaryRecomputeFailure } from './summary-errors.js';
import { CrossDatasourceTransactionWriteError, TransactionUnsupportedError } from './transaction-errors.js';
import {
  aggregateSummaryValue,
  summaryEmptySetValue,
  type SummaryDescriptor,
} from './summary-aggregate.js';
import { ReadonlyFieldRejectedError } from './readonly-strict-errors.js';
import { HookTargetRebindError } from './hook-target-rebind-errors.js';
import {
  DriverConnectError,
  DatasourceUnavailableError,
  emitDegradedBootBanner,
  type DriverConnectFailure,
  type DriverHealth,
  type DatasourceUnavailableInfo,
  type DatasourceUnavailableKind,
} from './driver-connect-errors.js';
import { resolveAllowDriverConnectFailure } from '@objectstack/types';
// [#5979] The ONE shared "which read failure is benign?" predicate (#4825
// family). Imported from the leaf `/errors` subpath — which exists precisely
// so a cross-package consumer gets the 40-line predicate without the manager,
// the loaders or the YAML/filesystem machinery behind `@objectstack/metadata`'s
// root entry. Asking the shared predicate rather than hand-rolling a
// `code === '42P01'` test here is load-bearing, not stylistic: a second
// vocabulary of "benign driver error" is the exact debt that module exists to
// retire, and `check:durability-log-level` exempts only this declared name.
import { isMissingTableError } from '@objectstack/metadata/errors';
// [#6806] The ONE shared "is this driver error a unique-constraint violation?"
// predicate, and its narrower companion "which column conflicted" (#6250 /
// #6544, both landed in `@objectstack/types`). The engine's autonumber
// collision resync asks exactly the two questions those exports were named to
// answer, so it asks THEM — hand-writing a fifth dialect word-list inside the
// engine is the consumer-side tolerant parsing PD #12 forbids and precedent
// #5841 retired.
import { isUniqueViolationError, uniqueViolationColumn } from '@objectstack/types';

/**
 * Per-row outcome of {@link ObjectQL.insertMany} (framework#3172). One entry
 * per input row, in input order: written rows carry the after-hook record,
 * failed rows carry the per-row error (validation / autonumber / encryption).
 */
export type InsertManyRowOutcome =
  | { ok: true; record: any }
  | { ok: false; error: unknown };
import { CoreServiceName, StorageNameMapping } from '@objectstack/spec/system';
import { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import {
  BulkDataEventSchema,
  DataEventSchema,
  type BulkDataEvent,
  type DataEvent,
} from '@objectstack/spec/api';
import type { ICryptoProvider, CryptoHandle } from '@objectstack/spec/contracts';
import {
  collectSecretFields,
  collectMaskedReadFields,
  collectInternalReadFields,
  collectCredentialFields,
  makeSecretRef,
  parseSecretRef,
  isSecretRef,
  SECRET_MASK,
} from './secret-fields.js';
import { pluralToSingular, ExternalWriteForbiddenError } from '@objectstack/spec/shared';
import { SchemaRegistry, computeFQN } from './registry.js';
import { expandSearchToFilter } from './search-filter.js';
import { isSearchCompanionRequested, stripSearchCompanion } from './search-companion.js';
import { ExpressionEngine } from '@objectstack/formula';
import type { Expression } from '@objectstack/spec';
import { isAggregatedViewContainer, expandViewContainer } from '@objectstack/spec';
import { bindHooksToEngine } from './hook-binder.js';
import { validateRecord, normalizeMultiValueFields, coerceBooleanFields, ValidationError, buildFieldError, resolveFieldLabel, valueShapePostureSetByEnv, mediaPostureSetByEnv, isScannableValueShapeField, valueShapeStrictEffective, mediaStrictEffective } from './validation/record-validator.js';
import type { AdmittedValueShapeViolation, AdmittedValueShapeViolationSink } from './validation/record-validator.js';
import { evaluateValidationRules, needsPriorRecord, stripReadonlyWhenFields, stripReadonlyWhenFieldsMulti, hasReadonlyWhenInPayload, hasParentScopedReadonlyWhenInPayload, hasParentScopedRequiredWhen, stripReadonlyFields, stripRuntimeOwnedFields } from './validation/rule-validator.js';
import { resolveMasterDetailRelation } from './master-detail.js';
// [#6457] The master-detail header a `parent`-scoped predicate reads is made
// total over the MASTER's declared fields before it leaves this engine — the
// same helper every other server seam materialises with (#1871/#4649/#4953).
import { materializeDeclaredFields } from './declared-fields.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';
import {
  resolveEngineDeleteDispatch,
  ENGINE_DELETE_REJECT_MESSAGE,
  type EngineDeleteDispatchInput,
} from './engine-delete-dispatch.js';
import {
  resolveEngineUpdateDispatch,
  ENGINE_UPDATE_REJECT_MESSAGE,
  type EngineUpdateDispatchData,
  type EngineUpdateDispatchInput,
} from './engine-update-dispatch.js';
import { applyHaving } from './having-filter.js';
import {
  auditDanglingReferences,
  type AuditableObject,
  type DanglingReferenceAuditOptions,
  type DanglingReferenceReport,
} from './integrity/dangling-reference-audit.js';

/**
 * One read of a `sys_migration` flag row: the verdict, plus whether the ledger
 * could actually be consulted to reach it (#4769). Both negatives keep the
 * gate closed; only the conclusive one is worth remembering.
 */
interface MigrationFlagRead {
  verified: boolean;
  conclusive: boolean;
}

/**
 * What this boot has ADMITTED against one ADR-0104 migration's contract —
 * the counterexample that forbids attesting it (#4769). `count` is a lower
 * bound (every admitted value is counted, but a revocation records the total
 * known at the moment it wrote); `first` is the one an operator is shown,
 * because a prescription needs a place to start, not a census.
 */
export interface AdmittedValueShapeViolationTally {
  count: number;
  first: { object: string; field: string; type: string; detail: string };
}

/**
 * The lifecycle events the engine actually dispatches via `triggerHooks`. This
 * is the single source of truth for what a hook can subscribe to — kept in
 * lockstep with the `triggerHooks(...)` call sites and with `HookEvent` in the
 * spec. `beforeFind`/`afterFind` cover both `find` and `findOne`; the write
 * events cover both single-id and bulk (`multi: true`) writes (#3195). A hook
 * subscribing to anything outside this set would silently never fire, so
 * `registerHook` warns rather than accepting it blindly.
 *
 * ## WHEN `after*` fires, relative to the commit (#7477)
 *
 * `afterInsert`/`afterUpdate`/`afterDelete` are dispatched INSIDE the unit of
 * work, before the enclosing transaction (if any) commits. The declared
 * meaning is **"the write has been requested and will happen unless this unit
 * of work is undone"** — not "the write happened". This is the ruled semantics
 * (#7477, 2026-08-11), not an accident of the current call sites: an `after*`
 * dispatch is deliberately NOT deferred to commit, because deferring it would
 * push a handler's own `ctx.api` writes outside the transaction the write ran
 * in, and an in-engine audit hook depends on landing inside it.
 *
 * Three ordinary paths open such a unit around the dispatch:
 *   - a by-id {@link ObjectQL.delete} whose cascade is `'atomic'` — each
 *     dependent's own `afterDelete` fires inside the wrap the parent opened,
 *     and the parent's row removal can still refuse afterwards (#7413). The
 *     PARENT's `afterDelete` is outside that wrap by construction, so it is
 *     unaffected; the cascaded CHILDREN's are not;
 *   - `runAtomicBatch` in `@objectstack/metadata-protocol` —
 *     `batchData`/`deleteManyData` with `atomic: true` runs every member's
 *     `after*` inside one transaction that aborts on the first failure
 *     (#4620);
 *   - any caller that opened `transaction()` / `ctx.api.transaction()` around
 *     the write itself.
 *
 * A rollback on any of those leaves a hook that fired for a row that still
 * exists. Effects routed back through this engine roll back with it and are
 * therefore safe; effects that leave the engine — webhooks, notifications,
 * external index updates, file deletion — are the HANDLER's responsibility to
 * make rollback-tolerant (idempotent and reconcilable, or re-checked against
 * the row by a worker rather than trusted from the event alone). Documented
 * for authors on `HookEvent` in `@objectstack/spec/data` and in
 * `content/docs/automation/hooks.mdx`.
 */
const DISPATCHABLE_HOOK_EVENTS: ReadonlySet<string> = new Set([
  'beforeFind', 'afterFind',
  'beforeInsert', 'afterInsert',
  'beforeUpdate', 'afterUpdate',
  'beforeDelete', 'afterDelete',
]);

/**
 * [#4346] The alias slots the ENGINE option bags still admit, cut from the
 * spec's own table (#3795) so the engine never re-declares a mapping.
 *
 * The deprecated `DataEngine{Query,Update,Delete,Count,Aggregate}Options`
 * contracts declare `filter` on every read AND write method, but only `find`
 * folded it — `findOne`/`count`/`update`/`delete`/`aggregate` passed the bag
 * through with `where === undefined`, which every driver reads as "no
 * predicate": a caller filtering with `{ filter }` silently matched EVERY row
 * (an over-grant on the reads, an unbounded write on `update`/`delete`).
 *
 * `where` is the slot every method folds; `limit` additionally applies to the
 * find-shaped bags, which declare `top` (OData) as its alias. The other four
 * pairs in the table are RPC/wire spellings folded at parse by
 * `RpcQueryOptionsSchema` / the protocol normalizer — their values need shape
 * lowering (`sort` records, `populate` lists) that belongs to those layers, so
 * the engine deliberately does not fold them.
 */
const ENGINE_WHERE_SLOTS: readonly QueryAliasSlot[] =
  RPC_QUERY_ALIAS_SLOTS.filter((slot) => slot.canonical === 'where');
const ENGINE_QUERY_SLOTS: readonly QueryAliasSlot[] =
  RPC_QUERY_ALIAS_SLOTS.filter((slot) => slot.canonical === 'where' || slot.canonical === 'limit');

/**
 * [#4371] The slots the engine does NOT fold — the wire-only pairs
 * (`select`→`fields`, `sort`→`orderBy`, `skip`→`offset`, `populate`→`expand`),
 * derived as the complement of {@link ENGINE_QUERY_SLOTS} so a seventh pair
 * added to the spec table lands on exactly one side of the split.
 *
 * Their values need shape lowering (`sort`'s `{field: 'asc'}` record form,
 * `populate`'s name list) that belongs to the RPC/protocol layers, so folding
 * here would re-implement the lowering per reader — the #3795 condition. But a
 * DIRECT engine call never crosses those layers: the alias key used to ride
 * the AST verbatim, drivers read only the canonical name, and the parameter
 * was silently dropped — three shipped "latest N in arbitrary order" bugs
 * (#4370) plus the engine's own `seedAutonumber`. Declared ≠ enforced
 * (AGENTS.md PD #10): the find-shaped entry points now REJECT these spellings,
 * naming the canonical key and shape, so the mistake throws at the call site
 * instead of degrading the result.
 *
 * Deliberately NOT applied to the where-only methods
 * (`update`/`delete`/`count`/`aggregate`): their contracts honour no
 * sort/projection/pagination at all, so "pass `orderBy` instead" would
 * redirect the caller to a key those methods silently ignore too. Unknown-key
 * enforcement for those bags is #4371's option (2), scoped separately.
 */
const ENGINE_WIRE_ONLY_SLOTS: readonly QueryAliasSlot[] =
  RPC_QUERY_ALIAS_SLOTS.filter((slot) => !ENGINE_QUERY_SLOTS.includes(slot));

/**
 * Canonical shape each wire-only slot's value must be rewritten into — quoted
 * by the rejection so the error carries the full migration, not just the key
 * rename (the value shapes differ; that is WHY the engine cannot fold them).
 */
const WIRE_ONLY_CANONICAL_SHAPES: Record<string, string> = {
  fields: "a string[] of field names",
  orderBy: "SortNode[]: [{ field, order: 'asc' | 'desc' }]",
  offset: 'a number of rows to skip',
  expand: 'a record of { relationName: QueryAST }',
};

/**
 * [#4371 option 2] The driver-option keys the engine forwards verbatim: on
 * `find`/`findOne`/`update`/`delete` the option bag IS the base of the driver
 * options (`buildDriverOptions(object, ctx, bag)`), which is how a caller's
 * explicit `tenantId` / `bypassTenantAudit` reaches the driver (pinned in
 * engine.test.ts). `count`/`aggregate` never forward the bag, so these keys
 * are deliberately NOT legal there — accepting them would be the exact
 * silently-ignored contract this gate exists to close.
 */
const ENGINE_DRIVER_PASSTHROUGH_KEYS = [
  'transaction', 'tenantId', 'tenantIds', 'timezone', 'bypassTenantAudit', 'preserveAudit',
] as const;

/**
 * [#4371 option 2] Per-method legal option keys. An option bag key outside
 * the method's set is REJECTED at the entry point: the engine executes none
 * of them, so the call would otherwise succeed with the option silently
 * ignored — the `declared ≠ enforced` shape (PD #10) one layer below the
 * wire-alias rejection above.
 *
 * Sources, in order: the method's `Engine*OptionsSchema` declared keys (minus
 * the `retiredKey` tombstones `cursor`/`distinct`, which get their tombstone
 * quoted instead of a generic rejection — the schema keeps them ONLY to carry
 * that message, and this runtime path never parses); `searchFields` (read by
 * `find` at the `$search` expansion, sent by the protocol layer);
 * `onFieldsDropped` and `strictReadonlyWrites` (`WriteObservabilityOptions` —
 * contract-declared, deliberately outside the serializable Zod schema: the
 * first because a function is unrepresentable in JSON Schema, the second
 * because #5126 ruled that a write-refusal switch must not be settable from a
 * wire body); and the driver pass-through keys above. The alias spellings
 * (`filter`/`top`) are folded and deleted BEFORE this check runs, so they
 * never reach it.
 *
 * A drift pin in engine-unknown-option.test.ts asserts each set equals its
 * schema's shape (minus tombstones, plus the documented extras) so a key
 * added to the spec cannot be silently rejected here.
 */
const ENGINE_FIND_OPTION_KEYS: ReadonlySet<string> = new Set([
  'context', 'where', 'fields', 'orderBy', 'limit', 'offset',
  'search', 'searchFields', 'expand',
  ...ENGINE_DRIVER_PASSTHROUGH_KEYS,
]);
const ENGINE_UPDATE_OPTION_KEYS: ReadonlySet<string> = new Set([
  'context', 'where', 'upsert', 'multi', 'returning', 'onFieldsDropped', 'strictReadonlyWrites',
  ...ENGINE_DRIVER_PASSTHROUGH_KEYS,
]);
const ENGINE_DELETE_OPTION_KEYS: ReadonlySet<string> = new Set([
  'context', 'where', 'multi',
  ...ENGINE_DRIVER_PASSTHROUGH_KEYS,
]);
const ENGINE_COUNT_OPTION_KEYS: ReadonlySet<string> = new Set(['context', 'where']);
const ENGINE_AGGREGATE_OPTION_KEYS: ReadonlySet<string> = new Set([
  'context', 'where', 'groupBy', 'aggregations', 'having', 'timezone',
]);

/**
 * Rows per page for the autonumber seeding scan (#6249). This is a PAGE size,
 * not a cap: the walk pages until the scope is exhausted. The number is the one
 * the old single-shot `limit: 5000` used, kept so the per-read cost against a
 * driver is unchanged — what changed is that reaching it no longer ends the
 * scan and truncates the max.
 */
const AUTONUMBER_SEED_PAGE_SIZE = 5000;

/**
 * How many times one insert may re-seed and re-issue after a unique-constraint
 * collision on an engine-issued autonumber (#6806) before it refuses.
 *
 * Bounded on purpose. The FIRST re-issue is the one that matters: the collision
 * proves the in-memory counter sits below the store's real max, and the re-seed
 * that follows reads that max back, so attempt 2 is issued from the truth. A
 * further collision means another writer took the number in between — real
 * concurrency, which more spinning does not resolve (each attempt costs a full
 * scope scan). Two spare attempts absorb a burst; past that the write fails
 * loudly rather than looping against a live competitor.
 */
const AUTONUMBER_COLLISION_ATTEMPTS = 3;

/**
 * One autonumber the ENGINE issued on a row, paired with the counter it came
 * from (#6806). Only engine-issued values are listed: a value an exempt writer
 * supplied is the caller's, and a collision on it is the caller's to see.
 */
interface IssuedAutonumber {
  /** Field the value was written to. */
  readonly field: string;
  /** `object.field.<scope>` key in {@link ObjectQL.autonumberCounters}. */
  readonly counterKey: string;
}

/**
 * Read the counter out of ONE stored autonumber value, under #6468's anchoring
 * rules. Shared by the seeding scan and by the adopt-on-exempt-write resync
 * (#6806) so both readings can never drift apart — a divergence here is a
 * duplicate record number, which is the harm the whole family is about.
 *
 * The ANCHORED reading itself is NOT this package's (#6560): it is the inverse
 * of `renderAutonumber`'s composition, so it lives beside it as spec's
 * {@link readAutonumberCounter}, which the SQL driver's `scanMaxNumericTail`
 * calls over the same two strings. This function adds only the piece the two
 * sides genuinely do not share:
 *
 *   - **Either `prefix` or `suffix` declared ⇒ ANCHORED**: spec answers, and its
 *     TSDoc carries the rationale (counter after the prefix, suffix stripped
 *     when it matches and never required to match, out-of-scope values read as
 *     `undefined`).
 *   - **Neither declared ⇒ UNANCHORED**: this engine's own legacy reading — the
 *     LAST digit run of the whole value — kept byte-for-byte by PR #6553. The
 *     SQL driver's legacy reading of the same case is deliberately DIFFERENT (it
 *     concatenates every digit), which is exactly why spec refuses to answer for
 *     an unanchored slot instead of picking one of the two.
 *
 * # The unanchored arm is IMPLEMENTATION DETAIL, outside the declared contract (#7287)
 *
 * Spec's refusal above is no longer just an absence of agreement: the #7287
 * ruling (2026-08-10, 「宣告边界」) DECLARES that a stored value carrying
 * non-digit content on an unanchored format is out of contract for counter
 * readback, and that `readAutonumberCounter`'s `undefined` for that slot is the
 * contract rather than a gap. The boundary and its rationale live in that
 * function's TSDoc in `packages/spec/src/data/autonumber-format.ts`; the pins
 * are `packages/spec/src/data/autonumber-unanchored-boundary.test.ts`.
 *
 * So the last-digit-run reading below is THIS ENGINE'S behavior, not a promise
 * the platform makes. On the inputs the contract admits — pure-digit values,
 * which is what `renderAutonumber` emits for an unanchored format — it answers
 * the same number the SQL driver does. On mixed-content values it may answer
 * differently (`'SO-2024-0007'` → `7` here, `20240007` there), and that
 * difference is out of contract on both sides, not a defect on either.
 *
 * Consequently the ruling moves nothing here: neither this reading nor the
 * driver's was hoisted into the shared helper, precisely because doing so would
 * move live behavior on the other side over record numbers already issued.
 *
 * The unanchored branch uses the linear `/\d+/g` — a backtracking lookahead here
 * is a polynomial-ReDoS sink on stored values full of zeros (CodeQL
 * js/polynomial-redos).
 */
function readStoredAutonumberCounter(value: string, prefix: string, suffix: string): number | undefined {
  if (prefix !== '' || suffix !== '') return readAutonumberCounter(value, prefix, suffix);
  const runs = value.match(/\d+/g);
  const digits = runs ? runs[runs.length - 1] : undefined;
  if (!digits) return undefined;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Tombstoned option keys: rejected with the spec's own removal notice. */
const ENGINE_RETIRED_OPTION_MESSAGES: Record<string, string> = {
  cursor: QUERY_CURSOR_REMOVED,
  distinct: QUERY_DISTINCT_REMOVED,
};

/**
 * The per-method legal key sets, exported for the drift pin ONLY
 * (engine-unknown-option.test.ts asserts each set against its schema's shape,
 * so a key added to the spec cannot be silently rejected here). Not a public
 * API surface — consumers pass options, they do not read this table.
 */
export const ENGINE_OPTION_KEY_SETS: Readonly<Record<string, ReadonlySet<string>>> = {
  find: ENGINE_FIND_OPTION_KEYS,
  findOne: ENGINE_FIND_OPTION_KEYS,
  update: ENGINE_UPDATE_OPTION_KEYS,
  delete: ENGINE_DELETE_OPTION_KEYS,
  count: ENGINE_COUNT_OPTION_KEYS,
  aggregate: ENGINE_AGGREGATE_OPTION_KEYS,
};

/**
 * Reject option-bag keys the engine does not execute (#4371 option 2).
 *
 * Runs AFTER `foldEngineOptionAliases`, so alias spellings are already folded
 * away (or thrown on). `null`-valued keys pass — a `null` is a withdrawal
 * carrying no intent a drop could lose, same rule as the fold. Retired keys
 * (`cursor`/`distinct`) quote their tombstone. Everything else gets the legal
 * key set, so the error carries the fix.
 */
function rejectUnknownEngineOptions(
  object: string,
  operation: string,
  bag: object | undefined,
  legal: ReadonlySet<string>,
): void {
  if (!bag) return;
  let unknown: string[] | undefined;
  for (const [key, value] of Object.entries(bag)) {
    if (value == null || legal.has(key)) continue;
    (unknown ??= []).push(key);
  }
  if (!unknown) return;
  const details = unknown.map((k) =>
    ENGINE_RETIRED_OPTION_MESSAGES[k] ? `'${k}': ${ENGINE_RETIRED_OPTION_MESSAGES[k]}` : `'${k}'`,
  );
  throw new Error(
    `${operation}('${object}') does not recognise option${unknown.length > 1 ? 's' : ''} ` +
    `${details.join('; ')}. The engine executes none of ${unknown.length > 1 ? 'them' : 'it'}, ` +
    `so the call would succeed with the option silently ignored (#4371). ` +
    `Legal keys for ${operation}: ${[...legal].sort().join(', ')}.`,
  );
}

/**
 * Fold the deprecated alias spellings of an engine option bag into their
 * canonical QueryAST keys, under the #3795/#4181 rule: an alias alone moves to
 * the canonical key, redundant identical spellings collapse, DIFFERENT values
 * for one slot are irreconcilable and throw (picking a winner IS the silent
 * drop), and an explicit `null` alias is a withdrawal.
 *
 * `rejectSlots` ({@link ENGINE_WIRE_ONLY_SLOTS}) names the slots whose alias
 * spellings the engine can neither fold nor honour: a non-null value under one
 * throws, quoting the canonical key and shape (#4371). `null` stays a
 * withdrawal here too — it carries no intent a drop could lose — and rides
 * through for drivers to ignore, exactly as before.
 *
 * Returns the SAME reference when no alias spelling is present (the common
 * path allocates nothing — `withResolvedWhere` discipline); otherwise folds a
 * shallow copy, because the bag belongs to the caller and may be reused (view
 * metadata, flow node config).
 */
function foldEngineOptionAliases<T extends object | undefined>(
  object: string,
  operation: string,
  bag: T,
  slots: readonly QueryAliasSlot[],
  rejectSlots?: readonly QueryAliasSlot[],
): T {
  if (!bag) return bag;
  if (rejectSlots) {
    const refused = rejectSlots.flatMap((slot) =>
      slot.aliases
        .filter((alias) => (bag as Record<string, unknown>)[alias] != null)
        .map((alias) => ({ alias, canonical: slot.canonical })),
    );
    if (refused.length > 0) {
      throw new Error(
        `${operation}('${object}') does not accept ` +
        `${refused.map((r) => `'${r.alias}'`).join(', ')}: ` +
        refused
          .map(
            (r) =>
              `'${r.alias}' is a wire spelling of '${r.canonical}', folded by the RPC/protocol ` +
              `layer — a direct engine call bypasses that fold, so the value would be silently ` +
              `dropped, not applied. Pass '${r.canonical}' ` +
              `(${WIRE_ONLY_CANONICAL_SHAPES[r.canonical] ?? 'the canonical QueryAST shape'}) instead.`,
          )
          .join(' '),
      );
    }
  }
  if (!slots.some((slot) => slot.aliases.some((alias) => alias in bag))) return bag;
  const folded: Record<string, unknown> = { ...bag };
  foldQueryAliasSlots(folded, slots, (conflict) => {
    throw new Error(
      `Conflicting options on ${operation}('${object}'): ` +
      `${conflict.spellings.map((s) => `'${s}'`).join(', ')} are spellings of the same ` +
      `parameter (canonical '${conflict.canonical}') and were given different values. ` +
      'Send exactly one.',
    );
  });
  return folded as T;
}

/**
 * **Door 2** — lower an arriving {@link FilterArray} on `where` to the
 * `FilterCondition` the AST actually declares (#5158, maintainer ruling C).
 *
 * `FilterArray` — `['stage', '=', 'won']`, `['and', […], […]]`, `[[…], […]]` —
 * is authoring sugar, and since #5285 the spec says so in as many words: it is
 * declared INPUT-ONLY (`data/filter.zod.ts`), and `QuerySchema.where` is a
 * `FilterCondition` that deliberately excludes it. There were two doors into
 * the runtime and only one of them read the contract that way:
 *
 * - **Door 1**, the protocol/HTTP face (`metadata-protocol` `protocol.ts`),
 *   has always run `isFilterAST` → `parseFilterAST` and answered `400
 *   INVALID_FILTER` for an array it could not lower. Nothing array-shaped
 *   survives it.
 * - **Door 2**, a direct in-process engine call, passed the array through
 *   verbatim, and four drivers grew a second filter compiler to meet it —
 *   an INFIX dialect (`[condA, 'or', condB]`) that the spec never declared,
 *   that `parseFilterAST` cannot even express, and that cloud's
 *   `RemoteTransport.buildWhereSQL` refuses outright. Same query, two
 *   answers, decided by whether the caller went over the wire.
 *
 * This is that second door, closed: every entry point lowers through the SAME
 * `parseFilterAST` sink Door 1 uses, so a driver sees exactly one filter
 * dialect regardless of how the query arrived. The authoring ergonomics are
 * untouched — `FilterBuilder` tuples, React block `filters` props and the five
 * showcase call sites all still work, because lowering is what those shapes
 * were always for.
 *
 * Three arrivals, three answers, matching Door 1 exactly:
 *
 * 1. `[]` — "no filter". The key is DELETED rather than lowered, which is the
 *    same reading every layer already gives it (`parseFilterAST([])` is
 *    `undefined`; `SqlDriver.applyFilters` returns early). Note this is now
 *    visible to `findOne`'s #4419 guard, which is the point: `findOne({where:
 *    []})` used to slip past the guard as "an expression tree the driver will
 *    interpret" and come back with an ARBITRARY row.
 * 2. A well-formed AST — lowered. `isFilterAST` gates first so the operator
 *    vocabulary is checked before `parseFilterAST`'s lenient `$${op}` fallback
 *    can turn a misspelling into a `$sounds_like` condition nothing executes.
 * 3. Anything else array-shaped — REFUSED, loudly, at the call site. Today
 *    those reach a driver and are refused there (#3948) with driver-internal
 *    wording, or — for the infix dialect — silently compiled by a second
 *    implementation. Failing here names the caller's own value.
 *
 * Returns the SAME reference when `where` is not an array (the overwhelmingly
 * common path allocates nothing), otherwise a shallow copy: the bag belongs to
 * the caller and may be reused (view metadata, flow node config).
 */
function lowerWhereFilterArray<T extends object | undefined>(
  object: string,
  operation: string,
  bag: T,
  schema?: unknown,
): T {
  if (!bag) return bag;
  const where = (bag as Record<string, unknown>).where;
  if (!Array.isArray(where)) {
    // [#5869] Door 1 lands HERE, not below: the protocol face runs its own
    // `isFilterAST` → `parseFilterAST` and hands the engine an already-lowered
    // `FilterCondition` object, so a gate on the array branch alone would miss
    // every query that arrived over the wire. The comparand check is the same
    // one either way — it reads the lowered condition, which is what both doors
    // produce.
    assertListComparandShapes(object, operation, where);
    // [#8296] The unmaterializable-FIELD door, on the same object form. It sits
    // beside the shape gate because the two answer different questions about
    // the same predicate — "can this comparand run" vs "is there a column to
    // run it against" — and because this seam is the one place EVERY
    // caller-supplied `where` passes through, whichever verb it arrived by.
    assertFilterIsMaterializable(object, operation, schema, where);
    // [#7872] The comparand-type door, on the OBJECT form. `parseFilterAST`
    // runs the same walk on everything it lowers or passes through, but
    // NEITHER door routes an object-form filter through it — Door 1 gates on
    // `isFilterAST` first and Door 2 is this very branch — so without this
    // call the dominant form would bypass the door entirely (the #7956
    // divergence matrix arrived through it). Shape gate first (#5869 keeps
    // its pinned wording for the list-operator shapes), type door second;
    // the walk is copy-on-write, so the common path allocates nothing and a
    // narrowed bigint replaces the bag rather than editing the caller's.
    const normalized = normalizeFilterComparandTypes(where, `${operation}('${object}')`);
    if (normalized !== where) {
      return { ...(bag as Record<string, unknown>), where: normalized } as T;
    }
    return bag;
  }

  const lowered: Record<string, unknown> = { ...bag };

  // (1) `[]` is "no filter", not a failed filter.
  if (where.length === 0) {
    delete lowered.where;
    return lowered as T;
  }

  // (3) Not a shape `parseFilterAST` can express.
  if (!isFilterAST(where)) {
    throw new Error(
      `${operation}('${object}') received a 'where' array that is not a filter: ` +
      `${JSON.stringify(where)}. A filter array is a comparison [field, operator, value], ` +
      `a logical node ["and"|"or", ...conditions], or a list of those — it is INPUT-ONLY ` +
      `sugar (spec 'FilterArray'), lowered to a FilterCondition here before any driver sees ` +
      `it (#5158). This value cannot be lowered, and an unapplied filter would have returned ` +
      `the UNFILTERED result set. Recognised operators: ` +
      `${[...VALID_AST_OPERATORS].sort().join(', ')}. Infix joins ([condA, "or", condB]) are ` +
      `NOT one of the shapes — write the prefix form ["or", condA, condB].`,
    );
  }

  // (2) The declared path.
  const condition = parseFilterAST(where);
  if (condition === undefined) {
    // Unreachable by construction — `isFilterAST` accepted the shape, so
    // `parseFilterAST` has a lowering for it. Loud rather than silent because
    // the failure mode of the two spec functions disagreeing is a dropped
    // predicate, i.e. every row (#3948).
    throw new Error(
      `${operation}('${object}'): filter array ${JSON.stringify(where)} passed isFilterAST() ` +
      `but parseFilterAST() lowered it to nothing. Refusing rather than running the query ` +
      `unfiltered (#5158).`,
    );
  }
  // [#5869] Door 2's half of the same check. `isFilterAST` vouched for the
  // OPERATOR and `parseFilterAST` lowered it, but neither looks at the
  // comparand — `['status', 'not_in', 'done']` lowers to `{status: {$nin:
  // 'done'}}` and a scalar `$nin` is what reached the driver as a 500.
  assertListComparandShapes(object, operation, condition);
  // [#8296] Same door as the object branch above, on the LOWERED condition —
  // the array sugar (`[['is_open','=',true]]`) names fields too, and a gate on
  // one branch would answer one mistake two ways depending on the spelling.
  assertFilterIsMaterializable(object, operation, schema, condition);
  lowered.where = condition;
  return lowered as T;
}

interface FormulaPlanEntry { name: string; expression: Expression; }

function planFormulaProjection(
  schema: any,
  requestedFields: string[] | undefined
): { plan: FormulaPlanEntry[]; projected?: string[] } {
  if (!schema?.fields) return { plan: [] };
  const allFieldNames = Object.keys(schema.fields);
  // When no explicit projection, evaluate every formula field on the schema —
  // matches REST default of "return everything". Explicit projection still
  // honours the caller's selection.
  const targets = (Array.isArray(requestedFields) && requestedFields.length > 0)
    ? requestedFields
    : allFieldNames;
  const plan: FormulaPlanEntry[] = [];
  const projected = new Set<string>();
  for (const f of targets) {
    const def = (schema.fields as any)[f];
    if (def?.type === 'formula' && def.expression) {
      // Normalize string-shorthand → Expression envelope (M9 transition).
      const expr: Expression = typeof def.expression === 'string'
        ? { dialect: 'cel', source: def.expression }
        : def.expression;
      plan.push({ name: f, expression: expr });
      // Pre-compile to surface syntax errors at planning stage rather than
      // per-row eval. Dependency discovery (which fields the formula reads)
      // is no longer used — CEL uses dynamic projection via `record.<field>`.
      ExpressionEngine.compile(expr);
    } else if (Array.isArray(requestedFields) && requestedFields.length > 0) {
      projected.add(f);
    }
  }
  if (plan.length === 0) return { plan: [] };
  // For formulas: project all schema fields so CEL `record.<field>` lookups
  // see complete data. Static dependency analysis on AST is M9.7 work.
  if (Array.isArray(requestedFields) && requestedFields.length > 0) {
    if (!projected.has('id')) projected.add('id');
    for (const fname of allFieldNames) {
      // Skip formula fields themselves — they are virtual and not
      // projectable by the underlying driver. Without this guard the
      // SQL driver emits `SELECT response_rate ...` which fails as
      // "no such column" and the driver returns [] (silently).
      const fdef = (schema.fields as any)[fname];
      if (fdef?.type === 'formula') continue;
      projected.add(fname);
    }
    return { plan, projected: Array.from(projected) };
  }
  // Implicit/full projection — leave projected undefined so the driver
  // returns its default columns (typically *).
  return { plan };
}

/**
 * [#7095] ORDER BY a field whose value is computed on read — refused HERE, on
 * the engine's own public boundary, and no longer only at the REST ingress.
 *
 * #6994 closed this at `assertSortFieldsExist` (`400 INVALID_SORT`), which
 * covers everything reaching `findData`: the REST list route,
 * `POST /data/:object/query`, the export route and the RPC dispatcher. It could
 * not cover a caller that reaches {@link ObjectQL.find} / {@link
 * ObjectQL.findOne} DIRECTLY, and that half was not hypothetical — measured on
 * this file's base (real `ObjectQL`, a driver that really sorts):
 *
 * ```
 * engine.find(o, { orderBy: [{ field: <formula>, order: 'asc'  }] }) -> C A E B D  (insertion order)
 * engine.find(o, { orderBy: [{ field: <formula>, order: 'desc' }] }) -> C A E B D  (byte-identical)
 * ```
 *
 * `asc` and `desc` coming back identical is what makes it a DROPPED sort rather
 * than a coincidence, and the rows carrying the very values they were asked to
 * be ordered by is what makes it invisible. `planFormulaProjection` above drops
 * the virtual NAME from the projection (it must — the driver has no column and
 * `SELECT sort_key` fails as "no such column"); nothing did the equivalent for
 * the sort, so the ORDER BY reached the driver, found nothing, and the #3821
 * unknown-column backstop returned the rows unordered under a success.
 *
 * WHY A REFUSAL AND NOT AN OBSERVABLE DROP (the card offered both): ruled
 * 2026-08-10 on #7095 — an ORDER BY the engine cannot apply is a 4xx with
 * guidance prose, never a silent drop, the same direction as the analytics
 * dataset refusal envelope and #6924's sort-hint prescription. The engine's
 * documented internal-caller tolerance (`assertProjectionFieldsExist`'s
 * docblock) was to survive only behind a pinned internal path and only if a
 * measured internal call site relied on it; the #7095 sweep found none, so
 * there is no internal path and no option to opt back into the drop. That sweep
 * is recorded in the changeset — if you are adding a caller that WANTS the old
 * behaviour, the answer is a stored field, not a flag.
 *
 * ⚠️ Post-hoc sorting after {@link applyFormulaPlan} evaluates the formulas is
 * a TRAP, written down here because it looks like the generous fix: `driver.find`
 * has already applied `limit`/`offset`, so re-sorting reorders an ARBITRARY
 * PAGE. It would pass every small-result-set test and be wrong the moment
 * pagination is involved.
 *
 * SCOPE — deliberately the third verdict only, on the SORT axis. `unknown` and
 * `dotted` SORT names are NOT judged here: the ingress gate's precedence is
 * `unknown` > `dotted` > unmaterializable (#4226 / #4256 / #6994), and widening
 * this door to those two is a separate posture change on two more axes, not a
 * free extension of this one — so a dotted SORT path keeps reaching the driver
 * exactly as before, including one whose head is a formula field. On the
 * PROJECTION axis the engine still tolerates an unknown PLAIN name by design
 * (the `SELECT *` tolerance a few lines below, kept by the #7589 ruling), but
 * a dotted PROJECTION entry is refused since #7589 —
 * {@link assertProjectionHasNoDottedPaths}, directly below.
 *
 * A registry-less host (`schema` undefined) returns early, exactly as the
 * ingress gate returns early when `resolveQueryFields` cannot answer: a door
 * that cannot see the field map must not invent a verdict about it.
 */
function assertOrderByIsMaterializable(
  object: string,
  operation: 'find' | 'findOne',
  schema: any,
  orderBy: unknown,
): void {
  if (!Array.isArray(orderBy) || orderBy.length === 0) return;
  if (!schema?.fields) return;
  const names = orderBy.map((node) =>
    typeof node === 'string' ? node : String((node as any)?.field ?? ''));
  const unmaterialized = names.filter((f) =>
    f !== '' && !f.includes('.') && (schema.fields as any)[f]?.type === 'formula');
  if (unmaterialized.length === 0) return;
  const first = unmaterialized[0];
  const type = String((schema.fields as any)[first]?.type);
  const err: any = new Error(
    `ObjectQL.${operation}('${object}') sorts by '${first}', a ${type} field on '${object}' — `
    + `a ${type} value is computed on read, so no driver materialises a column to order by`
    + (unmaterialized.length > 1 ? ` (also: ${unmaterialized.slice(1).join(', ')})` : '')
    + '. It was not applied, and an unapplied sort returns the rows in an arbitrary order — '
    + "which 'limit'/'offset' then slices into an arbitrary page."
    // Deliberately the SAME remedy, in the same words, as the ingress door's
    // formula and dotted refusals (#6994, #6924) and #6673's SEARCH-axis
    // correction. One vocabulary across the doors: a caller refused at the REST
    // boundary and a caller refused here must not be sent two different ways.
    // `query-expression-conformance.test.ts` pins the three wordings as EQUAL
    // rather than each separately, because separate wordings is exactly how
    // #4256 and #6673 drifted apart in the first place.
    + ` Denormalise the value onto '${object}' (a stored field, written when the`
    + ' source changes) and sort by that. A formula field is virtual: with no'
    + ' column behind it the ORDER BY reaches the driver, finds nothing, and is'
    + ' dropped — the arbitrary order this refusal replaces.',
  );
  // `INVALID_SORT`, not a new code, and 400 rather than 500: the ingress door
  // reasoned that one condition — "this sort was not applied as written" —
  // keeps ONE wire code however the caller reached it, and a caller reaching
  // the engine directly has not stopped being that condition. A host that
  // surfaces engine errors over HTTP therefore answers the same envelope on
  // both doors instead of turning the direct path into an unhandled 500.
  err.status = 400;
  err.code = 'INVALID_SORT';
  err.field = first;
  err.fields = unmaterialized;
  err.object = object;
  throw err;
}

/**
 * [#7589] A DOTTED projection entry — refused on the engine's own public
 * boundary, the second half of #7532's ingress refusal.
 *
 * #7532 (PR #7588) closed this at `assertProjectionFieldsExist`
 * (`400 INVALID_FIELD`), which covers everything reaching `findData`: the REST
 * list route, `POST /data/:object/query`, the export route and the RPC
 * dispatcher. It could not cover a caller that reaches {@link ObjectQL.find} /
 * {@link ObjectQL.findOne} DIRECTLY — and that half was measured, not assumed
 * (#7589): a flow-authored `get_record` node's `fields: ['name','account.name']`
 * parses (`GetRecordConfigSchema` restricts nothing), travels verbatim into
 * `data.find(...)`, cleared the head-only filter below on its head segment
 * (`account` IS a field), and reached the driver as a projection column — where
 * SQL renders `"account"."name"` against a table that was never joined, the DB
 * answers `no such column`, and the #3821 recovery ladder retries `select('*')`.
 * The caller asked to narrow and silently received EVERY field, byte-identical
 * to no projection at all. A saved report's `query.fields` reaches this the
 * same way (`plugin-reports` forwards it verbatim), as does every hook and
 * internal caller.
 *
 * WHY A REFUSAL: ruled 2026-08-12 on #7589 (adopting the drivers seat's
 * Option B) — a dotted entry the engine cannot resolve is refused loudly at
 * this one site, covering every caller that reaches the engine. The head-only
 * check this replaces was justified by a comment claiming the engine resolves
 * relationship paths "via populate"; #7601 measured that NO populate step
 * exists — the comment was the last place in the repo asserting dotted-path
 * resolution does (after PR #7617) — so what is removed here is not a working
 * feature but a path to widening, kept alive by a false premise. Both the typo
 * (`titel.name`) and the genuine traversal intent (`account.name`) eat this
 * refusal: nothing resolves either, they are not separable at this door, and
 * the alternative is the over-return above (#5918's precedent, same as the
 * ingress ruling).
 *
 * SCOPE — the dotted leg ONLY. The unknown-PLAIN-column tolerance a few lines
 * below each call site is explicitly KEPT (same #7589 ruling): an unknown
 * plain column is simply absent from each row, the "no records exist" failure
 * that tolerance prevents is real, and it backstops registry-less hosts. A
 * dotted path differs in kind — it is a projection no driver can structurally
 * apply, and answering it with every column points away from both FLS and data
 * minimisation. The two facts get two verdicts.
 *
 * A registry-less host (`schema.fields` undefined) returns early, exactly as
 * the ingress gate returns early when `resolveQueryFields` cannot answer: a
 * door that cannot see the field map must not invent a verdict about it. For
 * that host the driver-side #3821 ladder remains the documented backstop
 * (deliberately untouched — a driver-side carve-out is ruled measured-need
 * only).
 *
 * The wording deliberately shares its core sentence and remedies with the
 * ingress door's dotted refusal — one vocabulary across the doors, so a caller
 * refused at the REST boundary and a caller refused here are not sent two
 * different ways. Duplicated rather than imported because `metadata-protocol`
 * is assembled FROM an engine, so the engine cannot import from it without
 * inverting the layering; the agreement pin in
 * `query-expression-conformance.test.ts` is what keeps the duplication honest
 * (same mechanism as the sort axis' three-door remedy pin).
 */
function assertProjectionHasNoDottedPaths(
  object: string,
  operation: 'find' | 'findOne',
  schema: any,
  fields: unknown,
): void {
  if (!Array.isArray(fields) || fields.length === 0) return;
  if (!schema?.fields) return;
  const dotted = fields.filter(
    (f): f is string => typeof f === 'string' && f.includes('.'));
  if (dotted.length === 0) return;
  const first = dotted[0];
  const head = first.split('.')[0];
  const headDef: any = (schema.fields as any)[head];
  const crossesRelation = headDef != null && REFERENCE_VALUE_TYPES.has(headDef.type);
  const err: any = new Error(
    (crossesRelation
      ? `ObjectQL.${operation}('${object}') projects '${first}', which follows the relationship `
        + `'${head}' into another object — 'fields' reaches only columns of '${object}' itself`
      : `ObjectQL.${operation}('${object}') projects '${first}', a dotted path — 'fields' reaches `
        + `only whole columns of '${object}', not values inside them`)
    + (dotted.length > 1 ? ` (also: ${dotted.slice(1).join(', ')})` : '')
    + '. No driver resolves it: the path reaches the driver as a column name, matches no '
    + 'column, and the projection falls back to EVERY field — a narrower request answered '
    + 'with a wider response.'
    + (crossesRelation
      ? ` Read the related record with 'expand' (\`{ expand: { ${head}: { object: '<target>', `
        + `fields: ['<column>'] } } }\` to choose its columns), or denormalise the value onto `
        + `'${object}' (a stored field, written when the source changes) and name that.`
      : ` Name the whole column ('${head}') and read into its value in the caller.`),
  );
  // `INVALID_FIELD`, not a new code, and 400 rather than 500 — the same
  // reasoning `assertOrderByIsMaterializable` records for `INVALID_SORT`: one
  // condition ("this projection was not applied as written") keeps ONE wire
  // code however the caller reached it, so a host surfacing engine errors over
  // HTTP answers the same envelope on both doors.
  err.status = 400;
  err.code = 'INVALID_FIELD';
  err.field = first;
  err.fields = dotted;
  err.object = object;
  throw err;
}

/**
 * Evaluate formula virtual fields against the raw rows a driver handed back —
 * the read path (`find` / `findOne`) and, since #5504, the write path's
 * response hydration.
 *
 * The eval context is built ONCE per call and reused for every row × every
 * formula field, and that is where this function's determinism comes from: one
 * `now`, so a `now()`/`today()` formula cannot drift mid-operation, plus
 * `os.user` / `os.org` resolved from the execution context (so a computed field
 * can reference the caller, e.g. `os.user.id`). Previously this passed only
 * `{ record }`, so `now()`/`today()` ran against live wall-clock and user/org
 * were unreachable.
 *
 * That context has the same SHAPE as `applyFieldDefaults`' — the same keys, so
 * one expression vocabulary serves `formula` and `defaultValue` alike — but NOT
 * the same `now` value, and the two are sourced independently on purpose
 * (#5699):
 *  - `applyFieldDefaults` is handed the insert's `nowSnapshot`, so every
 *    defaulted field of every row in one write carries the same PRE-write
 *    instant;
 *  - this function reads the clock itself, once per call, because a formula is
 *    evaluated when a record is MATERIALIZED — at read time, and on the write
 *    response — not at the moment that row's defaults were resolved.
 *
 * So inside a single `insert` a `NOW()` default and a `now()` formula observe
 * two instants one driver round-trip apart (sub-millisecond in practice; across
 * a second/day boundary they can land on different calendar days). Making them
 * share one instant would hand the write path a determinism guarantee the read
 * path cannot have — a semantic decision, not a tidy-up, argued in #5699. Until
 * it is decided this function takes NO snapshot parameter: the zero-caller
 * `nowSnapshot?: Date` it carried from birth was retired there, in the same
 * enforce-or-remove reflex ADR-0049 applies to spec properties, because a
 * dormant parameter reads as a live one and anyone reasoning from it concludes
 * the two sides already share an instant.
 *
 * (ADR-0053 Phase 2 will additionally thread `timezone` here once
 * `ExecutionContext.timezone` exists — see #1980; this change is independent
 * of timezone.)
 */
function applyFormulaPlan(
  plan: FormulaPlanEntry[],
  records: any[],
  execCtx?: ExecutionContext,
): void {
  if (!plan.length) return;
  const now = new Date();
  const timezone = execCtx?.timezone;
  const user = execCtx?.userId ? { id: String(execCtx.userId), positions: execCtx?.positions ?? [] } : undefined;
  const org = execCtx?.tenantId ? { id: String(execCtx.tenantId) } : undefined;
  for (const rec of records) {
    if (rec == null) continue;
    for (const fp of plan) {
      const r = ExpressionEngine.evaluate(fp.expression, { now, timezone, user, org, record: rec });
      rec[fp.name] = r.ok ? r.value : null;
    }
  }
}

/**
 * Hydrate `formula` virtual fields onto the records a WRITE hands back (#5504).
 *
 * `applyFormulaPlan` used to hang off the read path only — `find` and `findOne`
 * — so `POST /data/:object` and `PATCH /data/:object/:id` answered with the
 * stored document, in which a formula field is not merely `null` but ABSENT
 * (formulas are virtual: no driver ever returns a column for one). The very
 * next `GET` of that same row carried every one of them, so a caller that
 * rendered the create response — the natural thing to do, the response calls
 * itself `record` — got a blank title on every object whose `nameField` points
 * at a formula, and could not tell "not configured" from "not evaluated".
 * Read-your-write, restored: the write response is now the same materialization
 * a read produces.
 *
 * Deliberately the SAME plan builder and the SAME evaluation the read path uses
 * — one formula semantic, not a write-path dialect:
 *  - `planFormulaProjection(schema, undefined)` is exactly find's no-projection
 *    branch: every formula field the schema declares, and no `projected`
 *    rewrite (a write returns whole rows, so there is nothing to project).
 *    It also carries the perf threshold unchanged — an object declaring no
 *    formula yields an empty plan and `applyFormulaPlan` returns at its first
 *    line, so a write on an ordinary object pays a field-name loop and nothing
 *    else.
 *  - the execution context is threaded exactly as find threads it, so `os.user`
 *    / `os.org` resolve identically on both sides. Widening what that context
 *    carries is #1979's work and stays out of here.
 *
 * Evaluates against the record the driver returned (a full row: `create` uses
 * `RETURNING *`, `update` re-reads), so no extra round-trip is needed and no
 * formula sees a partial record. Mutates in place, like the read path.
 *
 * Non-record entries (a `null` readback when the write moved the row out of the
 * caller's scope; the affected-row COUNT a predicate update resolves to) are
 * skipped rather than special-cased at each call site — the primitive would
 * otherwise take a property assignment, which throws under ES module strict
 * mode.
 */
function hydrateWriteFormulas(
  schema: any,
  results: unknown[],
  execCtx?: ExecutionContext,
): void {
  const records = results.filter(
    (r): r is Record<string, unknown> => r != null && typeof r === 'object',
  );
  if (records.length === 0) return;
  const { plan } = planFormulaProjection(schema, undefined);
  if (plan.length === 0) return;
  applyFormulaPlan(plan, records, execCtx);
}

/**
 * A hook body, as registered through {@link ObjectQL.registerHook} or bound
 * from metadata by `bindHooksToEngine`.
 *
 * ## `after*` handlers run INSIDE the unit of work (#7477)
 *
 * An `afterInsert` / `afterUpdate` / `afterDelete` handler is dispatched
 * before the enclosing transaction commits. The guarantee it may rely on is
 * **"the write has been requested and will happen unless this unit of work is
 * undone"** — not "the write happened": a later refusal in the same unit rolls
 * the row back after this handler has already run. See
 * {@link DISPATCHABLE_HOOK_EVENTS} for the full statement and for the paths
 * that open such a unit; a handler whose side effects leave the engine is the
 * one that has to tolerate it.
 */
export type HookHandler = (context: HookContext) => Promise<void> | void;

/**
 * Per-object hook entry with priority support
 */
export interface HookEntry {
  handler: HookHandler;
  object?: string | string[];  // undefined = global hook
  /**
   * [#5928] Object name(s) SUBTRACTED from whatever `object` admits — the
   * negative half of a registration's scope. Absent = subtract nothing.
   *
   * `object` alone can only say "these objects" (plus the `'*'` full set), and
   * the two are interchangeable only over a CLOSED universe. This one is open:
   * `applyObjectRegistryMutation` registers objects into a running engine on a
   * successful `/meta` PUT, emitting no event a plugin could subscribe to, so a
   * registrant that enumerated the complement of its skip list would keep a
   * frozen list and silently stop covering every object registered after boot.
   * For the audit plugin that is a compliance regression, and a silent one.
   *
   * Read only through {@link hookMatchesObject} — never re-implemented at a
   * call site (see that function's note on the one-semantic rule).
   */
  excludeObjects?: string | string[];
  priority: number;
  packageId?: string;
  /**
   * Original metadata-form `Hook` definition this entry was bound from
   * (when registered via `bindHooksToEngine`). Pure code-paths that call
   * `engine.registerHook` directly leave this undefined.
   */
  meta?: any;
  /** Hook `name` from metadata; used for diagnostics & deduplication. */
  hookName?: string;
}

/** `object` / `excludeObjects` in either accepted spelling → a name list. */
function hookTargetList(target: string | string[] | undefined): string[] {
  if (target === undefined) return [];
  return Array.isArray(target) ? target : [target];
}

/**
 * [#5928] Does `entry` cover `objectName`? **The** answer — one function, both
 * consumers.
 *
 * ## Why this is a function and not two `if`s
 *
 * `triggerHooks` (dispatch) and `hasHooksFor` (the #5038 / #5284 bulk-write
 * gate that decides whether the matched row set is worth reading) used to carry
 * this rule as two hand-written copies of one semantic. `hasHooksFor`'s own
 * comment named the hazard that arrangement carries: a gate LOOSER than the
 * dispatch only wastes a query, but a gate TIGHTER than the dispatch silently
 * drops hooks that were going to fire. Two copies stay in agreement only for as
 * long as everyone who edits one remembers the other, and #5928 adds a second
 * dimension to the rule — exactly the edit that would have desynchronised them.
 * So the copies are gone: both consumers call this, and the property test in
 * `hook-exclude-objects.test.ts` pins the implication (`dispatched ⇒ gate open`)
 * over the full allow × exclude matrix rather than trusting the structure.
 *
 * ## The semantic
 *
 * `matches = allowMatches && !excludeMatches`, where an absent `object` admits
 * everything (global) and `'*'` in `object` does the same explicitly.
 * `excludeObjects` names are matched literally — `'*'` is refused at
 * registration, so it can never reach this as a subtract-everything wildcard.
 *
 * The allow half keeps the TRUTHINESS test both copies used verbatim, rather
 * than the `!== undefined` that reads more precisely. They differ on exactly one
 * input, `object: ''`, which reads here as a GLOBAL hook (falsy ⇒ no filter).
 * That read is deliberately UNCHANGED, and #6573 is why: flipping it would turn
 * a hook firing on everything into one firing on nothing, silently — the same
 * class of defect pointing the other way. The shape is closed at the
 * registration door instead ({@link assertValidHookObject}), so no live entry
 * can carry `''` and this branch is unreachable for it in practice. It stays
 * because this function is also called directly on hand-built entries, and
 * because a matcher should describe one rule, not re-litigate the door's.
 */
export function hookMatchesObject(
  entry: Pick<HookEntry, 'object' | 'excludeObjects'>,
  objectName: string,
): boolean {
  // Allow half: absent = global; otherwise the wildcard or a literal name.
  if (entry.object) {
    const targets = hookTargetList(entry.object);
    if (!targets.includes('*') && !targets.includes(objectName)) return false;
  }
  // Subtract half: any literal hit removes the object from the admitted set.
  if (entry.excludeObjects) {
    if (hookTargetList(entry.excludeObjects).includes(objectName)) return false;
  }
  return true;
}

/**
 * [#5928] Registration-time refusal for the `excludeObjects` face, following
 * the sister ruling on empty hook targets (#4281 / #4001, ADR-0078 "no silently
 * inert declaration").
 *
 * Two shapes are refused, both statically decidable at the call site:
 *
 *  - **`''` / `['']`** (or any blank member) — no object is named `''`, so the
 *    entry subtracts nothing while reading as though it subtracts something.
 *    Inert, and inert in the direction that quietly keeps a hook firing on
 *    objects its author believed they had excluded.
 *  - **`'*'` anywhere in the list** — subtracting the full set from any allow
 *    set leaves the empty set: a hook that can never fire, registered
 *    "successfully". That is ADR-0078's silently-inert declaration exactly, and
 *    the same never-fire shape #4281 refused when `['']` produced it from the
 *    other side.
 *
 * `[]` is deliberately ACCEPTED. It is the honest spelling of "subtract
 * nothing" — identical in meaning to omitting the key, and the natural value of
 * a spread (`excludeObjects: [...SKIP_OBJECTS]`) whose source list is empty.
 * The refusal above is not "empty is bad"; it is "a name that matches nothing"
 * and "a name that matches everything". #4281 refused `[]` on `object` for a
 * reason that does not exist here: there, the binder WIDENED the empty target
 * into `'*'`, so blank intent silently became the maximum blast radius. Nothing
 * transforms this value.
 *
 * A throw, not a warn: `excludeObjects` ships in this release with no callers,
 * so strictness costs no migration, and unlike the unknown-event branch above
 * (where a custom driver dispatching its own events is a legitimate reading)
 * neither refused shape has one.
 */
function assertValidHookExcludeObjects(
  excludeObjects: string | string[] | undefined,
  event: string,
): void {
  if (excludeObjects === undefined) return;
  const names = hookTargetList(excludeObjects);
  for (const name of names) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(
        `[ObjectQL] Hook '${event}' declares an empty \`excludeObjects\` entry. `
        + 'No object is named \'\', so it would subtract nothing while reading as if it '
        + 'subtracted something — a hook still firing on objects it appears to exclude. '
        + 'Name the object(s) to exclude — `excludeObjects: [\'sys_audit_log\']` — or omit '
        + 'the option entirely (an empty array is accepted and subtracts nothing).',
      );
    }
    if (name === '*') {
      throw new Error(
        `[ObjectQL] Hook '${event}' excludes the wildcard '*', which subtracts every `
        + 'object and leaves a hook that can never fire (ADR-0078: no silently inert '
        + 'declaration). Exclude the object names you mean — '
        + '`excludeObjects: [\'sys_audit_log\']` — or, if the hook really should not be '
        + 'registered, do not register it.',
      );
    }
  }
}

/**
 * [#6573] Registration-time refusal for the `object` (ALLOW) face, closing
 * #4281 / #4001's "an empty target is not *no* target" ruling on the path that
 * ruling never reached.
 *
 * #4281 shut this shape at the two METADATA doors — `HookSchema.object`'s
 * refine in `packages/spec`, and `normalizeObjects` in `hook-binder.ts`. The
 * code door, `engine.registerHook`, goes through neither, so the same three
 * spellings still walked in here, and the matching read (see
 * {@link hookMatchesObject}) turns each of them into a defect:
 *
 *  - **`''`** is FALSY, so the allow half is skipped entirely and the entry
 *    registers as a GLOBAL hook. #4281's headline failure mode exactly — blank
 *    intent becoming the broadest possible blast radius — reproduced verbatim
 *    on the uncovered path.
 *  - **`[]` / `['']`** (or any blank member) are truthy but admit no object
 *    name, so the entry can never fire: registered "successfully", inert
 *    forever. ADR-0078's silently-inert declaration.
 *
 * Refused at REGISTRATION rather than fixed in the matcher, and that choice is
 * the whole point of the separate card. Teaching `hookMatchesObject` to read
 * `''` as a real (unmatchable) name would silently convert a hook firing on
 * every object into one firing on none — the same class of defect pointing the
 * other way, which is why #5928 declined to do it in passing. A throw at the
 * door changes no dispatch and leaves nothing to misread.
 *
 * Note the asymmetry with {@link assertValidHookExcludeObjects}, which
 * deliberately ACCEPTS `[]`: on the subtract face an empty list is the honest
 * spelling of "subtract nothing", identical to omitting the key. On the allow
 * face an empty list says "admit nothing", which is a hook that can never fire.
 * Same value, opposite meaning, because the faces compose in opposite
 * directions — and `[]` is named in #4281's own message, so accepting it here
 * would contradict the ruling this reuses.
 */
function assertValidHookObject(
  object: string | string[] | undefined,
  event: string,
): void {
  if (object === undefined) return;
  const names = hookTargetList(object);
  const empty =
    names.length === 0
    || names.some((name) => typeof name !== 'string' || name.trim().length === 0);
  if (!empty) return;
  throw new Error(
    `[ObjectQL] Hook '${event}' declares an empty \`object\` target. An empty target is `
    + 'not "no target": `\'\'` is falsy, so the allow face is skipped entirely and the hook '
    + 'registers on EVERY object, while `[]` and `[\'\']` admit no object name at all, so the '
    + 'hook could never fire (ADR-0078: no silently inert declaration). Name the object(s) — '
    + "`object: 'account'` or `object: ['account', 'contact']` — or, if firing on every "
    + "object really is the intent, write the wildcard explicitly: `object: '*'`.",
  );
}

/**
 * [#6573] Refuse a scope whose two faces cancel each other out —
 * `{ object: 'account', excludeObjects: 'account' }` and its list forms.
 *
 * The exclusion face subtracts from the allow face, so when the allow face is a
 * FINITE enumeration and every name in it is also excluded, the admitted set is
 * empty and the entry can never fire. #5928 named only three refusals (`''`,
 * `['']`, and `'*'` in the excludes) and this shape falls outside their letter,
 * so it was left registering silently — the same ADR-0078 inert declaration
 * those three exist to prevent, reached by arithmetic instead of by a single
 * bad name.
 *
 * Only a finite allow face can be decided here. `'*'` (and an absent `object`)
 * admits an OPEN universe — `applyObjectRegistryMutation` registers objects
 * into a running engine — so no finite exclusion list can empty it, and those
 * scopes are left alone. `'*'` inside `excludeObjects` is the one exclusion
 * that WOULD empty them, and it is already refused by
 * {@link assertValidHookExcludeObjects}.
 *
 * Runs after both faces have been validated individually, so every name here is
 * a non-blank string and the exclusion list carries no wildcard.
 */
function assertHookScopeNotSelfCancelling(
  object: string | string[] | undefined,
  excludeObjects: string | string[] | undefined,
  event: string,
): void {
  if (object === undefined || excludeObjects === undefined) return;
  const allow = hookTargetList(object);
  // An open allow face cannot be emptied by a finite subtraction.
  if (allow.length === 0 || allow.includes('*')) return;
  const deny = hookTargetList(excludeObjects);
  if (deny.length === 0) return;
  const denied = new Set(deny);
  if (!allow.every((name) => denied.has(name))) return;
  throw new Error(
    `[ObjectQL] Hook '${event}' excludes every object its \`object\` target admits `
    + `(object: ${JSON.stringify(allow)}, excludeObjects: ${JSON.stringify(deny)}), leaving `
    + 'a hook that can never fire (ADR-0078: no silently inert declaration). An exclusion '
    + 'subtracts from a WIDER allow face — widen `object` (or drop it for a global hook) or '
    + 'remove the overlapping names from `excludeObjects`; if the hook really should not be '
    + 'registered, do not register it.',
  );
}

/** Function registry entry — see `registerFunction`. */
export interface FunctionEntry {
  handler: HookHandler;
  packageId?: string;
  /**
   * What this function does to data, as DECLARED at registration (#4396).
   * Only a `script`-node caller reads it: a flow function is contractually
   * pure, and the run summary counts on that, so a function that legitimately
   * writes declares `'writes'` and its step is reported as an effect the
   * platform cannot count rather than as none. Absent ⇒ `'pure'`.
   *
   * Carried on the registry entry rather than beside it because this IS part of
   * the registration — one registry, and what a caller needs to know about a
   * function travels with the function.
   */
  effect?: FlowFunctionEffect;
}

/**
 * Declarations that may accompany a `registerFunction` call. The bare
 * `packageId` string is still accepted in that position (every existing caller
 * passes one), so this widens the signature without a migration.
 */
export interface FunctionRegistrationOptions {
  /** Owning package — the unit `unregisterFunctionsByPackage` removes. */
  packageId?: string;
  /** Declared data effect (#4396); omit for the pure default. */
  effect?: FlowFunctionEffect;
}

/**
 * Operation Context for Middleware Chain
 */
export interface OperationContext {
  object: string;
  operation: 'find' | 'findOne' | 'insert' | 'update' | 'delete' | 'count' | 'aggregate';
  ast?: QueryAST;
  data?: any;
  options?: any;
  context?: ExecutionContext;
  result?: any;
}

/**
 * Trailing options for the READ methods (find / findOne / count / aggregate).
 *
 * Historically the read methods took their execution context INSIDE the query
 * (`query.context`), while the WRITE methods (insert / update) took it in a
 * trailing `options.context`. That split was a footgun: the same `{ context }`
 * object is correct as the 3rd arg to `insert` but was SILENTLY DROPPED as the
 * 3rd arg to `find` — a class of bugs where an intended `isSystem` bypass just
 * vanished (e.g. control-plane reads coming back empty once org-scoping hooks
 * were added). We now ALSO accept `context` via this trailing options arg on the
 * read methods, so "execution context goes in the trailing options argument" is
 * one rule across reads and writes. `query.context` remains supported; when both
 * are given, `options.context` wins (it is the explicit channel).
 */
export interface EngineReadOptions {
  context?: ExecutionContext;
}

/** Merge read-path execution context from the query and the trailing options. */
function mergeReadContext(
  fromQuery?: ExecutionContext,
  fromOptions?: ExecutionContext,
): ExecutionContext | undefined {
  if (fromOptions == null) return fromQuery;
  if (fromQuery == null) return fromOptions;
  return { ...fromQuery, ...fromOptions };
}

/**
 * True when this write is exempt from the `state_machine` validation rule —
 * both the insert `initialStates` entry check and the update `transitions`
 * check are skipped for it. Either the seed-specific `seedReplay` flag (#3433)
 * or the general `skipStateMachine` flag (#3479, set by the REST import runner
 * for a "historical" import) turns it off. Both are server-set, never
 * client-supplied.
 */
function shouldSkipStateMachine(ctx?: ExecutionContext): boolean {
  return ctx?.seedReplay === true || ctx?.skipStateMachine === true;
}

/**
 * Engine Middleware (Onion model)
 */
export type EngineMiddleware = (
  ctx: OperationContext,
  next: () => Promise<void>
) => Promise<void>;

/**
 * The stack collections the engine decomposes into individual registry items —
 * ONE list, read by the ONE body both registration seams run
 * (`registerMetadataCollections()`, called from the manifest seam in
 * `registerApp()` and the nested-plugin seam in `registerPlugin()`).
 *
 * ## Why this is one constant and not two lists (#7049)
 *
 * It used to be two: `const metadataArrayKeys = [...]` declared separately
 * inside each loop. They drifted, invisibly, because nothing compared them —
 * `jobs`, `emailTemplates`, `tools` and `skills` were registered from a
 * manifest and NOT from a nested plugin, so a package shipping any of the four
 * from a nested plugin registered nothing and stamped no ADR-0010 provenance:
 * no refusal, no diagnostic. `capabilities` hit the SAME divergence and was
 * patched into the nested copy by hand (#5870) without anyone diffing the rest
 * of the two lists, which is how the remaining four survived it.
 *
 * The two loops were measured against each other before this was merged. They
 * differed in four ways — which object they read (`manifest` vs `plugin`), which
 * package id they stamp (both resolve to the SAME parent package: a nested
 * plugin contributes under its parent's ownership), a per-key `debug` line, and
 * the manifest seam's aggregated-view expansion plus its warn-on-nameless-item.
 * Every one of those lived in the loop BODY. Not one of them was a reason for
 * the two seams to enumerate different collections, so the enumeration was
 * shared and that divergence is now unrepresentable rather than merely unnoticed.
 *
 * ## …and why the BODY is shared too (#7163)
 *
 * The last two entries on that list were not stylistic. The aggregated-view
 * expansion is what makes ADR-0017's dual-read work, so the seam that lacked it
 * under-registered every nested plugin's views silently — see
 * `registerMetadataCollections()`, which is now the single body both seams run,
 * for the measurement. Sharing the list made the seams' collection SET
 * unanswerable-differently; sharing the body does the same for what they DO
 * with a collection they both see.
 *
 * `check:stack-collection-maps` pins this list against
 * `ObjectStackDefinitionSchema` in both directions (#6242); it used to pin the
 * two copies as two sites and carry a waiver row recording their divergence.
 * That row is gone with the divergence.
 */
const METADATA_ARRAY_KEYS = [
  // UI Protocol
  'actions', 'views', 'pages', 'dashboards', 'reports', 'datasets', 'themes',
  // Automation Protocol
  'flows', 'workflows', 'approvals', 'webhooks',
  'jobs',
  // Security Protocol — `capabilities` is here for the same reason as
  // `permissions` (#5870, #4967 Part 2): the ONLY seam that stamps
  // ADR-0010 provenance is `registerItem` → `applyProtection`, so a
  // collection missing from this list reaches no registry with a
  // `_packageId`. `bootstrapDeclaredCapabilities` resolves the owning
  // package as `cap._packageId ?? cap.packageId`; while `capabilities`
  // sat outside this list the first half could never be satisfied and
  // `readDeclared(ql, 'capability')` returned nothing, which made the
  // author-side `packageId` — documented as the FALLBACK — mandatory,
  // and its omission a silent, unenforced authorization declaration.
  'roles', 'permissions', 'capabilities', 'profiles', 'sharingRules', 'policies',
  // AI Protocol
  'agents', 'tools', 'skills', 'ragPipelines',
  // API Protocol
  'apis',
  // Data Extensions
  'hooks', 'mappings', 'analyticsCubes',
  // Integration Protocol
  'connectors',
  // System Protocol — outbound mail templates. Registered here so the
  // email plugin's materializer can read them back into
  // `sys_email_template` (#4509); without this key an authored
  // `emailTemplates:` entry never reached the registry at all, which is
  // the far end of the disconnect the bridge closes.
  'emailTemplates',
  // System Protocol — package documentation (ADR-0046); inert data
  'docs',
  // Documentation navigation spine (ADR-0046 §6)
  'books',
] as const;

/**
 * Derive the registry key for a metadata item.
 *
 * Most metadata items expose a top-level `name` (or `id`). The `View`
 * container defined by `@objectstack/spec/ui` is special: it aggregates
 * `list / form / listViews / formViews` for a single object and is
 * keyed implicitly by its target object name (see `data.object`).
 *
 * Per spec, `ViewSchema` does NOT have a top-level `name` field
 * (view.zod.ts), so we resolve it from the inner data source. This
 * matches the server-side metadata API contract (`/api/v1/meta/views/:object`).
 */
function resolveMetadataItemName(key: string, item: any): string | undefined {
  if (!item) return undefined;
  if (item.name) return item.name;
  if (item.id) return item.id;
  if (key === 'views') {
    // Independent ViewItems ("Object has-many View") carry a top-level `name`
    // (handled above) and bind to their object via `object`. The aggregated
    // container has no top-level name/object, so fall back to its inner data
    // source — matching the loader's expansion key.
    return (
      item?.object ||
      item?.list?.data?.object ||
      item?.form?.data?.object ||
      undefined
    );
  }
  return undefined;
}

/**
 * ObjectQL Engine
 * 
 * Implements the IDataEngine interface for data persistence.
 * Acts as the reference implementation for:
 * - CoreServiceName.data (CRUD)
 * - CoreServiceName.metadata (Schema Registry)
 */
// [#6063] `SummaryDescriptor`, `summaryEmptySetValue` and the single-descriptor
// aggregate moved to `./summary-aggregate.js` — unchanged, and still the one
// place each is written down. The move exists so the one-off backfill of
// pre-#6013 `NULL` rows computes its value through the SAME code this engine
// does, instead of a second implementation that agrees only until one of them
// is edited.

// `implements IObjectQLEngine` is the verification step of #4251 B3: every
// member the `objectql` slot's contract declares is checked against this class
// on every build, so the seven consumer-local surface declarations the contract
// replaced can never silently drift from the engine again. IObjectQLEngine
// extends IDataEngine, so the old claim rides along.
/**
 * [#4441] "The caller did not name a record here."
 *
 * `null` / `undefined` / `''` mean NO LINK — exactly what
 * `deleteBehavior: 'set_null'` writes — and an empty array is the multi-value
 * spelling of the same thing. None of them is an id to resolve.
 */
function isEmptyReferenceValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0 || v.every((e) => e === null || e === undefined || e === '');
  return false;
}

/**
 * [#4889] The master id a detail row's `parent` binding resolves against:
 * the write's own value for the FK when it carries one (a REPOINT must be
 * judged against the master it lands on), else the prior row's. Only a scalar
 * id counts — an expanded relation object or an array is not an id this read
 * can bind, and guessing one would be worse than leaving `parent` unbound.
 */
function masterIdOf(
  fk: string,
  data: Record<string, unknown> | null | undefined,
  row: Record<string, unknown> | null | undefined,
): string | number | undefined {
  const raw = data && fk in data ? data[fk] : row?.[fk];
  if (typeof raw === 'string') return raw === '' ? undefined : raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return undefined;
}

/**
 * RFC-4122 v4 uuid for the realtime `DataEvent.id` (#4626).
 *
 * The twin of the generator `MetadataManager` uses for `MetadataEvent.id`
 * (#4602/#4628) — same shape, same fallback, kept local rather than shared so
 * the engine's `core` import closure gains nothing (ADR-0076 D2 ratchet).
 * Prefers `crypto.randomUUID`; the fallback keeps browser-compatible (Pure)
 * environments without WebCrypto working while still satisfying
 * `DataEventSchema`'s `z.string().uuid()`.
 */
function generateEventUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Coerce a driver-returned primary key into `DataEvent.recordId` (a required
 * `string`). Returns `undefined` when the write has no single record identity
 * — a bulk `updateMany`/`deleteMany` returns only a count — so the caller can
 * decline to publish rather than fabricate one (#4626).
 */
function eventRecordId(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
}

/** `DataEvent.changes`/`before`/`after` are `z.record(...)` — only a plain object qualifies. */
function eventRecordBody(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `DataEvent.userId` — the acting user, when the execution context names one. */
function eventUserId(execCtx?: ExecutionContext): string | undefined {
  const userId = execCtx?.userId;
  if (userId == null) return undefined;
  const asString = String(userId);
  return asString === '' ? undefined : asString;
}

/**
 * Coerce a multi-row driver result into `BulkDataEvent.matched` (#4639).
 *
 * `IDataDriver.updateMany`/`deleteMany` are contracted to resolve the affected
 * row count (`Promise<number>`). A driver that resolves something else has not
 * met that contract, and the count is the ONLY substantive thing a bulk event
 * says — so this returns `undefined` and the caller declines to publish rather
 * than inventing a `matched: 0` that reads as "nothing was affected" when rows
 * very likely were.
 */
function eventMatchedCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

/**
 * What the engine knows about the transaction it opened, beyond the handle
 * itself (#4619, ADR-0119 D1 follow-up).
 *
 * It began as a pure OBSERVABILITY record — #4619 could say a write was outside
 * the transaction but deliberately did not act on it, because acting changes
 * ADR-0119 D1's declared contract and that was a decision for the maintainer,
 * not for the PR that found the defect. Since the 2026-08-06 ruling on #5351
 * this record is LOAD-BEARING: `enforceTransactionOrigin` refuses a
 * cross-driver business write on it, and `transactionCoversDriverFor` uses it
 * to keep a transaction handle from ever reaching a driver that does not own
 * it. Routing itself is still untouched — a write goes exactly where `getDriver`
 * sends it; what changed is whether it goes there carrying someone else's
 * connection.
 */
interface TransactionScope {
  /**
   * The driver instance the open transaction belongs to. Compared by IDENTITY
   * rather than by name: two drivers can transiently claim one name (see
   * `registerDriver`'s collision branch), and identity is what actually decides
   * whether a write rides this transaction's connection.
   */
  readonly driver: IDataDriver;
  /** The datasource name that driver is registered under — for the message. */
  readonly datasource: string;
  /**
   * Datasources already noted for THIS transaction. AGENTS.md's "say it once,
   * at the first degradation, not once per failed write" — a 500-row audit
   * batch carved out of this transaction is one note, not 500. Only the
   * carve-out path consumes the budget; a refused business write throws, and a
   * throw is never deduplicated.
   */
  readonly reportedOutOfScope: Set<string>;
}

export class ObjectQL implements IObjectQLEngine {
  /**
   * Ambient transaction store (ADR-0034). While a `transaction()` callback
   * runs, the active transaction handle lives here so that EVERY data
   * operation — including internal reads done during a write (reference
   * checks, hooks, expand) — automatically binds to the same connection
   * instead of asking the pool for another one and deadlocking on the
   * single-connection SQLite pool.
   */
  private readonly txStore = new AsyncLocalStorage<{
    transaction: unknown;
    /**
     * Which driver actually owns this transaction, when the engine opened it
     * (#4619). `transaction()` covers the DEFAULT datasource only — a caveat
     * that is part of the declared contract (ADR-0119 D1) — so a write routed
     * elsewhere by `setDatasourceMapping` runs OUTSIDE it and cannot be rolled
     * back with it. Carrying the owner here is what lets the write path SAY so
     * ({@link enforceTransactionOrigin}) — and, since #5351, to DECIDE what
     * happens to it: a business write is refused, a system ledger is carved out.
     *
     * Absent on the sandbox runner's explicitly-threaded handles (the
     * `beginTransaction`/`commit`/`rollback` trio never POPULATES this store —
     * since #6406 it reads it, to join an ambient transaction, but a
     * transaction the trio opens still cannot be published: there is no closure
     * spanning begin→commit to hand `run`) and on any store entry an outside
     * caller populated, so every reader must treat it as optional.
     */
    scope?: TransactionScope;
  }>();

  private drivers = new Map<string, IDataDriver>();
  private defaultDriver: string | null = null;
  private logger: Logger;

  /**
   * Datasources already reported by {@link warnTransactionUnsupported}, so the
   * "no `beginTransaction`" degrade says its piece ONCE per engine instance per
   * driver instead of once per `transaction()` call (#4619). Test doubles and
   * foreign engines hit that path on every call; a per-call warning would be
   * skimmed, which is the same unreadability that made the #4420 `warn`
   * worthless.
   */
  private readonly transactionUnsupportedReported = new Set<string>();

  /**
   * Objects already reported by {@link warnCascadeNotAtomic} — the `'split'`
   * verdict of {@link planCascadeAtomicity} — so a cascade that cannot be one
   * unit of work says so ONCE per engine instance per object rather than on
   * every delete (#7413). Same "say it once" discipline, and same reason, as
   * {@link transactionUnsupportedReported} above.
   */
  private readonly cascadeNotAtomicReported = new Set<string>();

  // Datasource mapping rules (imported from defineStack)
  private datasourceMapping: Array<{
    namespace?: string;
    package?: string;
    objectPattern?: string;
    default?: boolean;
    datasource: string;
    priority?: number;
  }> = [];

  // Package manifests registry (for defaultDatasource lookup)
  private manifests = new Map<string, any>();

  // Datasource definitions by name (ADR-0015): carries schemaMode +
  // external.allowWrites so the write gate (Gate 3) can enforce federation
  // ownership. Populated from manifests in registerApp and via
  // registerDatasourceDef. Absent entry ⇒ treated as managed (default DB).
  private datasourceDefs = new Map<string, { schemaMode?: string; external?: { allowWrites?: boolean } }>();

  // Declared-but-unusable datasources, keyed by name (framework#3828). Written
  // by the datasource connection layer via markDatasourceUnavailable; read only
  // by getDriver, to explain a missing driver instead of blaming a typo. Empty
  // is the normal state — an entry here means a connect was refused or failed.
  private unavailableDatasources = new Map<string, DatasourceUnavailableInfo>();

  // Per-object hooks with priority support
  private hooks: Map<string, HookEntry[]> = new Map([
    ['beforeFind', []], ['afterFind', []],
    ['beforeInsert', []], ['afterInsert', []],
    ['beforeUpdate', []], ['afterUpdate', []],
    ['beforeDelete', []], ['afterDelete', []],
  ]);

  // Middleware chain (onion model)
  private middlewares: Array<{
    fn: EngineMiddleware;
    object?: string;
  }> = [];

  // Action registry: key = "objectName:actionName"
  private actions = new Map<string, { handler: (ctx: any) => Promise<any> | any; package?: string }>();

  // Function registry: name → handler. Used by `bindHooksToEngine` to
  // resolve string-named hook handlers (the JSON-safe form). Populated by
  // `defineStack({ functions })` via `AppPlugin`, or directly via
  // `engine.registerFunction(...)`.
  private functions = new Map<string, FunctionEntry>();

  // Realtime service for event publishing
  private realtimeService?: IRealtimeService;

  // i18n service backing validation-message + field-label localization (#3957).
  // Optional: without it, messages render from the built-in catalog against the
  // declared labels.
  private i18nService?: { t?: (key: string, locale: string, params?: Record<string, unknown>) => string };

  // Crypto provider backing `secret`-typed fields. Optional: when absent,
  // writing an object that declares a secret field fails closed (never
  // persists cleartext). Injected by the host via setCryptoProvider().
  private cryptoProvider?: ICryptoProvider;

  // [#8022] Listeners notified when a crypto provider is (re)registered.
  // Server-side consumers that dereference a secret at BOOT — the webhook
  // auto-enqueuer's subscription cache is the one this was built for — run
  // inside `kernel:ready`, which every host completes BEFORE its composition
  // root injects a provider. Their first read therefore fails closed against a
  // capability that is about to exist, and without a notification the only way
  // back is to poll. The engine is the sole party that knows the moment it
  // arrives, so the notification belongs here.
  private readonly cryptoProviderListeners = new Set<() => void>();

  // [ADR-0105 D2 / #3623] Posture accessor for driver-scope widening under the
  // `group` posture. Injected by SecurityPlugin via setTenancyPostureProvider();
  // absent = equality scoping (fail toward isolation).
  private tenancyPostureProvider?: () => string | undefined;

  // Per-engine SchemaRegistry instance.
  //
  // Historically SchemaRegistry was a process-wide singleton of static state,
  // which broke multi-environment servers: a project kernel would inherit every
  // object registered by the control plane (e.g. sys_metadata), and
  // getDriver()'s owner lookup would route CRUD to the wrong database. Each
  // engine now owns its registry so kernels are fully isolated.
  private _registry: SchemaRegistry = new SchemaRegistry();

  constructor(hostContext: Record<string, any> = {}) {
    // Use provided logger or create a new one
    this.logger = hostContext.logger || createLogger({ level: 'info', format: 'pretty' });
    // Pick up production hardening switches from env so deployers can
    // enforce strict-body without code changes:
    //   OBJECTQL_STRICT_HOOKS=1 → unresolved hooks throw at bind time
    //   OBJECTQL_WARN_LEGACY_HANDLER=1 → log a deprecation per legacy bind
    if (process?.env?.OBJECTQL_STRICT_HOOKS === '1') {
      (this as any)._strictHookBinding = true;
    }
    if (process?.env?.OBJECTQL_WARN_LEGACY_HANDLER === '1') {
      (this as any)._warnLegacyHandler = true;
    }
    this.logger.info('ObjectQL Engine Instance Created');
  }

  /**
   * Service Status Report
   * Used by Kernel to verify health and capabilities.
   */
  getStatus() {
      return {
          name: CoreServiceName.enum.data,
          status: 'running',
          version: '0.9.0',
          features: ['crud', 'query', 'aggregate', 'transactions', 'metadata']
      };
  }

  /**
   * Expose the SchemaRegistry for plugins to register metadata.
   *
   * Returns the per-engine instance, NOT the class. Each ObjectQL engine
   * owns its registry so multi-environment kernels remain isolated.
   */
  get registry(): SchemaRegistry {
    return this._registry;
  }

  /**
   * Register a hook
   * @param event The event name (e.g. 'beforeFind', 'afterInsert')
   * @param handler The handler function
   * @param options Optional: target object(s), objects to exclude, and priority
   */
  registerHook(event: string, handler: HookHandler, options?: {
    object?: string | string[];
    /**
     * [#5928] Object name(s) subtracted from what `object` admits — the way to
     * say "global, except these". See {@link HookEntry.excludeObjects} for why
     * an allow list cannot express it, and
     * {@link assertValidHookExcludeObjects} for the two refused shapes.
     */
    excludeObjects?: string | string[];
    priority?: number;
    packageId?: string;
    /** Original metadata Hook definition (set by `bindHooksToEngine`). */
    meta?: any;
    /** Stable name from metadata (set by `bindHooksToEngine`). */
    hookName?: string;
  }) {
    // Refuse a scope that is statically decidable as meaningless before
    // anything is registered or reported. Each face is checked on its own
    // first, so the combined check below can assume well-formed names.
    // [#5928] An exclusion face that subtracts nothing (`''`) or everything (`'*'`).
    assertValidHookExcludeObjects(options?.excludeObjects, event);
    // [#6573] An allow face that names nothing (`''` → global, `[]`/`['']` → never fires).
    assertValidHookObject(options?.object, event);
    // [#6573] Two well-formed faces that cancel out (`'account'` minus `'account'`).
    assertHookScopeNotSelfCancelling(options?.object, options?.excludeObjects, event);
    // [#3195] Guard against enum-vs-dispatch drift: a hook on an event the
    // engine never triggers would register "successfully" and then silently
    // never fire. Warn loudly rather than swallow it. Not a hard reject — a
    // custom driver/plugin may dispatch its own events via `triggerHooks`.
    if (!DISPATCHABLE_HOOK_EVENTS.has(event)) {
      this.logger.warn(
        `Hook registered for '${event}', which the engine never dispatches — it will never fire. ` +
          `Dispatchable events: ${[...DISPATCHABLE_HOOK_EVENTS].join(', ')}. ` +
          `(Read filtering → RLS/permissions; field masking → field metadata; delete guards → beforeDelete.)`,
        { event, object: options?.object, hookName: options?.hookName },
      );
    }
    if (!this.hooks.has(event)) {
        this.hooks.set(event, []);
    }
    const entries = this.hooks.get(event)!;
    entries.push({
      handler,
      object: options?.object,
      excludeObjects: options?.excludeObjects,
      priority: options?.priority ?? 100,
      packageId: options?.packageId,
      meta: options?.meta,
      hookName: options?.hookName,
    });
    // Sort by priority (lower runs first)
    entries.sort((a, b) => a.priority - b.priority);
    // The exclusion face is reported alongside the allow face: a registration's
    // scope is BOTH halves (#5928), and a log that printed only `object` would
    // describe a global hook for an entry that is global-minus-twenty-tables.
    this.logger.debug('Registered hook', { event, object: options?.object, excludeObjects: options?.excludeObjects, priority: options?.priority ?? 100, totalHandlers: entries.length });
  }

  /**
   * Remove all hooks registered under a given `packageId`. Used by
   * `bindHooksToEngine` to make re-binding (hot reload, app reinstall)
   * idempotent, and by app uninstall flows.
   */
  unregisterHooksByPackage(packageId: string): number {
    if (!packageId) return 0;
    let removed = 0;
    for (const [event, entries] of this.hooks.entries()) {
      const before = entries.length;
      const kept = entries.filter((e) => e.packageId !== packageId);
      if (kept.length !== before) {
        this.hooks.set(event, kept);
        removed += before - kept.length;
      }
    }
    if (removed > 0) {
      this.logger.debug('Unregistered hooks by package', { packageId, removed });
    }
    return removed;
  }

  /**
   * Register a named function handler that can later be referenced by
   * string from a `Hook.handler` field, an `Action.target`, or a flow
   * `script` node's `config.function`. This is the JSON-safe form of
   * handler binding — declarative metadata persisted to disk or shipped
   * over the wire only carries the name.
   *
   * The third parameter accepts either the owning `packageId` (its original
   * shape, unchanged for every existing caller) or a
   * {@link FunctionRegistrationOptions} record that also carries what the
   * function DECLARES about itself — today its data `effect` (#4396).
   */
  registerFunction(
    name: string,
    handler: HookHandler,
    packageIdOrOptions?: string | FunctionRegistrationOptions,
  ): void {
    if (!name || typeof handler !== 'function') return;
    const opts: FunctionRegistrationOptions =
      typeof packageIdOrOptions === 'string' ? { packageId: packageIdOrOptions } : (packageIdOrOptions ?? {});
    const { packageId, effect } = opts;
    this.functions.set(name, { handler, packageId, ...(effect ? { effect } : {}) });
    this.logger.debug('Registered function', { name, packageId, effect });
  }

  /** Look up a registered function by name. */
  resolveFunction(name: string): HookHandler | undefined {
    return this.functions.get(name)?.handler;
  }

  /**
   * Look up a registered function's FULL entry — the handler plus whatever it
   * declared about itself (#4396). `resolveFunction` above answers "can I call
   * it"; a caller that must also report what the call did (the automation
   * engine's `script` node, feeding the #4354 run summary) needs the
   * declaration, and reading it off the same registry keeps the two from
   * drifting.
   */
  resolveFunctionEntry(name: string): Readonly<FunctionEntry> | undefined {
    return this.functions.get(name);
  }

  /** Remove all functions registered under a given `packageId`. */
  unregisterFunctionsByPackage(packageId: string): number {
    if (!packageId) return 0;
    let removed = 0;
    for (const [name, entry] of this.functions.entries()) {
      if (entry.packageId === packageId) {
        this.functions.delete(name);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.logger.debug('Unregistered functions by package', { packageId, removed });
    }
    return removed;
  }

  /**
   * Bind a list of declarative `Hook` metadata definitions to this engine.
   *
   * Convenience proxy to the canonical `bindHooksToEngine` so callers do
   * not need a separate import. Use `import { bindHooksToEngine } from
   * '@objectstack/objectql'` directly when you want the result object.
   */
  bindHooks(hooks: any[] | undefined, opts?: {
    packageId?: string;
    functions?: Record<string, HookHandler>;
    bodyRunner?: any;
    strict?: boolean;
    warnLegacyHandler?: boolean;
    metrics?: any;
  }): void {
    const merged = { ...(opts ?? {}), logger: this.logger } as any;
    if (!merged.bodyRunner && this._defaultBodyRunner) {
      merged.bodyRunner = this._defaultBodyRunner;
    }
    if (merged.strict === undefined && (this as any)._strictHookBinding) {
      merged.strict = true;
    }
    if (merged.warnLegacyHandler === undefined && (this as any)._warnLegacyHandler) {
      merged.warnLegacyHandler = true;
    }
    if (!merged.metrics && (this as any)._hookMetricsRecorder) {
      merged.metrics = (this as any)._hookMetricsRecorder;
    }
    bindHooksToEngine(this, hooks, merged);
  }

  /** Default hook body-runner — see {@link setDefaultBodyRunner}. */
  private _defaultBodyRunner?: any;
  /** Default action body-runner factory — see {@link setDefaultActionRunner}. */
  private _defaultActionRunner?: (actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined;

  /**
   * Install a default body-runner used when `bindHooks` is called without
   * an explicit one. The runtime layer sets this once on each per-project
   * engine so every binding path (template seed, metadata sync, AppPlugin)
   * can execute hook `body.source` consistently.
   *
   * FIRST-WINS (#4251): "set once per engine" is this method's own contract,
   * so the method enforces it — a second call is ignored and returns `false`.
   * Callers used to implement the guard themselves by probing the private
   * `_defaultBodyRunner` field through `any` (multiple AppPlugin instances on
   * one kernel must not clobber each other's runner), which meant the
   * invariant lived in every caller and belonged to none. Nobody replaces a
   * runner on a live engine: every setter call site either owns a fresh
   * engine or wants exactly this keep-the-first behaviour.
   *
   * @returns `true` when this call installed the runner, `false` when one was
   * already present (kept unchanged).
   */
  setDefaultBodyRunner(runner: any): boolean {
    if (this._defaultBodyRunner) {
      this.logger.debug('Default body runner already installed — keeping the first');
      return false;
    }
    this._defaultBodyRunner = runner;
    return true;
  }

  /** The installed default body-runner, if any — the public read the first-wins guard implies. */
  getDefaultBodyRunner(): any {
    return this._defaultBodyRunner;
  }

  /**
   * Install a default ACTION body-runner factory: `(actionDef) => handler |
   * undefined`. The runtime layer sets this once per engine (same boot point
   * as {@link setDefaultBodyRunner}) so runtime-authored `action` metadata —
   * which registers through paths that have no sandbox access of their own,
   * notably ObjectQLPlugin's metadata-service re-sync — can turn a declarative
   * `body` into an executable `registerAction` handler. The factory returns
   * `undefined` for actions it cannot run (no `body`, invalid shape), which
   * callers must treat as "skip", not an error.
   *
   * FIRST-WINS (#4251) — same contract and rationale as
   * {@link setDefaultBodyRunner}.
   *
   * @returns `true` when this call installed the runner, `false` when one was
   * already present (kept unchanged).
   */
  setDefaultActionRunner(runner: (actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined): boolean {
    if (this._defaultActionRunner) {
      this.logger.debug('Default action runner already installed — keeping the first');
      return false;
    }
    this._defaultActionRunner = runner;
    return true;
  }

  /** The installed default action-runner factory, if any. */
  getDefaultActionRunner(): ((actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined) | undefined {
    return this._defaultActionRunner;
  }

  /**
   * Toggle strict hook-binding mode for this engine. When enabled, every
   * subsequent `bindHooks` call rejects on the first unresolved hook
   * instead of silently warning. Production runtimes should enable this.
   */
  setStrictHookBinding(strict: boolean): void {
    (this as any)._strictHookBinding = strict;
  }

  /** Toggle deprecation warnings for hooks still using legacy `handler` ref. */
  setWarnLegacyHandler(warn: boolean): void {
    (this as any)._warnLegacyHandler = warn;
  }

  /**
   * Install a metrics recorder used by every subsequent `bindHooks` call.
   * The recorder's methods are invoked per-execution to count outcomes
   * (success / error / timeout / capability_rejected), skips, and retries.
   * Defaults to no-op so the engine pays zero cost when nobody is observing.
   */
  setHookMetricsRecorder(recorder: any): void {
    (this as any)._hookMetricsRecorder = recorder;
  }

  /** Read the engine's installed metrics recorder, if any. */
  getHookMetricsRecorder(): any {
    return (this as any)._hookMetricsRecorder;
  }

  /**
   * Dispatch `event` to every registered handler that covers `context.object`,
   * in priority order, awaiting each in turn.
   *
   * ⚠️ This runs wherever the caller calls it — it does NOT wait for a commit.
   * An `after*` dispatch made from inside an open transaction therefore fires
   * for a write that can still be rolled back; that is the declared semantics
   * (#7477), stated in full on {@link DISPATCHABLE_HOOK_EVENTS}. Anything
   * added here that defers a dispatch past the enclosing unit of work would be
   * changing that ruling, not implementing it.
   */
  public async triggerHooks(event: string, context: HookContext) {
    const entries = this.hooks.get(event) || [];
    
    if (entries.length === 0) {
      this.logger.debug('No hooks registered for event', { event });
      return;
    }

    this.logger.debug('Triggering hooks', { event, count: entries.length });

    // `session.skipAutomations` (set from ExecutionContext.skipAutomations —
    // import with "run automations & triggers" unchecked, import undo)
    // suppresses hooks bound FROM METADATA (`bindHooksToEngine` stamps
    // `entry.meta`). Hooks registered in code by plugins — audit, capability
    // gates, sharing projection — have no `meta` and always run: the opt-out
    // must never bypass security or audit (#2922).
    const skipAutomations =
      (context.session as { skipAutomations?: boolean } | undefined)?.skipAutomations === true;

    for (const entry of entries) {
      // Per-object matching — allow face minus exclusion face, the one shared
      // rule `hasHooksFor` also reads (#5928).
      if (!hookMatchesObject(entry, context.object)) {
        continue; // Skip non-matching hooks
      }
      if (skipAutomations && entry.meta) {
        this.logger.debug('Skipping metadata-bound hook (skipAutomations)', { event, hook: entry.hookName });
        continue;
      }
      await entry.handler(context);
    }
  }

  /**
   * [#5038] Would `triggerHooks(event, ctx)` reach ANY handler for `object`?
   *
   * Applies the SAME per-object rule the dispatch loop applies — literally the
   * same function, {@link hookMatchesObject}, since #5928 — because this answer
   * gates a READ of the whole matched row set on the bulk write path. Getting
   * it looser than the dispatch loop only costs a wasted query; getting it
   * TIGHTER would silently drop hooks that were going to fire. Until #5928 the
   * two were separate hand-written copies of one semantic and this comment
   * asked the reader to keep them in step; sharing the function is what
   * actually keeps them in step, and the property test in
   * `hook-exclude-objects.test.ts` pins the direction that matters.
   *
   * `session.skipAutomations` is deliberately NOT consulted: it suppresses only
   * metadata-bound entries, and code-registered hooks (audit, sharing) still
   * run, so the row set is still needed. Over-reading in that case is a cost,
   * never a correctness loss — and it is the SAFE side of the asymmetry above,
   * which is why the pin asserts an implication rather than an equality.
   */
  private hasHooksFor(event: string, object: string): boolean {
    const entries = this.hooks.get(event);
    if (!entries || entries.length === 0) return false;
    return entries.some((entry) => hookMatchesObject(entry, object));
  }

  /**
   * [#5038] The per-row after-hook contexts a predicate (`multi: true`) write
   * dispatches, one per matched row.
   *
   * ## Why per row at all
   *
   * ADR-0058's bulk-write addendum (the 2026-08-04 ruling on #4800 / #4862)
   * records the contract: **a bulk write is N record changes, so after-hooks
   * and the record-change flow triggers riding them evaluate and fire PER
   * ROW**, with `previous` = that row's pre-write state and `record` = that
   * row's actual state. Before it, the engine fired the hook ONCE, never
   * assigned `previous`, and left `record` degraded to the bare payload — so
   * the transition condition both the docs and ten showcase flows teach
   * (`status == "done" && previous.status != "done"`) was unevaluable on a
   * bulk write, and the audit/notification flows behind it silently did not
   * happen.
   *
   * ## The shape is the SINGLE-RECORD shape, deliberately
   *
   * Each context is exactly what a single-id write builds — `input.id` is the
   * row, `input.data` is this write's payload, `result` is the row's state,
   * `previous` is its pre-image. That is #2922's ruling for batch INSERT
   * restated: a single array-shaped context "broke every consumer built for
   * the single shape", so a per-row context must be indistinguishable from a
   * record-scoped one. It is also what makes this fix land at the PRODUCER:
   * `hook-wrappers`' `record`/`previous` bindings, the record-change trigger's
   * `buildContext`, and plugin-audit's diff all read these same four fields and
   * need no bulk-aware branch of their own.
   *
   * `input.data` is a shallow COPY per row: the batch has one payload, but an
   * after-handler that writes through the flat-input proxy must not have its
   * mutation leak into the next row's view.
   *
   * ## `result` is composed, not re-read
   *
   * The row's post-write state is `row ⊕ payload` — the pre-image the matched
   * set already gave us, overlaid with the payload the driver just applied.
   * Composing keeps the issue's performance guardrail literal: the matched row
   * set is read ONCE and reused for every per-row evaluation. Re-reading the
   * batch after the write to capture driver-side stamps would be a second
   * full-set query for fields the after-view has never carried on this path.
   *
   * For a DELETE there is no post-state, so `result` is left unset and
   * `input` carries no `data`: consumers fall back to `previous` (the deleted
   * row), which is what `record` means for a delete.
   */
  private buildPerRowAfterContexts(
    object: string,
    event: 'afterUpdate' | 'afterDelete',
    rows: Record<string, unknown>[],
    batchCtx: HookContext,
    payload?: Record<string, unknown>,
  ): HookContext[] {
    const schema = this._registry.getObject(object);
    const options = (batchCtx.input as { options?: unknown } | undefined)?.options;
    return rows.map((row, index) => ({
      ...batchCtx,
      event,
      input: payload
        ? { id: (row as { id?: unknown }).id, data: { ...payload }, options }
        : { id: (row as { id?: unknown }).id, options },
      // [#6966] `mode` and `scope` ride over from the batch context; only the
      // position differs. Spreading `batchCtx` would carry index 0 onto every
      // row, which is the one member a per-row consumer keys "do this once" on.
      dispatch: { ...(batchCtx.dispatch as object), index } as HookContext['dispatch'],
      previous: coerceBooleanFields(schema as any, row as any),
      result: payload
        ? coerceBooleanFields(schema as any, { ...row, ...payload } as any)
        : undefined,
    }) as unknown as HookContext);
  }

  /**
   * [#5574] The per-row `before*` dispatch of a predicate (`multi: true`)
   * write — ADR-0058 Addendum II, clauses D1–D4.
   *
   * ## D1/D2 — one dispatch per matched row, on the SINGLE-RECORD shape
   *
   * `input.id` names the row, `previous` is that row's pre-image, and
   * `input.options` is still the CALLER's bag (the PHASE rule in `hook.zod.ts`
   * is unchanged: the `before*` phase reads the pre-merge view, `where` and
   * `multi` visible). `result` stays ABSENT — the before phase has no
   * post-state, and a value assigned to `ctx.result` here is overwritten by the
   * write's own result before any `after*` handler could see it.
   *
   * Zero matched rows is zero dispatches, and `[]` is meaningful: a batch that
   * changed nothing is not a record change. The caller checks that BEFORE
   * calling in, so an empty row set never reaches this loop.
   *
   * ## D3 — the payload is BATCH-scoped, and that IS the merge rule
   *
   * Every per-row context carries THE payload, not a copy — deliberately
   * unlike {@link buildPerRowAfterContexts}, which copies because an
   * after-handler's mutation has nowhere legitimate to go. There is exactly one
   * payload for a predicate update (`driver.updateMany` takes one SET clause
   * for N rows), so:
   *
   *  - a rewrite takes effect on the WHOLE batch, whichever row's dispatch made
   *    it, and rewrites ACCUMULATE across the N dispatches in dispatch order;
   *  - N post-hook payloads cannot diverge, so nothing is reconciled, no
   *    payload is discarded, and no predicate write is ever split into N
   *    single-row writes.
   *
   * Two ways a handler can write the payload and both must accumulate: mutating
   * it in place (`ctx.input.data.x = 1`) needs no help, while REPLACING it
   * (`ctx.input.data = {…}`) would otherwise be lost with the row context that
   * held it. So each row reads the batch payload fresh and writes it back after
   * its dispatch — that write-back is what makes "accumulate in dispatch order"
   * true for both spellings rather than only the first.
   *
   * A rewrite CONDITIONED on the row (`ctx.previous`, `ctx.input.id`) is
   * outside the contract: it does not scope itself to the row it was decided
   * on, it widens to every matched row. Per-row `previous` is supplied so a
   * guard can REFUSE the write (throw), not so a rewrite can be aimed. That is
   * a contract statement, not an enforcement — no static rule can decide
   * whether a rewrite is row-invariant — and the ADR names it as such rather
   * than hiding it.
   *
   * ## D4 — `input.id` is not a reroute lever here
   *
   * On the old batch dispatch it was: `input.id` was present-but-`undefined`,
   * and binding it moved the write onto the single-id branch. A per-row context
   * arrives with `id` already bound and the dispatch already decided, so
   * rebinding retargets nothing — and is refused rather than ignored.
   */
  private async dispatchPerRowBeforeHooks(
    object: string,
    event: 'beforeUpdate' | 'beforeDelete',
    rows: Record<string, unknown>[],
    batchCtx: HookContext,
  ): Promise<void> {
    const schema = this._registry.getObject(object);
    const carriesPayload = event === 'beforeUpdate';
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowId = (row as { id?: unknown }).id;
      const options = (batchCtx.input as { options?: unknown }).options;
      const rowCtx = {
        ...batchCtx,
        event,
        // [#6966] See `buildPerRowAfterContexts` — same rule. The `scope`
        // identity carried over from `batchCtx` is what lets a `before*`
        // handler leave something an `after*` handler can still find: a per-row
        // context is a fresh object, so a stash written on the context itself
        // dies with the row that held it.
        dispatch: { ...(batchCtx.dispatch as object), index } as HookContext['dispatch'],
        // D3: THE payload, read fresh so a previous row's REPLACEMENT is what
        // this row sees. Never a copy.
        input: carriesPayload
          ? { id: rowId, data: (batchCtx.input as { data?: unknown }).data, options }
          : { id: rowId, options },
        previous: coerceBooleanFields(schema as any, row as any),
        // D2: no post-state in the before phase.
        result: undefined,
      } as unknown as HookContext;

      await this.triggerHooks(event, rowCtx);

      // D3, the accumulate half — see the class doc above.
      if (carriesPayload) {
        (batchCtx.input as { data?: unknown }).data = (rowCtx.input as { data?: unknown }).data;
      }
      // D4.
      const observed = (rowCtx.input as { id?: unknown }).id;
      if (observed !== rowId) {
        throw new HookTargetRebindError({
          object, event, path: 'per-row', expectedId: rowId, observedId: observed,
        });
      }
    }
  }

  /**
   * [#5038, one ceiling for both phases since #5574] Ceiling on the matched-row
   * set a predicate write fires per-row hooks over.
   *
   * The consequence ADR-0058's addendum told this implementation to price: a
   * hook that used to run once per batch now runs once per row, so a
   * notification hook sends N messages and a cache-invalidation hook runs N
   * times. Unbounded, a single `multi: true` update matching a whole table
   * turns into an unbounded fan-out of handler executions inside one write.
   *
   * Exceeding it REJECTS the write, before the FIRST per-row dispatch and
   * before `updateMany`/`deleteMany` runs, so nothing is written and no handler
   * ran for a batch that was going to be refused anyway. The alternative —
   * quietly falling back to firing once for the batch — is the silent
   * degradation this whole family exists to abolish (#4649/#4775): the hooks
   * would not fire for N-1 rows and nothing would say so.
   *
   * [#5574] The rule itself is `resolveBulkPerRowHookBudget` in
   * `packages/spec/src/data/bulk-write-hook-conformance.ts` (D6), not a copy
   * kept in step by a pin. This method is the RAISING half only: the contract
   * is pure and total (no clock, no I/O, no throw), the engine turns a
   * `refused` verdict into the thrown error. Splitting it that way is what lets
   * `before*` and `after*`, update and delete, share one ceiling and one
   * message with nothing to keep synchronised.
   */
  private assertBulkPerRowHookBudget(object: string, event: string, matched: number): void {
    const verdict = resolveBulkPerRowHookBudget({ object, event, matched });
    if (verdict.kind === 'ok') return;
    throw Object.assign(new Error(verdict.message), {
      code: verdict.code,
      object: verdict.object,
      event: verdict.event,
      matched: verdict.matched,
      limit: verdict.limit,
    });
  }

  // ========================================
  // Action System
  // ========================================

  /**
   * Register a named action on an object.
   * Actions are custom business logic callable via `repo.execute(actionName, params)`.
   *
   * @param objectName Target object
   * @param actionName Unique action name within the object
   * @param handler Handler function. Authoring sites should annotate it with
   *   `ActionHandler` from `@objectstack/spec/ui` (ADR-0104 D2) rather than an
   *   inline `(ctx: any)`; the params on `ctx` are validated against the
   *   action's declared param contract at dispatch before the handler runs.
   *   The seam itself stays untyped so existing untyped handlers keep working.
   * @param packageName Optional package owner (for cleanup)
   */
  registerAction(objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName?: string): void {
    const key = `${objectName}:${actionName}`;
    this.actions.set(key, { handler, package: packageName });
    this.logger.debug('Registered action', { objectName, actionName, package: packageName });
  }

  /**
   * Execute a named action on an object.
   */
  async executeAction(objectName: string, actionName: string, ctx: any): Promise<any> {
    const entry = this.actions.get(`${objectName}:${actionName}`);
    if (!entry) {
      throw new Error(`Action '${actionName}' on object '${objectName}' not found`);
    }
    return entry.handler(ctx);
  }

  /**
   * Every action handler currently registered, as `{ objectName, actionName }`
   * pairs (plus the owning package when one was given).
   *
   * [ADR-0110 D5] The handler registry is one half of the
   * declaration↔executable bijection; with no way to enumerate it, the other
   * half could only be checked when someone happened to invoke a route. The
   * boot reconciliation reads this to list handlers no declaration covers —
   * which since D3 are refused at dispatch, so having the inventory is what
   * makes that refusal a checklist instead of a support ticket.
   */
  listRegisteredActions(): Array<{ objectName: string; actionName: string; package?: string }> {
    const out: Array<{ objectName: string; actionName: string; package?: string }> = [];
    for (const [key, entry] of this.actions.entries()) {
      const sep = key.indexOf(':');
      if (sep < 0) continue;
      out.push({
        objectName: key.slice(0, sep),
        actionName: key.slice(sep + 1),
        ...(entry.package ? { package: entry.package } : {}),
      });
    }
    return out;
  }

  /**
   * Remove all actions registered by a specific package.
   */
  removeActionsByPackage(packageName: string): void {
    for (const [key, entry] of this.actions.entries()) {
      if (entry.package === packageName) {
        this.actions.delete(key);
      }
    }
  }

  /**
   * Register a middleware function
   * Middlewares execute in onion model around every data operation.
   * @param fn The middleware function
   * @param options Optional: target object filter
   */
  registerMiddleware(fn: EngineMiddleware, options?: { object?: string }): void {
    this.middlewares.push({ fn, object: options?.object });
    this.logger.debug('Registered middleware', { object: options?.object, total: this.middlewares.length });
  }

  /**
   * Execute an operation through the middleware chain
   */
  private async executeWithMiddleware(ctx: OperationContext, executor: () => Promise<any>): Promise<any> {
    const applicable = this.middlewares.filter(m =>
      !m.object || m.object === '*' || m.object === ctx.object
    );

    let index = 0;
    const next = async (): Promise<void> => {
      if (index < applicable.length) {
        const mw = applicable[index++];
        await mw.fn(ctx, next);
      } else {
        ctx.result = await executor();
      }
    };

    await next();
    return ctx.result;
  }

  /**
   * Build a HookContext.session from ExecutionContext — WHO is calling.
   *
   * Returns `undefined` when the context yields nothing session-worthy, which
   * keeps `!ctx.session` meaning exactly one thing for hooks: "no identity
   * envelope was supplied" — the bare-kernel / programmatic call that
   * caller-gating hooks skip for. A context carrying only write PROVENANCE
   * (`{ flowRunId }`, all an identity-less flow run has — #3712) is such a
   * case: it says what produced the write, not who is calling, and surfaces
   * through {@link buildProvenance} instead. Every real transport resolves
   * `positions` into the context, so an anonymous HTTP request still yields a
   * session and stays gated.
   */
  private buildSession(execCtx?: ExecutionContext): HookContext['session'] {
    if (!execCtx) return undefined;
    const session = {
      userId: execCtx.userId,
      // `organizationId` is the blessed developer-facing name for the caller's
      // active org (matches the `organization_id` column, `current_user`
      // RLS shape, and seed rows). It comes from `execCtx.tenantId`, which the
      // kernel resolves from `session.activeOrganizationId`. The deprecated
      // `session.tenantId` alias (#3280) was removed here in v11 (#3290) — the
      // driver-layer `execCtx.tenantId` knob is a separate axis and stays.
      organizationId: execCtx.tenantId,
      positions: execCtx.positions,
      accessToken: execCtx.accessToken,
      // Propagate system-elevated flag so hooks can distinguish engine
      // self-writes (e.g. approval status mirror) from genuine user writes.
      ...((execCtx as any).isSystem ? { isSystem: true } : {}),
      // Propagate the service-principal label (`ExecutionContext.actor`,
      // e.g. `svc:flow:<name>`) so a non-user write stays attributable in the
      // audit log — the writer's `userId ?? session.actor` fallback is dead
      // without this hop (ADR-0014 D2, #4366).
      ...(typeof (execCtx as any).actor === 'string' && (execCtx as any).actor
        ? { actor: (execCtx as any).actor }
        : {}),
      // Propagate the automation-suppression flag so the record-change trigger
      // can skip flow dispatch for seed/bulk writes (ADR: seed loads end-state
      // data, not user events). `skipAutomations` implies `skipTriggers` —
      // suppressing metadata hooks while still dispatching flows would leave
      // the "run automations & triggers" opt-out half-working (#2922).
      ...((execCtx as any).skipTriggers || (execCtx as any).skipAutomations ? { skipTriggers: true } : {}),
      // Propagate the full automation opt-out so `triggerHooks` can skip
      // metadata-bound hooks (import with "run automations" unchecked, undo).
      ...((execCtx as any).skipAutomations ? { skipAutomations: true } : {}),
      // Propagate the historical-import audit-preservation flag so the built-in
      // audit hook keeps a client-supplied updated_at/updated_by instead of
      // stamping now (#3493). Opt-in, server-set only.
      ...((execCtx as any).preserveAudit ? { preserveAudit: true } : {}),
    } as HookContext['session'];
    // Nothing to say about the caller → say nothing. An object whose every
    // property is `undefined` conveys no more than no session at all, and
    // returning it would turn "no caller" into "an anonymous caller".
    return Object.values(session as Record<string, unknown>).some((v) => v !== undefined)
      ? session
      : undefined;
  }

  /**
   * Build the HookContext.provenance envelope — WHERE this write came from.
   *
   * Deliberately separate from {@link buildSession}: provenance is server-
   * stamped, evaluated by no security middleware, and can exist with no
   * identity beside it. A schedule-triggered flow run resolves no principal
   * yet still owns its writes, and that is the case the approvals record lock
   * needs to recognize (#3456 / #3712).
   *
   * `attributedUserId` rides the SAME envelope for the same reason (#4586):
   * a better-auth-originated write authorizes as the system, so the human who
   * triggered it must reach the audit writer WITHOUT appearing in `session` —
   * where every caller-gating hook would read them as the caller. Attribution
   * here, authorization in `session`/`isSystem`, never the two mixed.
   */
  private buildProvenance(execCtx?: ExecutionContext): HookContext['provenance'] {
    const flowRunId = (execCtx as any)?.flowRunId;
    const attributedUserId = (execCtx as any)?.attributedUserId;
    if (!flowRunId && !attributedUserId) return undefined;
    return {
      ...(flowRunId ? { flowRunId: String(flowRunId) } : {}),
      ...(attributedUserId ? { attributedUserId: String(attributedUserId) } : {}),
    };
  }

  /**
   * Build the acting-user object (ADR-0068 EvalUser shape) surfaced to
   * validation-time predicates as `current_user` — notably per-option
   * `visibleWhen` authorization gating (objectui#2284). Returns undefined for
   * system / unauthenticated writes, where membership predicates then fail-open.
   */
  private buildEvalUser(
    execCtx?: ExecutionContext,
  ): { id: string; positions: string[]; organizationId: string | null } | undefined {
    if (!execCtx || execCtx.userId == null) return undefined;
    return {
      id: String(execCtx.userId),
      positions: execCtx.positions ?? [],
      organizationId: execCtx.tenantId != null ? String(execCtx.tenantId) : null,
    };
  }

  /**
   * Build the `HookContext.user` shortcut — the ergonomic "current user"
   * object surfaced to JS hooks. Carries `organizationId` (the blessed name
   * for the caller's active org, identical to `session.organizationId` and
   * `current_user.organizationId`) so a hook author who needs "the current org
   * to filter by" writes `ctx.user.organizationId` with zero relearning (#3280).
   *
   * Returns undefined for system / unauthenticated writes (no acting user) —
   * hooks that need an org regardless of a resolved user read
   * `ctx.session.organizationId`, which is populated whenever a session is.
   */
  private buildUser(execCtx?: ExecutionContext): HookContext['user'] {
    if (!execCtx || execCtx.userId == null) return undefined;
    return {
      id: String(execCtx.userId),
      ...(execCtx.email ? { email: execCtx.email } : {}),
      // Always equals `session.organizationId` (both from `execCtx.tenantId`).
      // Undefined on unscoped (platform/community) calls.
      ...(execCtx.tenantId != null ? { organizationId: String(execCtx.tenantId) } : {}),
    };
  }

  /**
   * Build the DriverOptions blob passed to every IDataDriver call.
   *
   * Carries `tenantId` from the active ExecutionContext so the driver can
   * enforce per-tenant isolation (SQL driver auto-scopes reads and
   * auto-injects the tenant column on writes) — EXCEPT for the two object
   * postures below. The SQL driver has its own opt-out (sticky tenant-field
   * cache), but withholding tenantId here protects every driver at the
   * source. Existing user-supplied shapes (transactions, AST extras) are
   * preserved by spreading them first — an explicitly-passed `base.tenantId`
   * is deliberate caller intent and still wins, under both exemptions.
   *
   * 1. **`tenancy.enabled: false`** (ADR-0066 platform-global posture, e.g.
   *    `sys_license`): stamping the caller's active-org tenantId there would
   *    org-scope a global catalog at the driver, and its NULL-org rows would
   *    vanish for authenticated org-context reads while anonymous reads still
   *    see them (#3249).
   *
   * 2. **`external != null`** — a federated object (ADR-0015), whose schema
   *    is owned by the REMOTE database (#7738). The driver turns `tenantId`
   *    into `(organization_id = :tenant OR organization_id IS NULL)`, and
   *    against a remote table that carries no such column that is a SQL error
   *    on Postgres/MySQL — or worse on SQLite, whose quoted-identifier
   *    fallback reinterprets the unresolvable identifier as the string
   *    literal `'organization_id'`, makes both disjuncts constant-false, and
   *    answers **0 rows with HTTP 200**: a correctly-bound external object
   *    silently reads empty.
   *
   *    Note the reason is NOT "the remote happens to lack the column". The
   *    column the driver detects is the platform's OWN: `applySystemFields`
   *    (`resolveInjectedSystemColumns`) injects `organization_id` into every
   *    object it registers, with no `external` branch, and
   *    `SqlDriver.registerExternalObject` is DDL-free by design and runs no
   *    introspection — so it computes the tenant column from the platform's
   *    field set, never from the remote's. On a federated object
   *    `organization_id`'s presence is therefore always the injection and
   *    never evidence about the remote, which leaves the engine no ground on
   *    which to scope by it. Tenant isolation for federated data belongs to
   *    the remote and to the layers above (RBAC/RLS, the datasource binding),
   *    not to a predicate the platform guesses onto someone else's table.
   *
   * System / isSystem callers may still cross tenants by clearing
   * `tenantId` themselves on the resulting object; this helper does not
   * mask the system path.
   */
  private buildDriverOptions(object: string, execCtx?: ExecutionContext, base?: any): any {
    // The open transaction may arrive explicitly via the context, or ambiently
    // via txStore when an internal query runs during a transactional write
    // (ADR-0034). Explicit wins; ambient is the safety net.
    const tx = execCtx?.transaction !== undefined
      ? execCtx.transaction
      : this.txStore.getStore()?.transaction;
    // [#5351] SAME-ORIGIN GATE. A transaction handle is a property of ONE
    // driver's connection; handing it to a different driver does not put that
    // driver's statement inside the transaction, it executes the statement on
    // the WRONG CONNECTION — measured on knex/SQLite as `no such table` against
    // a database that never held the object. The write path's
    // `enforceTransactionOrigin` has already refused a business write by the
    // time we get here (and let a system ledger through by decision), so this
    // is the structural half: whatever survives to here, the handle only ever
    // reaches the driver that owns it. It covers READS too, which have no gate
    // of their own and were riding the same wrong connection.
    const hasTx = tx !== undefined && this.transactionCoversDriverFor(object, tx);
    const objectSchema = this._registry.getObject(object) as any;
    // `external != null` is the same predicate `syncObjectSchema` routes a
    // federated object by — one spelling of "this schema is the remote's",
    // not a second reading of it.
    const isFederated = objectSchema?.external != null;
    const hasTenant =
      execCtx?.tenantId !== undefined &&
      !isTenancyDisabled(objectSchema) &&
      !isFederated;
    const hasTz = execCtx?.timezone !== undefined;
    const isSystem = execCtx?.isSystem === true;
    const preserveAudit = (execCtx as any)?.preserveAudit === true;
    if (!hasTx && !hasTenant && !isSystem && !hasTz && !preserveAudit) return base;
    const opts: any = base && typeof base === 'object' ? { ...base } : {};
    if (hasTx && opts.transaction === undefined) {
      opts.transaction = tx;
    }
    if (hasTenant && opts.tenantId === undefined) {
      opts.tenantId = execCtx!.tenantId;
    }
    // [ADR-0105 D2 / #3623] Under the `group` posture the caller's read reach
    // is their whole membership set, not the active org — thread it so the
    // driver's native scope widens to the SAME union Layer 0 enforces, instead
    // of ANDing an active-org equality under it (which collapsed group reads
    // to isolated semantics). Inserts still stamp from `tenantId` (the active
    // org is the write target, D5). No provider / other postures / absent set
    // → no `tenantIds`, and drivers fall back to equality: fail toward
    // isolation, never toward exposure.
    if (hasTenant && opts.tenantIds === undefined && this.tenancyPostureProvider?.() === 'group') {
      const set = (execCtx as any)?.accessible_org_ids;
      if (Array.isArray(set) && set.length > 0) {
        opts.tenantIds = set.map(String);
      }
    }
    if (hasTz && opts.timezone === undefined) {
      // Thread the business timezone so date-dependent driver generation
      // (autonumber `{YYYYMMDD}` tokens) resolves the calendar day correctly.
      opts.timezone = execCtx!.timezone;
    }
    if (isSystem && opts.bypassTenantAudit === undefined) {
      // System-elevated writes (boot-time seeds, internal mirrors, scheduled
      // hooks) are unscoped by design — silence the audit warn for them but
      // still flag genuine user-path bugs.
      opts.bypassTenantAudit = true;
    }
    if (preserveAudit && opts.preserveAudit === undefined) {
      // Historical import (#3493): let the driver keep a supplied `updated_at`
      // instead of force-stamping now on the update path.
      opts.preserveAudit = true;
    }
    return opts;
  }

  /**
   * Does the open transaction `tx` actually cover the driver `object` resolves
   * to? — the same-origin question, asked by instance IDENTITY (#5351).
   *
   * Answers `true` in two cases: the resolved driver IS the transaction's
   * owner, or the engine cannot tell who the owner is. The second case is the
   * DECLARED LIMIT of this gate, not an oversight, and it is exactly one
   * shape: a handle the engine never opened and cannot attribute.
   *
   * `TransactionScope` (#5724) records the owner for every transaction the
   * engine opens, and `transaction()` also threads that same handle down as
   * `execCtx.transaction`, so the dominant explicit-threading path is covered
   * by identity-matching the handle back to the store entry. What is NOT
   * covered:
   *
   * - `ScopedContext`'s discrete `beginTransaction`/`commit`/`rollback` trio,
   *   which threads the handle across `setImmediate` boundaries where
   *   AsyncLocalStorage does not survive, and so never populates txStore;
   * - any handle an outside caller obtained elsewhere and passed in as
   *   `execCtx.transaction`.
   *
   * For those the engine holds an opaque driver object with no back-reference
   * to its driver, so there is no honest comparison to make. Guessing — say,
   * assuming an unattributed handle belongs to the default driver — would
   * refuse legitimate single-datasource work on one side and carve out writes
   * that were genuinely covered on the other. So the gate declines to judge and
   * the pre-#5351 behaviour stands on that path: recorded in the ADR-0067/0119
   * revision, and closable only by making handle ownership discoverable on
   * `IDataDriver` (filed separately).
   */
  private transactionCoversDriverFor(object: string, tx: unknown): boolean {
    const store = this.txStore.getStore();
    // The scope describes the handle in the store. An explicitly-threaded
    // handle is covered by it only when it IS that handle.
    const scope = store !== undefined && tx === store.transaction ? store.scope : undefined;
    if (!scope) return true;
    return this.getDriver(object) === scope.driver;
  }

  /**
   * Resolve the `NOW()` runtime token into the value the field's declared type
   * actually stores (#4597).
   *
   * The engine — not the driver — owns this resolution, exactly as it owns
   * `current_user`. `NOW()` is the mirror of #4560's crack: `current_user` was
   * known to the engine and not to the DDL, so the DDL stored the token text;
   * `NOW()` was known to the SQL driver and not to the engine, so every
   * non-SQL datasource got the token text instead of a time. Resolving here
   * makes one answer serve every driver.
   *
   * The shapes below are NOT invented: they are the canonical storage forms
   * ADR-0053 already fixed and `SqlDriver.nowColumnDefault` already emits
   * per type. Producing a full instant for a `Field.date` would trade the old
   * cross-driver drift for a new one (SQL would keep collapsing it to a
   * calendar day in `formatInput`, memory/mongodb would not), so the token
   * resolves per declared type:
   *
   * | field type | stored form | matches |
   * |---|---|---|
   * | `date` | `YYYY-MM-DD` (UTC day) | `toDateOnly` / the `date` column DEFAULT |
   * | `time` | `HH:MM:SS[.fff]` (UTC wall clock, `.000` trimmed) | `canonicalTimeOfDay` |
   * | anything else | `YYYY-MM-DDTHH:MM:SS.sssZ` | `canonicalUtcDatetime` |
   *
   * "Anything else" deliberately includes non-temporal fields: a `text` field
   * that opts into `NOW()` gets the instant, which is what the SQL column
   * DEFAULT gives it today.
   *
   * `instant` is the caller's per-insert `now` snapshot when the `NOW()` token
   * is what asked, so two defaulted fields on one record cannot straddle a
   * millisecond boundary.
   *
   * It is NOT only the token's, though (#7373): this is the one place that
   * knows what shape a declared type stores an instant in, so the CEL branch's
   * {@link normalizeExpressionDefault} routes its own `Date` results through
   * the SAME table rather than growing a second copy of it. Hence the
   * parameter is an arbitrary `instant`, not "now" — `daysFromNow(7)` is a
   * week out and takes the identical per-type treatment.
   */
  private resolveNowDefault(fieldType: unknown, instant: Date): string {
    const iso = instant.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
    if (fieldType === 'date') return iso.slice(0, 10);
    if (fieldType === 'time') {
      const timeOfDay = iso.slice(11, 23); // HH:MM:SS.fff
      // Trim a zero-millisecond `.000` so a defaulted row is byte-canonical and
      // still matches an equality filter against `'HH:MM:SS'` — the same trim
      // the SQL driver's time DEFAULT and `canonicalTimeOfDay` apply.
      return timeOfDay.endsWith('.000') ? timeOfDay.slice(0, 8) : timeOfDay;
    }
    return iso;
  }

  /**
   * Put a CEL `defaultValue`'s evaluated result into the storage shape the
   * field's declared type contracts for (#7373).
   *
   * The counterpart the expression branch was missing. `applyFieldDefaults`
   * has three ways to produce a default and, before this, only two of them
   * honoured the stored-value contract: the `NOW()` token routed through
   * {@link resolveNowDefault}, a literal is checked against
   * `valueSchemaFor(def, 'stored')` at AUTHOR time (#7127), and the expression
   * envelope's result was assigned verbatim. But the temporal stdlib returns a
   * JS `Date` — ADR-0053 D1 fixes `today()` / `daysFromNow(n)` / `daysAgo(n)`
   * as UTC-midnight of the reference-tz calendar day, and `now()` as the raw
   * instant — while `valueSchemaFor` says a stored instant is an ISO-8601
   * STRING. So `{ dialect: 'cel', source: 'daysFromNow(7)' }` on a `datetime`
   * put a `Date` object in the column: a value the platform's own
   * `os migrate value-shapes` scan reports as a violation.
   *
   * Why NORMALIZE rather than refuse the `Date` — the two shapes this could
   * have taken, decided on measurement:
   *
   *  - **The drivers already agree with this answer.** Handed a `Date`,
   *    `SqlDriver.formatInput` coerces it through `canonicalUtcDatetime`
   *    (`toISOString()`) and `toDateOnly` (`YYYY-MM-DD`); mongodb's
   *    `storageDatetimeValue` keeps the BSON `Date`, which is what parsing the
   *    ISO string produces anyway, and its `storageDateValue` collapses to the
   *    same `YYYY-MM-DD`. Normalizing here is therefore byte-identical on
   *    every SQL and mongodb-backed store and changes exactly one thing: the
   *    memory driver, which applies its temporal canon to filter comparands
   *    only (`coerceTemporalValue`) and stores writes as handed. That is the
   *    whole defect, and this is the smallest change that closes it.
   *  - **Refusal would single out one writer.** `validateRecord` accepts a
   *    `Date` on `date`/`datetime` from ANY caller by explicit decision
   *    (`if (value instanceof Date) return null`), and temporal types are not
   *    in ADR-0104's strict value-shape block at all. Refusing a `Date` only
   *    when a CEL default produced it would make the rule depend on who wrote
   *    the value rather than on what the value is — and would break the
   *    documented envelope (#7244) on precisely the SQL backends where it
   *    stores correctly today.
   *
   * This is the `NOW()` crack of #4597 / #4560 in its third form: a value the
   * SQL driver silently repaired at the wire and non-SQL datasources did not,
   * so one declaration stored two shapes depending on the datasource. Resolved
   * engine-side, one answer serves every driver; the driver coercions stay as
   * defence in depth for writes that bypass the engine.
   *
   * No day can shift here. ADR-0053 D1's `Date` is UTC-midnight OF the
   * reference-tz calendar day, and {@link resolveNowDefault} reads it back
   * with `toISOString()` — UTC getters, the same `getUTC*` reading the ADR
   * names for the driver filter path. Reading those parts in LOCAL time is the
   * move that would shift a day, and nothing here does it.
   *
   * Non-`Date` results (a string, a number, a bool, a list) pass through
   * untouched: this normalizes temporal FORM, it does not police the contract,
   * and a CEL default is documented as "result type is a runtime concern".
   * An `Invalid Date` passes through too — the same totality the driver
   * canons keep, so a value nothing can interpret is never silently rewritten
   * into a wrong one.
   */
  private normalizeExpressionDefault(fieldType: unknown, value: unknown): unknown {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
    return this.resolveNowDefault(fieldType, value);
  }

  /**
   * Build a HookContext.api: a ScopedContext that hooks can use to
   * read/write other objects within the same execution context.
   * Falls back to a system-elevated empty context when no execCtx
   * is supplied (e.g. system-triggered hooks).
   */
  private buildHookApi(execCtx?: ExecutionContext): ScopedContext {
    const safeCtx: ExecutionContext = execCtx ?? ({ isSystem: true } as any);
    return new ScopedContext(safeCtx, this as unknown as IDataEngine);
  }

  /**
   * The initial value a field's OPTION LIST declares — the option marked
   * `default: true` — or `undefined` when it declares none (#7246).
   *
   * `SelectOption.default` has been authorable and spec-valid since the schema
   * was written, and until this method nothing on the insert path read it: a
   * create that omitted the field stored `null`, not the marked option. The one
   * consumer anywhere was lint's `isNullableField`, which concluded the column
   * was always-valued — a **build-breaking** verdict resting on a declaration
   * the engine did not honour. Enforcing it here is what makes that heuristic
   * true rather than merely asserted.
   *
   * Deliberate decisions, each of which could reasonably have gone the other
   * way:
   *
   *  - **Precedence: `defaultValue` wins.** Not decided here — decided by the
   *    caller, which only reaches this method when `defaultValue == null`. The
   *    field-level key is the more specific declaration (it names a value for
   *    THIS field; the option flag describes the shared option list), and it is
   *    the spelling every other consumer already honours. When both are
   *    declared and disagree, the option flag is inert exactly as it is today.
   *
   *  - **Type-agnostic, like the lint heuristic.** `options` is a field-level
   *    key on `FieldSchema`, not gated on `type: 'select'`, and
   *    `isNullableField` reads it without a type test. Matching that keeps the
   *    two sides honest BY CONSTRUCTION: there is no field the lint calls
   *    always-valued that this method leaves empty.
   *
   *  - **`multiple: true` assembles an ARRAY.** That field stores an
   *    Array/JSON (`FieldSchema.multiple`: "Stores as Array/JSON"), so the
   *    shape of its default follows the field, not the number of marked
   *    options — one marked option on a multi-select defaults to a
   *    one-element array, never a bare scalar that the driver would then store
   *    with the wrong shape. Refusing (throwing) was rejected: the metadata is
   *    spec-valid, and a runtime throw on spec-valid input is a worse answer
   *    than a well-defined value. Ignoring it was rejected too — it would
   *    preserve, for multi-selects only, precisely the inertness this change
   *    removes, and an author cannot see that carve-out from the schema.
   *
   *  - **Several options marked on a SINGLE-valued field: the FIRST wins.**
   *    There is one slot, so declaration order decides — deterministic, and
   *    the same option a picker preselects when it takes the first match.
   *    Neither the `Field.select` builder nor the schema dedupes the flag, so
   *    this case is reachable; the alternative (throw) again fails a
   *    spec-valid declaration at runtime. Nothing in the shipped corpus marks
   *    more than one.
   *
   *  - **Only the canonical `default` spelling is read.** The authoring
   *    aliases (`isDefault`, `selected`) are normalized by
   *    `SelectOptionSchema`'s alias layer before metadata reaches the engine,
   *    and lint reads the canonical key only. Reading the aliases here would
   *    make the engine honour raw shapes lint calls nullable — the two would
   *    disagree in the direction that produces a false "always-valued".
   */
  private resolveOptionDefault(field: { options?: unknown; multiple?: unknown }): unknown {
    const options = field.options;
    if (!Array.isArray(options)) return undefined;
    const marked: unknown[] = [];
    for (const o of options) {
      if (!o || typeof o !== 'object') continue;
      if ((o as { default?: unknown }).default !== true) continue;
      const value = (o as { value?: unknown }).value;
      // An option marked default but carrying no value declares nothing this
      // method can apply — skipped rather than stored as `null`, which would
      // be indistinguishable from "no default" downstream.
      if (value === undefined || value === null) continue;
      marked.push(value);
    }
    if (marked.length === 0) return undefined;
    return field.multiple === true ? marked : marked[0];
  }

  /**
   * Apply field defaults to an incoming insert payload. Defaults that are
   * Expression envelopes (e.g. `{ dialect: 'cel', source: 'today()' }`,
   * `{ dialect: 'cel', source: 'os.user.id' }`) are evaluated via
   * `ExpressionEngine` against the calling user/org/now snapshot. The
   * `defaultValue` runtime TOKENS (`@objectstack/spec/data`'s
   * `DEFAULT_VALUE_TOKENS` — `current_user` and `NOW()`, the whole family) are
   * resolved here, so one declaration behaves identically on every driver.
   * Static defaults are applied verbatim. Records that already supplied a value
   * for a field are left untouched.
   *
   * "Supplied a value" means the field is present with a non-null value. Both an
   * OMITTED field (`undefined`) and an EXPLICIT `null` are treated as "not
   * supplied" and get the default. This runs on the INSERT path only, where a
   * `null` from a form (an unpicked control serializes to `null`, not omission)
   * unambiguously means "no value"; the UPDATE path never calls this, so a
   * deliberate "set to null" on update is preserved (#2706). Empty string `''`
   * is a real, user-entered value and is left as-is.
   *
   * Implements ROADMAP §M9.9b — `defaultValue` accepts Expression so authors
   * can replace "write a hook to default to today/current-user" with a
   * declarative `defaultValue: cel\`today()\``.
   *
   * A field that declares NO `defaultValue` falls back to the option marked
   * `default: true` ({@link resolveOptionDefault}, #7246) — the select idiom,
   * which until then was authorable, spec-valid, and read by nothing on this
   * path.
   */
  private applyFieldDefaults(
    object: string,
    record: Record<string, unknown>,
    execCtx?: ExecutionContext,
    nowSnapshot?: Date,
  ): Record<string, unknown> {
    const schema = this.getSchema(object);
    const fieldsRaw = (schema as any)?.fields;
    if (!fieldsRaw || typeof fieldsRaw !== 'object') return record;
    // `fields` may be a Record<string, Field> (canonical) or an array (legacy).
    const fieldEntries: Array<{
      name: string; type?: unknown; defaultValue?: unknown; options?: unknown; multiple?: unknown;
    }> = Array.isArray(fieldsRaw)
      ? fieldsRaw
      : Object.entries(fieldsRaw).map(([name, def]) => ({ name, ...(def as object) }));
    const out = { ...record };
    const now = nowSnapshot ?? new Date();
    for (const f of fieldEntries) {
      // Apply the default when the field is either OMITTED (`undefined`) or an
      // EXPLICIT `null` — both mean "no value supplied" on insert (#2706). A
      // real value (including `''`) is respected. Insert-only path, so an
      // intentional "set to null" on update is never touched here.
      if (out[f.name] != null) continue;
      if (f.defaultValue == null) {
        // No `defaultValue` — fall back to the option marked `default: true`.
        //
        // Reached ONLY through this branch, which is the whole point of putting
        // it here (#7246): an option's `value` is a plain literal by
        // construction (`SystemIdentifierSchema`), never one of the runtime
        // TOKENS below, so it must not be handed to `isCurrentUserDefaultToken`
        // / `isNowDefaultToken`. An option literally spelled `current_user`
        // stores those twelve characters — it is a picklist value, not an
        // instruction — and that is pinned by test.
        //
        // The `dv == null` gate above is the presence test that decides
        // precedence: `defaultValue: ''` is a REAL default (`'' == null` is
        // false), so it wins and this fallback never fires for it, exactly as
        // `''` supplied by a caller is respected as a real value.
        const fromOption = this.resolveOptionDefault(f);
        if (fromOption !== undefined) out[f.name] = fromOption;
        continue;
      }
      const dv = f.defaultValue;
      if (typeof dv === 'object' && dv !== null && (dv as any).dialect && typeof (dv as any).source === 'string') {
        const result = ExpressionEngine.evaluate(dv as any, {
          now,
          timezone: execCtx?.timezone,
          user: execCtx?.userId ? { id: String(execCtx.userId), positions: execCtx?.positions ?? [] } : undefined,
          org: execCtx?.tenantId ? { id: String(execCtx.tenantId) } : undefined,
          record: out,
          extra: { object },
        });
        if (result.ok) {
          // Normalized to the declared type's stored shape, never assigned
          // verbatim: the temporal stdlib returns a `Date` and the contract
          // names an ISO-8601 string (#7373 — {@link normalizeExpressionDefault}).
          out[f.name] = this.normalizeExpressionDefault(f.type, result.value);
        } else {
          this.logger.warn('Failed to evaluate default expression', {
            object, field: f.name, error: result.error,
          });
        }
      } else if (isCurrentUserDefaultToken(dv)) {
        // `current_user` token → the acting user's id at insert time. Declarative
        // counterpart to writing a beforeInsert hook; mirrors the 'NOW()' string
        // convention and is resolved app-side per request (driver-agnostic), so
        // `Field.user({ defaultValue: 'current_user' })` auto-fills the actor.
        // When there is no authenticated user (system/anonymous), leave it unset
        // and let required-validation decide — never stamp a bogus owner.
        //
        // The token spelling comes from `@objectstack/spec/data`
        // (`DEFAULT_VALUE_TOKENS`), the one place the family is declared, so a
        // driver's DDL reads the SAME set when deciding which `defaultValue`s
        // may become a physical column DEFAULT. When the two sides disagreed,
        // SQL emitted `DEFAULT 'current_user'` and the DATABASE overrode the
        // "leave it unset" decision below with a literal non-id (#4560).
        if (execCtx?.userId != null) out[f.name] = String(execCtx.userId);
      } else if (isNowDefaultToken(dv)) {
        // `NOW()` token → the insert-time clock, in the storage shape the
        // field's declared type calls for ({@link resolveNowDefault}).
        //
        // The mirror of the `current_user` crack above (#4597 / #4560): this
        // token was understood by the SQL driver and NOT by the engine, so
        // `out[f.name] = dv` sent the literal string `'NOW()'` to every
        // driver. SQL hid it — `formatInput`'s safety net swapped in a real
        // timestamp before the wire — while memory/mongodb have no such net,
        // so the same declaration behaved differently per datasource. That
        // split surfaced two ways: a validation-visible field was REJECTED by
        // the engine's own write validator ("must be a valid datetime"), and a
        // `readonly`/`system` field — which `validateRecord` skips, i.e. the
        // ~100 `created_at`/`updated_at` platform declarations — silently
        // stored the four characters `NOW()`.
        //
        // Resolved from the caller's `nowSnapshot`, so every defaulted field
        // in one insert (and every row of one batch) carries the SAME instant.
        //
        // The driver's own now-handling is unchanged and stays as defence in
        // depth: `SqlDriver.formatInput`'s safety net (now unreachable from
        // this path) and the native column DEFAULT, which still serves writes
        // that bypass the engine entirely — the same division of labour
        // `current_user` has.
        out[f.name] = this.resolveNowDefault(f.type, now);
      } else {
        out[f.name] = dv;
      }
    }
    return out;
  }

  /**
   * Generate values for empty `autonumber` fields on insert — ONLY for drivers
   * that do not generate them natively (memory, mongodb). For SQL-backed objects
   * the driver owns a persistent, atomic `_objectstack_sequences` table and
   * advertises `supports.autonumber === true`; the engine then defers entirely
   * and never pre-fills (so the persistent sequence is the single source of
   * truth — see #1603). Required-validation exempts `autonumber` either way, so
   * a `required` record number is never rejected for "missing" — the runtime
   * owns the value, not the client.
   *
   * That ownership is now ENFORCED rather than merely asserted (#5503): the
   * insert path strips a caller-supplied value before this runs, so the "respect
   * explicit value" skip below is reached only by writers the strip exempts —
   * `isSystem` (seed replay, migration) and an opt-in historical import
   * (`preserveAudit`), plus values a `beforeInsert` hook computed server-side.
   * For every other caller the slot arrives empty and the sequence issues the
   * number. Do NOT "fix" a forged value here by overwriting it: the strip must
   * stay upstream of this method, because a driver with
   * `supports.autonumber === true` returns above without ever entering the loop.
   *
   * In the fallback path the next value is `max(existing) + 1`, seeded once per
   * `object.field.<scope>` from the store then incremented in memory (monotonic
   * within the process, resilient to deletions). The shared `autonumberFormat`
   * renderer is honored end-to-end, so date tokens (`AD{YYYYMMDD}{0000}`), field
   * interpolation (`{island_zone}{000}`) and per-scope reset behave identically
   * to the SQL driver's persistent sequence (#1603). NOTE: this in-memory seeding
   * is single-instance.
   *
   * # A format-LESS field renders through the contract default, not bare (#6555)
   *
   * "Identically to the SQL driver" was true of every DECLARED format and false
   * of the one case nobody declares: with no format at all this method used to
   * hand `parseAutonumberFormat` the empty string, whose empty token list
   * `renderAutonumber` renders through its no-slot branch as a BARE counter —
   * `1`, `2`, …. The SQL driver substituted `'{0000}'` in the same case and
   * issued `0001`, `0002`, …. One metadata document, two number shapes, decided
   * by which driver happened to serve it; the counter VALUE always agreed
   * (#6468 pinned that), so what forked was rendering width alone.
   *
   * The maintainer ruling of 2026-08-08 (#6555, route 3) puts the default in the
   * contract instead of in either fallback, and this method now reads it:
   * {@link resolveAutonumberFormat} answers the canonical `autonumberFormat`,
   * then the `format` shorthand (#1603), then `DEFAULT_AUTONUMBER_FORMAT`
   * (`{0000}`). Two consequences, both deliberate:
   *
   *   - A format-less field on this path now issues `0001` where it issued `1`.
   *     `{0000}` was chosen because it is the shape SQL deployments already
   *     store, so the flip lands on engine-fallback deployments only.
   *   - "Declared" is now a NON-EMPTY string (the SQL driver's long-standing
   *     truthiness rule) rather than the `??` this method used, so
   *     `autonumberFormat: ''` resolves to the default too instead of rendering
   *     bare — and an empty canonical key no longer masks a declared `format`
   *     shorthand. The bare counter is still reachable, by declaring a format
   *     with no `{0..0}` slot (`'PRE-'` → `PRE-1`).
   *
   * Seeding is untouched by all of this: `{0000}` renders prefix `''` and suffix
   * `''`, so {@link readStoredAutonumberCounter} stays on its UNANCHORED legacy
   * branch and reads already-stored bare values exactly as before.
   *
   * # Keeping the seeded counter in sync (#6806)
   *
   * Seeding "once per counter key" is only the truth while the engine is the
   * ONLY writer of the field. It is not: the `continue` below is reached by
   * every exempt writer (`isSystem` seed replay, a `preserveAudit` historical
   * import, a `beforeInsert` hook stamp), and each of those persists a record
   * number the counter never saw. The counter then keeps issuing from where the
   * one-time seed left it — below the store's real max — and every number it
   * issues up to that max is a duplicate business identifier. Two resyncs
   * close that, from opposite ends:
   *
   *   - **Adopt, here.** An exempt value passes through this very loop, so the
   *     counter can be lifted from it for FREE — one string parse, no query.
   *     {@link adoptExplicitAutonumber} does it, which makes the warm in-memory
   *     counter converge on what a cold re-seed of the same store would answer.
   *     This is the whole fix for in-process drift, and it costs nothing on the
   *     generating path (a caller-supplied value never reaches this method
   *     unless the writer is exempt).
   *   - **Re-seed on collision**, at the write. Adoption cannot see a writer
   *     outside this process (another instance, a direct driver write, a
   *     restore). Those surface as a unique-constraint failure on the create,
   *     and {@link createWithAutonumberResync} answers it by dropping the stale
   *     counter, re-seeding from the store and re-issuing — bounded. It costs
   *     nothing until a collision actually happens.
   *
   * Both are required and neither subsumes the other: adoption covers drift the
   * engine can observe but the store cannot report, collision-resync covers
   * drift the store reports but the engine could not observe.
   *
   * @returns the autonumbers this call ISSUED, in field order — the input
   * {@link createWithAutonumberResync} needs to decide whether a unique
   * violation is one of its own numbers. An adopted (caller-supplied) value is
   * deliberately NOT listed: it is not the engine's to re-issue.
   */
  private async applyAutonumbers(
    object: string,
    record: Record<string, unknown>,
    execCtx?: ExecutionContext,
    driverOwnsAutonumber?: boolean,
  ): Promise<IssuedAutonumber[]> {
    if (driverOwnsAutonumber) return []; // driver generates persistently in create()
    const fields = (this.getSchema(object) as any)?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
    const now = new Date();
    const timezone = execCtx?.timezone;
    const issued: IssuedAutonumber[] = [];
    for (const [name, def] of Object.entries(fields)) {
      if ((def as any)?.type !== 'autonumber') continue;
      // The contract answers "which format?" — canonical `autonumberFormat`,
      // then the `format` shorthand (#1603), then the declared default
      // `{0000}`. One resolver, shared with the SQL driver, so a format-less
      // field cannot render two shapes again (#6555; see the docstring above).
      // `fmt` is kept only for the diagnostic below, which now names the format
      // actually rendered with rather than `undefined`.
      const fmt = resolveAutonumberFormat(def as never);
      const tokens = parseAutonumberFormat(fmt);
      const current = record[name];
      // Respect an explicit value — reachable only for an EXEMPT writer now
      // (isSystem / preserveAudit / a hook stamp): #5503's strip removed every
      // other caller's value before this method was called. Respecting it is
      // unchanged; what is new is that the counter LEARNS from it (#6806).
      if (current != null && current !== '') {
        this.adoptExplicitAutonumber(object, name, tokens, record, String(current), now, timezone);
        continue;
      }
      // Refuse to generate when an interpolated `{field}` is empty — it would
      // render to an empty prefix and merge this record into the wrong counter
      // scope. Mirror the SQL driver so both paths fail identically (#1603).
      const missing = missingFieldValues(tokens, record);
      if (missing.length > 0) {
        throw new Error(
          `Cannot generate autonumber "${object}.${name}" (format "${fmt}"): ` +
            `referenced field(s) [${missing.join(', ')}] are empty on the record. ` +
            `Fields interpolated into an autonumber format must be set before the record is created.`,
        );
      }
      // The counter scope is the rendered prefix (date/field tokens before the
      // sequence slot); it is independent of the counter value, so a throwaway
      // render with seq 0 yields the scope and the literal prefix to seed from.
      const probe = renderAutonumber({ tokens, seq: 0, record, now, timezone });
      const counterKey = `${object}.${name}.${probe.scope}`;
      let next = this.autonumberCounters.get(counterKey);
      if (next == null) next = await this.seedAutonumber(object, name, probe.prefix, probe.suffix, execCtx);
      next += 1;
      this.autonumberCounters.set(counterKey, next);
      record[name] = renderAutonumber({ tokens, seq: next, record, now, timezone }).value;
      issued.push({ field: name, counterKey });
    }
    return issued;
  }

  /**
   * Lift the in-memory counter to a record number an EXEMPT writer supplied
   * (#6806) — the free half of the resync, and the one that closes the shape
   * #5495's PROBE1 measured on a warm database.
   *
   * The value is parsed with {@link readStoredAutonumberCounter}, i.e. by
   * exactly the anchoring rules #6468 gave the seeding scan, against the
   * prefix/suffix this record's own format renders. So adopting is the same reading a cold re-seed
   * would perform over the same row — which is the invariant to hold on to: a
   * warm counter must answer what a restart would answer.
   *
   * Four deliberate refusals, each one a way this could do harm:
   *
   *   - **Never throws.** An exempt write is not the engine's to reject, and it
   *     was not rejected before this method existed. A format whose `{field}`
   *     interpolation is empty, or a value that parses to nothing, simply
   *     teaches the counter nothing.
   *   - **Only LIFTS a counter that is already seeded.** With no seed in hand,
   *     writing this value in would SKIP the seeding scan and answer from one
   *     row — below the real max whenever the store holds a higher number, i.e.
   *     the duplicate-number defect itself. Doing nothing is correct: the row is
   *     persisted, so the first generating insert's own scan reads it.
   *   - **Never lowers.** A counter that has already issued numbers must not go
   *     back over them; the max is a floor that only rises.
   *   - **Only within this record's scope.** The reading returns `undefined`
   *     for a value that does not carry the rendered prefix, so a
   *     historical import into last month's date scope cannot lift THIS
   *     month's counter. Its own scope's counter is left untouched, which is
   *     harmless: a scope is derived from the write instant, so a past scope's
   *     counter is not one a subsequent generating insert can reach.
   *
   * Adoption runs BEFORE the driver write, so an exempt insert that then fails
   * leaves the counter lifted over a number nobody took — a gap. Gaps are
   * already the documented cost of this path (a failed attempt consumes its
   * value; the counter is "resilient to deletions"), and the direction is the
   * safe one: a gap is a cosmetic surprise, a duplicate is a corrupted business
   * identifier.
   */
  private adoptExplicitAutonumber(
    object: string,
    field: string,
    tokens: ReturnType<typeof parseAutonumberFormat>,
    record: Record<string, unknown>,
    value: string,
    now: Date,
    timezone?: string,
  ): void {
    let probe: ReturnType<typeof renderAutonumber>;
    try {
      // An empty `{field}` would render an empty prefix and point at the wrong
      // counter — the same hazard the generating branch throws on. Here it is a
      // reason to learn nothing, never a reason to fail the caller's write.
      if (missingFieldValues(tokens, record).length > 0) return;
      probe = renderAutonumber({ tokens, seq: 0, record, now, timezone });
    } catch {
      return;
    }
    const counterKey = `${object}.${field}.${probe.scope}`;
    const seeded = this.autonumberCounters.get(counterKey);
    if (seeded == null) return; // not seeded yet — the first seed scan will read this row
    const supplied = readStoredAutonumberCounter(value, probe.prefix, probe.suffix);
    if (supplied == null || supplied <= seeded) return;
    this.autonumberCounters.set(counterKey, supplied);
    this.logger.debug('Autonumber counter lifted to an externally supplied value', {
      object, field, counterKey, from: seeded, to: supplied,
    });
  }

  /**
   * Create ONE record, re-seeding and re-issuing when the driver rejects an
   * autonumber the engine itself issued as a duplicate (#6806).
   *
   * # What this is for
   *
   * A counter that sits below the store's real max — because a writer outside
   * this process took numbers the engine could not observe — collides on every
   * insert until it has walked past that max one number at a time. Before this,
   * each of those inserts failed with the driver's raw error AND advanced the
   * counter, so a warm-database storm burned a number per failed create and
   * never converged on its own (#5495's PROBE3). Dropping the counter on the
   * collision is what converges it: the re-seed reads the true max back, and
   * the next attempt is issued from it.
   *
   * # Which failures qualify
   *
   *   - The engine must have ISSUED an autonumber on this row. A row whose
   *     numbers all came from an exempt writer has nothing here to re-issue.
   *   - The error must be a unique violation, per `isUniqueViolationError`
   *     (#6250) — never a word-list of this method's own.
   *   - When the dialect names the conflicting COLUMN (`uniqueViolationColumn`,
   *     #6544), it must be one of the fields the engine issued. A conflict on
   *     some other unique field is the caller's business error and is rethrown
   *     untouched, exactly as #5495's disposition ruled («非本字段的冲突原样上抛»).
   *     When the dialect names no determinable column the attribution falls back
   *     to "the engine issued a number on this row, and the row was refused as a
   *     duplicate" — deliberately, because `uniqueViolationColumn` answers
   *     `undefined` for every index-named dialect, which includes MongoDB's
   *     `E11000 ... index: doc_no_1`, i.e. the ONE fallback driver that can
   *     raise this at all. Requiring a named column would make the resync
   *     unreachable on exactly the driver that needs it. The cost of the
   *     fallback is a wasted re-issue when an unrelated unique field is what
   *     actually conflicted: the second attempt fails the same way, and the
   *     original error is what the caller finally sees.
   *
   * # ⚠ The guarantee is STORAGE-DEPENDENT — say so, do not imply otherwise
   *
   * This whole branch is triggered by the storage layer REJECTING the duplicate,
   * so it reaches only drivers that (1) take this fallback path at all and
   * (2) enforce uniqueness. Measured across all five in-repo drivers:
   *
   * | driver | `supports.autonumber` | fallback path? | uniqueness on the column | a collision appears as |
   * |:---|:---|:---|:---|:---|
   * | driver-memory | `supports = {}` | **yes** | **none, ever** | **nothing** — a silent duplicate |
   * | driver-mongodb | absent (`{ batchSchemaSync: true }`) | **yes** | single-field unique index when the field declares `unique` | `E11000 duplicate key` → re-seed + re-issue, here |
   * | driver-sql | `autonumber: true` | no | — | — |
   * | driver-sqlite-wasm | inherited (`extends SqlDriver`, no `supports` override) | no | — | — |
   * | driver-turso | inherited (`...super.supports`) | no | — | — |
   *
   * So the retry protects essentially ONE backend: driver-mongodb with a
   * `unique` autonumber field. That is not a new claim — it is the reading the
   * repo already ruled and gates, in
   * `scripts/driver-memory-census.ledger.json`'s disposition for
   * `packages/runtime/src/autonumber-seed-cross-side-parity.integration.test.ts`
   * (axis `ruled-permanent`, «#6664 A, maintainer 2026-08-08 — inherits #5704
   * Q2 = B»), which states it as: "InMemoryDriver declares `supports = {}`, so
   * the ENGINE's autonumber seeding owns the counter. No SQL backend can stand
   * in — SqlDriver advertises the capability and its own sequence bootstrap
   * answers instead". This comment cites that ruling rather than restating it:
   * a second answer to "who owns the autonumber counter" is the same
   * one-contract-two-numbers defect this lane keeps closing (#6832).
   *
   * `InMemoryDriver.create` is a `table.push()` and it stores no constraints of
   * any kind — its own docstring says so since #4065, and calls itself a WEAK
   * oracle for exactly this reason. So on driver-memory an out-of-process
   * duplicate cannot raise anything for this method to catch, and the number
   * lands twice in the rendered field with no error anywhere.
   *
   * That is stated rather than papered over (PD #10: never advertise a
   * capability the runtime does not deliver). What covers driver-memory is the
   * OTHER half of this resync — {@link adoptExplicitAutonumber} — which needs no
   * constraint at all because it never waits for a rejection. Between them: drift
   * the engine can observe is fixed on every driver; drift only the store can
   * report is fixed wherever the store reports it.
   *
   * ⛔ The remedy for the silent-duplicate row is uniqueness enforcement in the
   * driver, NOT a pre-issue existence probe here: a probe costs a query on every
   * insert (the cost this resync was designed to avoid) and is still racy, so it
   * would trade a silent duplicate for a rarer silent duplicate at double the
   * read cost. `packages/drivers/**` is under the #5499 investment freeze, so
   * that work is not this change's to do.
   *
   * # And when it does not converge
   *
   * After {@link AUTONUMBER_COLLISION_ATTEMPTS} the write fails with a named
   * engine error (`code: 'ERR_AUTONUMBER_COLLISION'`) carrying the driver's
   * error as `cause`. The raw driver error is deliberately NOT the contract
   * here: "your record number collided three times after re-seeding" is an
   * engine-level condition a caller can act on, and the driver's prose is
   * preserved rather than replaced.
   */
  private async createWithAutonumberResync(
    driver: any,
    object: string,
    row: Record<string, unknown>,
    driverOptions: any,
    issued: IssuedAutonumber[],
    execCtx: ExecutionContext | undefined,
    driverOwnsAutonumber: boolean,
  ): Promise<any> {
    let attempt = 1;
    for (;;) {
      try {
        return await driver.create(object, row, driverOptions);
      } catch (error) {
        if (!this.isIssuedAutonumberCollision(error, issued)) throw error;
        // Whatever happens next, the stale counter must not survive this call:
        // leaving it in place is what turned one collision into a storm.
        for (const one of issued) this.autonumberCounters.delete(one.counterKey);
        if (attempt >= AUTONUMBER_COLLISION_ATTEMPTS) {
          const fields = issued.map((one) => one.field).join(', ');
          throw Object.assign(
            new Error(
              `Autonumber collision on '${object}' field(s) [${fields}]: the record number was ` +
                `re-seeded from the store and re-issued ${AUTONUMBER_COLLISION_ATTEMPTS} times and the ` +
                `driver rejected each one as a duplicate. No record was written.`,
            ),
            { code: 'ERR_AUTONUMBER_COLLISION', cause: error },
          );
        }
        attempt += 1;
        this.logger.warn('Autonumber collided — re-seeding the counter and re-issuing', {
          object, fields: issued.map((one) => one.field), attempt,
        });
        // Clear the slots so `applyAutonumbers` treats them as empty again —
        // leaving the burned value in place would read as an exempt writer's
        // and be adopted rather than re-issued.
        for (const one of issued) delete row[one.field];
        issued = await this.applyAutonumbers(object, row, execCtx, driverOwnsAutonumber);
        // Nothing left to re-issue (the field vanished from the schema
        // mid-flight) — the next failure is the caller's to see.
        if (issued.length === 0) return await driver.create(object, row, driverOptions);
      }
    }
  }

  /**
   * Whether `error` is a unique violation attributable to one of the
   * autonumbers this insert issued (#6806). See
   * {@link createWithAutonumberResync} for why an unnamed column counts as
   * attributable and a differently-named one does not.
   */
  private isIssuedAutonumberCollision(error: unknown, issued: IssuedAutonumber[]): boolean {
    if (issued.length === 0) return false;
    if (!isUniqueViolationError(error)) return false;
    const column = uniqueViolationColumn(error);
    if (column === undefined) return true;
    return issued.some((one) => one.field === column);
  }

  /**
   * Seed the autonumber counter from the current max in store, scoped to
   * `prefix`. With a non-empty prefix (date/field formats) only rows in the
   * same scope count.
   *
   * # Locating the counter inside a stored value (#6468)
   *
   * `renderAutonumber` composes `prefix + zero-padded(seq) + suffix`, and
   * `suffix` is a DECLARED return value: every token after the `{0..0}` slot
   * renders behind the counter (`{000}-{YYYY}` → `001-2026`). So the counter is
   * NOT "the digits at the end of the string" — reading it that way took the
   * year for the counter and seeded `2026` against a true counter of `1`, which
   * jumps the next issued number to `2027-2026` and burns the band in between.
   *
   * Both the rendered `prefix` and the rendered `suffix` therefore come in from
   * the caller (they are `renderAutonumber`'s own output — this method does not
   * re-derive any format understanding of its own, and neither does the SQL
   * driver's `scanMaxNumericTail`, which is handed the same two strings):
   *
   *   - **Either one declared ⇒ the slot is ANCHORED**: the counter is the digit
   *     run at the START of what follows the prefix, after removing the declared
   *     suffix when this row carries it. That half is spec's
   *     `readAutonumberCounter` — the declared inverse of `renderAutonumber`,
   *     which the SQL driver's scan calls too, so one edit moves both sides
   *     (#6560).
   *   - **Neither declared ⇒ UNANCHORED**: the legacy reading is kept — the LAST
   *     digit run of the whole value. A format with no `{0..0}` slot renders a
   *     bare trailing counter, and values predating any format have no anchor to
   *     read from, so this stays exactly as it was. The SQL driver's legacy
   *     reading of this case differs on purpose, which is why it stays per-side.
   *
   * The two together are {@link readStoredAutonumberCounter}, module-level
   * rather than inline, because #6806's resync must read an exempt writer's
   * supplied value by exactly these rules.
   *
   * The suffix is *stripped when it matches*, never *required* to match: a
   * dynamic suffix renders differently per row (`{000}-{YYYY}` is `-2025` on
   * last year's rows) while the counter scope is the rendered PREFIX — here `''`
   * — so those rows share this very counter and must still be counted. Skipping
   * them would seed BELOW the real max, which is the duplicate-record-number
   * harm #6249 fixed on the scan side. Reading the leading digit run gets them
   * right regardless; the strip only adds precision when a suffix begins with a
   * digit (`{0000}{YYYY}`, whose values are ambiguous by construction — the
   * compile lint nudges authors to a delimiter).
   *
   * # Why this walks every row in the scope (#6249)
   *
   * The seed used to be one `find` with `limit: 5000`, no `orderBy` and no
   * filter: the max of an ARBITRARY 5000-row window (on SQL, typically the
   * oldest 5000 rows), which for any object past that size — or any scope
   * whose rows sit outside the window because other scopes filled it — seeds
   * BELOW the real MAX. The counter then issues numbers from an already-taken
   * band, and on a `unique` record-number field that is a duplicate business
   * identifier: a value written wrong, which no retry and no restart repairs
   * (the same class of harm as the read-outage half fixed in #5979/#6114).
   *
   * The scan is therefore complete rather than windowed, in the shape the
   * SQL driver's own seeding already uses (`scanMaxNumericTail` pushes
   * `like 'prefix%'` down with NO limit). Two deliberate choices:
   *
   *   - **The numeric max is computed here, never delegated to an ORDER BY or
   *     an aggregate `max`.** Both of those rank the stored value as TEXT, and
   *     lexicographic order equals numeric order only when every value in the
   *     scope is zero-padded to one fixed width — which the format language
   *     does not guarantee (`{0}` pads to nothing, and any width OVERFLOWS
   *     once the counter passes it, putting `CASE-99999` above `CASE-100000`).
   *     The empty-prefix legacy path, which reads the LAST digit run of the
   *     whole value, has no lexicographic reading at all. Parsing every value
   *     keeps one code path correct for every format instead of a fast path
   *     guarded by assumptions a format author can silently break.
   *   - **Seek pagination, not `offset`** — `keysetWalk`'s own rationale
   *     (#4363): an offset walk cannot promise it visited every row, and a
   *     row it skips is exactly a number this seed must not miss.
   *
   * `prefix` is pushed down as `$startsWith` so a date/`{field}` scope reads
   * its own rows instead of paging through every other scope's. The JS-side
   * `startsWith` re-check below is kept as the authority: a driver whose
   * matching is LOOSER (a case-insensitive `LIKE`) must not be able to inflate
   * the max with another scope's rows.
   */
  private async seedAutonumber(
    object: string,
    field: string,
    prefix: string,
    suffix: string,
    execCtx?: ExecutionContext,
  ): Promise<number> {
    try {
      // Canonical `fields`, not the wire spelling `select` — this call sat on
      // the exact #4371 silent drop (the projection never applied; the scan
      // worked only because an unprojected row still carries `field`), and the
      // catch below would have swallowed the guard's rejection into "seed
      // from 0", i.e. duplicate autonumbers.
      const walk = keysetWalk<Record<string, unknown>>(
        (q: KeysetPageQuery) => this.find(object, {
          ...q,
          fields: ['id', field],
          context: execCtx,
        } as any),
        {
          where: prefix ? { [field]: { $startsWith: prefix } } : undefined,
          pageSize: AUTONUMBER_SEED_PAGE_SIZE,
        },
      );
      let max = 0;
      for await (const page of walk.pages()) {
        for (const r of page) {
          const v = r?.[field];
          if (v == null) continue;
          // The reading itself lives in `readStoredAutonumberCounter` (the
          // section above describes it) because #6806's adopt-on-exempt-write
          // resync must read a supplied value by the SAME rules this scan reads
          // a stored one — two copies of it would drift into two different
          // answers for one row, which is a duplicate record number. Its
          // anchored half is spec's `readAutonumberCounter`, the one the SQL
          // driver's own scan calls (#6560).
          const counter = readStoredAutonumberCounter(String(v), prefix, suffix);
          if (counter != null) max = Math.max(max, counter);
        }
      }
      // The walk is unbounded (no `max`), so truncation here means the scan
      // could not COMPLETE: a row carried no `id` to seek past, or the reader
      // never applied the seek predicate. Either way rows were left unread, and
      // the max over what was read is a floor, not the max. Answering with it
      // is the "seed below the real MAX" defect this method was fixed for, so
      // it fails loudly instead — the same disposition #6114 gave the read
      // outage: allocate nothing, write nothing.
      if (walk.truncated) {
        throw new Error(
          `Cannot seed the autonumber counter for "${object}.${field}": the seeding scan ` +
            `could not visit every stored row (it stopped after ${walk.scanned} rows without ` +
            `reaching the end). Seeding from a partial scan would issue record numbers that ` +
            `collide with existing ones, so no number was allocated.`,
        );
      }
      return max;
    } catch (error) {
      // [#5979] Discriminate by error TYPE. Seeding from 0 is the truth for
      // exactly ONE failure reason — the table has not been provisioned, so
      // there are genuinely no rows and number 1 collides with nothing.
      if (isMissingTableError(error)) return 0;
      // Every other failure (connection drop, timeout, permission denial,
      // query error) means the rows may well exist and simply were not seen.
      // Answering 0 there restarts the sequence at 1 against a table already
      // holding N rows and issues autonumbers that COLLIDE with existing ones
      // — a value written wrong, which no retry and no restart repairs. So the
      // read failure propagates and the caller allocates nothing: the write
      // fails loudly instead of succeeding with a forged business identifier.
      // This is the hazard the #4371 comment above the read already named.
      throw error;
    }
  }

  /**
   * Register contribution (Manifest)
   * 
   * Installs the manifest as a Package (the unit of installation),
   * then decomposes it into individual metadata items (objects, apps, actions, etc.)
   * and registers each into the SchemaRegistry.
   * 
   * Key: Package ≠ App. The manifest is the package. The apps[] array inside
   * the manifest contains UI navigation definitions (AppSchema).
   */
  registerApp(manifest: any) {
      const id = manifest.id || manifest.name;
      const namespace = manifest.namespace as string | undefined;
      this.invalidateSummaryIndex(); // new objects may add/change summary fields
      this.logger.debug('Registering package manifest', { id, namespace });

      // Store manifest for defaultDatasource lookup
      if (id) {
        this.manifests.set(id, manifest);
      }

      // Index datasource definitions (ADR-0015) so the write gate can read
      // schemaMode + external.allowWrites. Manifests may carry `datasources`
      // as an array or a name-keyed map.
      if (manifest.datasources) {
        const dsList = Array.isArray(manifest.datasources)
          ? manifest.datasources
          : Object.entries(manifest.datasources).map(([name, def]) => ({ name, ...(def as any) }));
        for (const ds of dsList) {
          if (ds?.name) this.registerDatasourceDef(ds);
        }
      }

      // 1. Register the Package (manifest + lifecycle state)
      this._registry.installPackage(manifest);
      this.logger.debug('Installed Package', { id: manifest.id, name: manifest.name, namespace });

      // 2. Register owned objects
      if (manifest.objects) {
          if (Array.isArray(manifest.objects)) {
             this.logger.debug('Registering objects from manifest (Array)', { id, objectCount: manifest.objects.length });
             for (const objDef of manifest.objects) {
                const fqn = this._registry.registerObject(objDef, id, namespace, 'own');
                this.logger.debug('Registered Object', { fqn, from: id });
             }
          } else {
             this.logger.debug('Registering objects from manifest (Map)', { id, objectCount: Object.keys(manifest.objects).length });
             // `manifest` is `any` (a raw authored manifest), so the map branch
             // widens its values to `unknown`. State the contract once, on the
             // entries, rather than casting the argument at the call: the map
             // values ARE authored `ServiceObject`s — the INPUT shape, which is
             // what `registerObject` takes since ADR-0122 phase 2 (#6083).
             for (const [name, objDef] of Object.entries(manifest.objects) as [string, ServiceObject][]) {
                // Ensure name in definition matches key
                objDef.name = name;
                const fqn = this._registry.registerObject(objDef, id, namespace, 'own');
                this.logger.debug('Registered Object', { fqn, from: id });
             }
          }
      }

      // 2b. Register object extensions (fields added to objects owned by other packages)
      if (Array.isArray(manifest.objectExtensions) && manifest.objectExtensions.length > 0) {
          this.logger.debug('Registering object extensions', { id, count: manifest.objectExtensions.length });
          for (const ext of manifest.objectExtensions) {
              const targetFqn = ext.extend;
              const priority = ext.priority ?? 200;
              // Create a partial object definition for the extension
              const extDef = {
                  name: targetFqn, // Use the target FQN as name
                  fields: ext.fields,
                  label: ext.label,
                  pluralLabel: ext.pluralLabel,
                  description: ext.description,
                  validations: ext.validations,
                  indexes: ext.indexes,
              };
              // Register as extension (namespace is undefined since we're targeting by FQN)
              this._registry.registerObject(extDef, id, undefined, 'extend', priority);
              this.logger.debug('Registered Object Extension', { target: targetFqn, priority, from: id });
          }
      }

      // 3. Register apps (UI navigation definitions) as their own metadata type
      //    Resolve short objectName references in navigation to FQN so the
      //    Console UI can match them against the object registry.
      if (Array.isArray(manifest.apps) && manifest.apps.length > 0) {
          this.logger.debug('Registering apps from manifest', { id, count: manifest.apps.length });
          for (const app of manifest.apps) {
              const appName = app.name || app.id;
              if (appName) {
                  const resolved = namespace ? this.resolveNavObjectNames(app, namespace) : app;
                  this._registry.registerApp(resolved, id);
                  this.logger.debug('Registered App', { app: appName, from: id });
              }
          }
      }

      // 4. If manifest itself looks like an App (has navigation), also register as app
      //    This handles the case where the manifest IS the app definition (legacy/simple packages)
      if (manifest.name && manifest.navigation && !manifest.apps?.length) {
          const resolved = namespace ? this.resolveNavObjectNames(manifest, namespace) : manifest;
          this._registry.registerApp(resolved, id);
          this.logger.debug('Registered manifest-as-app', { app: manifest.name, from: id });
      }

      // 4b. Register navigation contributions (ADR-0029 D7) — nav items this
      //     package injects into apps owned by other packages (e.g. a
      //     capability plugin adding its menu into the `setup` app). Merged
      //     into the target app's navigation on read by group id + priority.
      if (Array.isArray((manifest as any).navigationContributions) && (manifest as any).navigationContributions.length > 0) {
          for (const contribution of (manifest as any).navigationContributions) {
              this._registry.registerAppNavContribution(contribution, id);
          }
          this.logger.debug('Registered navigation contributions', {
              from: id,
              count: (manifest as any).navigationContributions.length,
          });
      }

      // 5. Register all other metadata types generically — the SAME seam the
      //    nested-plugin path uses (`registerMetadataCollections`), so the two
      //    entry points cannot answer differently for one collection (#7163).
      this.registerMetadataCollections(manifest, id, 'manifest');

      // 6. Register seed data as metadata (keyed by target object name)
      const seedData = (manifest as any).data;
      if (Array.isArray(seedData) && seedData.length > 0) {
          this.logger.debug('Registering seed data datasets', { id, count: seedData.length });
          for (const dataset of seedData) {
              if (dataset.object) {
                  this._registry.registerItem('data', dataset, 'object' as any, id);
              }
          }
      }

      // 6. Register contributions
       if (manifest.contributes?.kinds) {
          this.logger.debug('Registering kinds from manifest', { id, kindCount: manifest.contributes.kinds.length });
          for (const kind of manifest.contributes.kinds) {
            this._registry.registerKind(kind);
            this.logger.debug('Registered Kind', { kind: kind.name || kind.type, from: id });
          }
       }

      // 7. Recursively register nested plugins
      if (Array.isArray(manifest.plugins) && manifest.plugins.length > 0) {
          this.logger.debug('Processing nested plugins', { id, count: manifest.plugins.length });
          for (const plugin of manifest.plugins) {
              if (plugin && typeof plugin === 'object') {
                  const pluginName = plugin.name || plugin.id || 'unnamed-plugin';
                  this.logger.debug('Registering nested plugin', { pluginName, parentId: id });
                  this.registerPlugin(plugin, id, namespace);
              }
          }
      }
  }

  /**
   * Deep-clone an app definition, resolving objectName references in navigation
   * items via the registry. Object names are canonical identifiers — no FQN
   * expansion is applied.
   */
  private resolveNavObjectNames(app: any, namespace: string): any {
      if (!app.navigation) return app;

      const resolveItems = (items: any[]): any[] =>
          items.map((item: any) => {
              const resolved = { ...item };
              if (resolved.objectName && !resolved.objectName.includes('__')) {
                  resolved.objectName = computeFQN(namespace, resolved.objectName);
              }
              if (Array.isArray(resolved.children)) {
                  resolved.children = resolveItems(resolved.children);
              }
              return resolved;
          });

      return { ...app, navigation: resolveItems(app.navigation) };
  }

  /**
   * Register a nested plugin's metadata (objects, actions, views, etc.)
   *
   * Unlike registerApp(), this does NOT call SchemaRegistry.installPackage()
   * because plugins are not formal manifests — they are lightweight config
   * bundles with objects, actions, triggers, and navigation.
   *
   * @param plugin - The plugin config object
   * @param parentId - The parent package ID (for ownership tracking)
   * @param parentNamespace - The parent package's namespace (for FQN resolution)
   */
  private registerPlugin(plugin: any, parentId: string, parentNamespace?: string) {
      const pluginName = plugin.name || plugin.id || 'unnamed';
      const pluginNamespace = plugin.namespace || parentNamespace;

      // Use parentId as the owning package for namespace consistency.
      // The parent package already claimed the namespace — nested plugins
      // contribute objects UNDER the parent's ownership.
      const ownerId = parentId;

      // Register objects (supports both Array and Map formats)
      if (plugin.objects) {
          try {
              if (Array.isArray(plugin.objects)) {
                  this.logger.debug('Registering plugin objects (Array)', { pluginName, count: plugin.objects.length });
                  for (const objDef of plugin.objects) {
                      const fqn = this._registry.registerObject(objDef, ownerId, pluginNamespace, 'own');
                      this.logger.debug('Registered Object', { fqn, from: pluginName });
                  }
              } else {
                  // Same contract statement as the manifest map branch above —
                  // authored `ServiceObject`s (INPUT shape, ADR-0122 phase 2).
                  const entries = Object.entries(plugin.objects) as [string, ServiceObject][];
                  this.logger.debug('Registering plugin objects (Map)', { pluginName, count: entries.length });
                  for (const [name, objDef] of entries) {
                      objDef.name = name;
                      const fqn = this._registry.registerObject(objDef, ownerId, pluginNamespace, 'own');
                      this.logger.debug('Registered Object', { fqn, from: pluginName });
                  }
              }
          } catch (err: any) {
              this.logger.warn('Failed to register plugin objects', { pluginName, error: err.message });
          }
      }

      // Register plugin as app if it has navigation (for sidebar display)
      if (plugin.name && plugin.navigation) {
          try {
              const resolved = pluginNamespace ? this.resolveNavObjectNames(plugin, pluginNamespace) : plugin;
              this._registry.registerApp(resolved, ownerId);
              this.logger.debug('Registered plugin-as-app', { app: plugin.name, from: pluginName });
          } catch (err: any) {
              this.logger.warn('Failed to register plugin as app', { pluginName, error: err.message });
          }
      }

      // Register metadata arrays (actions, views, triggers, etc.) through the
      // SAME seam the manifest path uses — same stamping seam, one level down: a
      // nested plugin's declarations must carry the parent package's ADR-0010
      // provenance too, or the declared-≠-enforced hole reopens for packages
      // that ship a collection from a nested plugin (`capabilities` #5870;
      // `jobs` / `emailTemplates` / `tools` / `skills` #7049, which is why the
      // list is no longer copied here to be patched one name at a time; the
      // aggregated-view expansion, #7163, for why the loop BODY is no longer
      // copied here either).
      this.registerMetadataCollections(plugin, ownerId, 'nested plugin');
  }

  /**
   * Register one source's stack collections into the registry — the SINGLE
   * body both registration seams run.
   *
   * ## Why this is one method and not two loops (#7163)
   *
   * It used to be two, and #7049 only got halfway: that card hoisted the
   * ENUMERATION (`METADATA_ARRAY_KEYS`) out of the two seams after they had
   * drifted four collections apart, and measured the loop bodies against each
   * other on the way past — recording that they still differed in a per-key
   * `debug` line, the manifest seam's aggregated-view expansion, and its
   * warn-on-nameless-item. Sharing the list made "which collections does a
   * seam see?" unanswerable-differently; it left "what does a seam DO with a
   * collection both see?" still answered in two places.
   *
   * `views` is where that cost was measurable. "Object has-many View"
   * (ADR-0017 §2, §3.2) makes the loader **dual-read**: an aggregated
   * `defineView` container is registered under the bare `<object>` key for
   * back-compatible reads AND expanded into independent `ViewItem`s under
   * `<object>.<viewKey>`. Only the expanded items carry `viewKind`, and
   * `getViewsByObject()` (`metadata-manager.ts`) filters on exactly that — so
   * a container that is registered but never expanded is invisible to it, and
   * to `GET /meta/view?object=` and the view switcher above it. The manifest
   * seam expanded; the nested-plugin seam did not, so one container registered
   * `['account', 'account.all_accounts', 'account.form']` through the manifest
   * and `['account']` through a nested plugin. No refusal, no diagnostic: a
   * package shipping its views through `manifest.plugins[]` simply had no
   * views, as far as every reader of the expanded layer was concerned.
   *
   * Both differences had the same structure — a loop body copied, then
   * improved on one side only — so the body is shared rather than reconciled,
   * for the reason #7049 gave for the list: a divergence that cannot be
   * written down cannot be re-introduced by the next hand patch. What legally
   * varies between the seams is passed in: which object is read, which package
   * id is stamped (both resolve to the SAME owning package — a nested plugin
   * contributes under its parent's ownership), and the label the `debug` line
   * names the source with.
   *
   * @param source   The manifest or nested-plugin config to read collections from.
   * @param ownerId  The owning package id — stamped as ADR-0010 provenance.
   * @param sourceLabel Human-readable source name for the `debug` line.
   */
  private registerMetadataCollections(source: any, ownerId: string, sourceLabel: string) {
      for (const key of METADATA_ARRAY_KEYS) {
          const items = (source as any)?.[key];
          if (!Array.isArray(items) || items.length === 0) continue;
          this.logger.debug(`Registering ${key} from ${sourceLabel}`, { id: ownerId, count: items.length });
          for (const item of items) {
              const itemName = resolveMetadataItemName(key, item);
              if (!itemName) {
                  this.logger.warn(`Skipping ${pluralToSingular(key)} without a derivable name`, { id: ownerId });
                  continue;
              }
              const toRegister = item.name === itemName ? item : { ...item, name: itemName };
              this._registry.registerItem(pluralToSingular(key), toRegister, 'name' as any, ownerId);
              // "Object has-many View" (ADR-0017): a `defineView` document
              // aggregates an object's views. Register the container under the
              // bare <object> key (above, back-compat) AND expand it into
              // independent ViewItems registered under <object>.<key>, so
              // `getViewsByObject()` / `GET /meta/view?object=` surface the
              // per-view `package` layer the switcher + Studio consume.
              if (key === 'views' && isAggregatedViewContainer(toRegister)) {
                  for (const vi of expandViewContainer(itemName, toRegister)) {
                      for (const w of vi._diagnostics?.warnings ?? []) {
                          this.logger.warn(`View expansion warning for '${vi.name}': ${w.message}`, { from: ownerId });
                      }
                      this._registry.registerItem('view', vi, 'name' as any, ownerId);
                  }
              }
          }
      }
  }

  /**
   * Register a new storage driver.
   *
   * **Re-registering the SAME driver instance is by design, not an anomaly**
   * (#4773). Every standalone boot does it exactly once, on two legs of one
   * round trip:
   *
   *  1. `DatasourceConnectionService.attemptConnect()` builds the `default`
   *     datasource's driver and registers it here with `isDefault: true`
   *     (`service-datasource/src/datasource-connection-service.ts`), driven by
   *     `DefaultDatasourcePlugin.init()`;
   *  2. that plugin then republishes **the very object it just read back out of
   *     this engine** as the `driver.<name>` kernel service — the surface
   *     `os migrate` and serve's storage detection resolve the primary DB
   *     through — and `ObjectQLPlugin.start()`'s `driver.*` discovery loop
   *     bridges every such service into the engine, handing us back the
   *     instance we already hold.
   *
   * So this guard has to answer two different questions, and the whole point of
   * splitting it is that they deserve different voices:
   *
   *  - **Same instance** → leg 2 above. Nothing is decided and nothing is
   *    discarded, and it happens on every boot: `debug`. Reporting a
   *    no-anomaly, every-boot event at `warn` only teaches operators that
   *    `warn` means nothing, which is what makes the next real one unreadable
   *    (the degradation-log-level rule, #4632).
   *  - **A DIFFERENT driver under a name we already hold** → two distinct
   *    configurations claim one name and exactly one of them is silently
   *    dropped. Whatever the loser carried — connection string, pool, tenant
   *    scoping, capability set — is simply not in force, while every query
   *    bound to that name keeps working against the winner. That is a real
   *    caller-side defect and stays loud, now saying *which* config survived.
   *  - **Same instance, but the caller asked for `isDefault` and something
   *    else already is the default** → the caller's intent is being dropped,
   *    so it is loud too rather than folded into the quiet path.
   */
  registerDriver(driver: IDataDriver, isDefault: boolean = false) {
    const existing = this.drivers.get(driver.name);
    if (existing) {
      if (existing !== driver) {
        this.logger.warn(
          'Driver name collision — KEEPING the already-registered driver and DISCARDING the one just supplied. ' +
            'Two different driver instances claim one name, so whatever configuration the discarded instance carried ' +
            '(connection string, pool, capabilities) is NOT in force, while queries routed to this name keep working ' +
            'against the one that was kept. Fix the caller: give the second datasource a name of its own.',
          {
            driverName: driver.name,
            keptVersion: existing.version,
            discardedVersion: driver.version,
          },
        );
      } else if (isDefault && this.defaultDriver !== driver.name) {
        this.logger.warn(
          'Driver re-registered as DEFAULT but another driver already holds that role — the request is IGNORED and ' +
            'the existing default stands. Unregister the current default first if the switch was intended.',
          { driverName: driver.name, currentDefault: this.defaultDriver },
        );
      } else {
        // The by-design round trip documented above — expected on every boot,
        // so it must not reach the boot-diagnostics warning list.
        this.logger.debug('Driver already registered — re-registering the same instance is a no-op', {
          driverName: driver.name,
        });
      }
      return;
    }

    this.drivers.set(driver.name, driver);
    this.logger.info('Registered driver', {
      driverName: driver.name,
      version: driver.version
    });

    if (isDefault || this.drivers.size === 1) {
      this.defaultDriver = driver.name;
      this.logger.info('Set default driver', { driverName: driver.name });
    }
  }

  /**
   * Register a Datasource *definition* (ADR-0015).
   *
   * Distinct from {@link registerDriver}, which registers a live connection.
   * This captures the declarative `schemaMode` + `external.allowWrites` so the
   * write gate ({@link assertWriteAllowed}) can enforce external-datasource
   * ownership. Safe to call repeatedly; last write wins.
   */
  registerDatasourceDef(def: { name: string; schemaMode?: string; external?: { allowWrites?: boolean } }): void {
    if (!def?.name) return;
    this.datasourceDefs.set(def.name, { schemaMode: def.schemaMode, external: def.external });
  }

  /**
   * Record that a **declared** datasource has no live driver, and why
   * (framework#3828). Called by `DatasourceConnectionService` when a connect is
   * refused by the host policy or fails while the operator has opted into a
   * degraded boot.
   *
   * The engine only needs this to answer a query well: without it
   * {@link getDriver} cannot tell a refused datasource from a misspelled one and
   * says `is not registered` to both. Deliberately carries no operator-facing
   * cause — see {@link DatasourceUnavailableError}.
   */
  markDatasourceUnavailable(info: { name: string; kind: DatasourceUnavailableKind; publicDetail?: string }): void {
    if (!info?.name) return;
    this.unavailableDatasources.set(info.name, {
      kind: info.kind,
      ...(info.publicDetail ? { publicDetail: info.publicDetail } : {}),
    });
  }

  /** Drop a {@link markDatasourceUnavailable} record (successful (re)connect / pool removal). */
  clearDatasourceUnavailable(name: string): void {
    this.unavailableDatasources.delete(name);
  }

  /**
   * Name of the DEFAULT driver, when one is registered (#3826). The default
   * driver keeps its natural name (`registerDriver(driver, true)` — nothing
   * routes by `drivers.get('default')`), so the datasource connection layer's
   * `asDefault` idempotency guard needs this rather than a name lookup.
   */
  getDefaultDriverName(): string | undefined {
    return this.defaultDriver ?? undefined;
  }

  /**
   * Datasources that were declared but are NOT usable, with the reason class.
   *
   * Distinct from {@link checkDriversHealth}, which answers "can a REGISTERED
   * driver serve a query right now" and therefore cannot see these at all — a
   * datasource that never connected was never registered (framework#3827).
   */
  listUnavailableDatasources(): Array<{ name: string } & DatasourceUnavailableInfo> {
    return Array.from(this.unavailableDatasources, ([name, info]) => ({ name, ...info }));
  }

  /**
   * Write gate — Gate 3 of ADR-0015 §5.3.
   *
   * Blocks insert/update/delete against a federated datasource
   * (`schemaMode !== 'managed'`) unless BOTH the datasource opts in
   * (`external.allowWrites`) AND the object opts in (`external.writable`).
   * Managed datasources (the common case, including the absence of any
   * definition) are unaffected.
   */
  private assertWriteAllowed(objectName: string, operation: 'insert' | 'update' | 'delete'): void {
    const object = this._registry.getObject(objectName) as any;
    const dsName = object?.datasource;
    if (!dsName || dsName === 'default') return;

    const ds = this.datasourceDefs.get(dsName);
    // No recorded definition, or an explicitly managed one ⇒ allow.
    if (!ds || !ds.schemaMode || ds.schemaMode === 'managed') return;

    const dsAllows = ds.external?.allowWrites ?? false;
    const objAllows = object?.external?.writable ?? false;
    if (!(dsAllows && objAllows)) {
      throw new ExternalWriteForbiddenError(
        `Write '${operation}' blocked on object '${objectName}': datasource '${dsName}' is external ` +
          `(schemaMode=${ds.schemaMode}). Requires datasource.external.allowWrites=true (got ${dsAllows}) ` +
          `AND object.external.writable=true (got ${objAllows}).`,
      );
    }
  }

  /**
   * Set the realtime service for publishing data change events.
   * Should be called after kernel resolves the realtime service.
   *
   * @param service - An IRealtimeService instance for event publishing
   */
  setRealtimeService(service: IRealtimeService): void {
    this.realtimeService = service;
    this.logger.info('RealtimeService configured for data events');
  }

  /**
   * Publish a realtime {@link DataEvent} for a record write (#4626 —
   * contract-first, the data-side twin of #4602/#4628).
   *
   * What reaches a `subscribeData` callback must BE the spec's `DataEvent`
   * (`@objectstack/spec/api`): top-level `id` (uuid), `type`, `object`,
   * `recordId` (REQUIRED), plus `changes`/`after`/`userId` when they apply.
   * The transport keeps its `RealtimeEventPayload` envelope — `payload`
   * carries the complete `DataEvent`, and the client SDK unwraps + validates
   * it at the boundary instead of double-casting the envelope.
   *
   * Only per-record writes reach here. A predicate (`multi: true`) write has
   * its own contract — see {@link publishBulkDataEvent} (#4639) — and the
   * multi branches of `update()`/`delete()` route to it directly, so they
   * never arrive at the identity gate below.
   *
   * Two loud-by-design gates:
   *  - **No record identity → no event.** `DataEvent.recordId` is required, so
   *    a write that names no record has no truthful per-record event to
   *    publish. It publishes NONE (warn log) instead of the pre-#4626
   *    fabrication (`recordId: ''`, `after: <affected count>`) that every
   *    schema-compliant consumer must reject. Reaching this gate now means a
   *    single-id write whose driver returned no usable primary key — a driver
   *    bug — because the bulk callers no longer come through here.
   *  - The event body is `DataEventSchema.parse`d before publish, so a
   *    malformed producer fails here (warn log, event not published) rather
   *    than delivering a lie downstream.
   *
   * Never throws and never fails the write: a realtime transport problem must
   * not roll back a committed record.
   */
  private async publishDataEvent(
    action: 'created' | 'updated' | 'deleted',
    object: string,
    input: {
      recordId: unknown;
      changes?: unknown;
      after?: unknown;
      context?: ExecutionContext;
    },
  ): Promise<void> {
    if (!this.realtimeService) return;

    const recordId = eventRecordId(input.recordId);
    if (!recordId) {
      this.logger.warn(
        `No data.record.${action} event published for '${object}': the write names no single record, ` +
          `and DataEvent.recordId is required — refusing to publish an off-contract event. ` +
          `A predicate write publishes data.records.${action} instead (#4639), so reaching this ` +
          `means a single-id write whose driver returned no usable primary key (#4626)`,
        { object },
      );
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const changes = eventRecordBody(input.changes);
      const after = eventRecordBody(input.after);
      const userId = eventUserId(input.context);
      const event: DataEvent = DataEventSchema.parse({
        id: generateEventUuid(),
        type: `data.record.${action}`,
        object,
        recordId,
        ...(changes !== undefined ? { changes } : {}),
        ...(after !== undefined ? { after } : {}),
        ...(userId !== undefined ? { userId } : {}),
        timestamp,
      });

      const envelope: RealtimeEventPayload = {
        type: event.type,
        object,
        payload: { ...event },
        timestamp,
      };

      await this.realtimeService.publish(envelope);
      this.logger.debug(`Published data.record.${action} event`, { object, recordId });
    } catch (error) {
      this.logger.warn('Failed to publish data event', { object, recordId, error });
    }
  }

  /**
   * Publish a realtime {@link BulkDataEvent} for a predicate write (#4639).
   *
   * The `multi: true` branches of `update()`/`delete()` reach
   * `IDataDriver.updateMany`/`deleteMany`, which resolve an affected COUNT and
   * nothing else. That is too little for the per-record `DataEvent` contract
   * (`recordId` is required), so those writes were silent from #4626 until now
   * — honest, but it meant webhooks and every other event consumer saw
   * nothing at all when a predicate write emptied half a table.
   *
   * They now get their own event instead of impersonating a per-record one:
   * `data.records.updated` / `data.records.deleted`, carrying the object and
   * the count. A consumer reading the type knows immediately that no
   * `recordId` is coming — the failure mode of the pre-#4626 fabrication,
   * where `recordId: ''` looked like a record until you tried to use it.
   *
   * Deliberately NOT carried: the query predicate. The only one in hand here
   * is the middleware-composed AST, whose `where` embeds the security layer's
   * injected row scoping (RLS, sharing) — publishing it would ship tenant
   * internals to whatever external URL a webhook points at. See
   * `BulkDataEventSchema`'s TSDoc for the full reasoning.
   *
   * Same two disciplines as the per-record twin: validate before publish, and
   * never throw — a realtime transport problem must not roll back a committed
   * write.
   */
  private async publishBulkDataEvent(
    action: 'updated' | 'deleted',
    object: string,
    input: { matched: unknown; context?: ExecutionContext },
  ): Promise<void> {
    if (!this.realtimeService) return;

    const matched = eventMatchedCount(input.matched);
    if (matched === undefined) {
      this.logger.warn(
        `No data.records.${action} event published for '${object}': the driver's multi-row result is ` +
          `not an affected-row count (IDataDriver.updateMany/deleteMany are contracted to resolve ` +
          `a number). The count is the only thing a bulk event states, so publishing one here would ` +
          `assert something unverified (#4639)`,
        { object },
      );
      return;
    }

    // A predicate that matched nothing changed no data, so it is not a data
    // event — the per-record path is silent for the same reason (no rows
    // written, no events). This is what keeps an idle hourly LifecycleService
    // sweep from becoming a webhook delivery per object per hour saying
    // "0 records". Debug, not warn: matching nothing is normal, not a fault.
    if (matched === 0) {
      this.logger.debug(`No data.records.${action} event for '${object}': predicate matched no rows`, { object });
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const userId = eventUserId(input.context);
      const event: BulkDataEvent = BulkDataEventSchema.parse({
        id: generateEventUuid(),
        type: `data.records.${action}`,
        object,
        matched,
        ...(userId !== undefined ? { userId } : {}),
        timestamp,
      });

      const envelope: RealtimeEventPayload = {
        type: event.type,
        object,
        payload: { ...event },
        timestamp,
      };

      await this.realtimeService.publish(envelope);
      this.logger.debug(`Published data.records.${action} event`, { object, matched });
    } catch (error) {
      this.logger.warn('Failed to publish bulk data event', { object, matched, error });
    }
  }

  /**
   * Set the i18n service used to localize write-path validation messages and
   * the field labels inside them (#3957). Bridged by `ObjectQLPlugin` on start,
   * the same way the realtime service is.
   *
   * Optional by design: with no service the built-in message catalog
   * (`@objectstack/spec/system`) still renders each message in the caller's
   * locale against the field's DECLARED label. The service adds two things —
   * a deployment's `validation.field.*` message overrides, and the field's
   * TRANSLATED label for apps whose declared labels are in another language.
   */
  setI18nService(service: { t?: (key: string, locale: string, params?: Record<string, unknown>) => string }): void {
    this.i18nService = service;
    this.logger.info('I18nService configured for validation messages');
  }

  /**
   * Locale + translation hooks handed to the validators so a rejected write is
   * reported in the caller's language (#3957).
   *
   * `ExecutionContext.locale` is resolved once per request from the
   * `localization` settings (ADR-0053 Phase 2) and its contract already reads
   * "Drives message catalogs" — this is the consumer that makes that true.
   * Undefined locale (anonymous / programmatic / system write) leaves the
   * built-in `en` rendering in place.
   */
  private validationMessageContext(
    objectName: string,
    // Only `locale` is read — narrower than `ExecutionContext` so both the
    // resolved and the input-shaped envelope satisfy it.
    context?: { locale?: string },
  ): { locale?: string; translate?: (key: string, locale: string, params?: Record<string, unknown>) => string; objectName: string } {
    const t = this.i18nService?.t;
    return {
      objectName,
      locale: context?.locale,
      translate: t ? (key, locale, params) => t.call(this.i18nService, key, locale, params) : undefined,
    };
  }

  /**
   * An OBJECT's display name in the caller's locale: translation bundle →
   * declared `label` → API name (#7307).
   *
   * The object-level twin of `resolveFieldLabel` (`record-validator.ts`), and
   * deliberately the same three-step ladder with the same last resort: the API
   * name is what a user must not be shown, so it is where the ladder ENDS, not
   * where it starts. It stays available to clients on the structured fields
   * (`object` / `dependentObject`) and on `developerMessage`.
   */
  private objectDisplayLabel(
    objectName: string,
    declaredLabel: unknown,
    ctx: { locale?: string; translate?: (key: string, locale: string, params?: Record<string, unknown>) => string },
  ): string {
    if (ctx.translate && ctx.locale) {
      const key = objectLabelKey(objectName);
      try {
        const translated = ctx.translate(key, ctx.locale);
        // II18nService echoes the key back on a miss.
        if (typeof translated === 'string' && translated.length > 0 && translated !== key) {
          return translated;
        }
      } catch {
        // A misbehaving i18n service must not turn a 409 into a 500.
      }
    }
    const declared = typeof declaredLabel === 'string' ? declaredLabel.trim() : '';
    return declared.length > 0 ? declared : objectName;
  }

  /**
   * [#4441] Referential integrity on the WRITE path: a `lookup` (or any
   * reference-typed field) may not be given an id that exists in no row of the
   * object it declares.
   *
   * The field metadata is unambiguous — `{"type":"lookup","required":true,
   * "reference":"sys_permission_set"}` — and the DELETE side already reasons
   * about the edge (`deleteBehavior: 'set_null'`). Only the insert side never
   * checked, so `POST /data/sys_position_permission_set
   * {"permission_set_id":"ps_does_not_exist_at_all"}` created the row.
   *
   * On the RBAC link tables that is a security-surface record that resolves to
   * nothing: an administrator auditing permissions sees a binding whose target
   * cannot be inspected, and the audience-anchor gate has to resolve that very
   * set to evaluate the grant — so a dangling row is an unevaluable gate input,
   * not merely an untidy one.
   *
   * ## Scope, deliberately narrow
   *
   * - **Caller-supplied keys only.** Server stamps (`owner_id`,
   *   `organization_id`, `created_by`/`updated_by`) are lookups too; they are
   *   written by hooks and middleware, not by the request, and re-validating
   *   them here would turn a platform stamp into a caller-facing rejection.
   * - **Non-system writes only**, like every other write-path guard in this
   *   engine (`stripReadonlyFields`, `stripReadonlyForInsert`). Seed replay,
   *   package install and boot-time provisioning legitimately write rows in an
   *   order that resolves only once the batch completes; failing them closed
   *   would turn an ordering detail into a boot failure. This leaves a real
   *   residual — an `isSystem` caller can still write a dangling reference —
   *   which is recorded on the issue rather than silently accepted.
   * - **Empty values are not references.** `null` / `undefined` / `''` mean
   *   "no link", which is what `deleteBehavior: 'set_null'` produces.
   * - **Already-expanded objects are skipped.** A read round-trip can hand back
   *   `{id, name, …}` in the slot; that is not an id write.
   *
   * ## Why the probe is unscoped
   *
   * Existence is a fact about the database, not about the caller's visibility —
   * the same distinction the #4435 existence probe turns on. A scoped probe
   * would refuse a link to a permission set the caller cannot READ, which is
   * ordinary in an RLS-scoped deployment and would make the platform's own
   * admin flows fail. Whether the caller may create the binding at all is the
   * RBAC/RLS layer's decision, made where it already is.
   *
   * Fails OPEN when the target cannot be checked (unregistered object, no
   * driver, a probe that throws): an integrity check that cannot run must not
   * invent a rejection, and the alternative — refusing every write to an object
   * whose target lives on an unreachable datasource — converts a connectivity
   * problem into data loss.
   */
  private async assertReferencesResolve(
    schema: any,
    data: Record<string, unknown> | null | undefined,
    supplied: Record<string, unknown> | null | undefined,
    context: any,
    msgCtx?: { locale?: string; translate?: any; objectName?: string },
  ): Promise<void> {
    if (context?.isSystem) return;
    const fields = schema?.fields;
    if (!fields || !data) return;

    const failures: any[] = [];
    for (const name of Object.keys(fields)) {
      // [#4441, narrowing kept by #4743] A `readonly` field is never the
      // caller's to answer for — BY CONSTRUCTION, not by exemption.
      //
      // This check answers for exactly one thing: "the reference the CALLER
      // named". `stripReadonlyFields` removes a non-system caller's value from
      // a readonly field before the write, and the create ingress does the same
      // (`stripReadonlyForInsert`, #3043). So a value still sitting in one at
      // this point was minted by the PLATFORM — outside this check's own stated
      // scope, whatever it happens to hold. That argument stands on its own and
      // depends on no particular field: deleting the `continue` would start
      // rejecting the platform's own writes, which is why it is recorded here
      // (AGENTS.md PD #13) rather than left to be re-derived.
      //
      // Historical note, kept because it is how the narrowing was FOUND (the
      // dogfood gate, not reasoning) and because the audit next door re-scoped
      // itself on its removal: `sys_metadata_history.recorded_by` is a
      // `Field.lookup('sys_user', { readonly: true })` that the metadata
      // repository once filled with `actor ?? 'system'` — a SENTINEL STRING,
      // not a user id, on a write carrying no `isSystem`; checking it rejected
      // ordinary metadata authoring (package create / publish / clone). #4556
      // replaced that sentinel with NULL, so no platform write puts a non-id in
      // a reference column any more. The narrowing survives it unchanged
      // because it never rested on it — but #4551's blanket audit skip did, and
      // #4743/#5719 duly re-scoped that one (see `inspectDanglingReferences`).
      //
      // This does NOT weaken #4441: the fields the issue names —
      // `sys_position_permission_set.permission_set_id` and
      // `showcase_task.project` — are ordinary author-facing lookups with no
      // `readonly`, and both stay enforced (pinned in the unit suite).
      if (fields[name]?.readonly === true) continue;
      // Only a value the CALLER actually supplied is theirs to answer for.
      //
      // Key presence is not enough: a form serializes an unpicked control as
      // an explicit `null`, and `applyFieldDefaults` then fills it from
      // `defaultValue` — including the `current_user` token (#2706). The key is
      // in the payload, but the ID that lands is the PLATFORM's, so validating
      // it would report a server-derived value as the caller's bad reference
      // (and reject a perfectly ordinary insert against a driver that has no
      // `sys_user` row for the acting principal).
      //
      // So the value read for the check comes from the post-normalization
      // `data` (multi-value strings are already split by then), while WHETHER
      // to check is decided by the caller's own raw value being non-empty.
      if (!supplied || isEmptyReferenceValue((supplied as Record<string, unknown>)[name])) continue;
      if (!(name in data)) continue;
      const def = fields[name];
      const target = referenceTargetOf(def);
      if (!target) continue;
      const raw = (data as Record<string, unknown>)[name];
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'object') continue;
        const resolved = await this.referenceExists(target, v);
        if (resolved === false) {
          failures.push(buildFieldError(
            {
              field: name,
              code: 'reference_not_found',
              def,
              value: String(v),
              constraint: { target },
            },
            msgCtx as any,
          ));
        }
      }
    }
    if (failures.length > 0) throw new ValidationError(failures);
  }

  /**
   * Does `id` name a row in `target`? `false` only when the probe RAN and found
   * nothing; `null` when it could not run at all (see the fail-open note on
   * {@link assertReferencesResolve}).
   */
  private async referenceExists(target: string, id: unknown): Promise<boolean | null> {
    try {
      const resolved = this.resolveObjectName(target);
      if (!this._registry.getObject(resolved)) return null;
      const row = await this.findOne(resolved, {
        where: { id },
        fields: ['id'],
        context: { isSystem: true },
      } as any);
      return !!row;
    } catch {
      return null;
    }
  }

  /**
   * [#4889] The master-detail header a detail row's `parent`-scoped
   * `readonlyWhen` reads, or `null` when this write cannot resolve one.
   *
   * `readonlyWhen: parent.status == 'paid'` is a documented **server**
   * guarantee (ADR-0057 D10 puts enforcement here; the client grid is
   * courtesy), but the strip is a pure function over the payload and the prior
   * row — it has no driver and cannot fetch a header. So the engine resolves it
   * and passes it in.
   *
   * The header id comes from the payload first, then the prior row: a write that
   * REPOINTS the detail at another master must be judged against the master it
   * is landing on, not the one it is leaving. Read as **system**: the lock is a
   * data-integrity property of the header's state, not of the caller's
   * visibility of it, and the caller's right to touch this detail at all was
   * already settled upstream (RLS / `controlled_by_parent`, ADR-0055) before the
   * write reached the strip.
   *
   * `null` on any failure — no relation, no id, header gone, read threw. It is
   * NOT read as "unlocked": an unresolved binding leaves `parent` unbound, and
   * `isReadonlyWhenLocked` treats a predicate that needs it as LOCKED.
   *
   * [#6457] A header that IS resolved is handed over TOTAL over the MASTER
   * object's declared fields — see {@link materializeParentHeader} for why that
   * had to happen here and nowhere else, and for the verdict table it moves.
   */
  private async resolveMasterDetailParent(
    schema: any,
    data: Record<string, unknown> | null | undefined,
    priorRow: Record<string, unknown> | null | undefined,
  ): Promise<Record<string, unknown> | null> {
    const rel = resolveMasterDetailRelation(schema);
    if (!rel) return null;
    const parentId = masterIdOf(rel.fk, data, priorRow);
    if (parentId == null) return null;
    try {
      const row = await this.findOne(rel.master, { where: { id: parentId }, context: { isSystem: true } } as any);
      // `null` stays `null` — the fail-CLOSED signal (#4889) is the ABSENCE of
      // the binding, and materialising a row we do not have would destroy it.
      return row == null ? null : this.materializeParentHeader(rel.master, row as Record<string, unknown>);
    } catch (err) {
      this.logger?.warn?.('readonlyWhen parent lookup failed — parent stays unbound', {
        object: rel.master, id: parentId, error: err,
      });
      return null;
    }
  }

  /**
   * Bulk counterpart of {@link resolveMasterDetailParent}: one read for the
   * whole matched set, then a per-row lookup for
   * `stripReadonlyWhenFieldsMulti`. A bulk update of N details under M masters
   * costs ONE extra query, not N — the same "read the match set once" discipline
   * the #3106 prior-row fetch follows.
   *
   * [#4977] Serves three callers now, unchanged: the bulk `readonlyWhen` strip,
   * the bulk `requiredWhen` evaluation, and the INSERT path — where `data` is
   * passed as `null` and each inserted row supplies its own FK, so
   * `masterIdOf(fk, null, row)` reads `row[fk]` and the batch costs one header
   * read for the whole `insert()` call.
   *
   * [#6457] Every header this resolves is materialised over the MASTER's
   * declared fields, exactly as the single-id twin does — the declared-field
   * table is read ONCE for the batch, not per row. A row this map has no entry
   * for still answers `null` (unbound, fail-CLOSED for `readonlyWhen`).
   */
  private async resolveMasterDetailParents(
    schema: any,
    data: Record<string, unknown> | null | undefined,
    priorRows: ReadonlyArray<Record<string, unknown>> | null | undefined,
  ): Promise<(row: Record<string, unknown> | undefined) => Record<string, unknown> | null> {
    const unbound = () => null;
    const rel = resolveMasterDetailRelation(schema);
    if (!rel) return unbound;
    const ids = new Set<string>();
    for (const row of priorRows ?? []) {
      const id = masterIdOf(rel.fk, data, row);
      if (id != null) ids.add(String(id));
    }
    if (ids.size === 0) return unbound;
    const byId = new Map<string, Record<string, unknown>>();
    try {
      const rows = await this.find(rel.master, {
        where: { id: { $in: [...ids] } },
        context: { isSystem: true },
      } as any) as Array<Record<string, unknown>>;
      // [#6457] One declared-field lookup for the whole batch, then one shallow
      // copy per header. A master the registry does not know leaves `fields`
      // undefined and every header passes through untouched — see
      // {@link materializeParentHeader}.
      const masterFields = this.masterDeclaredFields(rel.master);
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.id != null) byId.set(String(row.id), materializeDeclaredFields({ ...row }, masterFields));
      }
    } catch (err) {
      this.logger?.warn?.('readonlyWhen parent lookup failed — parent stays unbound', {
        object: rel.master, error: err,
      });
      return unbound;
    }
    return (row) => {
      const id = masterIdOf(rel.fk, data, row);
      return id == null ? null : (byId.get(String(id)) ?? null);
    };
  }

  /**
   * [#6457] Make a resolved master-detail header TOTAL over the MASTER
   * object's declared fields, so a `parent.<field>` predicate is evaluable
   * whatever subset of columns the driver echoed back.
   *
   * ## The hole this closes
   *
   * #4953 made the `record` / `previous` roots total at every server seam
   * ({@link ./declared-fields.js#materializeDeclaredFields}); the 2026-08-06
   * ruling deliberately left `parent` out, because `parent` is a row of ANOTHER
   * object and its ABSENCE is #4889's fail-closed signal. What that left behind
   * is the same trap one root over — visible as a THREE-row table, of which
   * only the middle row moves here:
   *
   * | header state | `readonlyWhen: parent.status == null` | before | now |
   * |---|---|---|---|
   * | carries `status` | evaluates | locks per verdict | unchanged |
   * | resolved, no `status` key | `No such key: status` — `parent` IS bound, so `unknownVariableOf` does not match ⇒ ordinary fail-OPEN | **declared lock let through** | evaluates (`status` reads `null`) |
   * | unresolvable (`null`) | `Unknown variable: parent` | LOCKED (#4889) | LOCKED — unchanged |
   *
   * The middle row is the bug: whether a declared lock enforced depended on
   * which columns a driver happened to return, which is not something an author
   * can see or control. `requiredWhen` (#4977) shares the binding and had the
   * mirror of it — fail-open there means the requirement is simply not
   * enforced. One materialisation serves both consumers.
   *
   * ## Why HERE, and not in the strip / the evaluator
   *
   * `stripReadonlyWhenFields*` and `evaluateValidationRules` are pure functions
   * over what they are handed; they hold the DETAIL object's field table and
   * have no way to reach the MASTER's — threading a second field table through
   * their signatures would put the master's schema in four call sites' hands to
   * serve one binding. The engine already holds both the registry and the
   * just-read header at these two seams, so the header arrives at those
   * functions already total and their signatures do not move.
   *
   * ## The fail-CLOSED line is preserved EXACTLY (#4889)
   *
   * This function is only ever reached with a row IN HAND — the persisted-state
   * precondition `declared-fields.ts` states. An UNRESOLVABLE header still
   * returns `null` from the resolvers above, still leaves `parent` unbound,
   * still faults as `Unknown variable: parent`, and is still read as LOCKED. The
   * two cases stay distinguishable by construction: absence is decided before
   * this function is called, materialisation only ever applies to a row that
   * exists.
   *
   * A master the registry cannot resolve yields no field table, and the header
   * passes through unchanged — sparse, i.e. exactly the pre-#6457 behaviour.
   * That is the honest answer: without the declared shape we cannot know which
   * absent keys are fields and which would be fabrication.
   *
   * COPIED before materialising, like every other caller: the row is what
   * `findOne`/`find` returned and may be observed elsewhere; it must not gain
   * materialised nulls behind its reader's back.
   */
  private materializeParentHeader(master: string, row: Record<string, unknown>): Record<string, unknown> {
    return materializeDeclaredFields({ ...row }, this.masterDeclaredFields(master));
  }

  /** The MASTER object's declared-field table, or `undefined` when the registry
   *  does not know it (see {@link materializeParentHeader}). */
  private masterDeclaredFields(master: string): Record<string, unknown> | undefined {
    const schema = this._registry.getObject(master) as { fields?: Record<string, unknown> } | undefined;
    const fields = schema?.fields;
    return fields && typeof fields === 'object' ? fields : undefined;
  }

  /**
   * [#4551] Report stored references that resolve to nothing. **Read-only** —
   * this issues no writes at all.
   *
   * The follow-up to {@link assertReferencesResolve}'s deliberate `isSystem`
   * exemption. That exemption stays exactly as #4441 wrote it (seed replay and
   * boot provisioning must keep their ordering freedom); what it left behind is
   * a residual — the platform itself can still write a reference into the void
   * and nothing says so. This is the "something says so".
   *
   * The existence oracle passed to the audit is **this engine's own**
   * {@link referenceExists}, not a second copy: the audit and the write-path
   * guard therefore answer "does this id exist" — and "could I even tell?" —
   * with one predicate, so the report can never be more or less strict than the
   * rule it reports on.
   *
   * See {@link auditDanglingReferences} for the judgments (readonly SPLIT —
   * `readonly` references are read like any other and their findings filed
   * under `provenance` / `provenanceUndetermined` since #4743/#5719, not
   * skipped; empty values; unknown ≠ absent) and for the bounded-scan honesty
   * of the report, whose incompleteness now has a bucket at every level:
   * `truncatedObjects` inside a table, `unscannedObjects` for the tables the
   * budget never reached (#5718), `unreadableObjects` for what the datasource
   * refused, and `aborted` for a run called off (#4747).
   */
  async inspectDanglingReferences(
    options?: DanglingReferenceAuditOptions,
  ): Promise<DanglingReferenceReport> {
    return auditDanglingReferences(
      {
        objects: () => this._registry.getAllObjects() as unknown as AuditableObject[],
        find: (object, opts) => this.find(object, opts as any) as Promise<Array<Record<string, unknown>>>,
        probe: (target, id) => this.referenceExists(target, id),
        warn: (msg, meta) => this.logger?.warn?.(msg, meta as any),
      },
      options,
    );
  }

  /**
   * Register the crypto provider that backs `secret`-typed fields.
   *
   * When set, the engine encrypts secret fields on write (storing ciphertext in
   * `sys_secret` and only an opaque ref on the business row) and masks them on
   * read. When NOT set, writing to an object that declares a secret field is
   * **fail-closed** — the write throws rather than persist cleartext.
   *
   * Mirrors the Settings subsystem's ICryptoProvider wiring; the host (e.g.
   * `serve`) injects `LocalCryptoProvider` in dev and a KMS/Vault-backed
   * provider in production.
   *
   * Notifies {@link onCryptoProviderChange} listeners AFTER the provider is in
   * place, so a listener that immediately re-reads a secret sees the new
   * capability rather than the state that made it fail (#8022).
   */
  setCryptoProvider(provider: ICryptoProvider): void {
    this.cryptoProvider = provider;
    this.logger.info('CryptoProvider configured for secret fields');
    // A listener is a re-arm, never part of this call's contract: one that
    // throws must not fail the host's composition root, and must not stop the
    // listeners behind it from re-arming.
    for (const listener of [...this.cryptoProviderListeners]) {
      try {
        listener();
      } catch (err) {
        this.logger.warn('CryptoProvider registration listener failed', {
          error: (err as Error)?.message ?? String(err),
        });
      }
    }
  }

  /**
   * [#8022] Observe crypto-provider registration.
   *
   * Exists for consumers that must dereference a `secret` field on a schedule
   * they do not control — the boot path. `secret` reads are fail-closed by
   * design (#7799), which is correct, but "no provider" at boot is a
   * *transient* state on every host: `kernel:ready` runs plugins, and only
   * after `runtime.start()` returns does the composition root call
   * {@link setCryptoProvider}. A consumer whose cache was built in that gap is
   * wrong until it rebuilds, and polling is the only alternative to being told.
   *
   * Fires on every registration, including a later replacement (a KMS provider
   * swapped in over the dev one) — a listener that re-reads is correct in both
   * cases, and a re-read is cheap next to signing with a key from the wrong
   * provider.
   *
   * @returns an unsubscribe function; call it when the listener's owner stops.
   */
  onCryptoProviderChange(listener: () => void): () => void {
    this.cryptoProviderListeners.add(listener);
    return () => {
      this.cryptoProviderListeners.delete(listener);
    };
  }

  /**
   * [ADR-0105 D2 / #3623] Inject the tenancy-posture accessor that decides
   * whether driver-level native tenant scoping widens to the caller's whole
   * membership set (`DriverOptions.tenantIds`, the `group` posture's union)
   * instead of the active-org equality (`DriverOptions.tenantId`).
   *
   * Wired by the enforcement layer (SecurityPlugin) — deliberately NOT
   * self-derived from env here: the posture in force is an entitlement
   * question (`tenancy` service), and widening the driver wall is only safe
   * when the Layer 0 union wall is actually enforcing above it. No provider
   * (an embedding without plugin-security) keeps today's equality scoping —
   * fail toward isolation, never toward exposure.
   */
  setTenancyPostureProvider(provider: () => string | undefined): void {
    this.tenancyPostureProvider = provider;
  }

  /**
   * Normalize credential fields on `row` in place before it reaches the driver.
   *
   * Two channels share the read mask ({@link SECRET_MASK}) but differ on write
   * (see ADR-0100):
   *
   *  - **`secret`** — encrypted: each plaintext is wrapped by the ICryptoProvider,
   *    persisted as a `sys_secret` row, and replaced on `row` by an opaque ref.
   *    Cleartext never reaches the business table.
   *  - **`password`** (generic, non-`better-auth`) — plaintext at rest: stored
   *    verbatim, no encryption and no `sys_secret` row. Only the echoed-mask drop
   *    below applies to it.
   *
   * Rules:
   *  - Any masked field (secret or password) whose value equals the read mask ⇒
   *    the key is dropped, so a form round-trip that echoes the mask does not
   *    overwrite the stored value.
   *  - No secret fields on the object ⇒ no further work (fast path, no crypto).
   *  - `null`/`undefined` secret value ⇒ left as-is (clears the secret).
   *  - Secret value already a ref (re-save of an unchanged ref) ⇒ left as-is.
   *  - **Fail-closed:** any other secret value with no CryptoProvider registered,
   *    or no reachable `sys_secret` store, THROWS — never persists cleartext.
   *    (A `password` field needs no CryptoProvider — it is stored as-is.)
   */
  private async encryptSecretFields(
    object: string,
    row: Record<string, unknown>,
    context: ExecutionContext | undefined,
    driverOptions: unknown,
  ): Promise<void> {
    if (!row || typeof row !== 'object') return;
    const schema = this._registry.getObject(object);

    // Echoed-mask drop for every field the read path masks (secret + generic
    // password). The read path returns SECRET_MASK; a client that PATCHes it
    // back means "unchanged", so drop the key rather than persist the literal
    // mask. Doing this up front keeps the better-auth exemption in one place
    // (collectMaskedReadFields) and covers objects that have a password field
    // but no secret field. (#2036, ADR-0100)
    for (const field of collectMaskedReadFields(schema)) {
      if (field in row && row[field] === SECRET_MASK) delete row[field];
    }

    const secretFields = collectSecretFields(schema);
    if (secretFields.length === 0) return;

    for (const field of secretFields) {
      if (!(field in row)) continue;
      const value = row[field];

      if (value === null || typeof value === 'undefined') continue; // clear
      if (isSecretRef(value)) continue; // already encrypted ref

      if (!this.cryptoProvider) {
        throw new Error(
          `Cannot persist secret field "${object}.${field}": no CryptoProvider is registered. `
            + 'Wire one via engine.setCryptoProvider(...) (e.g. LocalCryptoProvider in dev, '
            + 'a KMS/Vault provider in production). Refusing to store cleartext (fail-closed).',
        );
      }

      const plain = typeof value === 'string' ? value : JSON.stringify(value);
      const handle: CryptoHandle = await this.cryptoProvider.encrypt(plain, {
        namespace: object,
        key: field,
        tenantId: context?.tenantId,
      });

      let secretDriver;
      try {
        secretDriver = this.getDriver('sys_secret');
      } catch {
        throw new Error(
          `Cannot persist secret field "${object}.${field}": the sys_secret store is not available. `
            + 'Ensure the platform-objects (sys_secret) are registered before writing secret fields (fail-closed).',
        );
      }

      await secretDriver.create(
        'sys_secret',
        {
          id: handle.id,
          namespace: object,
          key: field,
          kms_key_id: handle.kmsKeyId,
          alg: handle.alg,
          version: handle.version,
          ciphertext: handle.ciphertext,
          created_at: new Date().toISOString(),
        },
        driverOptions as any,
      );

      row[field] = makeSecretRef(handle.id);
    }
  }

  /**
   * Mask credential fields on read so plaintext never leaves the engine through
   * the normal query path. Covers `secret` fields (always) and `password` fields
   * on generic, non-`better-auth` objects (see {@link collectMaskedReadFields}
   * and ADR-0100). A set value becomes {@link SECRET_MASK}; an unset one stays
   * `null`. Privileged callers that genuinely need a secret's plaintext use
   * {@link resolveSecret} against the stored ref; a `password` field is stored
   * as plaintext at rest, so its cleartext is only ever reachable off this path.
   *
   * [#7728] Second collector branch, same choke point: a field declared
   * `internal: true` is OMITTED rather than masked — see
   * {@link omitInternalFields} for why the two dispositions differ.
   */
  private maskSecretFields(object: string, rows: any): void {
    if (!rows) return;
    const schema = this._registry.getObject(object);
    const maskedFields = collectMaskedReadFields(schema);
    if (maskedFields.length > 0) {
      const list = Array.isArray(rows) ? rows : [rows];
      for (const row of list) {
        if (!row || typeof row !== 'object') continue;
        for (const field of maskedFields) {
          if (!(field in row)) continue;
          row[field] = row[field] == null ? null : SECRET_MASK;
        }
      }
    }
    // Runs AFTER the mask, so a field that is somehow both `secret`-typed and
    // `internal` ends up omitted rather than masked — the stricter disposition
    // wins, which is the only safe way for the two to compose.
    this.omitInternalFields(object, rows);
  }

  /**
   * [#7728] Drop every field declared `internal: true` from the rows the engine
   * hands back — "the declared value is never returned on the generic data
   * path". This is the read protection for ADR-0100's third credential channel:
   * auth-subsystem one-way hashes stored in `text` columns, which the two
   * type-keyed credential collectors structurally cannot reach.
   *
   * **OMIT, not mask** (maintainer ruling 2026-08-12 on #7728). The credential
   * mask exists to signal "a value is set" without leaking it. The column this
   * was minted for — `sys_api_key.key` — is `required: true`, so it is ALWAYS
   * set: the signal carries zero bits, while still shipping a value under a
   * field whose own description says it is "never exposed to clients". Omission
   * also leaves that description string untouched, so the four generated
   * translation bundles that mirror it do not churn.
   *
   * **`?select=` is covered by construction, and that is load-bearing.** The
   * strip acts on the RESULT ROWS, not on the projection, so a client that
   * spells the column out (`?select=id,key`) gets a 200 without it rather than
   * a bypass. `select` only gates on whether a field is KNOWN
   * (`assertProjectionFieldsExist`) and a flagged column is known, so a
   * projection-aware strip would have shipped looking complete and still leaked
   * to any caller who named the column — measured on the sibling column in
   * #7823, and reproduced here on `sys_api_key.key` before the fix.
   *
   * **No system carve-out**, and this is where the shape deliberately diverges
   * from its sibling {@link stripSearchCompanionFromRead}. That one keeps the
   * `__search` companion for a system caller who names it by projection,
   * because it has exactly one such reader whose backfill comparison would
   * otherwise rewrite every row on every run. This flag has no such reader: the
   * API-key verifier uses the column as a `where` FILTER and never reads it off
   * the result (`resolveApiKeyPrincipal` takes `expires_at` / `user_id` /
   * `organization_id` / `scopes`), and the mint path returns the plaintext it
   * generated, not the row it inserted. An escape hatch nobody needs is a hole
   * in a non-exposure guarantee, so there isn't one — if a legitimate system
   * reader ever appears, it reads the column through a purpose-built privileged
   * accessor, the way {@link resolveSecret} does for `secret`.
   *
   * Nothing below storage is touched. The strip runs on rows the driver has
   * already produced, so the predicate has been evaluated and the index used
   * before this method sees anything — which is precisely why authentication
   * keeps working.
   */
  private omitInternalFields(object: string, rows: any): void {
    if (!rows) return;
    const schema = this._registry.getObject(object);
    const internalFields = collectInternalReadFields(schema);
    if (internalFields.length === 0) return;
    const list = Array.isArray(rows) ? rows : [rows];
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      for (const field of internalFields) delete row[field];
    }
  }

  /**
   * [#7642] Strip the hidden `__search` companion column from what a read
   * hands back, unless a SYSTEM caller named it in its projection.
   *
   * The column is declared client-invisible (`hidden` + `readonly` + `system`
   * + `searchable: false`) and the enforcement that exists is real: it is kept
   * out of auto-views, out of the `$search` auto-default, and a `$searchFields`
   * override naming it is refused with a 400 ("is hidden"). What was missing is
   * the PROJECTION half — a query that names no `fields` reaches the driver
   * with `ast.fields` undefined, every driver answers that with `SELECT *`, and
   * the companion rode back in every record body: list results, GET by id,
   * `/search` hits (which are `engine.find` rows verbatim) and the 201 create
   * body. The rule is applied HERE, at the engine, because the engine is the
   * PRODUCER those four surfaces share; fixing them one consumer at a time is
   * how three of the four would stay broken.
   *
   * Two carve-outs, both measured rather than defensive:
   *
   *  - **A system caller that asks for it by name keeps it.** The companion has
   *    exactly one such reader: `plugin-pinyin-search`'s backfill/reconcile
   *    walk, which projects `['id', ...sources, '__search']` under
   *    `{ isSystem: true }` and compares the stored blob against the recomputed
   *    one. Strip it unconditionally and that comparison reads `undefined`
   *    every pass — the backfill would rewrite every row of every object on
   *    every run, which is worse than the disclosure it was fixing.
   *  - **A non-system caller does NOT keep it, even by name.** `select` only
   *    gates on whether a field is KNOWN (`assertProjectionFieldsExist`), and
   *    the companion is known once provisioned — so `?select=__search` would
   *    otherwise be an open door straight through this strip, and a
   *    client-invisibility rule with a documented spelling that bypasses it is
   *    not one. `isSystem` is server-derived (never client input), the same
   *    trust the read-only strips on the write path already place in it.
   *
   * ## Why this door is SILENT where the `$searchFields` door returns a 400
   *
   * Asked on #7876 and ruled there on 2026-08-12 (direction C): the divergence
   * is intended, and it is not reopenable on symmetry alone. The two doors are
   * two KINDS of surface.
   *
   *  - `$searchFields` is AUTHORING input — it tells the server how to RUN the
   *    query. A value the server will not honour has to be said out loud, or
   *    the caller gets a WIDER answer than the one they narrowed to, in a
   *    response with nothing to distinguish it from a satisfied one. That is
   *    why `assertSearchFieldsAreSearchable` refuses the name with a 400
   *    (#4254) — the refusal is protecting the ROW SET.
   *  - `select` is a READ PROJECTION — it names what the caller would like
   *    back. Dropping a column the caller may not see leaves the answer
   *    correct: the rows are still the rows that were asked for, one key
   *    lighter. {@link omitInternalFields} directly above answers
   *    `?select=id,key` exactly this way, for exactly this reason (#7728), so
   *    silence here is the platform's existing read-path rule, not an
   *    exception to it.
   *
   * ⛔ Do not add a refusal here to make the two doors agree. That was option B
   * on #7876, weighed and declined: it turns a request that answers 200
   * today into a failure, for tidiness, on a spelling no non-system caller in
   * this tree uses — the companion's only deliberate reader is the backfill
   * carved out above. If a REAL caller is ever burned by the silent drop, that
   * measurement reopens it; the asymmetry by itself does not.
   *
   * ⚠️ `requestedFields` must be the CALLER's `fields`, captured before
   * `planFormulaProjection` — that pass rewrites the projection to every stored
   * column when a formula is in play, companion included.
   */
  private stripSearchCompanionFromRead(
    rows: unknown,
    requestedFields: readonly string[] | undefined,
    context: ExecutionContext | undefined,
  ): void {
    if (context?.isSystem && isSearchCompanionRequested(requestedFields)) return;
    stripSearchCompanion(rows);
  }

  /**
   * Dereference a stored secret ref back to its plaintext. Intended for
   * privileged, server-side consumers (e.g. a datasource connection-pool
   * binder) — NOT exposed through the generic read path, which only ever
   * returns the mask.
   *
   * Fail-closed: throws when no CryptoProvider is registered or the
   * `sys_secret` row is missing. Returns `null` when `ref` is not a secret ref.
   */
  async resolveSecret(ref: unknown, opts?: { tenantId?: string }): Promise<string | null> {
    const id = parseSecretRef(ref);
    if (!id) return null;
    if (!this.cryptoProvider) {
      throw new Error('Cannot resolve secret: no CryptoProvider is registered (fail-closed).');
    }
    const secretDriver = this.getDriver('sys_secret');
    const found = await secretDriver.find('sys_secret', { where: { id } });
    const secret: any = Array.isArray(found) ? found[0] : found;
    if (!secret) {
      throw new Error(`Cannot resolve secret: sys_secret row "${id}" not found (fail-closed).`);
    }
    const handle: CryptoHandle = {
      id: secret.id,
      kmsKeyId: secret.kms_key_id,
      alg: secret.alg,
      version: secret.version,
      ciphertext: secret.ciphertext,
    };
    return this.cryptoProvider.decrypt(handle, {
      namespace: secret.namespace,
      key: secret.key,
      tenantId: opts?.tenantId,
    });
  }

  /**
   * Privileged: recover the plaintext of ONE row's `secret`-typed field.
   *
   * {@link resolveSecret} is documented for "privileged consumers … against the
   * stored ref", but until #7799 there was no supported way for such a consumer
   * to OBTAIN that ref: {@link maskSecretFields} replaces it with
   * {@link SECRET_MASK} on every `find`/`findOne`, unconditionally and after
   * hooks. A server-side reader that genuinely needs the value therefore had
   * two options, both bad — keep the credential in cleartext somewhere the read
   * path does not mask (which is the defect #7799 reports on
   * `sys_webhook.definition_json`), or reach around the engine into the driver
   * from a plugin. This method is the supported third option, and it is why the
   * webhook signing secret can now live in the encrypted channel at all.
   *
   * The row is read at DRIVER level on purpose — that is the only layer where
   * the ref still exists — which means it bypasses read hooks, field-level
   * security and sharing. That is the same trust `resolveSecret` already places
   * in its caller, and the reason both are spelled as explicit, separately-named
   * privileged verbs rather than an option on `find`: there is no query string
   * that reaches this, so it cannot be turned on from outside the process.
   *
   * Refuses any field that is not declared `type: 'secret'`. Without that guard
   * this would be a generic mask-bypass — in particular over a `password` field,
   * which is stored as PLAINTEXT at rest and is masked for exactly that reason
   * (ADR-0100). Only the encrypted channel is dereferenceable.
   *
   * Fail-closed like {@link resolveSecret}: throws when no CryptoProvider is
   * registered or the `sys_secret` row has gone missing. Returns `null` when the
   * row does not exist or the field holds no secret (never set, or cleared).
   */
  async resolveSecretField(
    object: string,
    recordId: string,
    field: string,
    opts?: { tenantId?: string },
  ): Promise<string | null> {
    const schema = this._registry.getObject(object);
    if (!collectSecretFields(schema).includes(field)) {
      throw new Error(
        `Cannot resolve secret field "${object}.${field}": it is not declared as type 'secret'. `
          + 'Only the encrypted secret channel is dereferenceable — a `password` field is stored as '
          + 'plaintext at rest and is masked deliberately (ADR-0100), so dereferencing one here '
          + 'would be a mask bypass, not a decrypt.',
      );
    }
    const driver = this.getDriver(object);
    const found = await driver.find(object, { where: { id: recordId } });
    const row: any = Array.isArray(found) ? found[0] : found;
    if (!row) return null;
    return this.resolveSecret(row[field], opts);
  }

  /**
   * Privileged: recover the stored values of ONE `internal: true` field for a
   * batch of rows, keyed by record id.
   *
   * [#8118] {@link omitInternalFields} deletes a flagged field from every row
   * the engine hands back — with NO system carve-out, by explicit design
   * (#7728): an escape hatch nobody needs is a hole in a non-exposure
   * guarantee. The same ruling names the shape a legitimate system reader uses
   * when one finally appears: it reads the column through a purpose-built
   * privileged accessor, the way {@link resolveSecret} does for `secret`. This
   * method is that accessor. Its first consumer is the outbound-HTTP
   * dispatcher's claim path (`SqlHttpOutbox.claim()` in
   * `@objectstack/service-messaging`): `sys_http_delivery.headers_json` — the
   * authored header map, the ordinary place an `Authorization: Bearer …` goes —
   * is flagged `internal` so the generic data API returns rows without it,
   * while the dispatcher must hand exactly that map to the wire VERBATIM (a
   * delivery that goes out missing a header is not self-announcing: against an
   * endpoint that does not require it, the delivery succeeds while silently
   * deviating from the authored configuration).
   *
   * Batch-shaped, deliberately, where {@link resolveSecretField} is
   * single-record: its consumer claims up to a full batch per dispatcher tick,
   * and #8118's triage rejected the `Field.secret()` route partly BECAUSE that
   * shape costs a driver read plus a decrypt per row per tick. One driver read
   * serves the whole claim batch; a single record is the batch of one. This is
   * the sibling of {@link resolveSecretField}'s pattern — guard first, then a
   * driver-level read — not a second divergent privileged-read path.
   *
   * The rows are read at DRIVER level on purpose — the only layer where the
   * value still exists — so this bypasses read hooks, field-level security and
   * sharing: the same trust {@link resolveSecret} and {@link resolveSecretField}
   * place in their callers, and the same reason all three are explicit,
   * separately-named privileged verbs rather than an option on `find`. No
   * query string reaches this, so it cannot be turned on from outside the
   * process.
   *
   * Refuses (ADR-0112 `code` + `status`) any field not declared
   * `internal: true` on the object. Without that guard this would be a generic
   * read-protection bypass — over `password` plaintext in particular, which is
   * masked deliberately (ADR-0100) — rather than the internal channel's
   * dereference. A `secret`-typed field is likewise refused unless it is also
   * flagged, and even then this returns the stored `secret:<id>` ref, never a
   * plaintext: decryption stays with {@link resolveSecretField}.
   *
   * Returns the stored value per id — `null` when the column is unset. An id
   * whose row does not exist is absent from the map; what a missing row means
   * belongs to the caller (for the dispatcher: a row deleted mid-claim). No
   * decrypt is involved: `internal` is a read-side omission flag, not an
   * encrypted channel — the at-rest story is the object's own (for
   * `sys_http_delivery`, 30d telemetry retention; encrypting the delivery row
   * was measured and rejected on #8118).
   */
  async resolveInternalField(
    object: string,
    recordIds: readonly string[],
    field: string,
  ): Promise<Map<string, unknown>> {
    const schema = this._registry.getObject(object);
    if (!collectInternalReadFields(schema).includes(field)) {
      const err: Error & { code?: string; status?: number; object?: string; field?: string } =
        new Error(
          `Cannot resolve internal field "${object}.${field}": it is not declared \`internal: true\`. `
            + 'Only fields the engine omits from the generic read path are dereferenceable here — '
            + 'anything else either comes back on find/findOne already, or is protected by its own '
            + 'channel (`secret` refs via resolveSecretField; `password` is masked deliberately, '
            + 'ADR-0100, so dereferencing one here would be a mask bypass).',
        );
      err.code = 'INVALID_FIELD';
      err.status = 400;
      err.object = object;
      err.field = field;
      throw err;
    }
    const out = new Map<string, unknown>();
    if (recordIds.length === 0) return out;
    const driver = this.getDriver(object);
    const found = await driver.find(object, {
      where: { id: { $in: [...recordIds] } },
      fields: ['id', field],
    });
    for (const row of Array.isArray(found) ? found : [found]) {
      if (!row || typeof row !== 'object') continue;
      const id = (row as Record<string, unknown>).id;
      if (typeof id !== 'string' && typeof id !== 'number') continue;
      out.set(String(id), (row as Record<string, unknown>)[field] ?? null);
    }
    return out;
  }

  /**
   * Helper to get object definition
   */
  getSchema(objectName: string): ServiceObject | undefined {
    return this._registry.getObject(objectName);
  }

  /**
   * Resolve any object identifier to the physical storage name used by drivers.
   *
   * Accepts the canonical short name (e.g., 'account') or, for explicit
   * cross-package disambiguation, the canonical object name (e.g., 'account'). The result is
   * the physical table name derived via `StorageNameMapping.resolveTableName`.
   */
  private resolveObjectName(name: string): string {
    const schema = this._registry.getObject(name);
    if (schema) {
      return StorageNameMapping.resolveTableName(schema);
    }
    // Return name as-is (canonical name = table name; no FQN prefix to strip)
    return StorageNameMapping.resolveTableName({ name });
  }

  /**
   * Name of the dedicated datasource lifecycle-classed system data prefers
   * when one is registered (ADR-0057 §3.6 / P3). Purely opt-in by the
   * datasource's existence — no `telemetry` driver registered ⇒ resolution
   * is exactly what it was before.
   */
  static readonly LIFECYCLE_DATASOURCE = 'telemetry';

  /**
   * The lifecycle classes that make an object an APPEND-ONLY SYSTEM LEDGER —
   * the audit trail, telemetry, and the event log (ADR-0057 §3.6).
   *
   * One constant, read by both places that must agree (#5351):
   *
   * 1. {@link getDriver} step 3 — which objects lifecycle-class separation
   *    routes to the dedicated datasource;
   * 2. {@link enforceTransactionOrigin} — which cross-datasource writes are
   *    CARVED OUT of an ambient transaction instead of refused.
   *
   * Two hand-written copies of this tuple would drift by one class and produce
   * the worst outcome available: an object routed away by rule 1 and refused by
   * rule 2 loses exactly the compliance row this whole change exists to save.
   *
   * `transient` is deliberately absent, matching step 3: those objects stay on
   * the primary, so they never reach the gate at all.
   */
  static readonly SYSTEM_LEDGER_LIFECYCLE_CLASSES: ReadonlySet<string> = new Set([
    'audit',
    'telemetry',
    'event',
  ]);

  /**
   * Is `objectName` an append-only system ledger? — the #5351 carve-out's
   * discriminator, and deliberately a property of the object's DECLARATION
   * (`lifecycle.class`) rather than of the deployment's routing.
   *
   * Why the declaration and not "was it routed by step 3": an audit ledger
   * pinned to its own datasource by an explicit `datasource:` binding, or by a
   * `datasourceMapping` rule, is the same append-only compliance ledger with
   * the same reason to be carved out — the routing mechanism is an operator's
   * choice, the class is the author's statement about what the data IS. Judging
   * by the mechanism would make the carve-out depend on which of three
   * equivalent configurations a deployment happened to use.
   */
  private isSystemLedgerObject(objectName: string): boolean {
    const lifecycleClass = (
      this._registry.getObject(objectName) as { lifecycle?: { class?: string } } | undefined
    )?.lifecycle?.class;
    return lifecycleClass !== undefined && ObjectQL.SYSTEM_LEDGER_LIFECYCLE_CLASSES.has(lifecycleClass);
  }

  /**
   * Helper to get the target driver
   *
   * Resolution priority (first match wins):
   * 1. Object's explicit `datasource` field (if not 'default')
   * 2. DatasourceMapping rules (namespace/package/pattern matching)
   * 3. Lifecycle-class separation (ADR-0057 §3.6): telemetry/event/audit
   *    objects route to the dedicated 'telemetry' datasource when registered
   * 4. Package's `defaultDatasource` from manifest
   * 5. Global default driver
   *
   * The order itself lives in {@link resolveDatasourceBinding} — this method
   * turns the name it decides on into a driver, and diagnoses the cases where
   * that driver is missing.
   */
  private getDriver(objectName: string): IDataDriver {
    const binding = this.resolveDatasourceBinding(objectName);

    if (binding) {
      const driver = this.drivers.get(binding.datasource);
      if (driver) {
        // Debug lines kept at the DECISION they describe, but emitted here so
        // the resolver stays free of side effects: it also answers the public
        // {@link resolveEffectiveDatasource} probe, which must be able to name
        // a datasource without logging a routing event that never happened.
        if (binding.via === 'mapping') {
          this.logger.debug('Resolved datasource from mapping', {
            object: objectName,
            datasource: binding.datasource
          });
        } else if (binding.via === 'package') {
          this.logger.debug('Resolved datasource from package manifest', {
            object: objectName,
            package: binding.packageId,
            datasource: binding.datasource
          });
        }
        return driver;
      }

      // Only steps 1 and 2 reach here. Steps 3-5 answer ONLY when their driver
      // is registered (that registration is what opts the deployment into
      // lifecycle separation / a package default / a global default at all), so
      // a binding they produce always resolves.
      //
      // The datasource layer may have recorded WHY this one has no driver —
      // refused by the host policy, or failed to connect under
      // OS_ALLOW_DRIVER_CONNECT_FAILURE (framework#3828). Saying so beats
      // sending the reader hunting for a typo that isn't there.
      const unavailable = this.unavailableDatasources.get(binding.datasource);
      if (unavailable) {
        throw new DatasourceUnavailableError(
          binding.datasource,
          objectName,
          unavailable.kind,
          unavailable.publicDetail,
        );
      }
      if (binding.via === 'mapping') {
        throw new Error(
          `[ObjectQL] Datasource '${binding.datasource}' mapped for object '${objectName}' is not registered. ` +
          `A datasourceMapping rule routes this object to it, so falling back to the default store would ` +
          `write the object's data to a different database than the one it declares. Fix the datasource ` +
          `configuration, or remove the mapping rule.`,
        );
      }
      // No record: nothing ever tried to connect this name, so it is genuinely
      // undeclared (or misspelled). Unchanged message — there is nothing to add.
      throw new Error(`[ObjectQL] Datasource '${binding.datasource}' configured for object '${objectName}' is not registered.`);
    }

    throw new Error(`[ObjectQL] No driver available for object '${objectName}'`);
  }

  /**
   * WHERE does `objectName`'s data live, and WHICH step decided — the single
   * implementation of the resolution order documented on {@link getDriver}.
   *
   * Split out for #5288 so the order exists exactly once. It had two readers
   * with two different answers: `getDriver` (all five steps) and every caller
   * that only needed the NAME, which read `object.datasource` — step 1 of five.
   * A second, shorter copy of a routing order is the failure
   * `resolveMappedDatasource` (#4462) was extracted to prevent, and it fails the
   * same way: silently, in whichever direction the copy is short.
   *
   * Steps 1-2 answer even when the named datasource has no registered driver:
   * they are BINDINGS, and `getDriver` stops there (it throws rather than
   * falling through — #4462). Steps 3-5 answer only when their driver is
   * registered, because that registration is what turns each of them on.
   *
   * `undefined` means nothing routes the object anywhere: no binding, and no
   * global default driver to fall back to.
   */
  private resolveDatasourceBinding(objectName: string): {
    datasource: string;
    via: 'explicit' | 'mapping' | 'lifecycle' | 'package' | 'default';
    /** Owning package, on `via: 'package'` only — for the debug line. */
    packageId?: string;
  } | undefined {
    const object = this._registry.getObject(objectName);

    // 1. Object's explicit datasource field (highest priority)
    if (object?.datasource && object.datasource !== 'default') {
      return { datasource: object.datasource, via: 'explicit' };
    }

    // 2. Check datasourceMapping rules
    //
    // A rule that MATCHES is a routing decision, not a hint (#4462). It used to
    // fall through to steps 3-5 whenever the named datasource had no live
    // driver, which put an object's rows in the DEFAULT store while every
    // signal said otherwise: boot succeeded, `/ready` answered 200, the
    // datasource name appeared nowhere in the log, and the write returned 201.
    // An operator who routes an object to Postgres and gets the URL wrong finds
    // out by going to look in Postgres and finding it empty.
    //
    // `default` is the one name that legitimately resolves onward: the default
    // driver keeps its NATURAL name (#3826), so `drivers.has('default')` is
    // false by construction and step 5 is how routing to it works.
    const mappedDatasource = this.resolveDatasourceFromMapping(objectName, object);
    if (mappedDatasource && mappedDatasource !== 'default') {
      return { datasource: mappedDatasource, via: 'mapping' };
    }

    // 3. Lifecycle-class separation (ADR-0057 §3.6): high-frequency
    // platform-generated data (telemetry / event) and the audit ledger move
    // to a dedicated 'telemetry' datasource when one is registered, so their
    // growth can never again pollute the business DB. `transient` stays on
    // the primary deliberately: those objects are user-session data, and
    // some (e.g. better-auth's sys_device_code) are also accessed outside
    // the engine — splitting their storage would split their brain.
    const lifecycleClass = (object as { lifecycle?: { class?: string } } | undefined)?.lifecycle?.class;
    if (
      lifecycleClass !== undefined &&
      ObjectQL.SYSTEM_LEDGER_LIFECYCLE_CLASSES.has(lifecycleClass) &&
      this.drivers.has(ObjectQL.LIFECYCLE_DATASOURCE)
    ) {
      return { datasource: ObjectQL.LIFECYCLE_DATASOURCE, via: 'lifecycle' };
    }

    // 4. Check package's defaultDatasource
    // Use the object's FQN name (from getObject) for ownership lookup
    const fqn = object?.name || objectName;
    const owner = this._registry.getObjectOwner(fqn);
    if (owner?.packageId) {
      const manifest = this.manifests.get(owner.packageId);
      const packageDatasource = manifest?.defaultDatasource;
      if (packageDatasource && packageDatasource !== 'default' && this.drivers.has(packageDatasource)) {
        return { datasource: packageDatasource, via: 'package', packageId: owner.packageId };
      }
    }

    // 5. Fallback to global default driver
    if (this.defaultDriver && this.drivers.has(this.defaultDriver)) {
      return { datasource: this.defaultDriver, via: 'default' };
    }

    return undefined;
  }

  /**
   * Which datasource is `objectName` BOUND to? — the effective one, resolved
   * through the same five steps {@link getDriver} routes by, computed as a NAME
   * and without taking a driver.
   *
   * The public face of {@link resolveDatasourceBinding}, added for #5288, and
   * the same argument as {@link resolveMappedDatasource} (#4462): a caller that
   * only needs to NAME the datasource used to read `object.datasource` and stop
   * there. That is step 1 of five, and `ObjectSchema.datasource` carries
   * `.default('default')` — so an object routed by a `datasourceMapping` rule,
   * by the ADR-0057 §3.6 lifecycle split, or by its package's
   * `defaultDatasource` answered `'default'`, which in this engine means "no
   * explicit binding, keep looking", never "the primary DB". A diagnostic built
   * on that answer names a database the rows are not in.
   *
   * Returns `undefined` when nothing binds the object anywhere and it simply
   * rides the deployment's default driver (step 5), which is deliberate on two
   * counts. The default driver keeps its NATURAL name (#3826 —
   * `drivers.has('default')` is false by construction), so that name identifies
   * a driver, not a datasource anyone bound this object to; and "rides the
   * default" is what the consumers of this answer already document as
   * `undefined`. Callers that need the default driver's name have
   * {@link getDefaultDriverName}.
   *
   * Never throws. A binding whose datasource has no registered driver is still
   * this object's datasource — the deployment is broken, `getDriver` says so
   * loudly, and a naming probe must be able to report the name that is broken.
   */
  resolveEffectiveDatasource(objectName: string): string | undefined {
    const binding = this.resolveDatasourceBinding(objectName);
    return binding && binding.via !== 'default' ? binding.datasource : undefined;
  }

  /**
   * Which datasource do the mapping rules route `objectName` to, if any?
   *
   * The PUBLIC face of {@link resolveDatasourceFromMapping}, added for the boot
   * path (#4462): the datasource-connection service must connect the
   * datasources a mapping actually routes objects to, and it must learn which
   * those are from the same resolver the query path uses. A second
   * implementation of "does this rule match?" living in the connection service
   * would drift by one clause and produce the worst of both postures — a
   * datasource connected that routing does not use, or routed to and never
   * connected, which is the defect itself.
   *
   * Returns `null` when no rule matches, and the datasource name (including
   * `'default'`) when one does. Rule matching only — an explicit
   * `object.datasource` binding outranks this and is not consulted here.
   */
  resolveMappedDatasource(objectName: string): string | null {
    return this.resolveDatasourceFromMapping(objectName, this._registry.getObject(objectName));
  }

  /**
   * Resolve datasource from mapping rules
   *
   * Rules are evaluated in order (or by priority if specified).
   * First matching rule wins.
   */
  private resolveDatasourceFromMapping(
    objectName: string,
    object?: any
  ): string | null {
    if (!this.datasourceMapping || this.datasourceMapping.length === 0) {
      return null;
    }

    // Sort rules by priority if any have priority set
    const sortedRules = [...this.datasourceMapping].sort((a, b) => {
      const aPriority = a.priority ?? 1000;
      const bPriority = b.priority ?? 1000;
      return aPriority - bPriority;
    });

    for (const rule of sortedRules) {
      // 1. Match by namespace
      if (rule.namespace && object?.namespace === rule.namespace) {
        return rule.datasource;
      }

      // 2. Match by package ID
      if (rule.package && object?.packageId === rule.package) {
        return rule.datasource;
      }

      // 3. Match by object name pattern (glob-style)
      if (rule.objectPattern && this.matchPattern(objectName, rule.objectPattern)) {
        return rule.datasource;
      }

      // 4. Default fallback rule
      if (rule.default) {
        return rule.datasource;
      }
    }

    return null;
  }

  /**
   * Simple glob pattern matching
   * Supports * (any chars) and ? (single char)
   */
  private matchPattern(objectName: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
      .replace(/\*/g, '.*')                   // * → .*
      .replace(/\?/g, '.');                   // ? → .

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(objectName);
  }

  /**
   * Set datasource mapping rules
   * Called by ObjectQLPlugin during bootstrap
   */
  setDatasourceMapping(rules: Array<{
    namespace?: string;
    package?: string;
    objectPattern?: string;
    default?: boolean;
    datasource: string;
    priority?: number;
  }>) {
    this.datasourceMapping = rules;
    this.logger.info('Datasource mapping rules configured', {
      ruleCount: rules.length
    });
  }

  /**
   * Initialize the engine and all registered drivers.
   *
   * **Fail-fast by default** (framework#3741): if any boot-registered driver's
   * `connect()` rejects, this throws {@link DriverConnectError} and kernel
   * bootstrap aborts. Two reasons, both load-bearing:
   *
   *  1. Booting without a reachable datasource produces a server that reports
   *     itself started and then 500s every request with an error that reads
   *     nothing like "the database is unreachable". The caller immediately
   *     makes it worse: `ObjectQLPlugin.start()` runs `syncRegisteredSchemas()`
   *     right after this, issuing DDL against a driver that isn't there — so
   *     the boot leaves the schema half-applied even if the database appears
   *     a second later. Recovery is not the point: the underlying clients DO
   *     re-establish connections on their own (framework#3759 verified this),
   *     but nothing re-runs the boot sequence that was skipped.
   *  2. Swallowing the rejection removed a driver's ability to REFUSE STARTUP.
   *     Any fatal startup check — licence, server version, incompatible
   *     configuration, missing capability, not just an unreachable socket — is
   *     expressed by throwing from `connect()`, and every one of them used to
   *     be silently downgraded to a runtime error. (That is why
   *     driver-mongodb's multi-tenancy guard had to be hoisted into its
   *     constructor in #3734; `connect()` is a supported place for it now.)
   *
   * Operators who need the old lenient behaviour opt in explicitly with
   * `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`, which boots in a state that is warned
   * about loudly rather than assumed.
   */
  async init() {
    this.logger.info('Initializing ObjectQL engine', {
      driverCount: this.drivers.size,
      drivers: Array.from(this.drivers.keys())
    });

    const failures: DriverConnectFailure[] = [];
    for (const [name, driver] of this.drivers) {
      try {
        await driver.connect();
        this.logger.info('Driver connected successfully', { driverName: name });
      } catch (e) {
        failures.push({ driverName: name, error: e });
        this.logger.error('Failed to connect driver', e as Error, { driverName: name });
      }
    }

    if (failures.length > 0) {
      if (!resolveAllowDriverConnectFailure()) {
        throw new DriverConnectError(failures, this.drivers.size);
      }
      const failedDrivers = failures.map(f => f.driverName);
      const banner =
        `⚠️ DEGRADED BOOT: ${failures.length} of ${this.drivers.size} driver(s) failed to connect ` +
        `(${failedDrivers.join(', ')}), but OS_ALLOW_DRIVER_CONNECT_FAILURE is set — starting anyway. ` +
        `Every query routed to them fails until the datasource becomes reachable, and the boot-time ` +
        `schema sync is SKIPPED FOR GOOD — the client will reconnect on its own, but nothing re-runs ` +
        `the DDL, so those objects may have no tables even after the database comes back. Unset ` +
        `OS_ALLOW_DRIVER_CONNECT_FAILURE to restore fail-fast boot.`;
      this.logger.warn(banner, { failedDrivers });
      // …and again on a channel the operator's log level cannot filter away: the
      // line above is dropped outright at `error`/`fatal`/`silent`, which is a
      // normal production setting and precisely where this flag gets used. See
      // the helper's note — the duplication is deliberate, and it is NOT about
      // `os serve`'s boot-quiet window (that swallowed it too until #4012).
      emitDegradedBootBanner(banner);
    }

    this.logger.info('ObjectQL engine initialization complete');
  }

  /**
   * Ping every registered driver and report which ones are usable RIGHT NOW
   * (framework#3756).
   *
   * `init()` answers "could the drivers connect at boot"; this answers "can
   * they serve a query at this instant", which is a different question the
   * moment the database restarts, fails over, or drops the pool. Readiness
   * probes are the intended caller — a replica whose driver is down fails 100%
   * of its requests and must leave the load-balancer rotation.
   *
   * Every check is bounded by `timeoutMs` (default 2s) and settled
   * independently. The bound is not optional: `IDataDriver.checkHealth()`
   * swallows its own errors and returns `false`, but on a dead pool it does
   * not return at all — knex's `SELECT 1` waits out `acquireConnectionTimeout`
   * (60s by default). A probe that hangs is as useless as one that lies, so a
   * timed-out driver is reported unhealthy rather than awaited.
   *
   * A driver that implements no `checkHealth()` is reported healthy: absence of
   * a probe is not evidence of failure, and reporting "unhealthy" would take a
   * working deployment out of rotation over a driver that simply never had the
   * optional method.
   */
  async checkDriversHealth(opts?: { timeoutMs?: number }): Promise<DriverHealth[]> {
    const timeoutMs = opts?.timeoutMs ?? 2_000;

    return Promise.all(
      Array.from(this.drivers, async ([driverName, driver]): Promise<DriverHealth> => {
        if (typeof driver.checkHealth !== 'function') {
          return { driverName, healthy: true, skipped: true };
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const healthy = await Promise.race([
            Promise.resolve(driver.checkHealth()),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`checkHealth did not settle within ${timeoutMs}ms`)),
                timeoutMs,
              );
              // Never hold the event loop open for a probe.
              (timer as { unref?: () => void }).unref?.();
            }),
          ]);
          return healthy
            ? { driverName, healthy: true }
            : { driverName, healthy: false, error: 'checkHealth() returned false' };
        } catch (e) {
          return {
            driverName,
            healthy: false,
            error: e instanceof Error ? e.message : String(e),
          };
        } finally {
          if (timer) clearTimeout(timer);
        }
      }),
    );
  }

  /**
   * Does this object declare a media field at all? Cached per schema object —
   * the registry hands back the same instance per object, so this scans a
   * field map once rather than on every write.
   */
  private objectHasMediaField(objectSchema: any): boolean {
    if (!objectSchema?.fields) return false;
    const cached = ObjectQL.mediaFieldPresence.get(objectSchema);
    if (cached !== undefined) return cached;
    const present = Object.values(objectSchema.fields).some(
      (def: any) => def && FILE_REFERENCE_TYPES.has(def.type),
    );
    ObjectQL.mediaFieldPresence.set(objectSchema, present);
    return present;
  }
  private static readonly mediaFieldPresence = new WeakMap<object, boolean>();

  /**
   * The media value-shape verdict for a write against `objectSchema`.
   *
   * Dormant by design, mirroring the storage module's own rule: an object with
   * no file-class field can hold no malformed media value, so it must not pay
   * even one query to learn that. Only objects that actually declare media
   * consult the deployment flag — and that read is itself memoized, so the
   * whole mechanism costs one query per process, and zero for an app that
   * stores no files.
   */
  private async mediaValueShapeStrictFor(objectSchema: any): Promise<boolean> {
    if (!this.objectHasMediaField(objectSchema)) return false;
    return this.isFileReferencesMigrationVerified();
  }

  /**
   * Does this object declare a reference or structured-JSON field that a write
   * would actually check? Same per-schema cache and same dormancy rule as
   * {@link objectHasMediaField}: an object holding none can hold no violation
   * of them, so it must not pay a query to learn that.
   *
   * The membership test is `isScannableValueShapeField` — the validator's own
   * — and not raw type membership, because the registry INJECTS covered-type
   * fields into every object it registers: `organization_id` and `owner_id`
   * (both `system`), plus `created_by` / `updated_by` (both in `SKIP_FIELDS`),
   * are all `lookup`s. `validateRecord` skips every one of them before it ever
   * reaches the value-shape check, so counting them made this answer `true` for
   * literally every object — the dormancy rule above never fired, and this
   * cache memoized a constant. Same predicate as the scanner for the same
   * reason the scanner imports it: three readings of "a covered field" drifting
   * by one clause is how a gate ends up governing fields nothing enforces.
   */
  private objectHasCoveredValueField(objectSchema: any): boolean {
    if (!objectSchema?.fields) return false;
    const cached = ObjectQL.coveredValueFieldPresence.get(objectSchema);
    if (cached !== undefined) return cached;
    const present = Object.entries(objectSchema.fields).some(
      ([name, def]: [string, any]) => isScannableValueShapeField(name, def),
    );
    ObjectQL.coveredValueFieldPresence.set(objectSchema, present);
    return present;
  }
  private static readonly coveredValueFieldPresence = new WeakMap<object, boolean>();

  /** The reference / structured-JSON value-shape verdict for a write. */
  private async valueShapeStrictFor(objectSchema: any): Promise<boolean> {
    if (!this.objectHasCoveredValueField(objectSchema)) return false;
    return this.isValueShapesMigrationVerified();
  }

  /**
   * Has this deployment completed AND verified the ADR-0104 file-as-reference
   * migration (#3617)? Read once per process from the `sys_migration` flag.
   *
   * Every way of not knowing answers `false` — no storage service (so no
   * `sys_migration` object registered), no row, an unreadable table, a
   * malformed row. Enforcement derives from evidence, and absent evidence is
   * not permission. Here "no" means media value shapes keep warning instead
   * of rejecting, so a deployment that cannot be asked keeps writing.
   *
   * Public because the flag's other in-process consumer reads it through this
   * same memoized seam: the storage service's release path (#3459 PR-5b) asks
   * it whether a released field file may be tombstoned, duck-typed as an
   * optional method so a fake or an older engine reads as "not verified".
   * One read, one invalidation (`invalidateDataMigrationFlags`), no way for
   * the two consumers to see different answers.
   *
   * Costs nothing on a kernel without the storage objects: the registry lookup
   * short-circuits before any query.
   */
  async isFileReferencesMigrationVerified(): Promise<boolean> {
    return this.readMigrationFlagMemoized(
      'fileReferencesMigrationVerified',
      FILE_REFERENCES_MIGRATION_ID,
      '[value-shape] this deployment has verified the file-as-reference migration — ' +
        'media value shapes are enforced and released field files may be collected ' +
        '(ADR-0104 / #3617)',
    );
  }

  /**
   * Has this deployment completed AND verified the ADR-0104 non-media
   * value-shape scan (`os migrate value-shapes`, #3438)? Same memoized seam and
   * same fail-lenient posture as the file flag above — and a SEPARATE flag,
   * because it attests a different fact. The file migration says file values
   * were converted and reconciled; it says nothing about whether a `lookup` id
   * or a `location` payload is well formed, so it may not vouch for these
   * classes.
   */
  async isValueShapesMigrationVerified(): Promise<boolean> {
    return this.readMigrationFlagMemoized(
      'valueShapesMigrationVerified',
      VALUE_SHAPES_MIGRATION_ID,
      '[value-shape] this deployment has verified the value-shape scan — reference and ' +
        'structured-JSON value shapes are enforced (ADR-0104 / #3438)',
    );
  }

  /**
   * The memoized seam both public flag readers share — and the place where
   * "read once per process" is kept from meaning "answer from a read that
   * never happened" (#4769).
   *
   * The two negatives this read can produce are NOT the same fact:
   *
   *  - **Conclusive.** The ledger was reachable and it does not authorise the
   *    gate (no row, `verified_at` null, blocking findings). Evidence was
   *    consulted; memoize it. A later in-process migration run announces
   *    itself through {@link invalidateDataMigrationFlags}.
   *  - **Inconclusive.** The ledger could not be ASKED — `sys_migration` is
   *    not registered yet, or the query threw. Both still answer `false` (an
   *    unaskable gate stays closed), but freezing that for the life of the
   *    process turns one unlucky early write into a whole boot's posture. It
   *    is exactly how one boot ends up lax over data the next boot rejects:
   *    the platform objects register during kernel init while the very first
   *    write can land before them, so the answer cached is about a moment
   *    when nothing could have answered at all.
   *
   * So an inconclusive read is answered but not kept. The retry costs one
   * registry lookup per write until the ledger exists (it short-circuits
   * before any query), and stops the moment a real read succeeds.
   */
  private async readMigrationFlagMemoized(
    slot: 'fileReferencesMigrationVerified' | 'valueShapesMigrationVerified',
    migrationId: string,
    verifiedLog: string,
  ): Promise<boolean> {
    const cached = this[slot];
    if (cached) return (await cached).verified;
    const pending = this.readMigrationFlagVerified(migrationId, verifiedLog);
    this[slot] = pending;
    const result = await pending;
    // Only a read that actually consulted the ledger may be remembered. Clear
    // by identity so a concurrent `invalidateDataMigrationFlags()` (or a
    // re-read that already replaced this slot) is not undone here.
    if (!result.conclusive && this[slot] === pending) this[slot] = null;
    return result.verified;
  }

  /**
   * Read one deployment migration flag and answer whether it authorises its
   * consumers. Shared by both flags so the "every way of not knowing answers
   * false" rule is written once: no `sys_migration` object registered, no row,
   * an unreadable table, a malformed row — all `false`. Enforcement derives
   * from evidence, and absent evidence is not permission.
   *
   * `conclusive` says whether the ledger was actually consulted, so the caller
   * can tell "asked, and the answer is no" from "could not ask" — see
   * {@link readMigrationFlagMemoized}. It never changes the verdict, only
   * whether that verdict is worth remembering.
   *
   * Costs nothing on a kernel without the platform objects: the registry
   * lookup short-circuits before any query.
   */
  private async readMigrationFlagVerified(
    migrationId: string,
    verifiedLog?: string,
  ): Promise<{ verified: boolean; conclusive: boolean }> {
    if (!this._registry.getObject(DATA_MIGRATION_FLAG_OBJECT)) {
      return { verified: false, conclusive: false };
    }
    try {
      const rows = await this.find(DATA_MIGRATION_FLAG_OBJECT, {
        where: { id: migrationId },
        limit: 1,
        context: { isSystem: true } as ExecutionContext,
      });
      const row: any = rows?.[0];
      if (!row || row.id !== migrationId) return { verified: false, conclusive: true };
      const verified = isDataMigrationFlagVerified({
        id: migrationId,
        last_run_at: String(row.last_run_at ?? ''),
        verified_at: row.verified_at == null ? null : String(row.verified_at),
        // A non-numeric count must read as "not zero", not as 0 — a bad
        // coercion lands on NaN, which fails the === 0 test.
        blocking: typeof row.blocking === 'number' ? row.blocking : Number(row.blocking ?? Number.NaN),
      });
      if (verified && verifiedLog) this.logger.info(verifiedLog);
      return { verified, conclusive: true };
    } catch {
      return { verified: false, conclusive: false }; // unreadable evidence → stay lenient, keep asking
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // The counterexamples this boot has written (ADR-0104 / #4769)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Every ADR-0104 value-shape violation this process has ADMITTED, tallied
   * per migration id — the evidence that stops a boot certifying a contract it
   * has itself broken.
   *
   * ## The invariant this exists to keep
   *
   * A boot may not prove a contract it violates in that same boot. The
   * fresh-datastore attestation used to do exactly that: a store created from
   * empty was recorded as `verified` because emptiness settles both ADR-0104
   * facts — and then the very same boot seeded rows whose values contradict
   * them. The certificate was true at the instant it was written and false a
   * second later, so the FIRST boot ran warn-first over data it stored and
   * every LATER boot read the certificate, enforced, and rejected the data its
   * own predecessor had written. Nothing changed but a restart.
   *
   * ## Why the write path is the right witness
   *
   * Certifying a deployment clean needs a complete scan; showing it is NOT
   * clean needs one counterexample. The write path already computes that
   * counterexample with the exact predicate strict mode would use, so this
   * tally is free, exact, and impossible to drift from enforcement — the three
   * properties a second scan implementation would have had to earn.
   *
   * Keyed by migration id (not by field class) so the one place that maps a
   * value class to the flag that gates it stays here, beside the gates
   * themselves. A consumer asks about `adr-0104-file-references` and gets an
   * answer about `adr-0104-file-references`.
   */
  valueShapeViolationsAdmitted(): Record<string, AdmittedValueShapeViolationTally> {
    const out: Record<string, AdmittedValueShapeViolationTally> = {};
    for (const [migrationId, tally] of this.admittedValueShapeViolations) {
      out[migrationId] = { count: tally.count, first: { ...tally.first } };
    }
    return out;
  }

  /** Per-migration tally of admitted violations; see the accessor above. */
  private readonly admittedValueShapeViolations = new Map<string, AdmittedValueShapeViolationTally>();
  /** Ids whose creation attestation this process has already torn up. */
  private readonly retractedCreationAttestations = new Set<string>();
  /** Serializes retraction writes so concurrent violations issue one update. */
  private creationAttestationRetraction: Promise<void> = Promise.resolve();
  /**
   * Ids whose deviation marker this process has already written (#4797).
   * Reset by {@link invalidateDataMigrationFlags}, which is what a host calls
   * after running a migration in-process — a re-earned certificate opens a
   * fresh witness window, and without the reset the next admitted value in the
   * same process would be silently unrecorded.
   */
  private readonly recordedDeviations = new Set<string>();
  /** Serializes deviation writes so concurrent violations issue one update. */
  private deviationRecording: Promise<void> = Promise.resolve();

  /**
   * The sink `validateRecord` reports admitted violations to. Built per write
   * (one closure per call, not per row) so the tally can name the object.
   */
  private admittedViolationSink(object: string): AdmittedValueShapeViolationSink {
    return (violation) => this.noteAdmittedValueShapeViolation(object, violation);
  }

  private noteAdmittedValueShapeViolation(object: string, violation: AdmittedValueShapeViolation): void {
    const migrationId =
      violation.gate === 'media' ? FILE_REFERENCES_MIGRATION_ID : VALUE_SHAPES_MIGRATION_ID;
    const existing = this.admittedValueShapeViolations.get(migrationId);
    if (existing) {
      existing.count += 1;
    } else {
      this.admittedValueShapeViolations.set(migrationId, {
        count: 1,
        first: { object, field: violation.field, type: violation.type, detail: violation.detail },
      });
    }
    // Two consumers of the same counterexample, answering different questions.
    // The deviation marker goes first because it is the one that applies to
    // EVERY verified deployment (#4797); the retraction below applies only to
    // the narrow fresh-datastore case (#4769) and closes the gate outright
    // there. Each is the other's backstop if one write fails.
    this.recordObservedDeviation(migrationId);
    this.retractCreationAttestation(migrationId);
  }

  /**
   * Record that this deployment has ADMITTED a value its own verified contract
   * rejects (#4797) — without touching `verified_at`.
   *
   * ## The window
   *
   * Once a certificate holds, the write path is strict and a non-conforming
   * value cannot land, so the certificate cannot go stale on its own. The
   * operator escape hatches are the exception, and they exist *precisely* to
   * relax a deployment that has already verified: with
   * `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES` on, the value is
   * admitted and persisted while `sys_migration` still reads `verified_at`
   * non-null, `blocking: 0`. Turn the switch off — or let any other process or
   * machine run without it — and strict returns to reject the very data this
   * deployment stored. Meanwhile the `adr-0104-file-references` gate, which
   * also governs reclamation of released field files, keeps deleting bytes on
   * the strength of a certificate that is now false.
   *
   * ## Why a marker rather than a revocation
   *
   * {@link retractCreationAttestation} clears `verified_at`, and is right to:
   * its target is a certificate issued on the inference "created empty, so
   * clean", which a single counterexample fully disproves. A certificate
   * earned by `os migrate … --apply` is a walk of the whole store, and one
   * admitted write is not evidence of that order — overturning it would make a
   * deliberately temporary switch into a one-way door, forcing a full
   * re-migration on anyone who used the escape hatch once.
   *
   * So the authority is withdrawn in proportion to reversibility. The marker
   * leaves every recoverable behaviour running (strict enforcement once the
   * switch is off, tombstoning, throttling — a rejected write is retried, a
   * tombstone is lifted on re-attach) and stops only what cannot be undone:
   * `authorisesIrreversibleAction` is false while it stands, so the reap
   * guard's byte delete refuses. A real apply-mode run clears it.
   *
   * ## Cost
   *
   * At most one ledger read+update per migration id per process, never awaited
   * by the write that triggered it, and skipped entirely once the marker is
   * standing. A lax write is therefore not a ledger round-trip; the FIRST lax
   * write of each class is, and only while the row is still verified.
   *
   * Deliberately never inserts. No row means nothing was certified, so there
   * is no authority to withdraw — and inserting one would fabricate a run that
   * never happened.
   */
  private recordObservedDeviation(migrationId: string): void {
    if (this.recordedDeviations.has(migrationId)) return;
    if (!this._registry.getObject(DATA_MIGRATION_FLAG_OBJECT)) return;
    this.recordedDeviations.add(migrationId);
    this.deviationRecording = this.deviationRecording
      .then(async () => {
        const rows = await this.find(DATA_MIGRATION_FLAG_OBJECT, {
          where: { id: migrationId },
          limit: 1,
          context: { isSystem: true } as ExecutionContext,
        });
        const row: any = rows?.[0];
        if (!row || row.id !== migrationId) return; // nothing certified — no authority to withdraw
        if (row.deviation_observed_at != null && String(row.deviation_observed_at) !== '') return; // already standing
        // Only a row that currently authorises something can have authority
        // withdrawn. An unverified row already denies both halves, so marking
        // it would add a diagnostic nobody gates on — and the next apply run
        // would clear it before anything read it.
        const verified = isDataMigrationFlagVerified({
          id: migrationId,
          last_run_at: String(row.last_run_at ?? ''),
          verified_at: row.verified_at == null ? null : String(row.verified_at),
          blocking: typeof row.blocking === 'number' ? row.blocking : Number(row.blocking ?? Number.NaN),
        });
        if (!verified) return;
        const tally = this.admittedValueShapeViolations.get(migrationId);
        const now = new Date().toISOString();
        await this.update(
          DATA_MIGRATION_FLAG_OBJECT,
          {
            id: migrationId,
            deviation_observed_at: now,
            deviation_detail: JSON.stringify({
              observed: 'lax-admitted-violating-value',
              ...(tally?.first ?? {}),
            }),
            updated_at: now,
          },
          { context: { isSystem: true } as ExecutionContext },
        );
        this.logger.warn(
          `[value-shape] '${migrationId}': this deployment is recorded as verified, but an ` +
            'escape hatch (OS_ALLOW_LAX_MEDIA_VALUES / OS_ALLOW_LAX_VALUE_SHAPES) just admitted a ' +
            `value that contract rejects (${tally?.first.object}.${tally?.first.field}: ` +
            `${tally?.first.detail}). The certificate stands for everything recoverable, but ` +
            'irreversible actions are withheld — released field files are no longer collected, so ' +
            'no byte is deleted on evidence this deployment has contradicted. Fix the data and run ' +
            '`os migrate ' +
            (migrationId === FILE_REFERENCES_MIGRATION_ID ? 'files-to-references' : 'value-shapes') +
            ' --apply` to clear it (ADR-0104 / #4797).',
        );
      })
      .catch((err: any) => {
        // Bookkeeping must never surface as a write failure. Failing to record
        // is the dangerous direction — it leaves the reclamation gate open on
        // a certificate we now know is stale — so say so loudly.
        this.logger.warn(
          `[value-shape] could not record the observed deviation for '${migrationId}' ` +
            `(${err?.message ?? err}) — the ledger still authorises irreversible collection while ` +
            'this deployment holds a value its own contract rejects; run the migration to ' +
            're-derive the gate (#4797)',
        );
      });
  }

  /**
   * Tear up a creation attestation this boot has just contradicted (#4769).
   *
   * The attestation normally never gets written in the first place: it asks
   * {@link valueShapeViolationsAdmitted} before recording anything, so a boot
   * that seeded a violating value declines to certify. This closes the other
   * order — the certificate is already in the ledger and the contradicting
   * value lands afterwards, which is reachable whenever the deployment is
   * still lenient at that moment (`OS_ALLOW_LAX_MEDIA_VALUES` /
   * `OS_ALLOW_LAX_VALUE_SHAPES`) or whenever a writer runs after the
   * attestation point at all — the `os dev` hot-reload seeder and a runtime
   * marketplace install both seed on a store this boot created. Without this
   * the ledger would keep asserting a fact the store contradicts, and the NEXT
   * boot would enforce it against exactly the data this one wrote.
   *
   * The boot's own inline seed used to head that list, via the background
   * continuation of a run that overran `OS_INLINE_SEED_BUDGET_MS` — the
   * attestation's `kernel:ready` backstop fired mid-seed and the tail landed
   * against the certificate it had just issued. #4795 closed that ordering at
   * the source: the attestation now defers while the `seed-settlement` contract
   * reports a source outstanding, so the inline seed can no longer contradict
   * a certificate this boot issued. This stays the safety net rather than the
   * first line of defence for it.
   *
   * Deliberately narrow:
   *
   *  - only on a store THIS boot created from empty, so the only verified row
   *    that can exist is the attestation this boot issued. Evidence produced by
   *    a real `os migrate … --apply` run is never rewritten from here — a scan
   *    that walked the whole store outranks a single write's observation, and
   *    an operator who opted into leniency did not ask us to revoke their
   *    migration;
   *  - never inserts. No row means nothing was certified, and the attestation
   *    declining on the tally is what keeps it that way;
   *  - once per migration id per process, and never awaited by the write. The
   *    recorded `blocking` count is therefore a LOWER bound — which is all the
   *    gate reads, since any non-zero count closes it.
   */
  private retractCreationAttestation(migrationId: string): void {
    if (this.retractedCreationAttestations.has(migrationId)) return;
    if (!this._registry.getObject(DATA_MIGRATION_FLAG_OBJECT)) return;
    if (!this.wasDatastoreCreatedFromEmpty()) return;
    this.retractedCreationAttestations.add(migrationId);
    this.creationAttestationRetraction = this.creationAttestationRetraction
      .then(async () => {
        const rows = await this.find(DATA_MIGRATION_FLAG_OBJECT, {
          where: { id: migrationId },
          limit: 1,
          context: { isSystem: true } as ExecutionContext,
        });
        const row: any = rows?.[0];
        if (!row || row.id !== migrationId) return; // nothing certified — nothing to revoke
        if (row.verified_at == null) return; // gate already closed
        const tally = this.admittedValueShapeViolations.get(migrationId);
        const now = new Date().toISOString();
        let details: Record<string, unknown> = {};
        if (typeof row.details === 'string' && row.details.length > 0) {
          try {
            const parsed = JSON.parse(row.details);
            if (parsed && typeof parsed === 'object') details = parsed as Record<string, unknown>;
          } catch {
            details = { previous_details: row.details };
          }
        }
        await this.update(
          DATA_MIGRATION_FLAG_OBJECT,
          {
            id: migrationId,
            verified_at: null,
            blocking: tally?.count ?? 1,
            details: JSON.stringify({
              ...details,
              revoked: 'boot-admitted-violating-value',
              revoked_at: now,
              revoked_by: tally?.first,
            }),
            updated_at: now,
          },
          { context: { isSystem: true } as ExecutionContext },
        );
        this.invalidateDataMigrationFlags();
        this.logger.warn(
          `[value-shape] revoked '${migrationId}': this deployment was recorded as verified at ` +
            'creation, then this boot wrote a value that contradicts it ' +
            `(${tally?.first.object}.${tally?.first.field}: ${tally?.first.detail}). ` +
            'The gate is closed again — fix the data, then run `os migrate ' +
            (migrationId === FILE_REFERENCES_MIGRATION_ID ? 'files-to-references' : 'value-shapes') +
            ' --apply` to re-earn it (ADR-0104 / #4769).',
        );
      })
      .catch((err: any) => {
        // Bookkeeping must never surface as a write failure. Staying verified
        // is the bad direction, so say so loudly rather than silently.
        this.logger.warn(
          `[value-shape] could not revoke the creation attestation for '${migrationId}' ` +
            `(${err?.message ?? err}) — the ledger still claims this deployment is verified ` +
            'while its data contradicts that; run the migration to re-derive it (#4769)',
        );
      });
  }

  /**
   * Drop the memoized deployment migration flags so the next write re-reads
   * them. For a host that runs a data migration in-process and wants its
   * effect without a restart.
   *
   * Also reopens the deviation witness window (#4797). The run that prompted
   * this call cleared any standing marker, so the "already recorded, don't
   * write again" guard would otherwise silence the next admitted value for the
   * life of the process — a deployment could re-earn its certificate and then
   * deviate again with nothing noticing. Costs at most one further ledger
   * write per migration id per re-run.
   */
  invalidateDataMigrationFlags(): void {
    this.fileReferencesMigrationVerified = null;
    this.valueShapesMigrationVerified = null;
    this.migrationGatesAnnounced = false;
    this.recordedDeviations.clear();
  }

  /**
   * Say, once at boot, which value-shape gates are still open here and what
   * closes them (ADR-0104's 2026-07-30 addendum, #3438).
   *
   * Both gates fail toward leniency: a deployment that never runs its
   * migration keeps warning instead of rejecting, and keeps every released
   * file forever. That default is deliberate — but silent, and a gate nobody
   * is told about is served by nobody. The LAX posture is the one worth
   * announcing, so this logs only when a gate is open *and* this deployment's
   * own metadata says the gate is about something it stores; the verified case
   * already logs from the flag read.
   *
   * A gate whose posture an environment switch has already settled says
   * nothing either, because the flag this line reports on is not what decides
   * that deployment's posture: under `OS_DATA_VALUE_SHAPE_STRICT_ENABLED`
   * enforcement is already on, so "checked but NOT enforced here" is simply
   * false, and under either opt-out the operator chose leniency deliberately,
   * so naming a migration that would not change what they get is noise. Each
   * gate consults its own pair, since the opt-outs are per-class. Cheapest
   * test first: a kernel with nothing to say never reaches the flag query.
   *
   * Costs one flag read per applicable gate (both memoized, and both already
   * paid by the first write to such an object), and nothing at all for an app
   * that declares neither class of field.
   */
  async announceOpenMigrationGates(): Promise<void> {
    if (this.migrationGatesAnnounced) return;
    this.migrationGatesAnnounced = true;
    try {
      const mediaByEnv = mediaPostureSetByEnv();
      const coveredByEnv = valueShapePostureSetByEnv();
      if (mediaByEnv && coveredByEnv) return;

      let media = false;
      let covered = false;
      for (const obj of this._registry.getAllObjects() as any[]) {
        if (!media && !mediaByEnv && this.objectHasMediaField(obj)) media = true;
        if (!covered && !coveredByEnv && this.objectHasCoveredValueField(obj)) covered = true;
        if ((media || mediaByEnv) && (covered || coveredByEnv)) break;
      }

      // [#4769] Read the ledger, not the memo. This advisory runs once, at
      // `kernel:bootstrapped`, and the fresh-datastore attestation may have
      // written its rows moments earlier — after the boot's first write had
      // already memoized "not verified". Reporting from that memo tells a
      // brand-new deployment to run a migration whose gate is already closed.
      // One query per applicable gate, once per boot.
      if (media && !(await this.readMigrationFlagVerified(FILE_REFERENCES_MIGRATION_ID)).verified) {
        this.logger.info(
          '[value-shape] media values are checked but NOT enforced here, and released files are ' +
            'never collected — this deployment has not verified its file migration. Run ' +
            '`os migrate files-to-references` (dry run) to see what it would do, then `--apply` ' +
            'to close the gate (ADR-0104 / #3617).',
        );
      }
      if (covered && !(await this.readMigrationFlagVerified(VALUE_SHAPES_MIGRATION_ID)).verified) {
        this.logger.info(
          '[value-shape] reference and structured-JSON values are checked but NOT enforced here — ' +
            'this deployment has not verified its value-shape scan. Run `os migrate value-shapes` ' +
            '(dry run) to see what it would report, then `--apply` to close the gate ' +
            '(ADR-0104 / #3438).',
        );
      }
    } catch {
      // An advisory must never be the reason a boot fails.
    }
  }
  private migrationGatesAnnounced = false;

  /**
   * Did this process CREATE the datastore it is talking to, from empty?
   *
   * True only when every driver that can account for its schema sync created
   * tables and found none already there. That conjunction is the whole point:
   * one pre-existing table anywhere means something ran here before us, so
   * this store's history is not ours to vouch for. A driver that cannot
   * report (`getSchemaSyncStats` absent, deferred DDL, sync skipped) makes the
   * answer no rather than maybe — the consumers of this fact grant
   * permissions, so "cannot say" must read as "no".
   *
   * The one caller is the fresh-datastore attestation (#3438, ADR-0104's
   * 2026-07-30 addendum), which records that a store born empty needs no data
   * migration. Ask it only during boot: once the process starts serving, the
   * counts describe a moment that has passed.
   */
  wasDatastoreCreatedFromEmpty(): boolean {
    let created = 0;
    let existing = 0;
    let reporting = 0;
    for (const driver of this.drivers.values()) {
      const stats = (driver as any).getSchemaSyncStats?.();
      if (!stats) continue;
      reporting += 1;
      created += Number(stats.created) || 0;
      existing += Number(stats.existing) || 0;
    }
    return reporting > 0 && existing === 0 && created > 0;
  }

  async destroy() {
    this.logger.info('Destroying ObjectQL engine', { driverCount: this.drivers.size });
    
    for (const [name, driver] of this.drivers.entries()) {
      try {
        await driver.disconnect();
      } catch (e) {
        this.logger.error('Error disconnecting driver', e as Error, { driverName: name });
      }
    }
    
    this.logger.info('ObjectQL engine destroyed');
  }

  // ============================================
  // Helper: Expand Related Records
  // ============================================

  /** Maximum depth for recursive expand to prevent infinite loops */
  private static readonly MAX_EXPAND_DEPTH = 3;
  private static readonly MAX_CASCADE_DEPTH = 10;
  /**
   * [#5038] Most rows one predicate write may fire per-row hooks over — in
   * BOTH phases since #5574 (ADR-0058 Addendum II, D6).
   *
   * Public so a test — and an operator reading a rejection — can name the same
   * number the engine enforces. It is now a RE-EXPORT of the spec contract's
   * `MAX_BULK_PER_ROW_HOOK_ROWS`, not a second literal: until #5574's engine
   * half the same number was written down twice and only a pin in
   * `bulk-write-hook-conformance.test.ts` kept the two agreeing. See
   * `assertBulkPerRowHookBudget`.
   */
  public static readonly MAX_BULK_PER_ROW_HOOK_ROWS = MAX_BULK_PER_ROW_HOOK_ROWS;
  /** In-memory next-value cache per `object.field` for autonumber generation,
   *  lazily seeded from the current max in the store. */
  private readonly autonumberCounters = new Map<string, number>();

  /**
   * Memoized answer to "has THIS deployment completed and verified the
   * ADR-0104 file-as-reference migration?" (#3617) — the fact that decides
   * whether a malformed media value rejects or merely warns.
   *
   * Memoized as a PROMISE so concurrent first writes share one read rather
   * than racing several. Deliberately not refreshed on a timer: the flag is
   * written by `os migrate files-to-references --apply`, a deliberate
   * operator action, and a process that has not seen it yet simply stays
   * lenient — the safe direction. A host that migrates in-process can call
   * {@link invalidateDataMigrationFlags} instead of waiting for a restart.
   */
  private fileReferencesMigrationVerified: Promise<MigrationFlagRead> | null = null;
  private valueShapesMigrationVerified: Promise<MigrationFlagRead> | null = null;

  /** Lazily-built index: child object name → roll-up summary descriptors on
   *  parent objects that aggregate it. Invalidated when packages register. */
  private summaryIndex: Map<string, SummaryDescriptor[]> | null = null;

  /** The SAME descriptors, indexed the other way: parent object name → the
   *  roll-up summary fields that object OWNS. Built in the same pass as
   *  {@link summaryIndex} and invalidated with it. The child index answers
   *  "whose summaries must I recompute after writing this row"; this one answers
   *  "which of my own summary fields must be seeded when I create this row"
   *  (#5749) — the question the child index structurally cannot answer, because
   *  a parent that has never had a child appears in no child write. */
  private summaryIndexByParent: Map<string, SummaryDescriptor[]> | null = null;

  /**
   * Retry options for roll-up summary recompute (framework#3147). Public so a
   * test can inject a no-op sleep for deterministic backoff; production uses
   * the transient-retry defaults.
   */
  summaryRetryOptions: RetryOptions = {};

  /** Invalidate the cached roll-up summary index (call when metadata changes). */
  private invalidateSummaryIndex(): void {
    this.summaryIndex = null;
    this.summaryIndexByParent = null;
  }

  /** Scan all registered objects for `summary` fields and index them BOTH ways
   *  — by the child object they aggregate and by the parent object that owns
   *  them — resolving the child→parent FK field. One scan, two views of the
   *  identical descriptor objects, so the two indexes can never disagree about
   *  which roll-ups exist. */
  private buildSummaryIndex(): {
    byChild: Map<string, SummaryDescriptor[]>;
    byParent: Map<string, SummaryDescriptor[]>;
  } {
    const index = new Map<string, SummaryDescriptor[]>();
    const byParent = new Map<string, SummaryDescriptor[]>();
    let objects: any[] = [];
    try { objects = (this._registry as any).getAllObjects?.() ?? []; } catch { objects = []; }
    for (const parent of objects) {
      const fields = parent?.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
      for (const [summaryField, def] of Object.entries(fields)) {
        const d: any = def;
        if (d?.type !== 'summary' || !d.summaryOperations) continue;
        const so = d.summaryOperations;
        const childObject = so.object;
        const fn = so.function;
        if (!childObject || !fn) continue;
        // Resolve the FK on the child pointing back to this parent.
        let fkField: string | undefined = so.relationshipField;
        if (!fkField) {
          const child = this._registry.getObject(childObject) as any;
          const cfields = child?.fields || {};
          for (const [cfName, cdef] of Object.entries(cfields)) {
            const cd: any = cdef;
            if ((cd?.type === 'master_detail' || cd?.type === 'lookup') && cd?.reference === parent.name) {
              fkField = cfName;
              break;
            }
          }
        }
        if (!fkField) continue; // can't resolve the relationship — skip
        // Optional per-summary predicate: only child rows matching it are
        // aggregated (e.g. sum receipts where { status: 'received' }). ANDed with
        // the parent-FK match at recompute time. Ignore a non-object filter.
        const filter = so.filter && typeof so.filter === 'object' && !Array.isArray(so.filter)
          ? so.filter as Record<string, unknown>
          : undefined;
        const descriptor: SummaryDescriptor = {
          parentObject: parent.name, summaryField, childObject, fkField, fn, sourceField: so.field, filter,
        };
        const list = index.get(childObject) ?? [];
        list.push(descriptor);
        index.set(childObject, list);
        // Same descriptor, parent-side view. Only descriptors that made it this
        // far are indexed either way, so "seeded at insert" and "maintained by
        // recompute" are the same set by construction — a roll-up whose
        // relationship could not be resolved (the `continue` above) is left
        // untouched on both paths rather than seeded with a 0 nothing updates.
        const owned = byParent.get(parent.name) ?? [];
        owned.push(descriptor);
        byParent.set(parent.name, owned);
      }
    }
    return { byChild: index, byParent };
  }

  /** `registry.objectRevision` the cached {@link summaryIndex} was built at. */
  private summaryIndexRevision = -1;

  /**
   * Ensure both roll-up indexes are present and current. Split out of
   * {@link getSummaryDescriptors} so the parent-side view (#5749) shares the
   * exact same staleness rule instead of re-deriving one.
   */
  private ensureSummaryIndexes(): void {
    // Rebuild whenever the REGISTRY's object set has moved since the index was
    // built — not only when someone remembered to call
    // `invalidateSummaryIndex`. That single site (`registerApp`) is bypassed by
    // the runtime publish path, which registers straight into the registry
    // (`protocol.saveMetaItem` → `registry.registerObject`). A kernel that had
    // already done one write — publishing itself writes `sys_metadata` — held an
    // index built before the new object existed, so every child write of a
    // freshly published roll-up skipped the recompute and the parent read null
    // until the process restarted. That is exactly how an AI-built app's
    // "已完成任务数" shipped empty over correct metadata (cloud#970).
    const revision = (this._registry as unknown as { objectRevision?: number })?.objectRevision;
    const stale = typeof revision === 'number' && revision !== this.summaryIndexRevision;
    if (!this.summaryIndex || !this.summaryIndexByParent || stale) {
      const built = this.buildSummaryIndex();
      this.summaryIndex = built.byChild;
      this.summaryIndexByParent = built.byParent;
      if (typeof revision === 'number') this.summaryIndexRevision = revision;
    }
  }

  /** Roll-up descriptors for summaries that aggregate `childObject` — i.e. the
   *  ones a write to `childObject` must recompute. Semantics unchanged. */
  private getSummaryDescriptors(childObject: string): SummaryDescriptor[] {
    this.ensureSummaryIndexes();
    return this.summaryIndex!.get(childObject) ?? [];
  }

  /** Roll-up descriptors for the summary fields `parentObject` OWNS (#5749) —
   *  i.e. the ones a NEW row of `parentObject` must have seeded.
   *
   *  Public since #6063: the one-off backfill of pre-#6013 `NULL` rows
   *  (`os migrate summary-nulls`) iterates parents, and reading the engine's
   *  OWN index is what makes it see exactly the roll-ups the engine maintains —
   *  same FK resolution, same filter, same staleness rule. Re-deriving them
   *  would be a second index that disagrees the first time either moves. */
  getOwnedSummaryDescriptors(parentObject: string): SummaryDescriptor[] {
    this.ensureSummaryIndexes();
    return this.summaryIndexByParent!.get(parentObject) ?? [];
  }

  /**
   * Seed the roll-up `summary` fields a freshly-created row owns (#5749).
   *
   * `recomputeSummaries` only ever visits parents named by a child write, so a
   * parent that has NEVER had a child is never visited and its summary column
   * keeps whatever insert put there — `null`. Delete the last child and the
   * parent DOES get visited (via `previous`) and lands on 0. Same logical state,
   * two different values: `filter ["task_count","=",0]` silently skipped every
   * parent that never had a child, and so did sorting, GROUP BY and any formula
   * reading the field (null propagation).
   *
   * The fix is at the producer: write the empty-collection value at create time,
   * so `count`/`sum` start at 0 and only ever move to another number.
   * `min`/`max`/`avg` have no empty-set value and deliberately stay `null` —
   * {@link summaryEmptySetValue} is the single list both this and the recompute
   * fallback read.
   *
   * Author-supplied values are never overwritten. The `!= null` test matches
   * {@link applyFieldDefaults} exactly (#2706): on INSERT an explicit `null` is
   * "no value supplied", any real value — including a deliberate 0 or a seeded
   * count — is respected. Runs before the `beforeInsert` hooks for the same
   * reason defaults do, so a hook still has the final say.
   *
   * Existing rows are untouched: this is create-time only, so parents already
   * stored with `null` stay `null` until a child write recomputes them.
   */
  private initializeSummaryFields(object: string, record: any): any {
    const descriptors = this.getOwnedSummaryDescriptors(object);
    if (descriptors.length === 0) return record;
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    let out: Record<string, unknown> = record;
    for (const desc of descriptors) {
      const seed = summaryEmptySetValue(desc.fn);
      if (seed == null) continue; // min/max/avg — undefined on an empty set
      if (out[desc.summaryField] != null) continue; // author supplied a value
      if (out === record) out = { ...record };
      out[desc.summaryField] = seed;
    }
    return out;
  }

  /**
   * Recompute roll-up `summary` fields on parent records after a child write.
   * For each affected parent (the FK value on the changed/old child record), it
   * aggregates the child collection and writes the result onto the parent's
   * summary field. Runs in the caller's execution context — SYSTEM-ELEVATED,
   * see below — so it joins the same transaction (e.g. the cross-object batch)
   * when one is open.
   *
   * # Why the recompute is system-elevated (#7673)
   *
   * A roll-up is ENGINE-DERIVED state on the parent, not a caller write to it.
   * The permission decision that matters — may this caller write the CHILD —
   * has already been made by the time we get here; whether
   * `showcase_project.task_count` may be refreshed is not a question about the
   * caller's grant on `showcase_project`.
   *
   * Passing the caller's own context straight through made it one, and the
   * ordinary parent/child shape — a child more widely writable than its parent
   * (tasks, line items, comments, time entries) — broke on it in three
   * separate ways, all of them fail-open:
   *
   *   1. **A granted child write returned 500 after the row was written.** The
   *      parent update raised `PermissionDeniedError`, which this method
   *      recorded as a failure and the three call sites then threw as
   *      `SummaryRecomputeError` — mapped to a 500 by REST, on a write that had
   *      already COMMITTED. A client that retried created a duplicate row
   *      (#7673 / #7719, measured on `examples/app-showcase`: a plain member
   *      holding `showcase_task: create + read` 500'd on every POST and PATCH).
   *   2. **The aggregate was computed from the caller's VISIBLE subset.** Where
   *      the caller COULD write the parent, the recompute succeeded and stored
   *      an RLS-scoped count — a parent column silently rewritten to one
   *      reader's view of the child collection. A roll-up is a property of the
   *      parent, never of whoever happened to touch a child.
   *   3. **An author-declared `readonly: true` roll-up column was stripped.**
   *      The write-path read-only strip runs on `!context.isSystem`, and the
   *      recompute's payload is "caller supplied" from its point of view, so
   *      the summary silently never landed.
   *
   * Elevation is a `sudo()`-shaped derivative of the caller's context
   * (`{ ...execCtx, isSystem: true }`), NOT a bare `{ isSystem: true }`: the
   * open transaction handle, `tenantId` and `timezone` must survive, or the
   * recompute leaves the caller's transaction and stops being tenant-scoped.
   * That makes this the same posture the roll-up's two OTHER writers already
   * hold — `initializeSummaryFields` runs inside the engine's own insert, and
   * `backfillSummaryNulls` (#6063) elevates explicitly — so all three writers
   * of a summary column now agree about who owns it.
   *
   * What this does NOT do: it never widens what the caller may read or write.
   * The parent's own row stays governed by the caller's grants (a direct
   * `update` of the parent is refused exactly as before), the summary field
   * stays subject to the parent's FLS on read, and the only value this path can
   * move is the one the author DECLARED as a function of the child collection.
   */
  private async recomputeSummaries(
    childObject: string,
    records: any,
    previous: any,
    execCtx?: ExecutionContext,
  ): Promise<SummaryRecomputeFailure[]> {
    const descriptors = this.getSummaryDescriptors(childObject);
    if (descriptors.length === 0) return [];
    // The elevation described above. Built once per call, spread from the
    // caller's context so transaction / tenant / timezone ride along.
    const systemCtx = { ...(execCtx ?? {}), isSystem: true } as ExecutionContext;
    const recs = Array.isArray(records) ? records : records ? [records] : [];
    const prevs = Array.isArray(previous) ? previous : previous ? [previous] : [];
    const failures: SummaryRecomputeFailure[] = [];
    for (const desc of descriptors) {
      const ids = new Set<string>();
      for (const r of recs) { const v = r?.[desc.fkField]; if (v != null && v !== '') ids.add(String(v)); }
      for (const p of prevs) { const v = p?.[desc.fkField]; if (v != null && v !== '') ids.add(String(v)); }
      for (const parentId of ids) {
        try {
          // Retry a transient failure (a turso `fetch failed` on the parent
          // aggregate/update) with backoff — a network blip here used to leave
          // the parent summary silently stale (framework#3147).
          await withTransientRetry(async () => {
            // The aggregate — parent-FK match ANDed with the optional
            // per-summary filter, empty-set fallback included — is
            // `aggregateSummaryValue` (#6063). Behaviour unchanged; it simply
            // lives where the insert-time seed and the one-off NULL backfill
            // can read the identical computation instead of copying it.
            const value = await aggregateSummaryValue(this, desc, parentId, systemCtx);
            await this.update(desc.parentObject, { id: parentId, [desc.summaryField]: value }, { context: systemCtx } as any);
          }, this.summaryRetryOptions);
        } catch (err) {
          // Retries exhausted (or a non-transient failure). Record it so the
          // caller can surface it — one parent's failure must not abort the
          // remaining parents' recompute.
          this.logger.warn('Roll-up summary recompute failed', {
            childObject, parentObject: desc.parentObject, parentId, field: desc.summaryField,
            error: (err as any)?.message,
          });
          failures.push({ childObject, parentObject: desc.parentObject, parentId, field: desc.summaryField, error: err });
        }
      }
    }
    return failures;
  }

  /**
   * Post-process expand: resolve lookup/master_detail fields by batch-loading related records.
   * 
   * This is a driver-agnostic implementation that uses secondary queries ($in batches)
   * to load related records, then injects them into the result set.
   * 
   * @param objectName - The source object name
   * @param records - The records returned by the driver
   * @param expand - The expand map from QueryAST (field name → nested QueryAST)
   * @param depth - Current recursion depth (0-based)
   * @returns Records with expanded lookup fields (IDs replaced by full objects)
   */
  private async expandRelatedRecords(
    objectName: string,
    records: any[],
    expand: Record<string, QueryAST>,
    depth: number = 0,
    execCtx?: ExecutionContext,
  ): Promise<any[]> {
    if (!records || records.length === 0) return records;
    if (depth >= ObjectQL.MAX_EXPAND_DEPTH) return records;

    const objectSchema = this._registry.getObject(objectName);
    // If no schema registered, skip expand — return raw data
    if (!objectSchema || !objectSchema.fields) return records;

    for (const [fieldName, nestedAST] of Object.entries(expand)) {
      // [#4371] The nested AST is caller-authored too: a wire spelling inside
      // `expand: { rel: { sort } }` used to be silently dropped exactly like
      // the top-level bag (this loop reads only canonical keys). Same
      // rejection, scoped to the four wire-only pairs — the nested shape is a
      // QueryAST, not an option bag, so the option-key gate does not apply.
      if (nestedAST && typeof nestedAST === 'object') {
        for (const slot of ENGINE_WIRE_ONLY_SLOTS) {
          for (const alias of slot.aliases) {
            if ((nestedAST as Record<string, unknown>)[alias] != null) {
              throw new Error(
                `expand['${fieldName}'] on '${objectName}' does not accept '${alias}': it is a wire ` +
                `spelling of '${slot.canonical}', folded by the RPC/protocol layer — a direct engine ` +
                `call bypasses that fold, so the value would be silently dropped, not applied. Pass ` +
                `'${slot.canonical}' (${WIRE_ONLY_CANONICAL_SHAPES[slot.canonical] ?? 'the canonical QueryAST shape'}) instead.`,
              );
            }
          }
        }
      }
      const fieldDef = objectSchema.fields[fieldName];

      // Skip if field not found or not a relationship type.
      //
      // `user` is a lookup specialized to sys_user and `tree` is a hierarchical
      // self-reference — both carry the same `reference` + id storage, so both
      // expand through this exact path (single or multiple).
      //
      // [#4226] The membership test is `REFERENCE_VALUE_TYPES` — the spec's own
      // list of types whose value "points at another record … the related record
      // object in expanded form" — rather than a hand-copied `!==` chain. The
      // chain had drifted: it omitted `tree`, so a `$expand` of a hierarchy
      // field returned the raw parent id and rendered as a bare placeholder,
      // while `field-value.zod.ts` and objectui's `EXPANDABLE_FIELD_TYPES` both
      // declared it expandable. Reading the shared set is what stops the
      // protocol's expand gate (which validates against the same set) from ever
      // admitting a field this loop then silently skips.
      //
      // [cloud#983] The TARGET comes from `referenceTargetOf` for that same
      // anti-drift reason. A raw `fieldDef.reference` read made `{ type:
      // 'user' }` (no `reference`) targetless here AND at the gate — but
      // `user`'s target is fixed BY THE TYPE (`sys_user`; `Field.user()` takes
      // no target argument), so the field was fully specified and the request
      // was refused `400 … declares no target object`. Both sides now ask the
      // one function what a reference field points at.
      if (!fieldDef) continue;
      if (!REFERENCE_VALUE_TYPES.has(fieldDef.type)) continue;
      const referenceObject = referenceTargetOf(fieldDef);
      if (!referenceObject) continue;

      // Collect all foreign key IDs from records (handle both single and multiple values)
      const allIds: any[] = [];
      for (const record of records) {
        const val = record[fieldName];
        if (val == null) continue;
        if (Array.isArray(val)) {
          allIds.push(...val.filter((id: any) => id != null));
        } else if (typeof val === 'object') {
          // Already expanded — skip
          continue;
        } else {
          allIds.push(val);
        }
      }

      // De-duplicate IDs
      const uniqueIds = [...new Set(allIds)];
      if (uniqueIds.length === 0) continue;

      // Batch-load related records using $in query
      try {
        // Constrain the batch to the collected FK ids. When the nested expand
        // AST carries its own `where`, AND-merge it via an explicit `$and`
        // group rather than spreading keys onto the id filter: a shallow spread
        // would clobber the `id` constraint (if the nested filter also keys
        // `id`) and is ambiguous when the nested filter is a top-level `$or` /
        // `$and`. The `$and` wrapper is correct for every FilterCondition shape.
        const idFilter = { id: { $in: uniqueIds } };
        const where = nestedAST.where
          ? { $and: [idFilter, nestedAST.where] }
          : idFilter;

        // [#2850] Resolve the referenced object through the engine's own read
        // path (`this.find`) rather than the raw driver, so the security
        // middleware applies the REFERENCED object's RLS + FLS to the expanded
        // batch — not merely tenant isolation. A single `find` over the
        // collected `id $in [...]` batch re-enters the middleware exactly once
        // (no N+1), preserving the batched load. `nestedAST.limit/offset` are
        // still intentionally NOT forwarded: this path batch-loads every
        // parent's related records in one query, so a *per-parent* limit/offset
        // can't be expressed — a global cap would silently drop records other
        // parents need. Paginate by querying the related object directly.
        //
        // The `__expandRead` marker (set here, never from client input —
        // `executionContext` is server-built) tells the security layer this is
        // an expansion sub-read. It does NOT relax that layer: since #7626 the
        // referenced object takes the FULL treatment — CRUD gate,
        // requiredPermissions, RLS and FLS — so you may expand only rows you
        // could have read directly. (#2850 shipped a waiver for "public"
        // referenced objects; it keyed on an axis almost no object declares and
        // never checked the caller's grants, so it disclosed private records to
        // callers the gate had already refused.) A refusal is caught below and
        // the bare FK id is retained, which is why the parent read still
        // succeeds. `expand` is intentionally omitted from this query so `find`
        // does not re-expand — nested relations recurse below under the depth
        // guard.
        //
        // [#7537] The join key is MACHINERY, not a caller-chosen column. This
        // sub-read's projection is forwarded from `nestedAST.fields`, and the
        // map built below is keyed on `rec.id` — so a nested projection that did
        // not name `id` returned rows carrying no `id`, built an EMPTY map, and
        // fell through the `recordMap.get(...) ?? val` injection, writing the
        // original foreign key back. The expansion was then indistinguishable
        // from never having been requested: `200`, and the field still holds a
        // valid-looking id.
        //
        // The failing spelling is the one the platform itself PRESCRIBES: both
        // `FIELD_NODE_OBJECT_FORM_REMOVED` and `QUERY_JOINS_REMOVED`
        // (`query.zod.ts`) tell authors migrating off the retired nested-select
        // object form and off `query.joins` to write
        // `expand: { owner: { object: 'user', fields: ['name'] } }`. Refusing the
        // mismatch would turn two retirement messages' own migration target into
        // an error, so the prescribed form is made to WORK instead: `id` is added
        // to the sub-read unconditionally and stripped back out of the emitted
        // nested record when the caller did not ask for it.
        //
        // `id` is the only join key there is, literally: `referenceTargetOf`
        // yields the target OBJECT and a reference field carries no
        // target-column metadata, so the batch filter above is `{ id: { $in } }`
        // by construction. There is no configurable key to add instead.
        //
        // Only a driver that honours a projection exactly could ever show this —
        // `SqlDriver` emits `builder.select(query.fields)` verbatim, while
        // `InMemoryDriver.projectFields` force-adds `id` to every projection,
        // which is why mock/in-memory suites could not reach the defect and a
        // better-sqlite3 QA run (#7463) could.
        const nestedFields = Array.isArray(nestedAST.fields) && nestedAST.fields.length > 0
          ? nestedAST.fields
          : undefined;
        const joinKeyRequested = !nestedFields || nestedFields.includes('id');
        const relatedRecords = await this.find(
          referenceObject,
          {
            where,
            // [#6300] The `as any` these two carried is gone: `find` takes the
            // author state now, and the parsed nodes a `QueryAST` holds are
            // valid author input (a present `order` is legal to write).
            ...(nestedAST.fields
              ? { fields: joinKeyRequested ? nestedAST.fields : [...nestedFields!, 'id'] }
              : {}),
            ...(nestedAST.orderBy ? { orderBy: nestedAST.orderBy } : {}),
            context: { ...(execCtx ?? {}), __expandRead: true } as ExecutionContext,
          },
        ) ?? [];

        // Build a lookup map: id → record
        const recordMap = new Map<string, any>();
        for (const rec of relatedRecords) {
          const id = rec.id;
          if (id != null) recordMap.set(String(id), rec);
        }

        // Recursively expand nested relations if present
        if (nestedAST.expand && Object.keys(nestedAST.expand).length > 0) {
          const expandedRelated = await this.expandRelatedRecords(
            referenceObject,
            relatedRecords,
            nestedAST.expand,
            depth + 1,
            execCtx,
          );
          // Rebuild map with expanded records
          recordMap.clear();
          for (const rec of expandedRelated) {
            const id = rec.id;
            if (id != null) recordMap.set(String(id), rec);
          }
        }

        // [#7537] Strip the join key back out when the caller did not name it.
        // It was added above for THIS function's own lookup, so the emitted
        // nested record carries exactly the columns the projection asked for —
        // the same contract a top-level `fields` gets. Deliberately AFTER the
        // recursive expand: that block rebuilds `recordMap` keyed on `rec.id`
        // and still needs the key present. Each related record is stripped once
        // here rather than per-parent, because one record object is injected
        // into every parent that points at it.
        if (!joinKeyRequested) {
          for (const rec of recordMap.values()) {
            if (rec && typeof rec === 'object') delete rec.id;
          }
        }

        // Inject expanded records back into the original result set
        for (const record of records) {
          const val = record[fieldName];
          if (val == null) continue;

          if (Array.isArray(val)) {
            record[fieldName] = val.map((id: any) => recordMap.get(String(id)) ?? id);
          } else if (typeof val !== 'object') {
            record[fieldName] = recordMap.get(String(val)) ?? val;
          }
          // If val is already an object, leave it as-is
        }
      } catch (e) {
        // Graceful degradation: if expand fails, keep original IDs
        this.logger.warn('Failed to expand relationship field; retaining foreign key IDs', {
          object: objectName,
          field: fieldName,
          reference: referenceObject,
          error: (e as Error).message,
        });
      }
    }

    return records;
  }

  /**
   * Resolve file-field id references to their expanded `FileValueSchema` form
   * (ADR-0104 D3 wave 2). A `file`/`image`/`avatar`/`video`/`audio` value
   * stored as an opaque `sys_file` id string is enriched, in place, to
   * `{ id, name, size, mimeType, url }` — `url` derived from the stable
   * `/files/:fileId` resolver, never stored.
   *
   * DUAL-MODE SAFE: an inline-blob value (an object) and a string that does
   * NOT match a committed `sys_file` row (e.g. an external url) pass through
   * unchanged, so a field may hold either form during the pre-v17 window.
   *
   * Batched: at most one `sys_file` `id $in […]` read per call (no N+1); and
   * zero reads when no field holds a string value (the blob-only case), so the
   * step is free for objects that have not adopted references.
   */
  private async resolveFileReferences(
    objectName: string,
    records: any[],
    execCtx?: ExecutionContext,
  ): Promise<any[]> {
    if (!records || records.length === 0) return records;
    // A caller whose subject is the STORED form — the ADR-0104 backfill /
    // reconciliation (#3617) — opts out of resolution entirely; expanding
    // ids before that scan would hide the very state it exists to audit.
    if ((execCtx as any)?.[RAW_FILE_VALUES_CONTEXT_KEY] === true) return records;
    const objectSchema = this._registry.getObject(objectName);
    if (!objectSchema || !objectSchema.fields) return records;
    // Nothing to resolve against if the file object is not even registered
    // (e.g. the storage plugin is absent) — skip without a failing query.
    if (!this._registry.getObject('sys_file')) return records;

    const fileFields = Object.entries(objectSchema.fields)
      .filter(([, def]: [string, any]) => def && FILE_REFERENCE_TYPES.has(def.type))
      .map(([name]) => name);
    if (fileFields.length === 0) return records;

    // Collect candidate ids. A file field legitimately holds either an inline
    // blob (an object — already the rich form, skipped) OR, in the dual-mode /
    // legacy world, a URL string (`https://…`, `/api/…`, `data:…`, `blob:…`).
    // Only an OPAQUE id token — the minted uuid/nanoid form, never url-shaped —
    // is a `sys_file` reference to resolve. Filtering out url-shaped strings is
    // what keeps a seeded `data:`/CDN image value from firing a bogus lookup.
    const candidateIds: string[] = [];
    const addCandidate = (v: unknown) => {
      if (isFileIdToken(v)) candidateIds.push(v);
    };
    for (const record of records) {
      for (const fieldName of fileFields) {
        const val = record[fieldName];
        if (val == null) continue;
        if (Array.isArray(val)) {
          for (const v of val) addCandidate(v);
        } else {
          addCandidate(val);
        }
      }
    }
    const uniqueIds = [...new Set(candidateIds)];
    if (uniqueIds.length === 0) return records; // blob-only / empty → zero cost

    // One batched sys_file read. `__expandRead` mirrors the lookup-expansion
    // sub-read (a system-built marker, never from client input). Metadata only —
    // byte-download authorization is enforced at the /files/:fileId resolver.
    let fileRows: any[] = [];
    try {
      fileRows = (await this.find(
        'sys_file',
        { where: { id: { $in: uniqueIds } }, context: { ...(execCtx ?? {}), __expandRead: true } as ExecutionContext },
      )) ?? [];
    } catch (error) {
      // [#6116] Fail-open is deliberate and UNCHANGED — a file-metadata read
      // that fails must not take down the record read that asked for it, so the
      // ids pass through un-hydrated on BOTH branches below. What changes is
      // that the two reasons stop being the same silence.
      //
      // Benign: `sys_file` is registered but its TABLE was never provisioned
      // (storage plugin present, schema sync not run yet). There are genuinely
      // no committed rows, so "leave the ids as-is" IS the truth and there is
      // nothing to report. Discriminated through the shared `isMissingTableError`
      // predicate (`@objectstack/metadata/errors`, #4825) — never a hand-rolled
      // `code === '42P01'` copy — the same call `seedAutonumber` makes above.
      //
      // Everything else (connection drop, timeout, permission denial, query
      // error) means the rows may well exist and simply were not seen. The
      // consumer then receives a bare id where `{ id, name, size, mimeType,
      // url }` was due, and UI/export renders it as "this record has no
      // attachment": a fault wearing the appearance of legitimate absent data,
      // indistinguishable from a record that truly holds no file (ADR-0110 D3).
      // One `warn`, not `error`, per AGENTS "Degradation log levels" — the loss
      // is FUNCTIONAL and scoped to this response (the answer is visibly
      // smaller, and the next read repairs it); nothing on this path claims to
      // have persisted anything.
      if (!isMissingTableError(error)) {
        this.logger.warn(
          'sys_file lookup failed; file fields keep their raw ids and will render as "no file" for this read — '
            + 'check storage/database availability, then re-read to hydrate',
          {
            object: objectName,
            fields: fileFields,
            unresolvedIds: uniqueIds.length,
            error: (error as Error)?.message,
          },
        );
      }
      return records; // fail-open: leave ids as-is
    }

    const fileMap = new Map<string, any>();
    for (const row of fileRows) {
      if (row?.id != null && row.status === 'committed') fileMap.set(String(row.id), row);
    }
    if (fileMap.size === 0) return records;

    const toValue = (row: any) => ({
      id: String(row.id),
      ...(row.name != null ? { name: row.name } : {}),
      ...(row.size != null ? { size: row.size } : {}),
      ...(row.mime_type != null ? { mimeType: row.mime_type } : {}),
      url: `/api/v1/storage/files/${row.id}`,
    });

    for (const record of records) {
      for (const fieldName of fileFields) {
        const val = record[fieldName];
        if (val == null) continue;
        if (Array.isArray(val)) {
          record[fieldName] = val.map((v: any) =>
            typeof v === 'string' && fileMap.has(v) ? toValue(fileMap.get(v)) : v);
        } else if (typeof val === 'string' && fileMap.has(val)) {
          record[fieldName] = toValue(fileMap.get(val));
        }
      }
    }
    return records;
  }

  // ============================================
  // Data Access Methods (IDataEngine Interface)
  // ============================================

  /**
   * Expand `{filter-placeholder}` values in a read AST's `where` against the
   * request (framework#3582).
   *
   * Filters travel as JSON, so a time- or user-scoped slice authored in a view,
   * dashboard, related list or REST query writes `'{current_year_start}'` /
   * `'{current_user_id}'` rather than a literal. Until now nothing on the server
   * substituted them: the placeholder reached the driver as a string, compared
   * as text, and matched nothing — an empty grid with no error anywhere.
   *
   * The engine is the right seam because it is the ONE gate every server-side
   * read passes through (REST, SDK, related lists, flow `find_records`, sharing
   * graph reads), so a surface that follows the filter contract works the day it
   * ships instead of waiting for its own resolver. It runs BEFORE the middleware
   * chain so only author-supplied filters are inspected; the RLS/sharing filters
   * injected downstream are built from concrete context values and carry no
   * placeholders.
   *
   * Cheap by construction: {@link resolveFilterTokens} returns the input by
   * reference when the tree holds no placeholder, which is every internal query.
   * An unresolvable placeholder throws (see the resolver's module doc) — the one
   * outcome an author can act on.
   */
  private resolveWhereTokens(ast: QueryAST | undefined, execCtx?: ExecutionContext): void {
    if (!ast || ast.where == null) return;
    ast.where = resolveFilterTokens(ast.where, filterTokenContextFrom(execCtx));
  }

  /**
   * The write-path counterpart of {@link resolveWhereTokens}: return `options`
   * with `where` placeholders expanded (#3810).
   *
   * Returns the SAME object when nothing resolved — `resolveFilterTokens`
   * returns its input by reference on a placeholder-free tree, so the common
   * path allocates nothing. When something does resolve, a shallow copy is
   * made rather than assigning through: `options` belongs to the caller, and
   * writing back would bake one request's user id into a filter object the
   * caller may reuse (view metadata and flow node config both get reused).
   */
  private withResolvedWhere<T extends { where?: unknown; context?: ExecutionContext } | undefined>(
    options: T,
  ): T {
    if (!options || options.where == null) return options;
    const resolved = resolveFilterTokens(options.where, filterTokenContextFrom(options.context));
    return resolved === options.where ? options : ({ ...options, where: resolved } as T);
  }

  /**
   * ADR-0061: expand `search` into a server-resolved cross-field `$or` of
   * `$contains`, AND it with any caller `where`, then strip the search keys off
   * the AST.
   *
   * Shared by `find` and `findOne` (#4419). It lived inline in `find` and
   * nowhere else, while `ENGINE_FIND_OPTION_KEYS` — the one legal-key set BOTH
   * methods are checked against (see {@link ENGINE_OPTION_KEY_SETS}) — declares
   * `search`/`searchFields` for both. So `findOne({ search })` passed the gate,
   * rode onto the AST verbatim, and reached a driver: no driver reads
   * `ast.search` (the expansion is the engine's job by ADR-0061), so the
   * predicate vanished and the forced `limit: 1` turned it into the first row of
   * the WHOLE object — a real, plausible-looking record unrelated to the search.
   * That is #4419's reported failure exactly, under a different key than the
   * `filter` #4346 closed; one expander, called from both, is what stops the
   * pair drifting again.
   *
   * Field resolution is server-side (declared `searchableFields` →
   * auto-default); the optional `searchFields` override is intersected with the
   * allowed set, never widened. All drivers already execute `$or`/`$contains`,
   * so this needs no driver changes.
   *
   * The keys are deleted whether or not anything expanded — leaving them on
   * would hand the driver a key it does not read, which is the same silent drop
   * one layer down.
   */
  private expandSearchOnAst(ast: QueryAST, schema: ServiceObject | undefined): void {
    // The `$search`/`$searchFields` OData spellings are NOT read here: the
    // protocol layer normalizes them to the bare keys before the engine
    // (protocol.ts findData), and a direct engine call carrying one is an
    // unknown option — rejected at the entry point, not silently dropped
    // (#4371).
    const raw = (ast as any).search;
    if (raw != null && schema?.fields) {
      const requestedFields = (ast as any).searchFields
        ?? (typeof raw === 'object' ? raw?.fields : undefined);
      const searchFilter = expandSearchToFilter(raw, {
        fields: schema.fields as any,
        searchableFields: (schema as any).searchableFields,
        requestedFields,
        // [ADR-0079] `nameField` is the canonical primary-title pointer;
        // `displayNameField` is the deprecated alias (still honored).
        displayField: (schema as any).nameField ?? (schema as any).displayNameField,
      });
      if (searchFilter) {
        ast.where = ast.where ? { $and: [ast.where, searchFilter] } : searchFilter;
      }
    }
    delete (ast as any).search;
    delete (ast as any).searchFields;
  }

  /**
   * [#6300] Fill the author-state defaults the query schemas declare, so the
   * AST handed to middlewares, hooks and drivers is the PARSED state
   * `QueryAST` (a `z.infer` type) promises.
   *
   * ADR-0122 made `EngineQueryOptions` the author state (`z.input`): a key
   * with a declared `.default()` is optional to write. `find`/`findOne` kept
   * demanding the parsed state anyway (#6083 pinned them back) because the
   * engine built its AST by bare spread and filled no default — `order:
   * undefined` would have ridden straight to the driver. This is the filling.
   * Each defaulting node is run through ITS OWN schema rather than
   * hand-assigning values, so a default declared in `packages/spec` stays the
   * single source of truth:
   *
   * - `orderBy[]` nodes through `SortNodeSchema` — fills `order: 'asc'`, the
   *   query path's one declared default. Measured before the flip: every
   *   driver already coalesces a missing `order` to `'asc'` (`sql-driver.ts`
   *   `s.order || 'asc'`, `memory-driver.ts`, `mongodb-driver.ts`,
   *   `remote-transport.ts` likewise), so the filled value changes no query's
   *   answer — it makes the AST say what the drivers were already assuming.
   *   Parsing also applies the node's declared strictness to type-BYPASSING
   *   callers: an unknown sort key, or the retired `direction` spelling, is
   *   now refused with the schema's own prescription instead of silently
   *   dropped-or-honored per driver (#4721's defect class) — the same refusal
   *   `normalizeSortNodes` already makes on the wire path.
   * - `expand` values recurse: a nested query is the same authoring surface.
   *   No driver reads `ast.expand` (the engine expands post-fetch), and the
   *   nested read that executes re-enters `find()` — which fills again — so
   *   the recursion keeps the AST's type honest without a cast.
   *
   * `search` is deliberately NOT parsed, though `FullTextSearchSchema` carries
   * three flag defaults (`fuzzy`/`operator`/`highlight`). Two measurements
   * decide it. First, nothing can ever read them off the AST: no executor
   * reads the flags at all (#4286 — the ADR-0061 expansion reads only `query`
   * + `fields`), and {@link expandSearchOnAst} deletes `search` from the AST
   * before middlewares, hooks or the driver see it, so a filled value would be
   * constructed and then discarded unread. Second, parsing would REFUSE input
   * the engine deliberately accepts: the wire path hands this method
   * `search.fields` in the comma-STRING shape (and the `q` spelling) that
   * `resolveSearchFields`/`normalizeSearch` tolerate by design — pinned in
   * `query-expression-conformance.test.ts` — while the schema declares
   * `fields: string[]`. The type-level gap this leaves (author-state `search`
   * inside a `QueryAST`-typed value, until the key is deleted a few lines
   * later) is covered by the same single cast as `expand`, below.
   *
   * `where`/`fields`/`limit`/`offset`/`top` carry no `.default()` or
   * `.transform()` (pinned in `filter.zod.ts`'s own docs) and are not parsed —
   * the cost is one small-object parse per authored sort node / search
   * config, only when the key is present.
   */
  private fillQueryAstDefaults<T extends Pick<QueryInput, 'orderBy' | 'search' | 'expand'>>(
    query: T,
  ): T & Pick<QueryAST, 'orderBy' | 'search'> & { expand?: Record<string, QueryAST> } {
    const out: Record<string, unknown> = { ...query };
    if (Array.isArray(out.orderBy)) {
      out.orderBy = out.orderBy.map((node) => SortNodeSchema.parse(node));
    }
    if (out.expand != null && typeof out.expand === 'object') {
      const expand: Record<string, unknown> = {};
      for (const [field, nested] of Object.entries(out.expand)) {
        expand[field] = this.fillQueryAstDefaults(nested as QueryInput);
      }
      out.expand = expand;
    }
    // The one cast in the flip: `orderBy`/`expand` are rebuilt above; `search`
    // is claimed-but-not-parsed, per the doc — deleted from the AST unread.
    return out as T & Pick<QueryAST, 'orderBy' | 'search'> & { expand?: Record<string, QueryAST> };
  }

  /**
   * Refuse a `findOne` that selects nothing in particular (#4419).
   *
   * The AST reaching here is the CALLER's own intent: aliases folded, unknown
   * keys refused, `search` expanded — but the security/sharing middlewares have
   * not run yet, and that ordering is the point. An injected RLS predicate
   * narrows *which* rows are visible; it does not make "whichever of them comes
   * first" a thing the caller asked for. Judging the post-middleware AST would
   * pass every query on a scoped object and leave the hole open where it is
   * most expensive.
   *
   * "Selects nothing" is read the same way #3896 read an empty sharing
   * criteria: absent, `null`, or `{}` — the three shapes that mean "match every
   * row". This guard closes the one case that is unambiguously
   * match-everything, not everything it cannot prove.
   *
   * [#5158] This comment used to add: "a `where` that is not a plain object (an
   * expression tree) is the DRIVER'S to interpret, and counts as a predicate."
   * That sentence was the engine's blessing of a second filter dialect, and it
   * cost exactly what a blessing costs — `findOne({ where: [] })` counted as a
   * predicate, walked past this guard, and returned an ARBITRARY row: the #4419
   * defect surviving inside #4419's own guard. `FilterArray` is now lowered by
   * {@link lowerWhereFilterArray} at every entry point, so by the time this
   * runs `where` is a `FilterCondition` or nothing. The `Array.isArray` arm
   * below is kept as defence in depth for a subclass or a future caller that
   * reaches this method without lowering — it is no longer a contract.
   *
   * `orderBy` is the other way to be specific, and a legitimate one — "the
   * newest", "the highest priority". It is honored on this path by every
   * driver, so it is a real answer and not a second silent drop.
   */
  private requireFindOnePredicate(object: string, ast: QueryAST): void {
    const where = ast.where as unknown;
    const hasPredicate =
      where != null &&
      (typeof where !== 'object' || Array.isArray(where) || Object.keys(where).length > 0);
    if (hasPredicate) return;
    if (Array.isArray(ast.orderBy) && ast.orderBy.length > 0) return;
    throw new Error(
      `findOne('${object}') selects no particular record: 'where' is absent or empty ` +
      `and the query carries no 'orderBy'. findOne applies limit: 1, so this would return an ` +
      `ARBITRARY row — a real, plausible-looking record unrelated to what was asked for, which ` +
      `no caller's null-check can catch (#4419). Pass 'where' (or a 'search' that resolves to ` +
      `one) to select the record; pass 'orderBy' if you mean "the first record in THIS order"; ` +
      `or call find('${object}', { limit: 1 }) if any row will genuinely do.`,
    );
  }

  async find(object: string, query?: EngineQueryOptions, options?: EngineReadOptions): Promise<any[]> {
    object = this.resolveObjectName(object);
    // Normalize the alias spellings (`filter`→`where`, `top`→`limit`) by the
    // spec's slot table — the driver AST only understands the canonical keys,
    // so an unfolded `{ filter }` would match ALL rows (silent over-grant —
    // surfaced by ADR-0057's sharing/graph read path). Same fold, same
    // conflict rule on every engine entry point (#4346). The wire-only
    // spellings (`sort`/`select`/`skip`/`populate`) are REJECTED instead of
    // folded — a direct call carrying one used to have it silently dropped
    // (#4371, three shipped instances in #4370).
    query = foldEngineOptionAliases(object, 'find', query, ENGINE_QUERY_SLOTS, ENGINE_WIRE_ONLY_SLOTS);
    rejectUnknownEngineOptions(object, 'find', query, ENGINE_FIND_OPTION_KEYS);
    query = lowerWhereFilterArray(object, 'find', query, this._registry.getObject(object));
    this.logger.debug('Find operation starting', { object, query });
    const driver = this.getDriver(object);
    // `object` LAST: the resolved name must win. Spread-first used to let a
    // stray `query.object` overwrite it, splitting the AST's object from the
    // table actually queried (#4371 option-2 survey) — every middleware and
    // hook reading `ast.object` would have been lied to.
    // `context` is dropped HERE rather than `delete`d from the built AST: since
    // ADR-0122 the caller-supplied `context` is the AUTHOR state (every key
    // optional) while `QueryAST` carries the parsed one, so spreading it in and
    // removing it a line later would type the AST with a context it never holds.
    // [#6300] The rest of the bag is author state too now — the defaults its
    // schemas declare are filled here, before anything downstream reads the AST.
    const { context: _findContext, ...findQuery } = query ?? {};
    const ast: QueryAST = { ...this.fillQueryAstDefaults(findQuery), object };

    // Plan formula projection: rewrite ast.fields to drop virtual formula
    // names and inject their dependencies, so the driver returns the raw
    // fields needed to compute the formulas after fetch.
    const _findSchema = this._registry.getObject(object);

    this.expandSearchOnAst(ast, _findSchema);
    // [#7642] The caller's OWN projection, captured before any planning pass
    // rewrites it — the only thing that can answer "did this caller ask for
    // `__search`?". See `stripSearchCompanionFromRead`.
    const _findRequestedFields = Array.isArray(ast.fields) ? [...ast.fields] : undefined;
    // [#7095] Before the projection is planned and before anything is handed to
    // a driver: an ORDER BY this engine cannot materialise is refused, not
    // dropped. `fillQueryAstDefaults` has already normalised `orderBy` into
    // `SortNode[]`, so the names read here are the ones the driver would get.
    assertOrderByIsMaterializable(object, 'find', _findSchema, ast.orderBy);
    // [#7589] The projection's DOTTED leg, judged on the caller's own
    // spellings BEFORE the formula planner rewrites the projection: a dotted
    // entry is structurally unresolvable (no populate step exists — #7601)
    // and is refused loudly instead of riding its head segment into the
    // driver, where the #3821 ladder answered it with EVERY field.
    assertProjectionHasNoDottedPaths(object, 'find', _findSchema, ast.fields);
    const _findFormula = planFormulaProjection(_findSchema, ast.fields);
    if (_findFormula.projected) ast.fields = _findFormula.projected;

    // Drop any requested PLAIN field that doesn't exist on the schema.
    // Without this, drivers (notably SqlDriver) emit `SELECT unknown_col
    // FROM ...` which the DB rejects ("no such column") — and SqlDriver
    // swallows that error and returns `[]`, making a frontend bug (e.g. a
    // generic view requesting `name`/`due_date` on every object) look like
    // "no records exist". Silently filtering matches the existing OData
    // tolerance and Salesforce/Postgres behavior of `SELECT *` semantics.
    //
    // [#7589] This tolerance is for unknown PLAIN columns ONLY, and it is
    // KEPT deliberately (ruled 2026-08-12): the "no records exist" failure it
    // prevents is real, and the driver-side half of the same tolerance
    // backstops registry-less hosts. A structurally unresolvable (dotted)
    // projection is a different fact and no longer reaches this filter via
    // the engine — `assertProjectionHasNoDottedPaths` above refused it.
    if (_findSchema?.fields && Array.isArray(ast.fields) && ast.fields.length > 0) {
      const known = new Set(Object.keys(_findSchema.fields));
      // Always allow the primary key + audit columns even if not present in
      // schema.fields. Without this, callers requesting `select=id,name`
      // silently get the `id` projected away, breaking record navigation.
      known.add('id');
      known.add('created_at');
      known.add('updated_at');
      // Whole names, no head-splitting: only plain entries reach here (the
      // dotted refusal above fired on anything carrying a '.').
      const filtered = ast.fields.filter(f => known.has(f));
      // Guard against an empty projection — fall back to `*` so the
      // request still returns rows. An empty SELECT list would either
      // 400 in Postgres or silently project nothing.
      ast.fields = filtered.length > 0 ? filtered : undefined;
    }

    const opCtx: OperationContext = {
      object,
      operation: 'find',
      ast,
      options: query,
      context: mergeReadContext(query?.context, options?.context),
    };
    this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context);

    await this.executeWithMiddleware(opCtx, async () => {
      const hookContext: HookContext = {
          object,
          event: 'beforeFind',
          input: { ast: opCtx.ast, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
      };
      await this.triggerHooks('beforeFind', hookContext);
      hookContext.input.options = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any);

      try {
          let result = await driver.find(object, hookContext.input.ast as QueryAST, hookContext.input.options as any);

          // Post-process: evaluate formula virtual fields against the raw rows
          if (Array.isArray(result)) applyFormulaPlan(_findFormula.plan, result, opCtx.context);

          // Post-process: expand related records if expand is requested
          if (ast.expand && Object.keys(ast.expand).length > 0 && Array.isArray(result)) {
            result = await this.expandRelatedRecords(object, result, ast.expand, 0, opCtx.context);
          }

          // Post-process: resolve file-field id references to their expanded
          // FileValueSchema form (ADR-0104 D3). Always-on but free unless a file
          // field holds an id string; dual-mode-safe (blobs pass through).
          if (Array.isArray(result)) {
            result = await this.resolveFileReferences(object, result, opCtx.context);
          }

          hookContext.event = 'afterFind';
          hookContext.result = result;
          await this.triggerHooks('afterFind', hookContext);

          // Never let secret-field plaintext (or its ref) leave through the
          // generic read path — mask after hooks run. Privileged consumers use
          // resolveSecret() against the stored ref instead.
          this.maskSecretFields(object, hookContext.result);

          // [#7642] …and never let the hidden `__search` companion column out
          // through the default projection either. After the hooks, for the
          // same reason the mask is: a server-side `afterFind` handler is not
          // the client this column is hidden from.
          this.stripSearchCompanionFromRead(hookContext.result, _findRequestedFields, opCtx.context);

          return hookContext.result;
      } catch (e) {
          this.logger.error('Find operation failed', e as Error, { object });
          throw e;
      }
    });

    return opCtx.result as any[];
  }

  /**
   * Read the ONE record the query selects, or `null`.
   *
   * `findOne` applies `limit: 1` by contract — so unlike `find`, the query's
   * predicate is the only thing standing between the caller and *an arbitrary
   * row*. A query that selects nothing in particular does not return nothing;
   * it returns the object's first row, which is a real, plausible-looking
   * record that no caller's `if (!row)` check can catch, and that propagates
   * into whatever is computed next (#4419). So this method REQUIRES the caller
   * to say which record it wants:
   *
   * - `where` (or the `filter` alias, folded here), or a `search` that expands
   *   to one — the record is selected by predicate.
   * - `orderBy` — "the FIRST record in this order" (the newest, the highest
   *   priority). Deterministic without a predicate, and honored by every
   *   driver on this path.
   *
   * Neither → throws. If any row genuinely will do, that is
   * `find(object, { limit: 1 })`, which says so at the call site.
   *
   * No ordering is IMPOSED when the caller supplies none: `ORDER BY <pk> LIMIT
   * 1` makes a planner abandon the predicate's own index (objectstack#4363, and
   * see `SqlDriver.findRows`' `singleRowLookup`). `findOne` promises *a*
   * matching record, never a position in a sequence.
   *
   * Fires the same `beforeFind`/`afterFind` hooks as `find` (#3195).
   */
  async findOne(objectName: string, query?: EngineQueryOptions, options?: EngineReadOptions): Promise<any> {
    objectName = this.resolveObjectName(objectName);
    // Same alias fold as find() (#4346). Without it, `findOne({ filter })`
    // matched the first row of the WHOLE table rather than the predicate.
    // `top` folds into `limit` here too, but findOne is single-row by
    // contract, so the literal `limit: 1` below wins over both spellings.
    // Wire-only spellings are rejected, same as find() (#4371) — `sort`
    // matters here too: findOne({ sort }) means "first row of THIS order".
    query = foldEngineOptionAliases(objectName, 'findOne', query, ENGINE_QUERY_SLOTS, ENGINE_WIRE_ONLY_SLOTS);
    rejectUnknownEngineOptions(objectName, 'findOne', query, ENGINE_FIND_OPTION_KEYS);
    query = lowerWhereFilterArray(objectName, 'findOne', query, this._registry.getObject(objectName));
    this.logger.debug('FindOne operation', { objectName });
    const driver = this.getDriver(objectName);
    // `object` after the spread for the same reason as find(); `limit: 1`
    // last — findOne is single-row by contract.
    // Same reason as find(): the caller's `context` is the author state and the
    // AST carries the parsed one, so it leaves before the AST is typed.
    // [#6300] And the same default-filling as find(), for the same reason.
    const { context: _findOneContext, ...findOneQuery } = query ?? {};
    const ast: QueryAST = { ...this.fillQueryAstDefaults(findOneQuery), object: objectName, limit: 1 };

    // Plan formula projection (same as find): rewrite ast.fields so the driver
    // returns the raw dependency fields, then evaluate formulas after fetch.
    const _findOneSchema = this._registry.getObject(objectName);
    // Before the guard below, so a `search` that resolves to a real filter
    // counts as the predicate it is (#4419).
    this.expandSearchOnAst(ast, _findOneSchema);
    this.requireFindOnePredicate(objectName, ast);
    // [#7095] Same refusal as `find`, and it matters MORE here: `findOne`
    // applies `limit: 1`, so `orderBy` is the whole of "which record" — a
    // dropped sort does not merely reorder the answer, it returns a DIFFERENT
    // record, and the one it returns looks exactly as legitimate.
    assertOrderByIsMaterializable(objectName, 'findOne', _findOneSchema, ast.orderBy);
    // [#7589] Same dotted-projection refusal as `find`, same position: on the
    // caller's own spellings, before the formula planner rewrites them. The
    // measured flow chain (`get_record` → `data.findOne`) reaches THIS verb
    // whenever `limit` is absent or 1, so a hole here would be the same hole.
    assertProjectionHasNoDottedPaths(objectName, 'findOne', _findOneSchema, ast.fields);
    // [#7642] Caller's own projection, before planning rewrites it — see `find`.
    const _findOneRequestedFields = Array.isArray(ast.fields) ? [...ast.fields] : undefined;
    const _findOneFormula = planFormulaProjection(_findOneSchema, ast.fields);
    if (_findOneFormula.projected) ast.fields = _findOneFormula.projected;

    // Drop unknown PLAIN fields — see the equivalent block in `find()` for
    // the rationale, and for why this tolerance is plain-columns-only ([#7589]
    // refused any dotted entry above, so none reaches this filter).
    if (_findOneSchema?.fields && Array.isArray(ast.fields) && ast.fields.length > 0) {
      const known = new Set(Object.keys(_findOneSchema.fields));
      // Always allow the primary key + audit columns even if not present
      // in schema.fields (matches `find()` behavior).
      known.add('id');
      known.add('created_at');
      known.add('updated_at');
      const filtered = ast.fields.filter(f => known.has(f));
      ast.fields = filtered.length > 0 ? filtered : undefined;
    }

    const opCtx: OperationContext = {
      object: objectName,
      operation: 'findOne',
      ast,
      options: query,
      context: mergeReadContext(query?.context, options?.context),
    };
    this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context);

    await this.executeWithMiddleware(opCtx, async () => {
      // [#3195] `findOne` fires the SAME `beforeFind`/`afterFind` hooks as
      // `find` — the read event attaches to record materialization, not to the
      // engine method, so one subscription covers every read shape (there is no
      // separate `beforeFindOne`/`afterFindOne`). Mirrors `find()` above.
      const hookContext: HookContext = {
          object: objectName,
          event: 'beforeFind',
          input: { ast: opCtx.ast, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
      };
      await this.triggerHooks('beforeFind', hookContext);
      hookContext.input.options = this.buildDriverOptions(objectName, opCtx.context, hookContext.input.options as any);

      let result = await driver.findOne(objectName, hookContext.input.ast as QueryAST, hookContext.input.options as any);

      // Post-process: evaluate formula virtual fields against the raw row
      if (result != null) applyFormulaPlan(_findOneFormula.plan, [result], opCtx.context);

      // Post-process: expand related records if expand is requested
      if (ast.expand && Object.keys(ast.expand).length > 0 && result != null) {
        const expanded = await this.expandRelatedRecords(objectName, [result], ast.expand, 0, opCtx.context);
        result = expanded[0];
      }

      // Post-process: resolve file-field id references (ADR-0104 D3).
      if (result != null) {
        const resolved = await this.resolveFileReferences(objectName, [result], opCtx.context);
        result = resolved[0];
      }

      hookContext.event = 'afterFind';
      hookContext.result = result;
      await this.triggerHooks('afterFind', hookContext);

      // Mask secret fields — plaintext never leaves through the read path.
      this.maskSecretFields(objectName, hookContext.result);
      // [#7642] Hidden `__search` companion — same door, same rule as `find`.
      // This is the `GET /data/:object/:id` surface (`getData` reads through
      // findOne), one of the four the issue measured.
      this.stripSearchCompanionFromRead(hookContext.result, _findOneRequestedFields, opCtx.context);

      return hookContext.result;
    });

    return opCtx.result;
  }

  /**
   * Insert one record or an array of records.
   *
   * At-least-once hook semantics (framework#3152): when this call is driven by
   * `bulkWrite` (seed / import), a transient batch retry or a per-row
   * degradation re-runs the whole insert, so a `beforeInsert` hook may fire
   * MORE THAN ONCE for the same input row (a first attempt that failed in
   * validation, then the degraded retry). Side-effecting `beforeInsert` hooks
   * (notifications, external calls, counters) must therefore be idempotent.
   * `afterInsert` hooks fire only on a successful write, so they are not
   * re-run by a validation failure. Autonumbers are assigned only after
   * validation passes, so a doomed attempt no longer consumes a sequence value
   * (no number-range gaps from a rejected batch).
   */
  // [#3407 / #5126] BOTH members of `WriteObservabilityOptions` are live here,
  // for exactly ONE strip: the runtime-owned (`autonumber`) strip added by
  // #5503, wired at its strip site below. Each arrived carrying the same
  // standing condition — #3407's "if insert ever gains a silent strip, wire the
  // listener at that strip site", #5126's "it is inert here only because insert
  // strips nothing; if insert ever gains a strip, both members wire up together
  // at that site". #5503 is that strip, so both are discharged together:
  // quiet-and-observable by default (`onFieldsDropped`), refused outright under
  // `strictReadonlyWrites` — the same one-per-call choice update offers.
  //
  // INSERT remains deliberately exempt from the AUTHOR-declared
  // readonly/readonlyWhen strips (a create may legitimately seed read-only
  // columns; the #3043 ingress strip covers external callers instead), and the
  // FLS write gate throws rather than stripping. So neither member reports on
  // those here — only on what this path actually strips. Any FURTHER strip added
  // here must wire both members at its own site too.
  /**
   * Validate-only (#6037, #4633 ruling D) — run the write path's own verdict
   * over candidate rows and report it, WITHOUT persisting anything.
   *
   * ## Why this exists
   *
   * `import`'s dry run used to predict the write's verdict with a hand-copied
   * mirror of the engine's rules (`rest/src/import-coerce.ts`). A copy cannot
   * structurally keep up with the family it mirrors — value shapes and their
   * ADR-0104 posture, `format` checks, object-level `validations`, the state
   * machine — so the ruling replaced prediction with the verdict itself. The
   * point is that agreement is guaranteed **by construction**: this method
   * calls the same `validateRecord` and `evaluateValidationRules`, with the
   * same options, that `insert()` calls a few hundred lines below.
   *
   * ## ADR-0104 posture — the whole reason B was rejected
   *
   * The verdict is resolved against the TARGET DEPLOYMENT'S REAL POSTURE via
   * the same `valueShapeStrictFor` / `mediaValueShapeStrictFor` the write path
   * uses. On a self-certified (strict) deployment a bad value shape is an
   * error here exactly as it would be on write; on a warn-first deployment it
   * is admitted here exactly as it would be on write, and reported as a
   * WARNING rather than an error. An unconditionally-strict dry run (option B)
   * was rejected precisely because it would fail rows on every un-migrated
   * deployment that the write would have accepted — a false alarm that teaches
   * authors to distrust the one gate in front of a bulk import.
   *
   * The warn-first admissions are deliberately NOT routed to
   * `admittedViolationSink`: that sink records "this boot has written data
   * against the old contract" so the deployment cannot then certify itself
   * (#4769). A dry run writes nothing, so recording an admission would make a
   * *preview* block a later migration — a side effect on a call whose whole
   * contract is to have none.
   *
   * ## What it deliberately does NOT simulate
   *
   * No hooks run. `beforeInsert` fires BEFORE validation on the real path, so
   * a hook that derives a business field could in principle change a verdict
   * this method reports. Running arbitrary user-authored hooks to close that
   * gap is the worse trade by a wide margin — a "validate without persisting"
   * call that fires side-effecting hooks (mail, outbound calls, writes to
   * other objects) is the #4052 defect in a new spelling, where a preview
   * quietly executes. So the gap is documented rather than closed: audit and
   * ownership stamps are `system`/`readonly` and are skipped by validation
   * anyway, so what remains is the narrow case of a hook deriving a
   * *business* field that its object also validates.
   *
   * Nothing is written, no sequence is consumed, and no driver is touched —
   * validation is in-process, which is what makes row-by-row dry run of a
   * large import affordable.
   */
  async validate(
    object: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    options?: { mode?: 'insert' | 'update'; context?: ExecutionContext },
  ): Promise<ValidateDataResponse> {
    object = this.resolveObjectName(object);
    const mode = options?.mode ?? 'insert';
    const schemaForValidation = this._registry.getObject(object);

    // [#4633] `insert()` resolves `defaultValue`s and seeds owned roll-up
    // `summary` fields BEFORE it validates, so a required field carrying a
    // default is never missing by the time `validateRecord` runs. The preview
    // has to walk the same two steps or it reports `required` on a row the
    // write happily creates — a FALSE ALARM, and the one failure mode the
    // ruling that created this operation set out to prevent. (Measured on the
    // import dry run: `tier: { required: true, defaultValue: 'standard' }`
    // unmapped ⇒ preview `failed`, write `created`.)
    //
    // Both helpers are pure and synchronous: they read the registry, copy the
    // row, and touch neither driver nor hook — so running them here keeps the
    // "nothing is written, nothing is executed" contract intact. `update()`
    // deliberately does not default (#2706: a PATCH's explicit `null` means
    // "clear it"), so neither does an `update`-mode preview.
    const rawRows = Array.isArray(data) ? data : [data];
    const nowSnapshot = new Date();
    const rows: Record<string, unknown>[] = mode === 'insert'
      ? rawRows.map((row) => this.initializeSummaryFields(
          object,
          this.applyFieldDefaults(object, row, options?.context, nowSnapshot),
        ) as Record<string, unknown>)
      : rawRows;

    // Resolved once for the whole set, exactly as the write path resolves them
    // once per batch — this is the "same posture as the real write" guarantee.
    const mediaValueShapeStrict = await this.mediaValueShapeStrictFor(schemaForValidation);
    const valueShapeStrict = await this.valueShapeStrictFor(schemaForValidation);
    const messages = this.validationMessageContext(object, options?.context);
    const currentUser = this.buildEvalUser(options?.context);
    const skipStateMachine = shouldSkipStateMachine(options?.context);

    const results: NonNullable<ValidateDataResponse['results']> = rows.map((row) => {
      const warnings: ValidateDataIssue[] = [];
      // Warn-first admissions are the posture signal the caller came for, so
      // they are reported — into this row's own bucket, never into the
      // certification sink (see the note above).
      //
      // Carried under the code the STRICT path would have FAILED with
      // (`invalid_type`) rather than a warning-specific one: the same bad
      // value is one finding that changed buckets when the posture changed,
      // and a caller diffing a preview against a write should see that, not
      // two vocabularies. The sink's payload is `{gate, field, type, detail}`,
      // so the message is composed the way the warn-first log line composes it.
      const onAdmittedValueShapeViolation = (violation: any) => {
        const field = String(violation?.field ?? '');
        const type = String(violation?.type ?? '');
        const detail = String(violation?.detail ?? 'invalid value shape');
        warnings.push({
          field,
          code: 'invalid_type',
          message: `${field} has an invalid ${type} value: ${detail}`,
        });
      };
      try {
        validateRecord(schemaForValidation, row, mode, {
          mediaValueShapeStrict, valueShapeStrict, messages, onAdmittedValueShapeViolation,
        });
        evaluateValidationRules(schemaForValidation as any, row, mode, {
          logger: this.logger, currentUser, skipStateMachine, messages,
        });
      } catch (e) {
        if (e instanceof ValidationError) {
          return { valid: false, errors: e.fields.map((f) => ({ ...f })), warnings };
        }
        throw e;
      }
      return { valid: true, errors: [], warnings };
    });

    return {
      object,
      mode,
      valid: results.every((r) => r.valid),
      results,
      // The EFFECTIVE posture, not the raw deployment flag. `validateRecord`
      // runs the flag through `valueShapeStrictEffective`, where the ADR-0104
      // env switches take precedence over it, so reporting the flag would
      // describe a different posture than the one that just decided the
      // verdict — on a deployment holding the flag but running with
      // `OS_ALLOW_LAX_VALUE_SHAPES`, exactly backwards. Reporting what decided
      // is the whole point of returning it.
      posture: {
        valueShapeStrict: valueShapeStrictEffective(valueShapeStrict),
        mediaValueShapeStrict: mediaStrictEffective(mediaValueShapeStrict),
      },
    };
  }

  async insert(object: string, data: any | any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<any> {
    object = this.resolveObjectName(object);
    this.logger.debug('Insert operation starting', { object, isBatch: Array.isArray(data) });
    this.assertWriteAllowed(object, 'insert');
    const driver = this.getDriver(object);
    // [#5351/#5696] Same-origin gate: refuse a cross-driver BUSINESS write,
    // carve an append-only system ledger out of the transaction. Before any
    // hook, default or validation runs, so a refusal costs nothing.
    this.enforceTransactionOrigin(object, driver, 'insert');

    const opCtx: OperationContext = {
      object,
      operation: 'insert',
      data,
      options,
      context: options?.context,
    };

    await this.executeWithMiddleware(opCtx, async () => {
      // Resolve field `defaultValue`s (including the `current_user` and
      // `NOW()` tokens)
      // BEFORE the beforeInsert hook runs, so a hook that DERIVES one field
      // from another can read the defaulted value instead of a stale `null`
      // (#2703). The hook still has final say — it runs after and may override
      // any defaulted field. `applyFieldDefaults` returns a fresh copy and only
      // fills fields left `undefined`, so client-supplied values are untouched.
      //
      // [#5749] Roll-up `summary` fields this object OWNS are seeded in the same
      // pass, right after the declared defaults: `count`/`sum` over the empty
      // child collection is 0, and a brand-new parent HAS an empty child
      // collection. Without it the row stored `null` and stayed there until some
      // child write happened to name it — so "never had a child" (null) and
      // "had one, deleted it" (0) read differently and `= 0` filters dropped
      // rows. Same placement rules as the defaults above: caller-supplied values
      // untouched, hooks run after and may override.
      const nowSnap = new Date();
      const isBatch = Array.isArray(opCtx.data);
      // [#4441] The RAW caller payload per row — before `applyFieldDefaults`
      // resolves any `defaultValue` / `current_user` token and before the
      // beforeInsert hooks stamp `owner_id` / `organization_id` /
      // `created_by`. The reference check consults it to decide WHAT THE
      // CALLER ACTUALLY SENT, so neither a platform stamp nor a backfilled
      // default is ever reported as the caller's bad reference.
      //
      // [#6339] It carries the caller's VALUES, and it is taken HERE — ahead of
      // the hooks — as an explicit shallow COPY. Both halves are load-bearing:
      //  - VALUES, because the runtime-owned strip below runs AFTER
      //    `beforeInsert`, so "the caller named this key" and "this key still
      //    holds the caller's value" are different facts, and only the second
      //    one licenses a delete (see `stripRuntimeOwnedFields`).
      //  - a COPY, taken ahead of the hooks, because `rows[i]` is a different
      //    object from `opCtx.data` only by the grace of two upstream helpers:
      //    `applyFieldDefaults` returns `{ ...record }` — except on its
      //    `!fields` early return, which hands the SAME reference back — and
      //    `initializeSummaryFields` copies only when it actually seeds. Hooks
      //    mutate `ctx.input.data` IN PLACE, so an aliased snapshot would
      //    answer "what did the caller send?" with the post-hook payload.
      //    Measured on `origin/main`: not aliased today, because that early
      //    return lines up with the strip's own `!fields` bail — a coincidence
      //    of three call sites, which the copy turns into an invariant of this
      //    one. Same spread, same reason, as the update path's `suppliedValues`
      //    (#5591).
      const suppliedPerRow: Array<Record<string, unknown>> =
        (isBatch ? (opCtx.data as any[]) : [opCtx.data]).map(
          (row) => ({ ...((row ?? {}) as Record<string, unknown>) }),
        );
      const defaultedData = isBatch
        ? (opCtx.data as any[]).map((row) =>
            this.initializeSummaryFields(
              object,
              this.applyFieldDefaults(object, row as Record<string, unknown>, opCtx.context, nowSnap),
            ),
          )
        : this.initializeSummaryFields(
            object,
            this.applyFieldDefaults(object, opCtx.data as Record<string, unknown>, opCtx.context, nowSnap),
          );

      // Batch inserts trigger beforeInsert/afterInsert PER ROW, each with the
      // exact single-record context shape (`input.data` = one row, `result` =
      // its returned record). A single array-shaped context broke every
      // consumer built for the single shape — the flat-input proxy read
      // `undefined`s, declarative `condition`s evaluated against an array,
      // audit rows and flow-trigger contexts came out mangled (#2922).
      //
      // [#6966] Which is exactly why the fan-out has to be STATED rather than
      // inferred: the shape is deliberately identical, so nothing about a
      // context tells a handler whether it is one row of a batch. The scratch
      // is created once per CALL and shared by every row's context, before and
      // after — see `HookContext.dispatch`.
      const insertScope: Record<string, unknown> = {};
      const rowHookContexts: HookContext[] = (isBatch ? (defaultedData as any[]) : [defaultedData]).map(
        (row, rowIndex) => ({
          object,
          event: 'beforeInsert',
          input: { data: row, options: opCtx.options },
          dispatch: { mode: isBatch ? 'per-row' : 'record', index: rowIndex, scope: insertScope },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this,
        }),
      );
      for (const rowCtx of rowHookContexts) {
        await this.triggerHooks('beforeInsert', rowCtx);
      }
      // Thread the open transaction (if any) into the driver-facing
      // options so that knex's `.transacting(trx)` is honoured. Without
      // this, calls inside a `engine.transaction(...)` block would deadlock
      // on SQLite's single-connection pool. Also propagates tenantId so
      // the driver can enforce per-tenant isolation.
      // Base the merge on the first row context's options: hooks share the
      // same underlying options object (in-place mutations are visible), and
      // for single inserts this is exactly the pre-#2922 behaviour.
      const driverOptions = this.buildDriverOptions(object, opCtx.context, rowHookContexts[0]?.input.options as any);
      for (const rowCtx of rowHookContexts) {
        rowCtx.input.options = driverOptions;
      }

      try {
        let result: any;
        const schemaForValidation = this._registry.getObject(object);
        // When the driver generates autonumbers natively (persistent SQL
        // sequence), the engine defers to it — see #1603.
        const driverOwnsAutonumber = (driver as any)?.supports?.autonumber === true;
        // Defaults are already resolved above (pre-hook, #2703); a hook may
        // have overridden fields or replaced `input.data` — take its data as-is.
        const rows = rowHookContexts.map((rowCtx) => rowCtx.input.data as Record<string, unknown>);
        // Partial-success mode (framework#3172, entered via insertMany): a row
        // that fails validation is culled and reported per-row instead of
        // aborting the whole batch — so a bulkWrite caller never needs the
        // whole-batch degradation that re-runs beforeInsert hooks on the good
        // rows. rowErrors[i] set = row i is dead; only live rows reach the
        // driver / afterInsert / summaries.
        const partialMode = isBatch && (options as any)?.__partialRowErrors === true;
        const rowErrors: (unknown | undefined)[] = new Array(rows.length);
        for (let i = 0; i < rows.length; i++) {
          try {
            await this.encryptSecretFields(object, rows[i], opCtx.context, driverOptions);
          } catch (e) {
            if (!partialMode) throw e;
            rowErrors[i] = e;
          }
        }
        // Resolved once for the whole batch; dormant unless the object declares
        // a media field, and memoized after the first object that does.
        const mediaValueShapeStrict = await this.mediaValueShapeStrictFor(schemaForValidation);
        const valueShapeStrict = await this.valueShapeStrictFor(schemaForValidation);
        // [#4769] Where a warn-first admission is recorded, so this boot cannot
        // go on to certify a contract it has just written data against.
        const onAdmittedValueShapeViolation = this.admittedViolationSink(object);
        // Locale + translation hooks for the rejection messages (#3957) —
        // resolved once for the batch, identical for every row.
        const msgCtx = this.validationMessageContext(object, opCtx.context);
        // [#5503] `autonumber` is RUNTIME-owned: the engine (or the driver's
        // persistent sequence) issues the value, so a non-system caller does not
        // get to supply or rewrite it. Until now nothing enforced that — a POST
        // carrying an explicit record number was stored verbatim, bypassing the
        // sequence, and the SQL driver's `supports.autonumber` path adopted it
        // too (it only fills a slot left empty). Stripping HERE, in the engine
        // and before `applyAutonumbers`, is what makes the fix driver-agnostic:
        // every driver — native-sequence or not — is handed a row with no
        // caller-supplied record number, so no driver had to change.
        //
        // Runs BEFORE validation on purpose: a value the caller was never
        // allowed to send must not be judged by the object's rules either (a
        // `format` rule on the field would otherwise 400 on a payload we are
        // about to discard). Symmetric with the UPDATE strip, which likewise
        // runs before `evaluateValidationRules`. Exemptions are the update
        // path's, unchanged: `isSystem` (seed replay, migration) skips the whole
        // pass, and `preserveAudit` (#3493) lets a historical import reinstate
        // legacy record numbers.
        //
        // [#6339] `suppliedPerRow[i]` is handed over WHOLE — values included —
        // rather than reduced to its key set. This pass runs after the
        // beforeInsert hooks, so a key set could only say "the caller named
        // this", and `delete` then took whatever value was standing there: a
        // hook that RE-ISSUES the record number lost its write to any caller
        // that had also submitted the key, while the same hook's write survived
        // on a caller that had not. The update path's twin (#5591).
        const autonumberDropped: string[] = [];
        if (!opCtx.context?.isSystem) {
          const preserveAudit = opCtx.context?.preserveAudit === true;
          for (let i = 0; i < rows.length; i++) {
            if (rowErrors[i] !== undefined) continue;
            // [#8214] The insert side carries the same claim and the same
            // sequencing — this pass logs, the `ReadonlyFieldRejectedError`
            // below throws before any driver dispatch. Measured on
            // `origin/main`: `driverCreates 0` while the line said the write
            // was "COMMITTED WITHOUT IT". The card marked this half UNVERIFIED;
            // it reproduces, so the flag is threaded here too.
            const stripped = stripRuntimeOwnedFields(
              schemaForValidation as any, rows[i], suppliedPerRow[i] ?? {}, this.logger,
              { preserveAudit, strictReadonlyWrites: options?.strictReadonlyWrites === true },
            ) as Record<string, unknown>;
            if (stripped === rows[i]) continue;
            for (const k of Object.keys(rows[i])) {
              if (!(k in stripped) && !autonumberDropped.includes(k)) autonumberDropped.push(k);
            }
            rows[i] = stripped;
            rowHookContexts[i].input.data = stripped;
          }
        }
        // [#3407 / #5126] This is the strip site both standing notes on
        // `insert()` pointed at, so both members of `WriteObservabilityOptions`
        // discharge here — the same one-per-call choice `update` offers, and by
        // the same rule #5126 wrote down: strict adds NO second policy, it
        // refuses exactly what the strip would have taken. A value the strip
        // does not take is not rejected either, so an `isSystem` write and a
        // `preserveAudit` historical import stay accepted under strict — they
        // never reach this branch at all.
        //
        // Reported under the existing `readonly` reason: from the caller's side
        // an implicitly read-only field is dropped for exactly the reason a
        // declared one is, and inventing a parallel reason code would fork the
        // vocabulary (`packages/spec`) for a distinction no consumer acts on.
        if (autonumberDropped.length > 0) {
          const drop: DroppedFieldsEvent = { object, fields: autonumberDropped, reason: 'readonly' };
          if (options?.strictReadonlyWrites === true) {
            // Before the driver write and before validation — nothing is
            // written, and "you sent a runtime-owned field" should not depend on
            // whether some other field also failed a business rule (#5126's
            // ordering on the update path, mirrored).
            throw new ReadonlyFieldRejectedError(object, autonumberDropped, [drop], 'insert');
          }
          if (typeof options?.onFieldsDropped === 'function') {
            // Under strict the listener deliberately does NOT fire (above):
            // `DroppedFieldsEvent` is contracted as "dropped, and the write
            // completed without them", and a refused write did not complete.
            try {
              options.onFieldsDropped(drop);
            } catch (err) {
              this.logger.warn('onFieldsDropped listener threw — ignored', { object, error: err });
            }
          }
        }
        // [#4977] A `parent`-scoped `requiredWhen` ("once the header is Sent,
        // every line must carry a description") is a SERVER guarantee, and the
        // insert is where a line is first written empty — so unlike the
        // `readonlyWhen` strip, which is an update-path concept, this binding
        // has to exist here too. Gated on the schema actually declaring such a
        // predicate, so an object with only `record`-scoped requirements pays
        // nothing; batched, so N rows under M masters cost ONE header read.
        const insertParentForRow = hasParentScopedRequiredWhen(schemaForValidation as any)
          ? await this.resolveMasterDetailParents(schemaForValidation, null, rows)
          : undefined;
        for (let i = 0; i < rows.length; i++) {
          if (rowErrors[i] !== undefined) continue;
          try {
            normalizeMultiValueFields(schemaForValidation, rows[i]);
            validateRecord(schemaForValidation, rows[i], 'insert', { mediaValueShapeStrict, valueShapeStrict, messages: msgCtx, onAdmittedValueShapeViolation });
            evaluateValidationRules(schemaForValidation as any, rows[i], 'insert', { logger: this.logger, currentUser: this.buildEvalUser(opCtx.context), skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: msgCtx, parent: insertParentForRow?.(rows[i]) });
            await this.assertReferencesResolve(
              schemaForValidation, rows[i], suppliedPerRow[i], opCtx.context, msgCtx,
            );
          } catch (e) {
            if (!partialMode) throw e;
            rowErrors[i] = e;
          }
        }
        // Autonumbers are assigned AFTER validation (framework#3152): in the
        // batch path a bulkWrite retry / per-row degradation re-runs the whole
        // engine.insert, and a batch that dies in validation would otherwise
        // have already consumed a sequence value for every good row on the
        // failed attempt, leaving gaps. Required-validation exempts autonumber
        // fields either way (they are engine-assigned), and a driver that owns
        // autonumber assigns nothing here — so no validation rule can depend on
        // the value, making this reorder safe. In partial mode dead rows are
        // skipped, so they never consume a sequence value either.
        // [#6806] What each row's autonumbers were ISSUED from, so a
        // unique-violation on the write below can be attributed to a counter
        // and answered by re-seeding it. Empty for every row when the driver
        // owns autonumber, and for any row the engine numbered nothing on.
        const issuedPerRow: IssuedAutonumber[][] = new Array(rows.length).fill(null).map(() => []);
        for (let i = 0; i < rows.length; i++) {
          if (rowErrors[i] !== undefined) continue;
          try {
            issuedPerRow[i] = await this.applyAutonumbers(object, rows[i], opCtx.context, driverOwnsAutonumber);
          } catch (e) {
            if (!partialMode) throw e;
            rowErrors[i] = e;
          }
        }
        // Live rows = the ones that survived per-row preparation. In
        // non-partial mode rowErrors is all-empty, so this is exactly `rows`.
        const liveIndexes: number[] = [];
        for (let i = 0; i < rows.length; i++) if (rowErrors[i] === undefined) liveIndexes.push(i);
        const liveRows = liveIndexes.map((i) => rows[i]);
        if (isBatch) {
          if (liveRows.length === 0) {
               result = [];
          } else {
            // [#6806] A batch is re-seeded but never re-issued. `bulkCreate` may
            // be partially applied by a driver without a transaction, so
            // re-writing the batch could DUPLICATE the rows that did land —
            // strictly worse than the collision. What must not survive is the
            // stale counter: leaving it is what makes the very next insert
            // collide too, one number at a time, which is the storm. So the
            // counters this batch drew on are dropped and the driver's error is
            // rethrown UNCHANGED (a batch caller — bulkWrite's per-row
            // degradation — reads these errors, and this is not the place to
            // change what it reads).
            //
            // What an author gets, stated plainly: `insert(object, rows[])` and
            // `insertMany` both REJECT with the driver's own duplicate-key
            // error — never `ERR_AUTONUMBER_COLLISION`, which is the
            // single-row path's identity for "re-issued and still refused".
            // Whether any row was written is the driver's answer, not this
            // method's. The one thing the engine guarantees is that the NEXT
            // write re-seeds instead of walking into the same collision, so a
            // retry by the caller converges. Pinned in
            // engine-autonumber-resync.test.ts.
            try {
              if (driver.bulkCreate) {
                result = await driver.bulkCreate(object, liveRows, driverOptions);
              } else {
                // Fallback loop
                result = await Promise.all(liveRows.map((item) => driver.create(object, item, driverOptions)));
              }
            } catch (error) {
              const batchIssued = liveIndexes.flatMap((i) => issuedPerRow[i]);
              if (this.isIssuedAutonumberCollision(error, batchIssued)) {
                for (const one of batchIssued) this.autonumberCounters.delete(one.counterKey);
                this.logger.warn('Autonumber collided in a batch insert — counter dropped, batch not re-issued', {
                  object, fields: [...new Set(batchIssued.map((one) => one.field))],
                });
              }
              throw error;
            }
          }
        } else {
          result = await this.createWithAutonumberResync(
            driver, object, liveRows[0], driverOptions, issuedPerRow[liveIndexes[0]],
            opCtx.context, driverOwnsAutonumber,
          );
        }

        // Driver-result contract guard (framework#3151): a batch write must
        // return one record per input row. A short / non-array return would
        // otherwise be padded with `undefined` below and fed to afterInsert
        // hooks (`ctx.result === undefined`) and back to the caller as phantom
        // records — corrupting seed externalId→id maps and import undo logs.
        // Refuse it: throw so the caller sees a real failure rather than
        // silent data loss. (Every driver in this repo already returns
        // one-per-row in order; this defends against third-party drivers.)
        if (isBatch && (!Array.isArray(result) || result.length !== liveRows.length)) {
          throw Object.assign(
            new Error(
              `bulkCreate for '${object}' returned ${
                Array.isArray(result) ? `${result.length} record(s)` : String(typeof result)
              } for ${liveRows.length} input row(s) — refusing to fabricate afterInsert contexts`,
            ),
            { code: 'ERR_BULK_RESULT_MISMATCH' },
          );
        }

        // Coerce `boolean` fields (SQLite/libsql return 0/1) to real booleans on
        // the after-hook view so flow trigger conditions (`record.is_escalated
        // != true`) and `{record.<bool>}` interpolation see JS booleans, not
        // ints. A shallow copy — the value returned to the caller is untouched.
        // Only live rows have results — dead (partial-mode) rows never reach
        // afterInsert.
        const resultRows: any[] = isBatch ? (Array.isArray(result) ? result : [result]) : [result];
        // [#5504] Evaluate `formula` virtual fields onto what this write hands
        // back, so a create response is the same materialization the following
        // GET produces. Placed HERE for three reasons, all load-bearing:
        //  - AFTER every strip / refusal above (#5503's runtime-owned strip,
        //    #5126's `strictReadonlyWrites` throw): a payload the engine
        //    refuses never reaches a driver, so there is nothing to hydrate,
        //    and a stripped field must not reappear via a formula that read it.
        //  - AFTER the bulk contract guard, so `resultRows` is already known to
        //    be one row per live input row — no `undefined` slot to evaluate a
        //    formula against.
        //  - BEFORE the afterInsert dispatch, mirroring the read path's
        //    `applyFormulaPlan` → `afterFind` order. An after-hook therefore
        //    observes the same complete record on a write as it does on a read,
        //    and — because `coerceBooleanFields` copies the row it is handed —
        //    the caller-facing `rowCtx.result` carries the values too.
        // Batch (`insertMany` / `createManyData`) is covered by construction:
        // one hydration pass over every returned row, not one per call site.
        hydrateWriteFormulas(schemaForValidation, resultRows, opCtx.context);
        for (let k = 0; k < liveIndexes.length; k++) {
          const rowCtx = rowHookContexts[liveIndexes[k]];
          rowCtx.event = 'afterInsert';
          rowCtx.result = coerceBooleanFields(schemaForValidation as any, resultRows[k] as any);
          await this.triggerHooks('afterInsert', rowCtx);
          // [#7642] The 201 create body is the surface most likely to be missed
          // on this card, and the one no read-path fix reaches: `createData`
          // returns `engine.insert`'s value verbatim as `record`, so the
          // companion the `beforeInsert` stamp just wrote came straight back to
          // the client. A write has no projection to consult, so there is no
          // "asked for it by name" case to honour — the strip is unconditional.
          // AFTER the hook dispatch, matching the read path: `afterInsert`
          // handlers still observe the whole stored row.
          stripSearchCompanion(rowCtx.result);
          // [#7728] Same position, same reason, for `internal` fields. A write
          // has no projection to consult here either, so the omit is
          // unconditional. This does NOT touch the show-once mint path: that
          // route reads only `id` off the insert result and returns the
          // plaintext it generated itself.
          this.omitInternalFields(object, rowCtx.result);
        }

        // Roll-up: recompute parent summary fields that aggregate this object.
        const summaryFailures = await this.recomputeSummaries(object, result, null, opCtx.context);

        // Publish one data.record.created DataEvent per written record (#4626).
        // A batch insert is N record events, not one event about N records —
        // `DataEvent.recordId` is per record.
        if (this.realtimeService) {
          const createdRows: any[] = Array.isArray(result) ? result : [result];
          for (const record of createdRows) {
            await this.publishDataEvent('created', object, {
              recordId: record?.id,
              after: record,
              context: opCtx.context,
            });
          }
        }

        // Return the (possibly hook-mutated) after-view: the array of per-row
        // results for batch, the single record otherwise. In partial mode the
        // batch return is instead one outcome PER INPUT ROW ({ok,record} /
        // {ok:false,error}), in input order (framework#3172).
        const written = isBatch
          ? (partialMode
              ? rows.map((_r, i) => (rowErrors[i] === undefined
                  ? { ok: true as const, record: rowHookContexts[i].result }
                  : { ok: false as const, error: rowErrors[i] }))
              : rowHookContexts.map((rowCtx) => rowCtx.result))
          : rowHookContexts[0].result;
        // Records ARE written; a summary that could not be recomputed after
        // retries must not be silent (framework#3147). Thrown after realtime
        // publish, carrying the written records so a bulk caller (seed/import)
        // can treat it as a warning rather than re-writing.
        if (summaryFailures.length > 0) throw new SummaryRecomputeError(summaryFailures, written);
        return written;
      } catch (e) {
        this.logger.error('Insert operation failed', e as Error, { object });
        throw e;
      }
    });

    return opCtx.result;
  }

  /**
   * Batch insert with PARTIAL SUCCESS (framework#3172): unlike
   * `insert(object, rows[])` — which aborts the whole batch when any row
   * fails validation — this culls the bad rows after beforeInsert, writes the
   * survivors in one driver batch, and returns one outcome per input row in
   * input order. beforeInsert hooks therefore run exactly ONCE per row even
   * when the batch contains bad rows (no whole-batch degradation re-run), and
   * dead rows never consume an autonumber sequence value. afterInsert hooks,
   * summary recompute, and realtime events fire only for the written rows.
   *
   * A summary-recompute failure after retries still throws
   * {@link SummaryRecomputeError} (framework#3147) with `written` set to the
   * outcome array — the records ARE written.
   *
   * `onFieldsDropped` (#3407) is forwarded to `insert`, so the runtime-owned
   * strip (#5503) reports here too. The event carries no row index — it is the
   * UNION over the batch — but the strip only ever removes keys the row itself
   * supplied, so a caller holding the input rows can attribute each name back to
   * the rows that carried it (`insertManyData` does exactly that).
   */
  async insertMany(object: string, rows: any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<InsertManyRowOutcome[]> {
    if (!Array.isArray(rows)) throw new Error('insertMany expects an array of rows');
    return this.insert(object, rows, { ...(options ?? {}), __partialRowErrors: true } as any);
  }

  async update(object: string, data: any, options?: EngineUpdateOptions & WriteObservabilityOptions): Promise<any> {
     object = this.resolveObjectName(object);
     this.logger.debug('Update operation starting', { object });
     this.assertWriteAllowed(object, 'update');
     const driver = this.getDriver(object);
     // [#5351/#5696] Same-origin gate: refuse a cross-driver BUSINESS write,
     // carve an append-only system ledger out of the transaction. Before any
     // hook, default or validation runs, so a refusal costs nothing.
     this.enforceTransactionOrigin(object, driver, 'update');

     // Fold the `filter` alias into `where` FIRST (#4346): everything below —
     // token resolution, the by-id fast path, the #2982 AST seeding — reads
     // `options.where` only, so an unfolded `{ filter }` left the AST with no
     // predicate at all and a `multi: true` update rewrote EVERY row.
     options = foldEngineOptionAliases(object, 'update', options, ENGINE_WHERE_SLOTS);
     rejectUnknownEngineOptions(object, 'update', options, ENGINE_UPDATE_OPTION_KEYS);
     // [#5158] Lower before the by-id extraction below reads `where.id`: on an
     // array that read is `undefined` whatever the caller wrote, so an
     // `update({ where: [['id','=',x]] })` used to route to the multi-row path.
     options = lowerWhereFilterArray(object, 'update', options, this._registry.getObject(object));

     // Expand `{filter-placeholder}` values BEFORE the id is extracted (#3810).
     // The read path resolves them; without the same call here the SAME filter
     // selected different rows depending on the verb — `find({owner:
     // '{current_user_id}'})` matched the signed-in user's rows while
     // `update`/`delete` compared the literal token text and matched none. That
     // is the #3106 shape one layer down: the evaluator existed, but only some
     // call sites reached it.
     //
     // Ordering matters: a scalar `where.id` becomes the by-id fast path below,
     // so an unresolved `{current_user_id}` would be bound as the primary key
     // itself. Resolve first, then extract.
     options = this.withResolvedWhere(options);

     // 1. Extract ID from data or where if it's a single update by ID.
     //    Only a SCALAR `where.id` means "update one row by primary key". An
     //    operator object ({ $in: [...] }, { $ne: ... }, …) is a multi-row
     //    predicate — treating it as an id would bind the object literally
     //    (e.g. `WHERE id = {"$in":[...]}`, which SQLite rejects). Leave `id`
     //    undefined in that case so the call routes to updateMany (requires
     //    options.multi=true), where applyFilters compiles the operator.
     //
     // [#5480] The decision lives in `engine-update-dispatch.ts` — the twin of
     // the `delete` extraction below (#4550) — so the fake engines that stand
     // in for this method import it instead of re-deriving it. Same argument,
     // same failure mode: a double looser than the producer converts a green
     // suite into no suite at all on exactly the path the double was written
     // for (#4434), and a predicate update is no less destructive than a
     // predicate delete — it rewrites every matching row's fields.
     const dispatch = resolveEngineUpdateDispatch(
       data as EngineUpdateDispatchData,
       options as EngineUpdateDispatchInput | undefined,
     );
     const id: any = dispatch.kind === 'by-id' ? dispatch.id : undefined;

     const opCtx: OperationContext = {
       object,
       operation: 'update',
       data,
       options,
       context: options?.context,
     };

     // [#2982] A no-single-id update routes to `driver.updateMany` below with
     // an AST that used to be REBUILT from `options.where` AFTER the
     // middleware chain — so row-scoping filters a middleware AND-composed
     // onto `opCtx.ast` (RLS write policies, the sharing plugin's
     // editable-rows filter) never reached the driver, and a bulk write hit
     // every matching row regardless of ownership. Seed the AST with the
     // caller's predicate BEFORE the chain runs — the same seam the read path
     // uses — and let the multi branch consume the composed result. Keyed on
     // the SAME falsy-`id` test the multi branch dispatches on (below), so the
     // seed and the branch never disagree. `where` is included only when
     // supplied, mirroring the read path's AST shape.
     if (!id) {
       opCtx.ast = { object, ...(options?.where !== undefined ? { where: options.where } : {}) } as QueryAST;
     }

     // [#2948] Snapshot what the CALLER supplied, BEFORE any middleware /
     // beforeUpdate hook stamps server-managed columns (owner/tenant stamp,
     // `updated_by`/`updated_at`). The static-`readonly` strip below drops only
     // caller-supplied read-only writes, so hook/middleware stamps survive.
     //
     // [#5591] KEYS ARE NOT ENOUGH — this snapshot carries the VALUES too, and
     // it must be a COPY. Hooks mutate `opCtx.data` IN PLACE
     // (`ctx.input.data.x = …` — `hookContext.input.data` starts as this very
     // reference), so a snapshot that aliased it would track those mutations
     // and answer every question about "what the caller sent" with the
     // post-hook payload. A key-only snapshot was already immune to that; a
     // value snapshot only stays immune because of the spread.
     //
     // Why values: the strip runs AFTER the hooks (below), so "this key is
     // caller-supplied" and "this key still holds the caller's value" are
     // different facts, and only the second one licenses a delete. Reading the
     // first as the second deleted hook-written timestamps whenever the caller
     // had echoed the key back — see `stripReadonlyFields` for the measured
     // downstream row (`status = published`, `published_at = null`).
     const suppliedValues: Readonly<Record<string, unknown>> = {
       ...((opCtx.data ?? {}) as Record<string, unknown>),
     };

     // [#3407] Structured strip observability. The readonly/readonlyWhen strips
     // below — and, since #6437, the primary-key strip at each branch's head —
     // are LEGAL semantics (the write still succeeds without the dropped
     // fields), but until now the only trace was a server-side logger warn — a
     // caller that reports success per requested field (a flow's `update_record`
     // step) saw a clean success while the DB value never changed. When the
     // caller registers `onFieldsDropped`, report each strip pass's dropped
     // keys back with its reason. Diffing before/after key sets is exact here:
     // every strip helper returns the SAME reference when nothing was dropped,
     // else a shallow copy with keys removed. A listener fault must never break
     // the write.
     //
     // [#5126] The LOUD half of the same seam. `strictReadonlyWrites` is the
     // caller's per-call choice to have the write REFUSED rather than committed
     // without the stripped columns — the out #4903 could not add, because the
     // option key had to be declared in `packages/spec` first
     // (`WriteObservabilityOptions`, ruled Option B: in-process, not the
     // client-serializable bag).
     //
     // Two design points that are easy to get wrong later:
     //
     //  - The strips still RUN under strict. Diffing their before/after is how
     //    we learn which fields would go; the stripped payload is then thrown
     //    away with the write. So the flag adds no second policy — it reports
     //    the existing one. A field the strip does not take (an `isSystem`
     //    caller's statically-`readonly` column, an unlocked `readonlyWhen`)
     //    is not rejected either.
     //  - Under strict the listener does NOT fire. `DroppedFieldsEvent` is
     //    contracted as "dropped, and the write completed without them"; a
     //    refused write did not complete, and a flow step listening for drops
     //    would otherwise report a partial success for a write that never
     //    happened. Quiet-and-observable or loud — one per call.
     //
     // Drops accumulate across EVERY pass and throw ONCE (below, after the
     // static strip) so the caller gets every offending field in one error
     // instead of a round-trip per field. The throw lands before any driver
     // call, so nothing is written.
     //
     // [#6437] Adding a reason therefore adds a REFUSAL, and that is the
     // contract rather than a side effect: `strictReadonlyWrites` is documented
     // as covering "every drop `onFieldsDropped` reports" — a set DERIVED from
     // what this helper reports, never an enumeration frozen at #5126. So the
     // `primary_key` strip is refused under strict for exactly the reason the
     // read-only ones are (don't half-apply my payload), and the refusal error
     // composes its wording from `drops` so it never calls a stripped `id`
     // read-only. Route a new strip through here ⇒ own both halves.
     //
     // [#8093] ...and one thing is NOT a drop: the row's own primary key, when
     // it is the address of the row this call is already writing. `droppedFields`
     // has one declared meaning — fields the CALLER SUPPLIED and the engine
     // REFUSED. An `id` that names the targeted row was refused nothing; it did
     // its job. ADDRESSING IS NOT PAYLOAD.
     //
     // How a caller who sent no `id` gets one reported anyway: the REST ingress
     // folds the path id INTO the write payload (`metadata-protocol`'s
     // `updateData`: `{ ...request.data, id: request.id }`, #6479 — so a body
     // `id` can no longer bind a different row than the one the URL, the OCC
     // check and the receipt all name). That fold is correct and stays. But it
     // lands in `data` BEFORE the `suppliedValues` snapshot above, so from here
     // down the address is indistinguishable from something the caller typed —
     // and on an object whose `id` is declared `readonly: true` (as platform
     // objects' are), the static-`readonly` strip below then drops it and
     // reports it. Measured on `main` through the real ingress:
     // `PATCH /data/sys_user_preference/<id>` with the body `{"value":[...]}` —
     // no `id` key in it — answered 200 carrying
     // `droppedFields:[{fields:["id"],reason:"readonly"}]`.
     //
     // What that cost is not cosmetic. The console's internal "recent items"
     // trace runs on every org switch, so every org switch popped a user-facing
     // amber warning toast naming a field the user never touched. The damage is
     // that the warning channel gets TRAINED TO BE IGNORED — a user who learns
     // the amber toast is noise will ignore the one that matters. The identical
     // failure mode is already on record one field over: #3431 / #3794 stopped
     // `userState.ts` sending `updated_at` because doing so "made every
     // recents/favorites write pop a scary warning about a field the user never
     // touched, drowning the real signal the toast exists for."
     //
     // Deliberately the REPORT and not the strip. `id` still leaves the SET
     // clause, and must: a same-value primary-key write is a harmless no-op on
     // SQL but an outright rejection on stores with immutable primary keys, and
     // #6435's block already ruled that widening the strip to the truthy-scalar
     // case "is a separate decision, not a rider here". The payload handed to
     // the driver is byte-identical before and after this change.
     //
     // Self-scoping to SINGLE-RECORD update by construction: `id` is bound only
     // on the by-id branch, so a predicate/multi write — where nothing addresses
     // a row by key — is untouched, and a caller-supplied `id` there is still
     // reported. It cannot collide with the `primary_key` strips either: those
     // fire only when the dispatch has ALREADY RULED the value is not a primary
     // key, which is exactly when it cannot equal the bound key.
     //
     // Asked of `suppliedValues`, never of the live payload: this is a question
     // about what the CALLER submitted, and the answer must survive a hook
     // rewriting the key mid-write — the same reason that snapshot carries
     // values at all (#5591).
     //
     // [#8141] #8093 wired this to the REPORT channel only, so the strip's own
     // WARN went on calling the address a forged caller write on every
     // single-record PATCH of every platform object. It now feeds BOTH channels
     // — `reportDroppedFields` below and `stripReadonlyFields`' `addressKey`
     // argument — from this ONE predicate. Deliberately not a second derivation:
     // two notions of "this id is the address" that disagree in one edge case
     // would be a worse defect than the log line either of them silences.
     const onFieldsDropped = options?.onFieldsDropped;
     const strictReadonlyWrites = options?.strictReadonlyWrites === true;
     const strictDrops: DroppedFieldsEvent[] = [];
     const idAddressesThisRow =
       id !== undefined && id !== null
       && Object.prototype.hasOwnProperty.call(suppliedValues, 'id')
       && Object.is(suppliedValues.id, id);
     const reportDroppedFields = (
       before: Record<string, unknown> | null | undefined,
       after: Record<string, unknown> | null | undefined,
       reason: DroppedFieldsEvent['reason'],
     ): void => {
       if ((!onFieldsDropped && !strictReadonlyWrites) || before === after || !before) return;
       const afterObj = (after ?? {}) as Record<string, unknown>;
       const fields = Object.keys(before).filter(
         // [#8093] The address the caller wrote to is not a field it lost.
         (k) => !(k in afterObj) && !(idAddressesThisRow && k === 'id'),
       );
       if (fields.length === 0) return;
       if (strictReadonlyWrites) {
         strictDrops.push({ object, fields, reason });
         return;
       }
       try {
         onFieldsDropped!({ object, fields, reason });
       } catch (err) {
         this.logger.warn('onFieldsDropped listener threw — ignored', { object, error: err });
       }
     };
     /**
      * Refuse the write if strict is on and any pass dropped something. Called
      * once per branch, AFTER both strip passes and BEFORE the driver write.
      */
     const assertNoStrictDrops = (): void => {
       if (strictDrops.length === 0) return;
       const fields = [...new Set(strictDrops.flatMap((d) => d.fields))];
       throw new ReadonlyFieldRejectedError(object, fields, strictDrops);
     };

     await this.executeWithMiddleware(opCtx, async () => {
       const hookContext: HookContext = {
          object,
          event: 'beforeUpdate',
          input: { id, data: opCtx.data, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
       };

       // ────────────────────────────────────────────────────────────────────
       // [#5574 / #5846] The dispatch ladder is resolved BEFORE the before
       // phase, and the before phase is dispatched PER MATCHED ROW.
       //
       // ADR-0058 Addendum II (ruling B, 2026-08-06) is what forces the
       // reorder rather than merely permitting it: a per-row `before*` context
       // is BUILT from the matched row set, so the row set has to be in hand
       // before the first dispatch, so the branch that decides whether there IS
       // a row set has to be decided before that. #5846's (a) direction lands
       // in the same edit — the by-id path reads its prior row ahead of the
       // dispatch and binds `previous` there, exactly as `delete()` has since
       // #5272 — because the before phase becomes a real reader of that read on
       // BOTH paths, which is the one thing #5284's gate comment said it was
       // not.
       //
       // The lever that reorder retires is named and refused rather than
       // silently dropped: see `HookTargetRebindError`.
       //
       // Keyed on the SAME falsy-`id` test the #2982 AST seed above uses, so
       // seed, ladder and branch cannot disagree.
       const isByIdWrite = Boolean(id);
       const isPredicatePath = !isByIdWrite && Boolean(options?.multi) && typeof driver.updateMany === 'function';
       if (!isByIdWrite && !isPredicatePath) {
           // [#5480] The `reject` verdict of resolveEngineUpdateDispatch. It
           // used to be re-asked AFTER the before phase, because a hook could
           // still bind the id and convert the call into a by-id write; with
           // the ladder resolved first there is no such conversion, so the
           // refusal lands where it costs least — before any handler runs and
           // before anything is read.
           throw new Error(ENGINE_UPDATE_REJECT_MESSAGE);
       }

       // [#6966] The ladder verdict, stated on the contract. Bound HERE and
       // nowhere else: this is the one point that knows which branch the write
       // takes, and re-deriving it downstream is what `asScalarId` stays
       // unexported to prevent (#4434 / #4550). The batch context carries index
       // 0; `dispatchPerRowBeforeHooks` and `buildPerRowAfterContexts` override
       // only `index`, so `mode` and — load-bearing — the `scope` IDENTITY are
       // shared by every dispatch of this call, in both phases.
       hookContext.dispatch = {
           mode: isPredicatePath ? 'per-row' : 'record',
           index: 0,
           scope: {},
       };

       const updateSchema = this._registry.getObject(object);
       // Pre-update snapshot. Exposed to hooks via `hookContext.previous` in
       // BOTH phases now (the HookContext contract documents `previous` for
       // update/delete) and reused for object-level validation rules and the
       // roll-up recompute. Fetched once, and only for single-id updates —
       // [#7867] unconditionally there, since the not-found gate at the by-id
       // branch below is a fourth consumer that every such write has.
       let priorRecord: Record<string, unknown> | null = null;
       // [#5038] The matched rows a PREDICATE write fires its per-row
       // `afterUpdate` contexts over. `[]` is meaningful and distinct from
       // `null`: zero matched rows is zero record changes, hence zero hook
       // calls.
       let bulkPerRowRows: Record<string, unknown>[] | null = null;

       if (isByIdWrite) {
           // [#5284] Demand-driven, and the demand is asked PER OBJECT — see
           // the long-form reasoning at the by-id branch below, which still
           // holds for every term. What changed with #5574/#5846 is the one
           // term that comment singled out as deliberately ABSENT:
           // `beforeUpdate` is now a real reader of this read, because the
           // read happens before the dispatch and binds `previous` for it. So
           // it joins the gate, and the gate stops being narrower than
           // `delete()`'s twin (#5272) for no reason anyone could state.
           //
           // This is not a NEW read where a kernel is concerned — it is the
           // same one, moved and deduplicated. `sys_fetch_previous_update`
           // (`plugin.ts`, `object: '*'`, priority 5) used to make its own
           // `ql.findOne` on every by-id update to bind exactly this value;
           // #5846 retires it, because the engine now binds `previous` before
           // any authored before-hook runs.
           // [#7867] …and the read is now UNCONDITIONAL, because the gate below
           // is a question only a read can answer. `wantsPriorRecord` — the
           // #5284 narrowing this replaces — asked "does anything CONSUME the
           // prior row?" and skipped the read when nothing did. Existence is a
           // consumer it never counted, and it is the one consumer every by-id
           // write has.
           //
           // What the narrowing actually bought, measured rather than assumed:
           // its own #5929 twin in `delete()` enumerates the global registrants
           // (plugin-sharing, service-storage, plugin-auth, plugin-audit — all
           // registering with no `object`, hence matching every object), so on
           // any kernel that loads them `wantsPriorRecord` was ALREADY true for
           // everything and skipped nothing. The read becomes genuinely new
           // only for a bare `@objectstack/objectql/core` embedder whose object
           // has no hooks, no prior-reading validation rule and no roll-up —
           // and that embedder is buying a 404 it did not have.
           //
           // ⚠️ It cannot be answered from the write's own return value
           // instead. `IDataDriver.update` declares `Promise<Record<string,
           // unknown>>` — no not-found signal in the contract at all — and the
           // engine's post-write readback is `null` for a SECOND reason
           // (`protocol.updateData`'s own note: a write that moves the row out
           // of the caller's row scope, e.g. reassigning `owner_id` away from
           // yourself under an owner-scoped policy, reads back null while
           // having succeeded). Reading either as "not found" would answer 404
           // to a write that landed. Both siblings ask existence BEFORE the
           // write for exactly this reason; so does this.
           //
           // `buildDriverOptions` is what carries the open transaction and
           // the tenant scope onto a raw driver read — the same bag the
           // post-phase write uses, built here because the write's own
           // merge has not happened yet. `delete()`'s pre-image read does
           // the same for the same reason.
           const priorAst: QueryAST = { object, where: { id }, limit: 1 };
           const preOpts = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any);
           priorRecord = await driver.findOne(object, priorAst, preOpts);
           // ── [#7867] The not-found gate ──────────────────────────────────
           //
           // A by-id update whose id names no row was a SILENT NO-OP that
           // resolved `null`: nothing on this path ever asked whether the row
           // existed, so the write ran on into validation, the driver and the
           // hook chain, and died on whichever of them complained first. The
           // 400 class varied with the object's declarations — a
           // `HookConditionError` on a hooked object, a required-field
           // `VALIDATION_FAILED` on an unhooked one — while the missing 404 was
           // the constant. Two sibling paths had this gate and an action body
           // traverses neither: `protocol.updateData` (#4435) and `callData`'s
           // ObjectQL fallback (#5138). This is the third, placed at the one
           // point all of them funnel through, so it is not a fourth site.
           //
           // ⚠️ It throws BEFORE `triggerHooks('beforeUpdate')` deliberately,
           // and that ordering is the fix rather than a detail of it. The
           // reported symptom was an `afterUpdate` condition reading `previous`
           // on a row that was never there; `if (priorRecord) …` below is
           // CORRECT and stays untouched (ADR-0058 Addendum II / #4649 —
           // never fabricate a prior state), it was simply running on a path
           // that should never have been entered. Killing the producer is
           // #5574's ruled remedy for this family, not specializing the
           // message the symptom happened to produce.
           //
           // Scope: the BY-ID branch only. A `multi: true` predicate update
           // that matches zero rows is legitimately "0 rows affected", not a
           // missing record — same line both siblings draw.
           if (!priorRecord) throw recordNotFoundError(object, id);
           // Never fabricate: a row that is not there leaves `previous`
           // UNBOUND rather than `{}`/`null`, so a condition reading it
           // faults loudly instead of answering for a record nobody read
           // (#4649/#4775) — `delete()`'s `bindPreImage` rule, verbatim.
           // The guard is kept verbatim although the gate above now makes it
           // permanently true here: it states the invariant, and the invariant
           // outlives this call site.
           if (priorRecord) hookContext.previous = coerceBooleanFields(updateSchema as any, priorRecord as any) as any;
           await this.triggerHooks('beforeUpdate', hookContext);
           // The retired lever, refused. Everything above — `previous`, and
           // below it the `readonlyWhen` strip and every validation rule — was
           // computed against the row the ladder chose.
           if (hookContext.input.id !== id) {
               throw new HookTargetRebindError({
                   object, event: 'beforeUpdate', path: 'by-id',
                   expectedId: id, observedId: hookContext.input.id,
               });
           }
       }

       // [#3106/#3042/#5038/#5574] D7 — ONE read of the matched row set per
       // predicate write, serving four consumers: per-row validation rules,
       // the `readonlyWhen` strip, the per-row `before*` dispatch and the
       // per-row `after*` dispatch. The ruling forbids a second fetch in as
       // many words, so the read is a MEMO rather than a call at each
       // consumer's site: the before phase needs it earliest (its contexts are
       // built from it), the strip gate can only be asked of the POST-hook
       // payload, and a memo is what lets both be true without the read
       // happening twice or being hoisted past the gate that decides it is
       // needed at all.
       let priorRows: Record<string, unknown>[] | null = null;
       let priorRowsRead = false;
       let readPriorRows: () => Promise<Record<string, unknown>[] | null> = async () => null;

       if (isPredicatePath) {
           // [#2982] Consume the middleware-composed AST seeded above, so the
           // injected row-scoping (RLS write filter, sharing's editable-rows
           // filter) actually binds every read and write on this path — the
           // per-row hook dispatch included, which is why the check moved here
           // from the driver call. Fail CLOSED if it is somehow absent:
           // rebuilding `{ object, where }` would silently drop every composed
           // filter and reopen the unscoped-bulk-write hole this fix closed
           // (AGENTS.md PD #12).
           const ast = opCtx.ast;
           if (!ast) {
               throw new Error(
                 `[Security] Refusing bulk update on '${object}': row-scoping AST was not seeded ` +
                   `(the predicate branch was reached without the #2982 seed).`,
               );
           }
           const preOpts = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any);
           readPriorRows = async () => {
               if (!priorRowsRead) {
                   priorRowsRead = true;
                   priorRows = (await driver.find(object, ast, preOpts) as Record<string, unknown>[]) ?? [];
               }
               return priorRows;
           };

           // The demand is uniform across hooks and asked PER OBJECT: it is
           // NOT keyed on whether any condition mentions `previous`, which the
           // ruling rejected explicitly as a hidden rule that makes a hook's
           // firing count depend on its condition text.
           const perRowBeforeHooks = this.hasHooksFor('beforeUpdate', object);
           const perRowAfterHooks = this.hasHooksFor('afterUpdate', object);
           if (perRowBeforeHooks || perRowAfterHooks) {
               const rows = (await readPriorRows()) ?? [];
               // [D6] ONE ceiling for BOTH phases, checked BEFORE the first
               // per-row dispatch and before the driver call — so an
               // over-ceiling batch runs zero handlers and writes nothing,
               // rather than running 10 001 of them and then throwing. Named
               // for the phase that will dispatch first, so the operator is
               // told which hook to narrow or drop.
               this.assertBulkPerRowHookBudget(
                 object, perRowBeforeHooks ? 'beforeUpdate' : 'afterUpdate', rows.length,
               );
               if (perRowAfterHooks) bulkPerRowRows = rows;
               // [D1] Zero matched rows is zero dispatches — a batch that
               // changed nothing is not a record change.
               if (perRowBeforeHooks && rows.length > 0) {
                   await this.dispatchPerRowBeforeHooks(object, 'beforeUpdate', rows, hookContext);
               }
           }
       }

       hookContext.input.options = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any);

       try {
           let result;
           // [#4639] Which event contract this write reports under. A predicate
           // write publishes the aggregate `data.records.updated`; anything else
           // publishes the per-record `data.record.updated`. Recorded at the
           // branch that made the choice rather than re-derived at the publish
           // site from an absent id — the two are the same today, and a future
           // driver returning a row from `updateMany` would silently reroute a
           // bulk write onto the per-record contract if we inferred it.
           let isPredicateWrite = false;
           const mediaValueShapeStrict = await this.mediaValueShapeStrictFor(updateSchema);
           const valueShapeStrict = await this.valueShapeStrictFor(updateSchema);
           const updateMsgCtx = this.validationMessageContext(object, opCtx.context);
           // [#4769] See the insert path — an update admits values on the same
           // terms, so it owes the same counterexample.
           const onAdmittedValueShapeViolation = this.admittedViolationSink(object);
           // [#5574] Branch on the LADDER, not on `hookContext.input.id`. The
           // two used to be the same question asked twice, which is exactly
           // what made the id slot a reroute lever; the ladder was resolved
           // before the before phase above and a handler's attempt to move it
           // has already been refused.
           if (isByIdWrite) {
               // [#6435] The by-id half of #6262's strip — same defect, other
               // arm. Reaching this branch means the dispatch found a truthy
               // scalar id, but NOT necessarily in the payload: when `data.id`
               // is a non-scalar (an operator object, an array, `null`) or a
               // falsy scalar, `resolveEngineUpdateDispatch` rules it is not a
               // primary key and falls through to `options.where.id`, binding
               // THAT (#5748 / PR #5919 — `ENGINE_UPDATE_DISPATCH_CASES` states
               // it: `operator object in data.id, scalar where.id` ⇒ `by-id`,
               // `expectId: 'rec_1'`). The dispatch is right; the PAYLOAD was
               // never cleaned. Measured on origin/main, this very branch:
               //
               //   driver.update('task', 'rec_1', { id: { $in: ['a','b'] }, title: 'x' })
               //                                     ^^^^^^^^^^^^^^^^^^^^^^ the SET clause
               //
               // `driver-sql`'s `update()` formats the WHOLE payload
               // (`sql-driver.ts`, `applyWriteColumnMap(formatInput(object,
               // data))` — `id` is on no skip list), so the row is written as
               // `UPDATE task SET id = '{"$in":["a","b"]}', title = 'x' WHERE
               // id = 'rec_1'`: rec_1's identity is overwritten with a
               // serialized operator object, irreversibly, on any backend that
               // accepts it.
               //
               // The rule is #6262's, unchanged and asked of the payload rather
               // than of the branch: a value the engine has ALREADY RULED is
               // not a primary key does not get to sit in the primary-key
               // column. It is asked by CALLING the dispatch — "would this
               // payload, on its own, identify a row?" — never by re-deriving
               // the scalar test here: `asScalarId` is deliberately unexported
               // (`engine-update-dispatch.ts`: "adding a third public spelling
               // of the same question is how a rule with one definition grows a
               // second one"), and a hand-mirrored copy is the #4434 / #4550
               // failure this family exists to prevent.
               //
               // Deliberately NARROW, and the narrowness is the whole scope:
               //
               //  - A TRUTHY SCALAR `data.id` is left exactly as it is. There
               //    the payload's `id` IS the bound key (it outranks `where` —
               //    same case-set), so the write is `SET id = 'rec_1' WHERE id
               //    = 'rec_1'`: a same-value no-op, redundant rather than
               //    damaging, and long-standing behaviour. Widening the strip
               //    to cover it is a separate decision, not a rider here.
               //  - Rejecting the call instead (#6435's route B) would reverse
               //    the `expect: 'by-id'` verdict the case-set states today —
               //    a partial rollback of #5748's ruling A, i.e. a maintainer
               //    decision. This change alters NO verdict: the same call
               //    still dispatches by-id and still binds `rec_1`.
               //  - Per-driver skip lists (route C) are the #5240 / #4434 shape
               //    of five backends answering one question five ways.
               //
               // [#6437] REPORTED, on the same seam as the read-only strips.
               // The vocabulary widened (`DroppedFieldsEvent.reason` gained
               // `primary_key`), so the strip no longer has to choose between
               // silence and a `reason` that lies — the choice #6262 / #6435
               // were right to refuse. The `warn` below STAYS: it carries the
               // remedy prose, and `onFieldsDropped` is opt-in, so a caller
               // that registered no listener would otherwise lose the #4632
               // signal entirely.
               const preIdById = hookContext.input.data as Record<string, unknown> | null | undefined;
               if (
                   preIdById &&
                   typeof preIdById === 'object' &&
                   Object.prototype.hasOwnProperty.call(preIdById, 'id') &&
                   resolveEngineUpdateDispatch(preIdById as EngineUpdateDispatchData, undefined).kind !== 'by-id'
               ) {
                   const { id: notAnId, ...withoutId } = preIdById;
                   hookContext.input.data = withoutId as any;
                   this.logger.warn(
                     `Update on '${object}' of record ${String(hookContext.input.id)}: dropped 'id' from the ` +
                       `write payload. The row is identified by the id argument, and the engine has already ruled ` +
                       `this payload value is not a primary key (${JSON.stringify(notAnId) ?? String(notAnId)}) — ` +
                       `writing it would have overwritten that row's primary-key column. To update ONE row by id, ` +
                       `pass a SCALAR id (\`update(object, { id, ...fields })\` or \`{ where: { id } }\`); to ` +
                       `SELECT rows by an id set, put it in \`where\` ` +
                       `(\`{ where: { id: { $in: [...] } }, multi: true }\`).`,
                   );
                   reportDroppedFields(preIdById, hookContext.input.data as Record<string, unknown>, 'primary_key');
               }
               await this.encryptSecretFields(object, hookContext.input.data as Record<string, unknown>, opCtx.context, hookContext.input.options);
               normalizeMultiValueFields(updateSchema, hookContext.input.data as Record<string, unknown>);
               validateRecord(updateSchema, hookContext.input.data as Record<string, unknown>, 'update', { mediaValueShapeStrict, valueShapeStrict, messages: updateMsgCtx, onAdmittedValueShapeViolation });
               // [#5284] Demand-driven, and the demand is asked PER OBJECT.
               //
               // This gate used to ask `this.hooks.get('afterUpdate').length > 0`
               // — the whole registration list, every object's hooks pooled — so
               // ONE object being observed made EVERY single-id update on EVERY
               // object pay an extra `driver.findOne`. The bulk paths next door
               // already asked the same question per object
               // (`hasHooksFor('afterUpdate', object)`, #5038), so one file held
               // two precisions of one question; this is the narrower one, which
               // `hasHooksFor` answers by mirroring `triggerHooks`' own filter
               // (an entry with no `object`, or `'*'`, is still global).
               //
               // Measured, so the expectation is right: what this saves depends
               // on how the deployment's hooks are REGISTERED, not on how many
               // there are. Object-scoped registrants stop taxing their
               // neighbours — a record-change flow trigger (`object:
               // binding.object`), plugin-sharing's per-rule recompute, plugin-
               // auth's `sys_user` snapshot refresh, every metadata-authored
               // hook. Registrants that pass no `object` at all (plugin-audit's
               // `writeAudit`, service-storage's file-reference reconcile) DO
               // reach every object, so where they are loaded this gate stays
               // true for everything and saves nothing — correctly, since their
               // handlers really do run. Making those two express in the
               // registration what their handlers already decide at runtime is
               // #5846, not this change.
               //
               // Every consumer of `priorRecord` on this branch is counted, and
               // there are exactly three:
               //   * `needsPriorRecord(updateSchema)` — object validation rules
               //     (ADR-0020: state_machine / cross_field / script; a PATCH
               //     carries only changed fields) AND the `readonlyWhen` /
               //     `requiredWhen` / option-visibility field predicates, which
               //     it subsumes;
               //   * an `afterUpdate` hook on THIS object — `hookContext.previous`
               //     for its handler (plugin-audit, the record-change trigger)
               //     and for its declarative `condition`;
               //   * a roll-up `summary` aggregating this object — `previous`
               //     carries the OLD parent id, so a child that REPOINTS
               //     recomputes both parents (see `recomputeSummaries` below).
               //     Without this term the narrowing would have turned an
               //     incidental read into a silently stale parent summary: today
               //     a repointed child is only saved by some other object having
               //     an afterUpdate hook.
               //
               // [#5574 / #5846] `beforeUpdate` USED to be deliberately absent
               // from this gate, and that was the one place it did not mirror
               // `delete()`'s twin (#5272). The reason given was ordering: this
               // path dispatched `beforeUpdate` first and bound
               // `hookContext.previous` only after the write, so no
               // `beforeUpdate` hook could observe this row however the gate was
               // written, and counting the event would have bought a read with
               // no reader. ADR-0058 Addendum II reversed the ordering, so the
               // reader now exists — the read and the binding happen ABOVE, in
               // the pre-phase, and `wantsPriorRecord` there counts
               // `beforeUpdate` alongside `afterUpdate`.
               //
               // What that also retired: the `sys_fetch_previous_update`
               // builtin (`plugin.ts`, `object: '*'`, priority 5) used to be the
               // only producer of `previous` for the before phase, making its
               // own `ql.findOne` on every by-id update. With the engine binding
               // it first the builtin's `!ctx.previous` guard is permanently
               // short-circuited, so #5846 removes it rather than leaving a
               // second read behind a guard that can no longer be false.
               //
               // B2: drop writes to fields locked by a TRUE `readonlyWhen` — the
               // field is read-only for this record's state, so the incoming
               // change is ignored (the persisted value is kept).
               const preRoWhen = hookContext.input.data as Record<string, unknown>;
               // [#4889] A `parent`-scoped predicate ("once the header invoice
               // is Paid, its lines are frozen") needs the master-detail header
               // bound as `parent`. Only the engine can fetch it, so the strip
               // is a pure function of what we hand it — resolve here, gated on
               // the payload actually touching such a predicate so a detail
               // object with only `record`-scoped locks pays no extra read.
               //
               // [#4977] `requiredWhen` reads the same root at the same write,
               // so the two slots share ONE resolution rather than each buying
               // a header read — and, more importantly, so a single write can
               // never judge its lock and its requirement against two different
               // headers. Payload-FK-first for both (#4889's rule: a repoint is
               // judged against the master it lands on).
               const schemaHasParentRequiredWhen = hasParentScopedRequiredWhen(updateSchema as any);
               const wantsParentBinding =
                   hasParentScopedReadonlyWhenInPayload(updateSchema as any, preRoWhen) ||
                   schemaHasParentRequiredWhen;
               const roWhenParent = wantsParentBinding
                   ? await this.resolveMasterDetailParent(updateSchema, preRoWhen, priorRecord)
                   : undefined;
               // [#4977] The ADR-0113 non-regression pre-check asks whether the
               // STORED row already violated, so for a REPOINT it must read the
               // header the row hung off BEFORE the write — not the one it is
               // landing on. Resolved only when the payload actually moves the
               // detail to another master; otherwise the two are the same row
               // and `evaluateValidationRules` reuses `parent` for both.
               const mdRel = schemaHasParentRequiredWhen ? resolveMasterDetailRelation(updateSchema as any) : null;
               const priorMasterId = mdRel ? masterIdOf(mdRel.fk, null, priorRecord) : undefined;
               const repointsMaster =
                   mdRel != null &&
                   priorMasterId != null &&
                   masterIdOf(mdRel.fk, preRoWhen, priorRecord) !== priorMasterId;
               const roWhenPreviousParent = repointsMaster
                   ? await this.resolveMasterDetailParent(updateSchema, null, priorRecord)
                   : undefined;
               hookContext.input.data = stripReadonlyWhenFields(updateSchema as any, preRoWhen, priorRecord, this.logger, roWhenParent) as any;
               reportDroppedFields(preRoWhen, hookContext.input.data as Record<string, unknown>, 'readonly_when');
               // [#2948] Enforce STATIC `readonly` on the write path for
               // non-system callers (system writes legitimately set read-only
               // columns and are exempt). Runs AFTER hooks/middleware stamped
               // their columns; `suppliedValues` ensures only caller-forged
               // read-only writes are dropped, never the server stamps — and
               // (#5591) never a stamp a hook wrote OVER a key the caller
               // happened to echo back.
               //
               // [#8141] `addressKey` carries the SAME fact `reportDroppedFields`
               // is already keyed on — `idAddressesThisRow`, one predicate, both
               // channels — so the log and the report can never disagree about
               // what is an address. The strip is unchanged: `id` still leaves
               // the SET clause, and the driver receives the identical payload;
               // only the WARN that called the address a caller forgery is gone.
               // Undefined on every other path (the multi branch below, and the
               // insert-side sibling), which is what keeps those byte-identical.
               if (!opCtx.context?.isSystem) {
                   const preRo = hookContext.input.data as Record<string, unknown>;
                   // [#8214] `strictReadonlyWrites` is threaded INTO the strip
                   // rather than consulted only at `assertNoStrictDrops()`
                   // below: the strip logs from inside, the refusal happens
                   // afterwards, and until the strip knew the flag its line
                   // told a refused caller the update had been "COMMITTED
                   // WITHOUT IT" while `driverWrites` was 0. The seam that
                   // composes the sentence has to know the mode the sentence
                   // describes; nothing else here can tell it.
                   hookContext.input.data = stripReadonlyFields(updateSchema as any, preRo, suppliedValues, this.logger, { preserveAudit: opCtx.context?.preserveAudit === true, addressKey: idAddressesThisRow ? 'id' : undefined, strictReadonlyWrites }) as any;
                   reportDroppedFields(preRo, hookContext.input.data as Record<string, unknown>, 'readonly');
               }
               // [#5126] Both strip passes are done; refuse now if the caller
               // asked for loud. Before `evaluateValidationRules` deliberately:
               // strict is about the payload the caller SENT, and reporting
               // "you sent a read-only field" should not depend on whether some
               // other field also failed a business rule.
               assertNoStrictDrops();
               evaluateValidationRules(updateSchema as any, hookContext.input.data as Record<string, unknown>, 'update', { previous: priorRecord, logger: this.logger, currentUser: this.buildEvalUser(opCtx.context), skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: updateMsgCtx, parent: roWhenParent, previousParent: roWhenPreviousParent });
               // [#4441] A repoint is as capable of dangling as an initial link.
               await this.assertReferencesResolve(
                 updateSchema, hookContext.input.data as Record<string, unknown>,
                 opCtx.data as Record<string, unknown>, opCtx.context, updateMsgCtx,
               );
               result = await driver.update(object, hookContext.input.id as string, hookContext.input.data as Record<string, unknown>, hookContext.input.options as any);
           } else {
               // [#6262] A bulk SET clause must not carry `id`. Reaching this
               // branch AT ALL means `resolveEngineUpdateDispatch` returned
               // `multi`, i.e. it found no scalar truthy id in EITHER source —
               // so whatever sits in `data.id` here (an operator object, an
               // array, `null`, a falsy scalar) is a value the engine has
               // already RULED is not a primary key. Leaving it in the payload
               // then asks the driver to write that ruled-not-an-id value into
               // the primary-key column of every matched row: the measured
               // probe was `updateMany({object}, { id: { $in: ['a','b'] },
               // title: 'x' })`, i.e. a serialized operator object as the new
               // primary key of N rows. Five backends would each answer that
               // differently (#5240 / #4434), and on the ones that accept it
               // the matched rows lose their identity irreversibly.
               //
               // This is the SAME answer to the SAME question, applied one
               // layer on — not a second opinion. #5748 / PR #5919 ruled that a
               // non-scalar `data.id` is not an id and therefore stops
               // shadowing the dispatch ladder; the declared bulk intent is
               // honoured (`ENGINE_UPDATE_DISPATCH_CASES` says `'multi'`, and
               // this change leaves every verdict in that set untouched). The
               // strip is that ruling's other half: a value that is not the
               // primary key does not get to sit in the primary-key column
               // either. Rejecting the call instead (#6262's route B) would
               // reverse a verdict the case-set states today, which is a fresh
               // maintainer decision rather than this fix.
               //
               // No reachable shape loses a legitimate write: a truthy scalar
               // `data.id` outranks both `where` and `multi` and never gets
               // here, and N rows cannot share one primary key anyway.
               //
               // [#6437] REPORTED through `reportDroppedFields` under the
               // `primary_key` reason. `DroppedFieldsEvent.reason` was a closed
               // enum over the two READ-ONLY strips when this block landed, and
               // this drop is neither — so PR #6433 emitted only the `warn`
               // rather than force-fit an arm that would have lied. #6437
               // widened the vocabulary instead (spec, plus the batch/REST
               // protocol responses that carry it transitively), which is what
               // lets the seam report it truthfully now. The `warn` STAYS: it
               // carries the remedy prose, and a caller that registered no
               // listener still needs the #4632 signal.
               const preIdMulti = hookContext.input.data as Record<string, unknown> | null | undefined;
               if (preIdMulti && typeof preIdMulti === 'object' && Object.prototype.hasOwnProperty.call(preIdMulti, 'id')) {
                   const { id: notAnId, ...withoutId } = preIdMulti;
                   hookContext.input.data = withoutId as any;
                   this.logger.warn(
                     `Bulk update on '${object}': dropped 'id' from the write payload. A multi:true update ` +
                       `targets rows through its predicate, and the engine has already ruled this value is not a ` +
                       `primary key (${JSON.stringify(notAnId) ?? String(notAnId)}) — writing it would have ` +
                       `overwritten the primary-key column of every matched row. To update ONE row by id, pass a ` +
                       `scalar id (\`update(object, { id, ...fields })\` or \`{ where: { id } }\`) instead of ` +
                       `options.multi; to SELECT rows by an id set, put it in \`where\` (\`{ where: { id: { $in: [...] } }, multi: true }\`).`,
                   );
                   reportDroppedFields(preIdMulti, hookContext.input.data as Record<string, unknown>, 'primary_key');
               }
               await this.encryptSecretFields(object, hookContext.input.data as Record<string, unknown>, opCtx.context, hookContext.input.options);
               normalizeMultiValueFields(updateSchema, hookContext.input.data as Record<string, unknown>);
               validateRecord(updateSchema, hookContext.input.data as Record<string, unknown>, 'update', { mediaValueShapeStrict, valueShapeStrict, messages: updateMsgCtx, onAdmittedValueShapeViolation });
               // [#2982] The middleware-composed AST — asserted present and
               // bound to the memoized row read in the pre-phase above, so the
               // injected row-scoping (RLS write filter, sharing's
               // editable-rows filter) binds every read AND the write.
               const ast = opCtx.ast!;
               // [#3106] Validation rules, `requiredWhen` and per-option
               // `visibleWhen` are PER ROW on a bulk update, exactly like the
               // `readonlyWhen` strip below: one payload, N prior states. Read
               // the row-scoped match set ONCE with the SAME AST the write binds
               // (shared with the [#3042] strip), and only when the schema
               // actually needs prior state — `needsPriorRecord` subsumes
               // `hasReadonlyWhenInPayload` (readonlyWhen fields count toward
               // it), so a rule-free schema still pays nothing here.
               const rulesNeedRows = needsPriorRecord(updateSchema as any);
               const payloadHasReadonlyWhen = hasReadonlyWhenInPayload(updateSchema as any, hookContext.input.data as Record<string, unknown>);
               // [#5038/#5574] The hook phases are the third and fourth demands
               // on that same read, and they were already resolved in the
               // pre-phase above (they have to be — a per-row `before*` context
               // is built from these very rows). What is left here is the
               // strip's and the rules' own demand, asked of the POST-hook
               // payload, which is why this call site survives at all. It is
               // the SAME read: `readPriorRows` is a memo, so one `driver.find`
               // serves validation, the `readonlyWhen` strip and BOTH hook
               // phases — D7's one-read rule, and the issue's performance
               // guardrail ("行集读取一次完成,求值批内复用"), stated as code.
               if (rulesNeedRows || payloadHasReadonlyWhen) {
                   priorRows = await readPriorRows();
               }
               // [#3042] Enforce conditional `readonlyWhen` on the bulk path too.
               // Unlike static `readonly` (below), a `readonlyWhen` lock is PER
               // ROW — drop any field locked in ≥1 matched row: a bulk write
               // can't keep it for some rows and drop it for others, so a field
               // locked in any target row is fail-safe-dropped for all (narrow
               // `where` to reach the unlocked rows). Symmetric with the
               // single-id `stripReadonlyWhenFields`; INSERT stays exempt.
               //
               // [#4889] N matched rows can hang off N different masters, so the
               // `parent` binding is per row here. Batch-read the distinct
               // headers ONCE (the same shape as the single-id resolution, one
               // query instead of one per row) and hand out a lookup.
               //
               // [#4977] Hoisted out of the `readonlyWhen` block because the
               // per-row `evaluateValidationRules` below needs the same lookup
               // for `requiredWhen` — including on a batch whose payload writes
               // no `readonlyWhen` field at all. One resolution, both consumers,
               // so a bulk write cannot judge its lock and its requirement
               // against different headers.
               const preRoWhenMulti = hookContext.input.data as Record<string, unknown>;
               const schemaHasParentRequiredWhenMulti = hasParentScopedRequiredWhen(updateSchema as any);
               const parentForRow =
                   hasParentScopedReadonlyWhenInPayload(updateSchema as any, preRoWhenMulti) ||
                   schemaHasParentRequiredWhenMulti
                       ? await this.resolveMasterDetailParents(updateSchema, preRoWhenMulti, priorRows)
                       : undefined;
               // [#4977] Pre-check headers for the ADR-0113 non-regression test,
               // resolved only when the payload REPOINTS the matched rows at
               // another master (see the single-id branch for why the stored
               // row's own header is the one that question needs).
               const mdRelMulti = schemaHasParentRequiredWhenMulti ? resolveMasterDetailRelation(updateSchema as any) : null;
               const previousParentForRow =
                   mdRelMulti != null && masterIdOf(mdRelMulti.fk, preRoWhenMulti, undefined) != null
                       ? await this.resolveMasterDetailParents(updateSchema, null, priorRows)
                       : undefined;
               if (payloadHasReadonlyWhen) {
                   hookContext.input.data = stripReadonlyWhenFieldsMulti(updateSchema as any, preRoWhenMulti, priorRows, this.logger, parentForRow) as any;
                   reportDroppedFields(preRoWhenMulti, hookContext.input.data as Record<string, unknown>, 'readonly_when');
               }
               // [#2948] Same static-`readonly` write guard on the bulk path —
               // a forged read-only column in a multi-row update is dropped for
               // non-system callers (a foreign `organization_id` is additionally
               // rejected upstream by the tenant write wall, #2946).
               if (!opCtx.context?.isSystem) {
                   const preRoMulti = hookContext.input.data as Record<string, unknown>;
                   // [#8214] Same threading as the by-id branch; the multi
                   // branch still passes no `addressKey` (nothing addresses a
                   // row by key here), which is what keeps it byte-identical
                   // to #8141 in every other respect.
                   hookContext.input.data = stripReadonlyFields(updateSchema as any, preRoMulti, suppliedValues, this.logger, { preserveAudit: opCtx.context?.preserveAudit === true, strictReadonlyWrites }) as any;
                   reportDroppedFields(preRoMulti, hookContext.input.data as Record<string, unknown>, 'readonly');
               }
               // [#5126] Same refusal on the predicate path. A bulk strip is
               // "locked in ≥1 matched row ⇒ dropped for ALL", so a strict bulk
               // caller is told before N rows are written with a column missing
               // — the failure mode a bulk write makes N times larger.
               assertNoStrictDrops();
               // [#3106] Same enforcement the single-id branch runs at its
               // `evaluateValidationRules` call, applied per matched row: any
               // error-severity violation rejects the WHOLE batch before
               // `updateMany` writes anything (all-or-nothing, like the strip's
               // locked-in-any-row rule). Runs on the stripped payload, in the
               // single-id branch's order. Warning-severity violations may log
               // once per matched row — accepted. With no prior-dependent rules
               // the payload-only evaluation covers format / json_schema /
               // non-prior conditional at zero fetch cost.
               const bulkEvalUser = this.buildEvalUser(opCtx.context);
               if (rulesNeedRows) {
                   for (const row of priorRows ?? []) {
                       try {
                           evaluateValidationRules(updateSchema as any, hookContext.input.data as Record<string, unknown>, 'update', { previous: row, logger: this.logger, currentUser: bulkEvalUser, skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: updateMsgCtx, parent: parentForRow?.(row), previousParent: previousParentForRow?.(row) });
                       } catch (err) {
                           if (err instanceof ValidationError && row?.id != null) {
                               throw new ValidationError(err.fields.map((f) => ({ ...f, message: `${f.message} (record ${String(row.id)})` })));
                           }
                           throw err;
                       }
                   }
               } else {
                   // [#4977] No `parent` here, and it is not a hole: this branch
                   // is unreachable for an object that has a `requiredWhen` at
                   // all. `needsPriorRecord` is TRUE as soon as any field
                   // declares one (`fieldsNeedPrior`), so `rulesNeedRows` sends
                   // every such object down the per-row branch above, where the
                   // binding is supplied. This branch only ever runs for the
                   // rule families that never read a header.
                   evaluateValidationRules(updateSchema as any, hookContext.input.data as Record<string, unknown>, 'update', { previous: null, logger: this.logger, currentUser: bulkEvalUser, skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: updateMsgCtx });
               }
               // [#4441] The bulk call site too — a guard wired into single-id
               // writes only is still a hole one call site over (AGENTS.md
               // PD #10's own worked example, #3106).
               await this.assertReferencesResolve(
                 updateSchema, hookContext.input.data as Record<string, unknown>,
                 opCtx.data as Record<string, unknown>, opCtx.context, updateMsgCtx,
               );
               // `updateMany` presence is part of the ladder verdict resolved above.
               result = await driver.updateMany!(object, ast, hookContext.input.data as Record<string, unknown>, hookContext.input.options as any);
               isPredicateWrite = true;
           }

           hookContext.event = 'afterUpdate';
           // [#5504] Same formula hydration the insert path runs, on the same
           // terms: after both strip passes and `assertNoStrictDrops()` (which
           // throw before any driver call), before the afterUpdate dispatch.
           //
           // Only the BY-ID branch has records to hydrate. A predicate write
           // resolves to the affected-row COUNT `driver.updateMany` returns
           // (#4639) — it names no row and returns none, so there is nothing to
           // materialize and `isPredicateWrite` says so explicitly rather than
           // letting a `typeof` sniff decide. Giving a bulk update a record
           // response is a contract change, not a hydration gap.
           if (!isPredicateWrite) {
             hydrateWriteFormulas(
               updateSchema,
               Array.isArray(result) ? result : [result],
               opCtx.context,
             );
           }
           // Coerce boolean fields (SQLite 0/1 → JS bool) on the after-hook view
           // of both the new row and the prior row, so flow conditions comparing
           // `record.is_escalated`/`previous.status` against booleans behave.
           // Shallow copies — the value returned to the caller is untouched.
           hookContext.result = Array.isArray(result)
             ? result.map((r) => coerceBooleanFields(updateSchema as any, r as any))
             : coerceBooleanFields(updateSchema as any, result as any);
           if (priorRecord) hookContext.previous = coerceBooleanFields(updateSchema as any, priorRecord as any);
           if (bulkPerRowRows) {
             // [#5038] N record changes ⇒ N `afterUpdate` dispatches, each on a
             // single-record-shaped context (see `buildPerRowAfterContexts`).
             // The batch `hookContext` still carries the affected COUNT as
             // `result` and is what this call returns — the write's own contract
             // (a predicate update resolves a count, #4639) is unchanged; only
             // the hook dispatch became per row.
             //
             // Rows outer, hooks inner — the same order batch INSERT uses
             // (#2922) — so a handler observes one whole record at a time.
             // A per-row handler that throws propagates and fails the operation,
             // exactly as it does on the single-record and batch-insert paths;
             // `onError: 'log'` still swallows it per row. `onError` needed no
             // new per-row meaning: it governs a HANDLER on a record-scoped
             // context, and that is now what it always gets.
             for (const rowCtx of this.buildPerRowAfterContexts(
               object, 'afterUpdate', bulkPerRowRows, hookContext,
               hookContext.input.data as Record<string, unknown>,
             )) {
               await this.triggerHooks('afterUpdate', rowCtx);
             }
           } else {
             await this.triggerHooks('afterUpdate', hookContext);
           }

           // Roll-up: recompute parent summaries; pass priorRecord too so a child
           // that moved to a different parent updates BOTH old and new parent.
           const summaryFailures = await this.recomputeSummaries(object, result, priorRecord, opCtx.context);

           // Publish the update event under whichever contract this write can
           // honour: per-record `data.record.updated` (#4626), or the aggregate
           // `data.records.updated` for a predicate write, whose driver call
           // returns an affected count and names no row (#4639).
           if (this.realtimeService) {
             if (isPredicateWrite) {
               await this.publishBulkDataEvent('updated', object, {
                 matched: result,
                 context: opCtx.context,
               });
             } else {
               const resultId = (typeof result === 'object' && result && 'id' in result) ? (result as any).id : undefined;
               await this.publishDataEvent('updated', object, {
                 recordId: hookContext.input.id ?? resultId,
                 changes: hookContext.input.data,
                 after: result,
                 context: opCtx.context,
               });
             }
           }

           // [#7642] Same strip the create body gets, for the same reason: a
           // by-id update resolves to a RECORD, `updateData` returns it as
           // `record`, and the `beforeUpdate` companion stamp had just written
           // `__search` into the row it echoes. The issue measured four
           // surfaces and this is not one of them — it is the same column, the
           // same contract and the same response shape, and leaving it out
           // would mean POST and PATCH on one object disagreed about whether a
           // client-invisible column is visible. A predicate update resolves to
           // an affected-row COUNT (#4639), which the strip skips as a
           // non-object.
           stripSearchCompanion(hookContext.result);
           // [#7728] …and the same for `internal` fields, on the identical
           // argument. This is not a hypothetical symmetry: `sys_api_key` is
           // one of the few identity objects with a write verb open
           // (`apiMethods: ['get','list','update']`, #7727) and its declared
           // revoke/restore row actions PATCH it, so before this line a client
           // revoking a key got the stored hash back in the 200 body — measured,
           // and the fourth leaking surface on the object #7728 was filed
           // against. A predicate update resolves to an affected-row COUNT
           // (#4639), which the omit skips as a non-object.
           this.omitInternalFields(object, hookContext.result);
           // The record IS updated; a summary that could not recompute after
           // retries must surface, not stay silent (framework#3147).
           if (summaryFailures.length > 0) throw new SummaryRecomputeError(summaryFailures, hookContext.result);
           return hookContext.result;
       } catch (e) {
          this.logger.error('Update operation failed', e as Error, { object });
          throw e;
       }
     });

     return opCtx.result;
  }

  /**
   * Can the by-id delete of `object` and its whole cascade run as ONE unit of
   * work? [#7413]
   *
   * `delete()`'s by-id branch ran `cascadeDeleteRelations` and then
   * `driver.delete` with no transaction around either, and the cascade
   * RE-ENTERS `this.delete()` / `this.update()` per dependent row — so every
   * child committed on its own. A refusal partway (the `restrict` branch below,
   * a child's permission check, a later child's `beforeDelete` hook) left an
   * arbitrary PREFIX of the children deleted while the caller received 409/403
   * and reasonably read it as "nothing happened". #4620 already ruled the
   * principle for the batch path — *atomic honoured for real, or refused; a
   * partial delete has no natural undo* — and this path never got it.
   *
   * Three verdicts, because "wrap it in a transaction" is only unconditionally
   * right in one of them:
   *
   * - **`'none'`** — no registered object declares a `master_detail`/`lookup`
   *   pointing at `object`, so `cascadeDeleteRelations` cannot write anything
   *   and there is no multi-write unit to make atomic. The delete runs exactly
   *   as it did before this card: one `driver.delete`, no transaction opened,
   *   no degrade warning. A plain non-cascade delete is the CONTROL for this
   *   change and must stay byte-identical.
   * - **`'split'`** — dependents exist, but at least one participant (the
   *   parent or a transitively-referencing child) resolves to a driver other
   *   than the engine's DEFAULT one. `transaction()` opens on the default
   *   driver and covers that connection alone (ADR-0119 D1 — no two-phase
   *   commit on `IDataDriver`), so opening one here would not buy atomicity; it
   *   would REFUSE the cascade outright, because `enforceTransactionOrigin`
   *   throws {@link CrossDatasourceTransactionWriteError} for a business write
   *   inside a transaction that does not cover it (#5351 / #5696 point 2, the
   *   2026-08-06 ruling). A cross-datasource cascade delete works today, and
   *   turning it into a hard refusal is a strictly worse answer than the
   *   non-atomic one it has always had. So it keeps that answer and says so
   *   once — see {@link warnCascadeNotAtomic}.
   * - **`'atomic'`** — dependents exist and every participant sits on the
   *   default driver. This is the shape the card measured and the shape
   *   virtually every deployment has; the caller gets one unit of work.
   *
   * A pure registry walk — no I/O, no driver call. It answers from the SCHEMA
   * (which objects *could* be reached), never from row counts, so the verdict
   * is stable for a given schema and costs nothing on the common path. The walk
   * is the transitive closure of "objects referencing X" because a cascade
   * recurses into each child's own cascade; it is bounded by
   * {@link ObjectQL.MAX_CASCADE_DEPTH}, the ceiling the recursion itself carries.
   *
   * Fails toward `'split'` on anything it cannot resolve (an unregistered
   * reference, a `getDriver` throw): the degrade is today's behaviour, while a
   * wrong `'atomic'` would manufacture the refusal this verdict exists to
   * avoid.
   */
  private planCascadeAtomicity(object: string): 'none' | 'split' | 'atomic' {
    let objects: ServiceObject[];
    try {
      objects = this._registry.getAllObjects();
    } catch {
      // Same swallow as `cascadeDeleteRelations` — an unreadable registry
      // cascades nothing, so there is nothing to make atomic.
      return 'none';
    }

    // Which objects reference `name` via a relation the cascade would follow.
    // The `master_detail`/`lookup` + `reference` test is `cascadeDeleteRelations`'s
    // own, so the two cannot disagree about who participates. `restrict` fields
    // are INCLUDED deliberately: a restrict refusal is the card's core repro,
    // and it must roll back the siblings already cascaded before it.
    const referencing = (name: string): string[] => {
      const out: string[] = [];
      for (const child of objects) {
        const childName = (child as any)?.name as string | undefined;
        const fields = (child as any)?.fields as Record<string, any> | undefined;
        if (!childName || !fields) continue;
        for (const fdef of Object.values(fields)) {
          if (!fdef || (fdef.type !== 'master_detail' && fdef.type !== 'lookup')) continue;
          const ref = fdef.reference;
          if (!ref) continue;
          let resolvedRef: string | undefined;
          try { resolvedRef = this.resolveObjectName(ref); } catch { resolvedRef = undefined; }
          if (ref !== name && resolvedRef !== name) continue;
          out.push(childName);
          break;
        }
      }
      return out;
    };

    const firstLevel = referencing(object);
    if (firstLevel.length === 0) return 'none';

    const defaultDriver = this.defaultDriver ? this.drivers.get(this.defaultDriver) : undefined;
    if (!defaultDriver) return 'split';
    const onDefaultDriver = (name: string): boolean => {
      try { return this.getDriver(name) === defaultDriver; } catch { return false; }
    };

    if (!onDefaultDriver(object)) return 'split';
    const seen = new Set<string>([object]);
    let frontier = firstLevel;
    for (let depth = 0; depth < ObjectQL.MAX_CASCADE_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const name of frontier) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (!onDefaultDriver(name)) return 'split';
        next.push(...referencing(name));
      }
      frontier = next;
    }
    return 'atomic';
  }

  /**
   * The `'split'` verdict of {@link planCascadeAtomicity}, said out loud — once
   * per object per engine instance (#7413).
   *
   * Same reasoning as {@link warnTransactionUnsupported}, which this mirrors
   * deliberately: a capability is not available, so the delete keeps the
   * non-atomic behaviour it has always had. `warn`, not `error` — at this
   * moment nothing claimed-persisted has failed to land; what is missing is the
   * ability to undo the cascade if a later child refuses. Escalating it would
   * train readers to skim `error`, which AGENTS.md names as the mirror-image
   * mistake.
   */
  private warnCascadeNotAtomic(object: string): void {
    if (this.cascadeNotAtomicReported.has(object)) return;
    this.cascadeNotAtomicReported.add(object);
    this.logger.warn(
      `Cascade delete of '${object}' cannot run as one unit of work: the cascade reaches an object routed ` +
        `to a datasource other than the default one ('${this.defaultDriver ?? '<none>'}'), and a transaction ` +
        "covers one driver's connection only (ADR-0119 D1 — no two-phase commit). The cascade therefore runs " +
        'UNWRAPPED, exactly as it did before #7413: if a later dependent refuses the delete, the rows already ' +
        'removed stay removed while the call rejects. Route the cascading objects to one datasource to get the ' +
        'atomic path. Reported once per object per engine instance.',
      { object, defaultDatasource: this.defaultDriver ?? undefined },
    );
  }

  /**
   * Apply referential delete behavior for relations pointing AT this record,
   * before it is removed. For every registered object with a `master_detail`
   * or `lookup` field referencing `object`, honor the field's `deleteBehavior`:
   *   - `cascade`  → delete the dependent rows (recursively, so grandchildren
   *                  are handled by each child's own delete),
   *   - `set_null` → clear the foreign key,
   *   - `restrict` → refuse the delete when dependents exist.
   * `master_detail` defaults to `cascade` (the parent owns the child
   * lifecycle); `lookup` defaults to `set_null` — except a `set_null` default
   * on a REQUIRED lookup escalates to `restrict` (you can't null a NOT NULL
   * FK; restricting with a clear dependent-count message beats a misleading
   * "<field> is required" 400 from the child). Only runs for single-id
   * deletes — multi/predicate deletes skip cascade (logged).
   */
  private async cascadeDeleteRelations(
    object: string,
    id: string | number,
    context?: ExecutionContext,
    depth = 0,
  ): Promise<void> {
    if (id == null || depth >= ObjectQL.MAX_CASCADE_DEPTH) return;
    let objects: ServiceObject[];
    try {
      objects = this._registry.getAllObjects();
    } catch {
      return;
    }
    for (const child of objects) {
      const childName = (child as any)?.name as string | undefined;
      const fields = (child as any)?.fields as Record<string, any> | undefined;
      if (!childName || !fields) continue;
      for (const [fieldName, fdef] of Object.entries(fields)) {
        if (!fdef || (fdef.type !== 'master_detail' && fdef.type !== 'lookup')) continue;
        const ref = fdef.reference;
        if (!ref) continue;
        // Match the target object by raw or resolved name.
        let resolvedRef: string | undefined;
        try { resolvedRef = this.resolveObjectName(ref); } catch { resolvedRef = undefined; }
        if (ref !== object && resolvedRef !== object) continue;

        // A master-detail parent owns its children: cascade by default (the
        // child FK is typically required, so set_null would be invalid). Only
        // an explicit `restrict` deviates. A plain lookup honors its
        // configured deleteBehavior (default set_null).
        let behavior: string =
          fdef.type === 'master_detail'
            ? (fdef.deleteBehavior === 'restrict' ? 'restrict' : 'cascade')
            : (fdef.deleteBehavior || 'set_null');

        // A REQUIRED foreign key cannot be nulled — set_null would issue an
        // UPDATE clearing the FK, which the child's required-field validator
        // rejects with a misleading "<field> is required" 400 (the field isn't
        // even on the object being deleted). That's a contradiction, not the
        // author's intent: a required FK means the child can't exist detached,
        // so deleting the parent must be RESTRICTed (SQL's default for a
        // NOT NULL FK). Authors who want the children gone set
        // deleteBehavior:'cascade' explicitly. This only escalates the
        // *defaulted* set_null; an explicit cascade/restrict is untouched.
        if (behavior === 'set_null' && fdef.required === true) {
          behavior = 'restrict';
        }

        let dependents: any[];
        try {
          dependents = await this.find(childName, { where: { [fieldName]: id }, context } as any);
        } catch {
          continue;
        }
        if (!dependents || dependents.length === 0) continue;

        if (behavior === 'restrict') {
          // [#7307] TWO messages, two audiences — because this error has two
          // and they were sharing one string.
          //
          // `message` is what a BUSINESS USER reads: REST ships it verbatim as
          // `body.error` in the flat 409 envelope (`mapDataError`), and Console
          // renders that as-is in a toast. It was composed English-only with the
          // API names concatenated in and a metadata-authoring instruction on
          // the end, so an operator deleting a 部门 in a fully Chinese app got an
          // English sentence naming two tables and a column they have never
          // seen, ending in advice only a developer can act on. It is now
          // rendered through the operation-message catalog in the caller's
          // locale against resolved LABELS — the same fix #3957 made one layer
          // down for field constraints, reached from the operation side.
          //
          // `developerMessage` is what the DEVELOPER reads, and is the previous
          // sentence unchanged, byte for byte: English, API names, and the
          // `deleteBehavior:'cascade'` hint — which is correct and useful, and
          // is not lost, it is addressed. It rides the structured half of the
          // envelope alongside `dependentObject` / `dependentCount`, which
          // already carry API names, so it discloses nothing new; no
          // user-facing surface reads it.
          //
          // The wire code does NOT split: one `DELETE_RESTRICTED` (ADR-0112),
          // two SENTENCES, exactly as the field catalog splits a message key
          // without splitting `FieldErrorCode`.
          const required = fdef.deleteBehavior !== 'restrict' && fdef.required === true;
          const msgCtx = this.validationMessageContext(object, context);
          const parent = objects.find((o) => (o as any)?.name === object);
          const err: any = new Error(
            renderOperationMessage(
              {
                messageKey: required ? 'delete_restricted_required' : 'delete_restricted',
                params: {
                  object: this.objectDisplayLabel(object, (parent as any)?.label, msgCtx),
                  dependentObject: this.objectDisplayLabel(childName, (child as any)?.label, msgCtx),
                  field: resolveFieldLabel(fieldName, fdef, { ...msgCtx, objectName: childName }),
                  count: dependents.length,
                },
              },
              { locale: msgCtx.locale, translate: msgCtx.translate },
            ),
          );
          err.developerMessage =
            `Cannot delete ${object} (${id}): ${dependents.length} dependent ${childName} record(s) reference it via ${fieldName}` +
            `${required ? ` (${fieldName} is required, so it cannot be cleared)` : ''}. ` +
            `Delete or reassign them first, or set deleteBehavior:'cascade' on ${childName}.${fieldName}.`;
          err.code = 'DELETE_RESTRICTED';
          err.status = 409;
          err.object = object;
          err.dependentObject = childName;
          err.dependentCount = dependents.length;
          throw err;
        }

        for (const dep of dependents) {
          const depId = dep?.id;
          if (depId == null) continue;
          if (behavior === 'cascade') {
            // Recurse via the public delete so the child's own cascade,
            // hooks and events fire.
            await this.delete(childName, { where: { id: depId }, context } as any);
          } else {
            // [#3023] Clear the FK as an engine-internal referential-integrity
            // write, tagged so plugin-security's ownership-anchor guard (#3004)
            // treats an `owner_id = null` cascade as integrity maintenance, not
            // a user-initiated disown — otherwise deleting the referenced record
            // trips the transfer guard and aborts the cascade mid-way. Marker
            // rides a server-DERIVED context (set here, never from client input
            // — same trust model as `__expandRead`), so it cannot be forged from
            // a request to bypass the guard on an ordinary write.
            const referentialCtx = { ...(context ?? {}), __referentialFieldClear: true } as ExecutionContext;
            await this.update(childName, { id: depId, [fieldName]: null }, { context: referentialCtx } as any);
          }
        }
      }
    }
  }

  async delete(object: string, options?: EngineDeleteOptions): Promise<any> {
    object = this.resolveObjectName(object);
    this.logger.debug('Delete operation starting', { object });
    this.assertWriteAllowed(object, 'delete');
    const driver = this.getDriver(object);
    // [#5351/#5696] Same-origin gate: refuse a cross-driver BUSINESS write,
    // carve an append-only system ledger out of the transaction. Before any
    // hook, default or validation runs, so a refusal costs nothing.
    this.enforceTransactionOrigin(object, driver, 'delete');

    // Fold the `filter` alias into `where` first — same reasoning as update()
    // above (#4346): unfolded, a `multi: true` delete with `{ filter }` had no
    // predicate on its AST and emptied the table.
    options = foldEngineOptionAliases(object, 'delete', options, ENGINE_WHERE_SLOTS);
    rejectUnknownEngineOptions(object, 'delete', options, ENGINE_DELETE_OPTION_KEYS);
    // [#5158] Same ordering reason as update(): the dispatch decision below
    // reads `where.id`, which an unlowered array never carries.
    options = lowerWhereFilterArray(object, 'delete', options, this._registry.getObject(object));

    // Expand `{filter-placeholder}` values before the id is extracted — same
    // reasoning as update() above (#3810).
    options = this.withResolvedWhere(options);

    // Extract ID logic mirroring update(): only a SCALAR `where.id` means
    // "delete one row by primary key". An operator object ({ $in: [...] }, …)
    // is a multi-row predicate — treating it as an id would bind the object
    // literally (driver.delete(object, {$in:[…]})) and both skip the #2982 AST
    // seeding below AND bypass the by-id RLS pre-image check. Leave `id`
    // undefined so the call routes to deleteMany with the scoped AST.
    //
    // [#4550] The decision lives in `engine-delete-dispatch.ts` so the fake
    // engines that stand in for this method import it instead of re-deriving
    // it. #4434 shipped a dead REST route green because plugin-sharing's fake
    // accepted the one shape the `reject` branch below refuses; a double that
    // reads THIS predicate cannot be looser than this method.
    const dispatch = resolveEngineDeleteDispatch(options as EngineDeleteDispatchInput | undefined);
    const id: any = dispatch.kind === 'by-id' ? dispatch.id : undefined;

    const opCtx: OperationContext = {
      object,
      operation: 'delete',
      options,
      context: options?.context,
    };

    // [#2982] Same seam as update: a no-single-id delete routes to
    // `driver.deleteMany` with an AST that used to be rebuilt from
    // `options.where` after the middleware chain, discarding any row-scoping a
    // middleware composed onto `opCtx.ast`. Seed the caller's predicate before
    // the chain, keyed on the SAME falsy-`id` test the multi branch dispatches
    // on; the multi branch consumes the composed result.
    if (!id) {
      opCtx.ast = { object, ...(options?.where !== undefined ? { where: options.where } : {}) } as QueryAST;
    }

    await this.executeWithMiddleware(opCtx, async () => {
      const hookContext: HookContext = {
          object,
          event: 'beforeDelete',
          input: { id, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
      };

      // [#5272] The pre-image of the row this delete is about to remove.
      //
      // `HookContext.previous` is documented — in the spec, since it was
      // written — as "the state of the record BEFORE the operation (for
      // update/delete)", and `update()` has bound it all along. `delete()`
      // never did: `previous` was `undefined` in `beforeDelete` AND in
      // `afterDelete`, so a legal, contract-shaped delete-side transition
      // condition (`previous.status == "done"`) was unevaluable — and since
      // #4775 unevaluable REJECTS the operation. Worse, it was reported
      // through the generic branch, which reads as "you misspelled a key"
      // when the key was fine and the engine simply never bound it (#5037's
      // shape, one path over).
      //
      // #5038 made the asymmetry visible from the other side: a predicate
      // bulk delete already binds each doomed row's own pre-image on its
      // per-row `afterDelete`, so the SINGLE-record path was strictly worse
      // than the bulk one — the exact inversion #4800/#4862 ruled against.
      //
      // Demand-driven, like `update()`'s `priorRecord`: read only when
      // something on this object actually consumes it —
      //   * a delete-side hook, EITHER phase (its `condition` may read
      //     `previous`; its handler — plugin-audit, the record-change
      //     trigger — reads `ctx.previous` directly);
      //   * a roll-up summary aggregating this object, which needs the
      //     doomed row's FK value to find the parent to recompute.
      // Those two used to be separate reads at separate times (the summary
      // one fetched only after `beforeDelete` had run); they are ONE read
      // now — and a RAW driver read, which is exactly what `update()`
      // already hands `recomputeSummaries` as its `previous` argument, so
      // the two write paths now agree on what a pre-image is.
      //
      // `needsPriorRecord(schema)` is deliberately NOT part of this gate
      // even though `update()`'s twin carries it: object validation rules
      // are evaluated on insert/update only — `delete()` evaluates none —
      // so including it would buy a read with no reader.
      //
      // Read BEFORE `beforeDelete` fires. A delete's `before` phase is the
      // one that has nothing else to look at (its `input` carries an id and
      // no data), and the pre-image has to be taken before the row is gone
      // either way, so a single read serves both phases.
      //
      // [#5574] The same read now serves the PER-ROW `beforeDelete` dispatch on
      // the predicate path — see the pre-phase below. `delete()` was already
      // the right shape here; what changed is that the predicate branch grew
      // the same discipline the by-id branch has had since #5272.
      //
      // [#5929] The gate's THREE terms, unchanged by that card and enumerated
      // here because it had to enumerate them to answer it:
      //   1. `hasHooksFor('beforeDelete', object)`
      //   2. `hasHooksFor('afterDelete', object)`
      //   3. `getSummaryDescriptors(object).length > 0`
      // No validation term, deliberately — see `needsPriorRecord` above.
      //
      // What #5929 changed is not this expression but what term 1 MEANS. Until
      // then, objectql's own `ObjectQLPlugin` registered a builtin
      // `sys_fetch_previous_delete` on `beforeDelete` with `object: '*'`, so on
      // every kernel-hosted engine term 1 was true for every object and the
      // per-object skip this gate exists to perform could never happen. The
      // builtin's only remaining effect WAS holding this gate open: the read
      // below binds `previous` before `beforeDelete` dispatches, so its own
      // `!ctx.previous` guard was already unreachable. Retiring it (plugin.ts,
      // ADR-0049 enforce-or-remove) makes term 1 an honest question.
      //
      // ⚠️ Honest is not the same as usually-false, and the difference is worth
      // knowing before anyone reads a skip into a production trace. Every
      // delete-phase hook below registers with NO `object` — global — so each
      // holds term 1 or term 2 open for every object on a kernel that loads it:
      //
      //   * `plugin-auth`   identity-write-guard  beforeDelete  (filters by
      //                     `isManaged(ctx.object)` inside the handler)
      //   * `plugin-sharing` record-share-cascade  before+afterDelete (filters
      //                     by `targets(objectName)` inside the handler)
      //   * `service-storage` file-reference-lifecycle before+afterDelete
      //                     (filters by `activeFileFields(object)` inside)
      //   * `plugin-audit`  writeAudit  afterDelete only — #6656 retired
      //                     `captureBefore`, which was its `beforeDelete` half,
      //                     so it holds term 2 open and no longer term 1;
      //                     global MINUS `excludeObjects: AUDIT_EXCLUDED_OBJECTS`
      //                     (#5860) — the one that narrows at the ENGINE face,
      //                     so `hookMatchesObject` can subtract it and an
      //                     excluded object really does skip this read.
      //
      // The first three are real handlers with real work, merely deciding their
      // own applicability at dispatch time rather than at registration time;
      // this gate answering "yes" for them is the gate WORKING, not a second
      // instance of the #5929 defect. Narrowing any of them to the objects it
      // actually serves — plugin-audit's `excludeObjects` face is the worked
      // example — is what would convert them into skips, and that is each
      // package's own card, not this one's.
      // [#7867] ⚠️ RETIRED — the three-term `wantsPreImage` gate the paragraphs
      // above describe is GONE, and the paragraphs are kept because what they
      // record (which registrants hold which term open, and why an honest gate
      // is not the same as a usually-false one) is still the reason the removal
      // costs nothing measurable.
      //
      // It asked "does anything CONSUME the pre-image?" and skipped the read
      // when nothing did. Existence is a consumer it never counted — and it is
      // the one consumer EVERY by-id delete has, because a delete against an id
      // that names no row must answer 404 rather than run. So the by-id branch
      // below reads the pre-image unconditionally and gates on it; the
      // predicate branch reads its doomed rows under its own `perRowBefore/
      // AfterHooks` gate, which is untouched. On any kernel loading the global
      // registrants enumerated above, term 1 or 2 was already true for every
      // object, so this skipped nothing there anyway; the read becomes
      // genuinely new only for a bare embedder whose object has no delete-side
      // hook and no roll-up — and that embedder is buying a 404 it did not have.
      //
      // ⛔ Do not reintroduce it as a guard around the by-id read. A gate on
      // whether to LOOK is not compatible with a rule about what to do when
      // nothing is there. See `update()`'s twin.
      //
      // [#7933] The first three entries were carried here UNVERIFIED when
      // #7707 corrected the `plugin-audit` one, which was wrong on BOTH halves
      // — hook name and term. All three have since been read against the
      // function that binds them — `registerIdentityWriteGuard`,
      // `bindRecordShareCascade`, `installFileReferenceHooks` — and all three
      // match what is claimed above: same events, same object-less
      // registration, same in-handler filter. Nothing above needed changing.
      // That audit is what the retirement note's "term 1 or 2 was already true
      // for every object" stands on, so it is recorded here rather than left
      // in a closed issue: the enumeration outlived the gate it was written
      // for, and it is now load-bearing for a different claim than the one it
      // was written to support.
      const deleteSchema = this._registry.getObject(object);
      // `buildDriverOptions` is what carries the open transaction and the
      // tenant scope onto a raw driver read. Skipping it here would read
      // outside this write's transaction and across the tenant boundary —
      // `update()`'s prior read passes the same bag for the same reason.
      const readPreImage = async (targetId: unknown): Promise<Record<string, unknown> | null> => {
        const preAst: QueryAST = { object, where: { id: targetId }, limit: 1 };
        const preOpts = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any);
        return (await driver.findOne(object, preAst, preOpts)) as Record<string, unknown> | null;
      };
      const bindPreImage = (row: Record<string, unknown> | null): void => {
        // Never fabricate: a row that is not there leaves `previous` UNBOUND
        // rather than `{}`/`null`, so a condition reading it faults loudly
        // instead of answering for a record nobody read (#4649/#4775).
        hookContext.previous = row ? (coerceBooleanFields(deleteSchema as any, row as any) as any) : undefined;
      };
      let priorRecord: Record<string, unknown> | null = null;
      // [#5038] Matched rows for the per-row `afterDelete` dispatch — see the
      // twin in update(). A bulk delete is N record changes too, so a
      // `record-after-delete` flow must see each deleted row rather than one
      // context that names none of them.
      let bulkPerRowRows: Record<string, unknown>[] | null = null;

      // [#5574] The dispatch ladder, resolved BEFORE the before phase — see
      // update()'s twin for the full reasoning. Keyed on the SAME falsy-`id`
      // test the #2982 AST seed above uses.
      const isByIdDelete = Boolean(id);
      const isPredicatePath = !isByIdDelete && Boolean(options?.multi) && typeof driver.deleteMany === 'function';
      if (!isByIdDelete && !isPredicatePath) {
        // [#4550] The `reject` verdict of resolveEngineDeleteDispatch. It used
        // to be re-asked after the before phase because a hook could still bind
        // the id; with the ladder resolved first there is no such conversion.
        throw new Error(ENGINE_DELETE_REJECT_MESSAGE);
      }

      // [#6966] See update()'s twin — same rule, same single binding point.
      hookContext.dispatch = {
        mode: isPredicatePath ? 'per-row' : 'record',
        index: 0,
        scope: {},
      };

      if (isByIdDelete) {
        // [#7867] Read first, then GATE — the twin of `update()`'s, and #5138's
        // own record names `delete` as the worst of the three when the gate was
        // missing: "the delete ran and the answer was `200 { deleted: true }`
        // for any string in the path, so a typo'd id, an already-deleted row
        // and a real deletion were indistinguishable" — the shape #4435 removed
        // from `protocol.deleteData` and #5138 removed from `callData`, still
        // live here on the path an action body's `.delete()` actually takes.
        //
        // The pre-image is the only honest place to ask. `IDataDriver.delete`
        // does declare `Promise<boolean>` ("true if deleted, false if not
        // found"), so the answer exists downstream — but downstream is AFTER
        // `beforeDelete` has dispatched and after `cascadeDeleteRelations` has
        // run, i.e. after handlers have fired and children have been touched
        // for a parent that was never there. `IDataEngine.delete` also declares
        // `Promise<any>` and passes its driver's result through the hook chain,
        // so testing it for `=== false` here would read a signal this layer's
        // contract does not promise — #5138's argument, unchanged.
        priorRecord = await readPreImage(id);
        if (!priorRecord) throw recordNotFoundError(object, id);
        // Bound unconditionally now that the row is proven present.
        // `bindPreImage`'s never-fabricate rule (#4649/#4775) is unchanged and
        // still the reason the binding goes through it rather than around it.
        bindPreImage(priorRecord);
        await this.triggerHooks('beforeDelete', hookContext);
        // [#6752] The retired lever, refused — the `update()` twin's check,
        // verbatim, because the rule is now ONE rule: a by-id target is
        // immutable in a `before*` handler.
        //
        // Both halves of it used to be answered separately here. CLEARING the
        // id was already refused (ADR-0058 Amendment II.1): it worked by
        // falling through to the predicate branch, and the ladder is now
        // resolved before any handler runs, so there is no ladder left to
        // re-enter. REBINDING to another id was still HONOURED, by re-reading
        // the new target's pre-image and rebinding `previous` (#5272) so
        // nothing stale reached `afterDelete` or the summary recompute.
        //
        // The 2026-08-09 ruling on #6752 retires that second half. #5272's
        // mechanism was internally correct — that is not what was weighed. What
        // was weighed: the measured compatibility cost is zero (no consumer in
        // the repository repoints), one rule across both verbs beats two
        // individually-correct rules an author has to memorize, and a hook that
        // silently redirects WHICH ROW GETS DELETED is a top-grade footgun for
        // authored — especially AI-authored — handlers. Correctness of the
        // mechanism does not justify the surface.
        //
        // ⛔ Route 3 (growing the same re-resolution for `update()`) stays
        // excluded by #5574's ruling: "do not silently pick re-resolution
        // instead". The alignment goes the other way, and this is that edit.
        //
        // The re-read that used to sit here is GONE, not merely bypassed: its
        // guard was `input.id !== id && input.id`, which is exactly the case
        // this refusal now throws on, so it became unreachable. `readPreImage`
        // survives for the pre-dispatch read above — the only read left. A
        // handler writing back the SAME id is untouched, as on `update()`.
        if (hookContext.input.id !== id) {
          throw new HookTargetRebindError({
            object, event: 'beforeDelete', path: 'by-id',
            expectedId: id, observedId: hookContext.input.id,
          });
        }
      } else {
        // [#2982] Consume the middleware-composed AST seeded above so the
        // injected row-scoping binds every read AND the delete. Fail CLOSED if
        // it is absent rather than rebuilding an unscoped `{ object, where }`
        // (AGENTS.md PD #12).
        const ast = opCtx.ast;
        if (!ast) {
          throw new Error(
            `[Security] Refusing bulk delete on '${object}': row-scoping AST was not seeded ` +
              `(the predicate branch was reached without the #2982 seed).`,
          );
        }
        // [#5038/#5574] Read the doomed rows ONCE, before they are gone — the
        // only moment their pre-image exists — and serve BOTH phases from it
        // (D7). Gated on this object actually having delete-side hooks, so a
        // bulk delete with none pays for no read.
        const perRowBeforeHooks = this.hasHooksFor('beforeDelete', object);
        const perRowAfterHooks = this.hasHooksFor('afterDelete', object);
        if (perRowBeforeHooks || perRowAfterHooks) {
          const preOpts = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any);
          const doomed = (await driver.find(object, ast, preOpts) as Record<string, unknown>[]) ?? [];
          // [D6] One ceiling, both phases, BEFORE the first per-row dispatch
          // and before the driver call.
          this.assertBulkPerRowHookBudget(
            object, perRowBeforeHooks ? 'beforeDelete' : 'afterDelete', doomed.length,
          );
          if (perRowAfterHooks) bulkPerRowRows = doomed;
          // [D1] Zero matched rows is zero dispatches.
          if (perRowBeforeHooks && doomed.length > 0) {
            await this.dispatchPerRowBeforeHooks(object, 'beforeDelete', doomed, hookContext);
          }
        }
      }

      hookContext.input.options = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any);

      try {
          let result;
          // [#4639] See update()'s twin: recorded at the branch that chose the
          // driver call, not inferred later from a missing id.
          let isPredicateWrite = false;
          if (isByIdDelete) {
              // Honor referential delete behavior (cascade/set_null/restrict)
              // for relations pointing at this record before removing it.
              //
              // [#7413] ONE UNIT OF WORK — the cascade and the parent's own row
              // removal, or neither. These two statements used to run bare, and
              // the cascade re-enters `this.delete()`/`this.update()` per
              // dependent, each committing as it executed; a refusal partway
              // (the `restrict` branch, a child's permission check, a later
              // child's `beforeDelete` hook) stranded an arbitrary prefix of the
              // children deleted while the caller got 409/403 and read it as
              // "nothing happened". #4620's changeset already ruled the shape
              // for the batch path: atomic honoured for real, or refused — a
              // partial delete has no natural undo.
              //
              // The recursion COMPOSES rather than deadlocking because
              // `transaction()` publishes its handle into the ambient `txStore`
              // and joins an already-open one (ADR-0067 D2 / #5696): the child
              // `delete()` calls below receive `trxContext` explicitly AND see
              // the ambient entry, so a grandchild's own wrap JOINS with
              // `owned: false` instead of opening a second driver transaction on
              // a second connection.
              //
              // The driver options are rebuilt INSIDE the callback on purpose:
              // the ones computed above were built before any transaction
              // existed, so they carry no handle and the parent's own
              // `driver.delete` would execute outside the very transaction
              // wrapping its cascade. `buildDriverOptions` only fills keys that
              // are still `undefined`, so re-running it adds the handle and
              // changes nothing else.
              const runByIdDelete = async (writeContext?: ExecutionContext) => {
                await this.cascadeDeleteRelations(object, hookContext.input.id as string | number, writeContext);
                return await driver.delete(
                  object,
                  hookContext.input.id as string,
                  this.buildDriverOptions(object, writeContext, hookContext.input.options as any),
                );
              };
              // WHEN to open one is `planCascadeAtomicity`'s call — see there.
              // `'none'` (nothing references this object) keeps the pre-#7413
              // path exactly, so a plain non-cascade delete opens no
              // transaction and emits no degrade warning; `'split'` keeps it
              // too, because a transaction on the default driver cannot cover a
              // cross-datasource cascade and would refuse it outright.
              const plan = this.planCascadeAtomicity(object);
              if (plan === 'atomic') {
                  // No `require: true` — see the changeset. `delete()` never
                  // asked for atomicity, so it must not start REFUSING on a
                  // runtime that cannot roll back; `transaction()`'s declared
                  // degrade (ADR-0119 D1) already warns once per driver (#4619).
                  result = await this.transaction(
                    async (trxCtx: any) => await runByIdDelete(trxCtx as ExecutionContext),
                    opCtx.context,
                  );
              } else {
                  if (plan === 'split') this.warnCascadeNotAtomic(object);
                  result = await runByIdDelete(opCtx.context);
              }
          } else {
               // [#2982] The AST asserted present and already used for the
               // pre-phase row read above.
               // `deleteMany` presence is part of the ladder verdict resolved above.
               result = await driver.deleteMany!(object, opCtx.ast!, hookContext.input.options as any);
               isPredicateWrite = true;
          }

          hookContext.event = 'afterDelete';
          hookContext.result = result;
          if (bulkPerRowRows) {
            // [#5038] One dispatch per deleted row. No payload is passed, so
            // each context carries `previous` = the deleted row and no
            // `result`: after a delete there IS no post-state, and every
            // consumer (hook `condition`, the record-change trigger, the audit
            // diff) already falls back to the pre-image for `record` on a
            // delete-shaped context.
            for (const rowCtx of this.buildPerRowAfterContexts(
              object, 'afterDelete', bulkPerRowRows, hookContext,
            )) {
              await this.triggerHooks('afterDelete', rowCtx);
            }
          } else {
            await this.triggerHooks('afterDelete', hookContext);
          }

          // Roll-up: recompute the parent summary now that the child is gone,
          // from the row's FK values captured BEFORE deletion. [#5272] That
          // capture is now the same single pre-image read `previous` rides on
          // (it used to be its own later `findOne`), which is also what
          // `update()` passes here.
          const summaryFailures = priorRecord
            ? await this.recomputeSummaries(object, null, priorRecord, opCtx.context)
            : [];

          // Same split as update(): per-record `data.record.deleted` (#4626),
          // or the aggregate `data.records.deleted` when the delete was by
          // predicate (#4639).
          if (this.realtimeService) {
            if (isPredicateWrite) {
              await this.publishBulkDataEvent('deleted', object, {
                matched: result,
                context: opCtx.context,
              });
            } else {
              const resultId = (typeof result === 'object' && result && 'id' in result) ? (result as any).id : undefined;
              await this.publishDataEvent('deleted', object, {
                recordId: hookContext.input.id ?? resultId,
                context: opCtx.context,
              });
            }
          }

          // The record IS deleted; a summary that could not recompute after
          // retries must surface, not stay silent (framework#3147).
          if (summaryFailures.length > 0) throw new SummaryRecomputeError(summaryFailures, hookContext.result);
          return hookContext.result;
      } catch (e) {
          // [#7307] `Error.message` is now the END USER's localized sentence for
          // a `DELETE_RESTRICTED`, and the logger serializes only `message` +
          // `stack` — so without this the operator-facing half (API names, the
          // `deleteBehavior:'cascade'` remedy) would reach no channel at all,
          // and the server log of a zh-CN deployment would read in Chinese. An
          // error that carries no `developerMessage` logs exactly as before.
          const devDetail = (e as any)?.developerMessage;
          this.logger.error('Delete operation failed', e as Error, {
            object,
            ...(typeof devDetail === 'string' && devDetail.length > 0 ? { developerMessage: devDetail } : {}),
          });
          throw e;
      }
    });

    return opCtx.result;
  }

  async count(object: string, query?: EngineCountOptions, options?: EngineReadOptions): Promise<number> {
     object = this.resolveObjectName(object);
     // Fold the `filter` alias into `where` (#4346) — the AST below reads
     // `query.where` only, so an unfolded `{ filter }` counted the whole table.
     query = foldEngineOptionAliases(object, 'count', query, ENGINE_WHERE_SLOTS);
     rejectUnknownEngineOptions(object, 'count', query, ENGINE_COUNT_OPTION_KEYS);
     query = lowerWhereFilterArray(object, 'count', query, this._registry.getObject(object));
     const driver = this.getDriver(object);

     // The AST must ride on the opCtx so the security/sharing middlewares can
     // inject their read filters (RLS, OWD/sharing scope) into `ast.where` —
     // exactly like find(). Building it locally inside the executor (#2737)
     // discarded every injected filter: `total` counted the RAW table while
     // `records` were scoped, leaking invisible-row counts and breaking
     // pagination.
     const opCtx: OperationContext = {
       object,
       operation: 'count',
       ast: { object, where: query?.where },
       options: query,
       context: mergeReadContext(query?.context, options?.context),
     };
     this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context);
     // The caller's own `where`, placeholders expanded — captured BEFORE the
     // middleware chain scopes `opCtx.ast.where`, so the find() fallback below
     // still passes the unscoped filter (find() applies the read filters itself).
     const callerWhere = (opCtx.ast as QueryAST).where;

     await this.executeWithMiddleware(opCtx, async () => {
       const countOpts = this.buildDriverOptions(object, opCtx.context);
       if (driver.count) {
           return driver.count(object, opCtx.ast as QueryAST, countOpts);
       }
       // Fallback to find().length — find() applies the read filters itself,
       // so pass the caller's original where, not the already-scoped ast.
       const res = await this.find(object, { where: callerWhere, fields: ['id'], context: opCtx.context });
       return res.length;
     });

     return opCtx.result as number;
  }

  /**
   * Fail-closed guard (ADR-0100 / #3171 / #7922): refuse to aggregate over a
   * field whose value is withheld on the generic read path. Such fields reach
   * this guard through **two independent collectors**, and it needs both:
   *
   *  - {@link collectCredentialFields} — keyed by field TYPE (`secret` /
   *    `password`). A GROUP BY / MIN / MAX / array_agg over such a column would
   *    surface the stored `secret:<id>` ref or the password value.
   *  - {@link collectInternalReadFields} — keyed by the `internal: true` FLAG
   *    (#7728). ADR-0100's third credential channel is a one-way hash living in
   *    an ordinary `text` column, which no type-keyed collector can ever reach;
   *    the flag is that channel's opt-in declaration. Without this half the
   *    guard had the same type-vs-flag blind spot #7728 fixed on the read path:
   *    a flagged column was omitted from `find`/`findOne` yet freely groupable
   *    here, so the flag's promise ("never returned on the generic data path")
   *    stopped at the edge of `aggregate()`.
   *
   * Post-hoc masking is not available on this path — the value is already a
   * group key by the time there is a row, and masking group keys corrupts the
   * result. So we reject instead.
   *
   * Neither collector carries a `managedBy` exemption, so the union does not
   * acquire one, deliberately. Read-masking exempts `password` on better-auth
   * objects so login reads still see the stored value; *aggregating* a
   * credential is never legitimate, least of all on an identity table, where it
   * is an inference oracle over hashes.
   *
   * Only the two output-bearing positions on `EngineAggregateOptions` carry
   * field names: `aggregations[].field` (skip COUNT(*) — undefined or '*') and
   * `groupBy[]` (a string, or a `{ field }` bucket object).
   */
  private rejectCredentialAggregation(object: string, query: EngineAggregateOptions): void {
    const schema = this._registry.getObject(object);
    // Deduped: one field can be reachable through both collectors (a `secret`
    // column that is also flagged `internal`), and it must be named once.
    const protectedFields = [
      ...new Set([...collectCredentialFields(schema), ...collectInternalReadFields(schema)]),
    ];
    if (protectedFields.length === 0) return;

    const referenced = new Set<string>();
    for (const agg of query?.aggregations ?? []) {
      const field = (agg as { field?: string })?.field;
      if (field && field !== '*') referenced.add(field);
    }
    for (const g of query?.groupBy ?? []) {
      const field = typeof g === 'string' ? g : g?.field;
      if (field) referenced.add(field);
    }

    const hit = protectedFields.filter((f) => referenced.has(f));
    if (hit.length > 0) {
      throw new Error(
        `Cannot aggregate credential field(s) ${hit.map((f) => `"${object}.${f}"`).join(', ')}: `
          + 'secret/password fields are masked on read and `internal: true` fields are omitted '
          + 'outright, so the value never leaves the engine on the generic data path; aggregating '
          + 'them (group-by, min/max, array_agg, …) would surface it. '
          + 'Refusing (fail-closed) — see ADR-0100 / #3171 / #7922.',
      );
    }
  }

  async aggregate(object: string, query: EngineAggregateOptions, options?: EngineReadOptions): Promise<any[]> {
      object = this.resolveObjectName(object);
      // Fold the `filter` alias into `where` (#4346) — the AST below reads
      // `query.where` only, so an unfolded `{ filter }` aggregated every row.
      query = foldEngineOptionAliases(object, 'aggregate', query, ENGINE_WHERE_SLOTS);
      rejectUnknownEngineOptions(object, 'aggregate', query, ENGINE_AGGREGATE_OPTION_KEYS);
      query = lowerWhereFilterArray(object, 'aggregate', query, this._registry.getObject(object));
      this.rejectCredentialAggregation(object, query);
      const driver = this.getDriver(object);
      this.logger.debug(`Aggregate on ${object} using ${driver.name}`, query);

      const opCtx: OperationContext = {
        object,
        operation: 'aggregate',
        // On the opCtx so middleware-injected read filters (RLS/sharing) land
        // in `ast.where` — same #2737 hole as count(): a locally-built AST
        // aggregated over rows the caller may not see.
        ast: {
            object,
            where: query.where,
            groupBy: query.groupBy,
            aggregations: query.aggregations,
            // ENFORCED since #4286 (step 3). On the ast so the FLS predicate
            // guard walks its references (predicate-guard.ts) and a future
            // native pushdown has it in hand; the engine's post-aggregation
            // applyHaving() below is authoritative either way.
            having: query.having,
        },
        options: query,
        context: mergeReadContext(query?.context, options?.context),
      };
      this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context);

      await this.executeWithMiddleware(opCtx, async () => {
        const ast = opCtx.ast as QueryAST;

        // Prefer driver.aggregate() when available — driver.find() in many
        // drivers (e.g. driver-sql) does not honor `groupBy` / `aggregations`
        // and would silently return ungrouped raw rows. Fall back to find()
        // for drivers that handle aggregations through their query AST.
        const drv = driver as any;
        // Structured groupBy items ({field, dateGranularity}) require the
        // driver to advertise per-granularity native bucket support via
        // `supports.queryDateGranularity[g]`. If every structured item is
        // supported we can push the aggregate down to the driver; otherwise
        // we fall back to driver.find() + in-memory bucketing so the result
        // remains correct on partial-support dialects (e.g. SQLite + week).
        const groupByItems = Array.isArray(query.groupBy) ? query.groupBy : [];
        const granularityCaps: Record<string, boolean> | undefined =
            drv?.supports?.queryDateGranularity;
        const structuredItems = groupByItems.filter((g) => typeof g !== 'string');
        const allStructuredSupported = structuredItems.every((g) => {
            if (!g?.dateGranularity) return true; // plain {field} object is fine
            return granularityCaps?.[g.dateGranularity] === true;
        });
        // ADR-0053 Phase 2 (D2): native driver date bucketing (`date_trunc`) is
        // UTC-only — SQLite has no tz database and MySQL needs tz tables loaded,
        // so pushing tz-aware bucketing down splits boundaries per dialect. When
        // a non-UTC reference timezone is in play we therefore force the
        // in-memory path: the date-range `where` still goes to the driver (only
        // matching rows are fetched), but bucketing runs uniformly in JS so a
        // row near a tz day-boundary lands identically on every driver.
        const tz = query.timezone;
        const hasDateBucket = structuredItems.some((g) => !!g?.dateGranularity);
        const tzRequiresInMemory = !!tz && tz !== 'UTC' && hasDateBucket;
        if (typeof drv.aggregate === 'function' && allStructuredSupported && !tzRequiresInMemory) {
            // HAVING is engine-owned (#4286): applied AFTER aggregation, over
            // the aggregated row's own columns (aggregation aliases + groupBy
            // projections), identically on both paths. No driver implements it
            // natively today; one that grows native support must advertise a
            // capability flag, at which point this post-filter becomes the
            // fallback tier — the dateGranularity two-tier pattern.
            const aggregated = await drv.aggregate(object, ast, this.buildDriverOptions(object, opCtx.context));
            return applyHaving(aggregated, ast.having);
        }
        // In-memory fallback path: ask the driver for raw rows, then bucket +
        // aggregate here. This guarantees `groupBy` (incl. structured items
        // carrying `dateGranularity`) and `aggregations` always work even on
        // drivers that have no native aggregation support (driver-rest,
        // driver-memory, partial SQL drivers), and is the path that honours a
        // non-UTC reference timezone.
        const raw = await driver.find(object, ast, this.buildDriverOptions(object, opCtx.context));
        return applyHaving(applyInMemoryAggregation(raw, ast, tz), ast.having);
      });

      return opCtx.result as any[];
  }
  
  /**
   * Run raw driver-specific commands (SQL for SqlDriver, REST for RestDriver, …).
   *
   * ⚠️ **Tenant isolation bypass.** Raw `execute()` does NOT thread the
   * caller's `ExecutionContext.tenantId` into a `WHERE organization_id`
   * predicate — drivers see the command verbatim. Callers MUST inline the
   * tenant filter themselves, or restrict raw execution to genuinely global
   * statements (schema migrations, sys_* / control-plane tables).
   *
   * Prefer the typed entry points (`find`, `update`, `delete`, `count`, …)
   * whenever feasible — they auto-apply tenancy + soft-delete + audit warnings.
   */
  async execute(command: any, options?: Record<string, any>): Promise<any> {
      // Driver selection priority:
      //   1. options.object  → route via getDriver(objectName)
      //   2. options.datasource → explicit driver name
      //   3. default driver (set via datasourceMapping or defaultDriver)
      // This lets system services (e.g. PackageService, AuditService) issue raw
      // SQL against the control-plane / default DB without having to know the
      // object name behind every CREATE TABLE / SELECT statement.
      let driver: IDataDriver | undefined;
      if (options?.object) {
          driver = this.getDriver(options.object);
      } else if (options?.datasource && this.drivers.has(options.datasource)) {
          driver = this.drivers.get(options.datasource);
      } else if (this.defaultDriver && this.drivers.has(this.defaultDriver)) {
          driver = this.drivers.get(this.defaultDriver);
      } else if (this.drivers.size === 1) {
          // Single registered driver — unambiguously the right one.
          driver = this.drivers.values().next().value;
      }

      if (!driver) {
          throw new Error(
              'Execute requires options.object to select a driver, or a default driver to be configured. ' +
              'Configure datasourceMapping with `default: true` or pass `{ object }` / `{ datasource }` in options.',
          );
      }
      if (!driver.execute) {
          throw new Error('Selected driver does not implement execute()');
      }

      // Support both call shapes:
      //   execute('SELECT ...', { args: [...] })
      //   execute({ sql: 'SELECT ...', args: [...] })
      let rawCommand: any = command;
      let params: any[] | undefined = options?.args ?? options?.params;
      if (command && typeof command === 'object' && !Array.isArray(command) && 'sql' in command) {
          rawCommand = command.sql;
          if (params === undefined) {
              params = command.args ?? command.params;
          }
      }

      return driver.execute(rawCommand, params, options);
  }

  /**
   * Execute a callback inside a database transaction.
   *
   * The callback receives a context object that should be passed to all
   * downstream `engine.insert/update/delete/find/findOne` calls (as
   * `{ context: trxCtx }`). The transaction handle threads through
   * `OperationContext.context.transaction` and the SQL driver's per-builder
   * `.transacting(trx)` call.
   *
   * - If the default driver does not support `beginTransaction`, the callback
   *   runs directly with the supplied base context (no rollback). This keeps
   *   the API safe to call on drivers without ACID support (e.g. the
   *   in-memory driver in tests). It is DECLARED behaviour (ADR-0119 D1), not
   *   a bug to be discovered — but since v17 it is no longer *silent*: the
   *   degrade warns once per driver (#4619, {@link warnTransactionUnsupported}),
   *   and a caller who cannot live with it says so with `opts.require: true`,
   *   which THROWS {@link TransactionUnsupportedError} instead (#5696 point 1).
   * - On callback success the transaction is committed; on any thrown error
   *   it is rolled back and the original error is re-thrown.
   * - The transaction covers ONE driver's connection — the default one — as
   *   ADR-0119 D1 declared and this engine still provides (no two-phase
   *   commit). What a write routed elsewhere gets is decided by
   *   {@link enforceTransactionOrigin} (#5351 / #5696, 2026-08-06 ruling): a
   *   BUSINESS write is refused with
   *   {@link CrossDatasourceTransactionWriteError}; an append-only SYSTEM
   *   LEDGER (`lifecycle.class` audit / telemetry / event) is carved out and
   *   executed OUTSIDE the transaction, so it survives a rollback — the orphan
   *   row is the deliberate direction of error for a compliance ledger. Either
   *   way the other driver never receives this transaction's handle, which is
   *   what the pre-v17 engine did and what put statements on the wrong
   *   connection entirely.
   * - The callback's SECOND argument says whether this call owns the
   *   transaction (#5696 point 3): `owned: true` when this call opened it,
   *   `false` when it JOINED an outer one (ADR-0067 D2) — and `false` on the
   *   degrade path too, where there is no transaction to own. A callback whose
   *   own guarantees are phrased as "this all rolls back together" only holds
   *   that promise when it owns the transaction; before this signal it had no
   *   way to tell. One-argument callbacks are unaffected.
   *
   * Use case: multi-step operations that must be atomic (e.g. CRM
   * `convertLead`, which creates an account + contact + opportunity + flips
   * the lead in a single unit of work).
   */
  async transaction<T>(
    callback: (trxCtx: any, info: EngineTransactionInfo) => Promise<T>,
    baseContext?: any,
    opts?: EngineTransactionOptions,
  ): Promise<T> {
    // ADR-0067 D2 — JOIN an already-open ambient transaction instead of
    // opening a nested driver transaction. A nested begin would acquire a
    // second connection (a deadlock on single-connection pools like the
    // SQLite knex pool) and would NOT be covered by the outer rollback —
    // exactly the half-landing this join prevents: an outer batch
    // transaction (e.g. `publishPackageDrafts`) must own the one-and-only
    // commit/rollback for every write made through nested helpers (the
    // sys-metadata repository's `withTxn`, hook-driven writes, …).
    const ambient = this.txStore.getStore();
    if (ambient?.transaction) {
      // JOINED, not owned: some outer caller decides commit vs rollback (#5696).
      return callback(
        { ...(baseContext ?? {}), transaction: ambient.transaction },
        { owned: false },
      );
    }
    const driver = this.defaultDriver ? this.drivers.get(this.defaultDriver) : undefined;
    const drv = driver as any;
    if (!drv?.beginTransaction) {
      const datasource = this.defaultDriver ?? drv?.name;
      if (opts?.require === true) {
        // Fail CLOSED (#5696 point 1): the caller declared it cannot tolerate
        // running without a rollback, so refuse BEFORE the callback writes
        // anything rather than degrade behind a warning it may never read.
        // Generalizes `batchData`'s atomic gate (ADR-0119 D4).
        throw new TransactionUnsupportedError(datasource ?? '<no default datasource>');
      }
      // Declared degrade (ADR-0119 D1) — behaviour unchanged, but no longer
      // mute: the caller asked for atomicity and is not getting it (#4619).
      this.warnTransactionUnsupported(datasource);
      // `owned: false` — honest: there is no transaction here to own, and no
      // rollback the callback may promise on the strength of it.
      return callback(baseContext, { owned: false });
    }
    const trx = await drv.beginTransaction();
    const trxCtx = { ...(baseContext ?? {}), transaction: trx };
    try {
      // Run the callback inside the ambient transaction store so internal
      // queries during writes reuse this transaction's connection (ADR-0034).
      const result = await this.txStore.run(
        { transaction: trx, scope: this.newTransactionScope(driver!) },
        () => callback(trxCtx, { owned: true }),
      );
      if (drv.commit) await drv.commit(trx);
      else if (drv.commitTransaction) await drv.commitTransaction(trx);
      return result;
    } catch (err) {
      try {
        if (drv.rollback) await drv.rollback(trx);
        else if (drv.rollbackTransaction) await drv.rollbackTransaction(trx);
      } catch {
        // swallow rollback failures so the original error surfaces
      }
      throw err;
    }
  }

  /**
   * Build the observability record for a transaction this engine just opened
   * (#4619). See {@link TransactionScope} — records only, routes nothing.
   */
  private newTransactionScope(owner: IDataDriver): TransactionScope {
    return {
      driver: owner,
      datasource: this.datasourceNameOf(owner),
      reportedOutOfScope: new Set<string>(),
    };
  }

  /**
   * Which datasource name is `driver` registered under?
   *
   * `registerDriver` keys {@link drivers} by `driver.name`, so the two normally
   * agree — but the map is the routing authority (`getDriver` resolves through
   * it), so the map is what is searched, and `driver.name` is only the fallback
   * for a driver that was never registered. Runs at most once per transaction
   * (and once per out-of-scope report), never on the hot path.
   */
  private datasourceNameOf(driver: IDataDriver): string {
    for (const [name, registered] of this.drivers) {
      if (registered === driver) return name;
    }
    return driver?.name ?? 'unknown';
  }

  /**
   * A caller asked for a transaction and the driver cannot give it one (#4619).
   *
   * The behaviour is unchanged and DECLARED (ADR-0119 D1: "when that driver has
   * no `beginTransaction` the callback runs with NO transaction and NO
   * rollback"). What was missing is that a caller had no way to find out —
   * the same shape as `batchData`'s `atomic` flag being a lie for as long as it
   * was (ADR-0119 D4). Tightening this into a throw would change the declared
   * contract and is deliberately NOT done here.
   *
   * `warn`, not `error`, on purpose. AGENTS.md's judgment question asks whether
   * the system looks normal *while something it claims is persisted has not
   * landed*; at this moment nothing has been lost — a capability simply is not
   * there, and every write in the callback still lands. This is the
   * `if (!capability)` composition branch the same section names as the
   * usual `warn`; escalating it would train readers to skim `error`, which is
   * exactly what made the #4420 `warn` unreadable.
   *
   * Once per engine instance per driver: the drivers that reach this path (test
   * doubles, foreign engines) reach it on EVERY call.
   */
  private warnTransactionUnsupported(datasource: string | undefined): void {
    const name = datasource ?? '<no default datasource>';
    if (this.transactionUnsupportedReported.has(name)) return;
    this.transactionUnsupportedReported.add(name);
    this.logger.warn(
      `transaction() requested a transaction but driver '${name}' has no beginTransaction — ` +
        'running WITHOUT transaction or rollback. Every write the callback makes commits as it executes, ' +
        'so a later throw leaves the earlier ones PERSISTED even though the call rejects as if the whole ' +
        'unit of work had been undone; no caller is told, and the records stay behind. ' +
        'Register a driver that implements beginTransaction for this datasource, or have the caller fail ' +
        "closed itself when it cannot tolerate losing atomicity (batchData's atomic gate, ADR-0119 D4, is " +
        'the pattern). Reported once per driver per engine instance.',
      { datasource: name },
    );
  }

  /**
   * A write inside an open `transaction()` resolved to a driver that
   * transaction does not cover — decide what happens to it (#5351, #5696).
   *
   * Called at the TOP of `insert`/`update`/`delete`, before hooks, validation
   * or defaults run: a refusal here has cost the caller nothing.
   *
   * This seam replaced `reportWriteOutsideTransaction` (#4619 / PR #5724),
   * which reported the split at `error` and let the write proceed with the
   * owner's handle. Reporting was the right first move — it made the defect
   * audible without pre-empting a decision that changes ADR-0119 D1's declared
   * contract for every multi-datasource deployment. The 2026-08-06 maintainer
   * ruling made that decision, and it is TWO answers, not one, because the two
   * kinds of write fail in opposite directions:
   *
   * - **Business writes are REFUSED** ({@link CrossDatasourceTransactionWriteError},
   *   #5696 point 2). The caller opened a transaction and asked for one unit of
   *   work; there is no way to give them one across two drivers (no two-phase
   *   commit on `IDataDriver`, deliberately out of scope). Silently committing
   *   part of it — which is what the pre-v17 engine did, on the wrong
   *   connection at that — is the outcome a caller can neither detect nor undo.
   *   Refusing hands them the choice: one datasource per transaction, or
   *   per-datasource units they reconcile themselves.
   * - **Append-only system ledgers are CARVED OUT** (#5351): audit / telemetry
   *   / event rows execute OUTSIDE the transaction, on their own connection,
   *   with no foreign handle. They therefore survive a rollback of the business
   *   transaction — an "orphan row" describing a write that was undone. For an
   *   append-only compliance ledger that is the correct direction of error:
   *   a spurious row is reconcilable, a MISSING row for a write that did
   *   commit is an unrecoverable compliance hole, and the missing row is what
   *   shipped before this change. It is also what lets a plugin author write an
   *   ordinary `afterInsert` audit hook with no knowledge that datasource
   *   routing exists — refusing here would be swallowed by that hook's
   *   try/catch and lose the row exactly as before.
   *
   * No `error` log survives on either path. The refusal IS the report, louder
   * than any line; and the carve-out is now DECLARED behaviour that fires on
   * every audited write of every transaction in a lifecycle-split deployment —
   * logging it at `error`, or even `warn`, would train readers to skim the
   * levels that carry real durability failures, which AGENTS.md names as the
   * mirror-image mistake. It is recorded at `debug`, once per transaction per
   * datasource, for the operator who is asking why an audit row outlived a
   * rolled-back write; the durable answer lives in ADR-0067/ADR-0119.
   */
  private enforceTransactionOrigin(
    objectName: string,
    driver: IDataDriver,
    operation: 'insert' | 'update' | 'delete',
  ): void {
    const scope = this.txStore.getStore()?.scope;
    // No engine-owned transaction in scope (or a handle threaded explicitly by
    // the sandbox trio, which this store never sees) — nothing to be outside
    // of. See `transactionCoversDriverFor` for why that limit is declared.
    if (!scope) return;
    // Identity, not name: this is about riding the same connection.
    if (driver === scope.driver) return;
    const target = this.datasourceNameOf(driver);

    if (!this.isSystemLedgerObject(objectName)) {
      throw new CrossDatasourceTransactionWriteError(objectName, operation, target, scope.datasource);
    }

    if (scope.reportedOutOfScope.has(target)) return;
    scope.reportedOutOfScope.add(target);
    this.logger.debug(
      `${operation} of '${objectName}' inside transaction() is routed to datasource '${target}' while the ` +
        `transaction is open on '${scope.datasource}' — executing it OUTSIDE the transaction, on its own ` +
        'connection (ADR-0057 §3.6 system ledger, carved out by #5351). It commits independently and will ' +
        'SURVIVE a rollback of this transaction: an audit/telemetry/event row may describe a write that was ' +
        'undone. That is the decided direction of error for an append-only ledger — an extra reconcilable ' +
        'row beats a missing row for a write that did commit. Said once per transaction per datasource.',
      { object: objectName, operation, datasource: target, transactionDatasource: scope.datasource },
    );
  }

  // ============================================
  // Compatibility / Convenience API
  // ============================================
  // These methods provide a higher-level API matching the @objectql/core
  // ObjectQL interface, enabling painless migration from the legacy layer.

  /**
   * Register a single object definition.
   * 
   * Proxies to SchemaRegistry.registerObject() with sensible defaults.
   * Fields without a `name` property are auto-assigned from their key.
   */
  registerObject(
    schema: ServiceObject,
    packageId: string = '__runtime__',
    namespace?: string
  ): string {
    // Auto-assign field names from keys
    if (schema.fields) {
      for (const [key, field] of Object.entries(schema.fields)) {
        if (field && typeof field === 'object' && !('name' in field)) {
          (field as any).name = key;
        }
      }
    }
    return this._registry.registerObject(schema, packageId, namespace);
  }

  /**
   * Unregister a single object by name.
   */
  unregisterObject(name: string, packageId?: string): void {
    if (packageId) {
      this._registry.unregisterObjectsByPackage(packageId);
    } else {
      // Remove from generic metadata as fallback
      this._registry.unregisterItem('object', name);
    }
  }

  /**
   * Get an object definition by name.
   * Alias for getSchema() — matches @objectql/core API.
   */
  getObject(name: string): ServiceObject | undefined {
    return this.getSchema(name);
  }

  /**
   * Get all registered object configs as a name→config map.
   * Matches @objectql/core getConfigs() API.
   */
  getConfigs(): Record<string, ServiceObject> {
    const result: Record<string, ServiceObject> = {};
    const objects = this._registry.getAllObjects();
    for (const obj of objects) {
      if (obj.name) {
        result[obj.name] = obj;
      }
    }
    return result;
  }

  /**
   * Get a registered driver by datasource name.
   * 
   * Unlike the private getDriver() (which resolves by object name),
   * this method directly looks up a driver by its registered name.
   */
  getDriverByName(name: string): IDataDriver | undefined {
    return this.drivers.get(name);
  }

  /**
   * Introspect a datasource's live remote schema (ADR-0015).
   *
   * Resolves the driver registered under `datasource` and delegates to its
   * `introspectSchema()` capability. Used by the external-datasource service
   * (and CLI/REST) to list remote tables and validate federated objects.
   *
   * @throws if the datasource has no registered driver, or the driver does
   *   not support introspection.
   */
  async introspectDatasource(datasource: string): Promise<unknown> {
    const driver = this.drivers.get(datasource) as any;
    if (!driver) {
      throw new Error(`[ObjectQL] Datasource '${datasource}' has no registered driver to introspect.`);
    }
    if (typeof driver.introspectSchema !== 'function') {
      throw new Error(`[ObjectQL] Driver for datasource '${datasource}' does not support introspectSchema().`);
    }
    return driver.introspectSchema();
  }

  /**
   * Get the driver responsible for the given object.
   *
   * Resolves datasource binding from the object's schema definition,
   * falling back to the default driver. This is a public version of
   * the internal getDriver() used by CRUD operations.
   *
   * @param objectName - FQN or short name of the registered object.
   * @returns The resolved IDataDriver, or undefined if no driver is available.
   */
  getDriverForObject(objectName: string): IDataDriver | undefined {
    try {
      return this.getDriver(objectName);
    } catch {
      return undefined;
    }
  }

  /**
   * Sync all registered object schemas to their respective drivers.
   * Call this after dynamically registering new objects at runtime
   * (e.g. after template seeding) to ensure tables/collections exist
   * before inserting seed data.
   */
  async syncSchemas(): Promise<void> {
    const allObjects = this._registry.getAllObjects();
    for (const obj of allObjects) {
      const driver = this.getDriverForObject(obj.name);
      if (!driver) continue;
      const tableName = StorageNameMapping.resolveTableName(obj);
      if (typeof (driver as any).syncSchemasBatch === 'function' && (driver as any).supports?.batchSchemaSync) {
        // Already handled per-driver below; skip individual call
      }
      if (typeof (driver as any).syncSchema === 'function') {
        try {
          await (driver as any).syncSchema(tableName, obj);
        } catch (e: unknown) {
          // #4632 — this catch used to be empty, with the comment "log
          // suppressed to avoid noise on already-synced tables". Suppressing an
          // already-synced no-op is not what it did: `syncSchema` is required to
          // be idempotent (see this method's doc comment), so a driver that
          // reaches this catch did NOT sync. The only callers are runtime
          // installs — marketplace plugin install, template seeding — which go
          // on to INSERT into a table this failure means does not exist, and
          // then report the install as successful. Nothing that claims to be
          // persisted afterwards is.
          this.logger.error(
            `Schema sync FAILED for object '${obj.name}' — its table/collection was NOT created or altered, yet the object is ` +
              `registered and will be written to: those writes will fail, or drop the columns that were never created. ` +
              `Any seeding or install step that continues past this point is not durable. ` +
              `Fix the driver error below, then re-run the install/sync.`,
            e as Error,
            { object: obj.name, tableName, driver: (driver as any)?.name },
          );
        }
      }
    }
  }

  /**
   * Sync a SINGLE object's physical storage (create/alter its table) on
   * demand. Boot-time {@link syncSchemas} runs once at startup, so an object
   * that becomes live at runtime (e.g. publishing a drafted object) has a
   * registry entry but no table — data CRUD then fails with "no such table"
   * until the next restart. Calling this right after the object is registered
   * makes it immediately usable. Idempotent: the SQL driver only creates the
   * table when absent (and alters to add new columns).
   */
  async syncObjectSchema(objectName: string): Promise<void> {
    const obj = this._registry.getObject(objectName) as any;
    if (!obj) return;
    const driver = this.getDriverForObject(objectName);
    if (!driver) return;
    // Federated (external) object (ADR-0015): register read metadata WITHOUT DDL
    // (its remote schema is owned externally). This is what an app's onEnable
    // calls after registering a late external driver so coercion maps + the
    // physical-table mapping exist for queries. See SqlDriver.registerExternalObject.
    if (obj.external != null) {
      if (typeof (driver as any).registerExternalObject === 'function') {
        await (driver as any).registerExternalObject(obj);
      }
      return;
    }
    if (typeof (driver as any).syncSchema !== 'function') return;
    const tableName = StorageNameMapping.resolveTableName(obj);
    await (driver as any).syncSchema(tableName, obj);
  }

  /**
   * Drop the physical storage (table/collection) backing an object — the
   * inverse of {@link syncObjectSchema}. DESTRUCTIVE: deletes all rows in the
   * table. Used by the protocol delete path when the caller explicitly opts
   * into storage teardown (e.g. discarding an object that was published only
   * to preview it). No-op when the object's driver does not expose `dropTable`.
   * Resolves the physical table name from the registered definition, falling
   * back to the bare name if the def was already removed.
   */
  async dropObjectSchema(objectName: string): Promise<void> {
    const obj = this._registry.getObject(objectName) as any;
    const driver = this.getDriverForObject(objectName);
    if (!driver || typeof (driver as any).dropTable !== 'function') return;
    const tableName = StorageNameMapping.resolveTableName(obj ?? ({ name: objectName } as any));
    await (driver as any).dropTable(tableName);
  }

  /**
   * Get a registered driver by datasource name.
   * Alias matching @objectql/core datasource() API.
   *
   * @throws Error if the datasource is not found
   */
  datasource(name: string): IDataDriver {
    const driver = this.drivers.get(name);
    if (!driver) {
      throw new Error(`[ObjectQL] Datasource '${name}' not found`);
    }
    return driver;
  }

  /**
   * Register a hook handler.
   * Convenience alias for registerHook() matching @objectql/core on() API.
   * 
   * Usage:
   *   ql.on('beforeInsert', 'user', async (ctx) => { ... });
   */
  on(
    event: string,
    objectName: string,
    handler: (ctx: HookContext) => Promise<void> | void,
    packageId?: string
  ): void {
    this.registerHook(event, handler, { object: objectName, packageId });
  }

  /**
   * Remove all hooks, actions, and objects contributed by a package.
   */
  removePackage(packageId: string): void {
    // Remove hooks
    for (const [key, handlers] of this.hooks.entries()) {
      const filtered = handlers.filter(h => h.packageId !== packageId);
      if (filtered.length !== handlers.length) {
        this.hooks.set(key, filtered);
      }
    }
    // Remove actions
    this.removeActionsByPackage(packageId);
    // Remove objects
    this._registry.unregisterObjectsByPackage(packageId, true);
  }

  /**
   * Gracefully shut down the engine, disconnecting all drivers.
   * Alias for destroy() — matches @objectql/core close() API.
   */
  async close(): Promise<void> {
    return this.destroy();
  }

  /**
   * Create a scoped execution context bound to this engine.
   * 
   * Usage:
   *   const ctx = engine.createContext({ userId: '...', tenantId: '...' });
   *   const users = ctx.object('user');
   *   await users.find({ where: { status: 'active' } });
   */
  createContext(ctx: Partial<ExecutionContext>): ScopedContext {
    return new ScopedContext(
      ExecutionContextSchema.parse(ctx),
      this
    );
  }

  /**
   * Static factory: create a fully configured ObjectQL instance.
   * 
   * Matches @objectql/core's `new ObjectQL(config)` pattern but also
   * registers drivers and objects, then calls init().
   * 
   * Usage:
   *   const ql = await ObjectQL.create({
   *     datasources: { default: myDriver },
   *     objects: { user: { name: 'user', fields: { ... } } }
   *   });
   */
  static async create(config: {
    datasources?: Record<string, IDataDriver>;
    objects?: Record<string, ServiceObject>;
    hooks?: Array<{ event: string; object: string; handler: (ctx: HookContext) => Promise<void> | void }>;
  }): Promise<ObjectQL> {
    const ql = new ObjectQL();

    // Register drivers
    if (config.datasources) {
      for (const [name, driver] of Object.entries(config.datasources)) {
        // Set driver name if not already set
        if (!driver.name) {
          (driver as any).name = name;
        }
        ql.registerDriver(driver, name === 'default');
      }
    }

    // Register objects
    if (config.objects) {
      for (const [_key, schema] of Object.entries(config.objects)) {
        ql.registerObject(schema);
      }
    }

    // Register hooks
    if (config.hooks) {
      for (const hook of config.hooks) {
        ql.on(hook.event, hook.object, hook.handler);
      }
    }

    // Initialize (connect drivers)
    await ql.init();

    return ql;
  }
}

/**
 * Repository scoped to a single object, bound to an execution context.
 *
 * Provides both IDataEngine-style methods (find, insert, update, delete)
 * and convenience aliases (create, updateById, deleteById) matching
 * the @objectql/core ObjectRepository API.
 */
/**
 * A repository bound to one object and one execution context — what
 * `ScopedContext.object(name)` returns, and what a hook reaches as
 * `ctx.api.object(name)`.
 *
 * `implements IScopedObjectRepository` (#5945): the six members that contract
 * declares are the ones the documentation corpus is measured to CALL, and the
 * `implements` clause is what keeps the two from drifting — before it, the
 * only descriptions of this face were the private slices each consumer
 * hand-rolled (`type CrossObjectApi = …`), which nothing checked. The class
 * stays WIDER than the contract on purpose (`create`, `delete`, `deleteById`,
 * `aggregate`, `execute`); `implements` allows that, and those members join the
 * contract when a call site turns up to justify them.
 */
export class ObjectRepository implements IScopedObjectRepository {
  constructor(
    private objectName: string,
    private context: ExecutionContext,
    private engine: IDataEngine & { executeAction?: (o: string, a: string, c: any) => Promise<any> }
  ) {}

  async find(query: any = {}): Promise<any[]> {
    return this.engine.find(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  async findOne(query: any = {}): Promise<any> {
    return this.engine.findOne(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  async insert(data: any): Promise<any> {
    return this.engine.insert(this.objectName, data, {
      context: this.context,
    });
  }

  /** Alias for insert() — matches @objectql/core convention */
  async create(data: any): Promise<any> {
    return this.insert(data);
  }

  async update(data: any, options: any = {}): Promise<any> {
    return this.engine.update(this.objectName, data, {
      ...options,
      context: this.context,
    });
  }

  /** Update a single record by ID */
  async updateById(id: string | number, data: any): Promise<any> {
    return this.engine.update(this.objectName, { ...data, id: id }, {
      where: { id: id },
      context: this.context,
    });
  }

  async delete(options: any = {}): Promise<any> {
    return this.engine.delete(this.objectName, {
      ...options,
      context: this.context,
    });
  }

  /** Delete a single record by ID */
  async deleteById(id: string | number): Promise<any> {
    return this.engine.delete(this.objectName, {
      where: { id: id },
      context: this.context,
    });
  }

  async count(query: any = {}): Promise<number> {
    return this.engine.count(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /** Aggregate query */
  async aggregate(query: any = {}): Promise<any[]> {
    return this.engine.aggregate(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /** Execute a named action registered on this object */
  async execute(actionName: string, params?: any): Promise<any> {
    if (this.engine.executeAction) {
      return this.engine.executeAction(this.objectName, actionName, {
        ...params,
        userId: this.context.userId,
        tenantId: this.context.tenantId,
        roles: this.context.positions,
      });
    }
    throw new Error(`Actions not supported by engine`);
  }
}

/**
 * Scoped execution context with object() accessor.
 *
 * Provides identity (userId, tenantId/spaceId, roles),
 * repository access via object(), privilege escalation via sudo(),
 * and transactional execution via transaction().
 *
 * `implements IScopedContext` (#5945) — this class IS `HookContext.api`, built
 * per dispatch by {@link ObjectQL.buildHookApi}. The contract declares the two
 * members hooks reach (`object`, `transaction`); `sudo()`, the discrete
 * begin/commit/rollback trio and the identity getters stay off it, so this
 * class is deliberately wider than what it implements.
 */
export class ScopedContext implements IScopedContext {
  constructor(
    private executionContext: ExecutionContext,
    private engine: IDataEngine
  ) {}

  /** Get a repository scoped to this context */
  object(name: string): ObjectRepository {
    return new ObjectRepository(name, this.executionContext, this.engine as any);
  }

  /** Create an elevated (system) context */
  sudo(): ScopedContext {
    return new ScopedContext(
      { ...this.executionContext, isSystem: true },
      this.engine
    );
  }

  /**
   * Execute a callback within a database transaction.
   *
   * The callback receives a new ScopedContext whose operations
   * share the same transaction handle. If the callback throws,
   * the transaction is rolled back; otherwise it is committed.
   *
   * Falls back to non-transactional execution if the driver
   * does not support transactions.
   *
   * Carries BOTH of `ObjectQL.transaction`'s declared caveats (ADR-0119 D1) —
   * default-datasource-only, and a silent degrade when that driver has no
   * `beginTransaction` — because it is a second implementation of the same
   * thing, reached from `ctx.api.transaction(fn)` in hook and action bodies.
   * Behaviour is unchanged, and so is the split: since #4619 both caveats
   * report through the SAME engine-side helpers the engine's own
   * `transaction()` uses, so this surface is no quieter than the direct one and
   * "say it once" holds across both.
   *
   * `opts.require` and the callback's `owned` argument (#5696) are honoured
   * here for the same reason: a second implementation of one primitive must not
   * become a second DIALECT of it. A hook body that fails closed through
   * `ctx.api.transaction` gets the same refusal the engine's own surface gives.
   *
   * And so, since #6168, is the **ADR-0067 D2 join** — the first thing this
   * method does, exactly as on the engine surface. It was the one point where
   * the second implementation still diverged, and it diverged in the direction
   * that costs the most: a hook triggered from inside an `engine.transaction()`
   * that called `ctx.api.transaction(fn)` opened a SECOND driver transaction,
   * which (a) takes a second connection — the deadlock D2 exists to avoid on a
   * single-connection pool like SQLite's — and (b) committed itself, so its
   * writes SURVIVED the outer rollback. D2's whole point is that the outermost
   * caller owns the one-and-only commit/rollback for every write made through
   * nested helpers. The `owned` signal was already honest about this
   * (`true` every time, because this surface really did always open); what was
   * wrong is the behaviour it was honestly describing.
   *
   * DECLARED LIMIT, so the next reader does not mistake it for the same
   * oversight: the join reads the engine's ambient `txStore` only. The discrete
   * `beginTransaction`/`commit`/`rollback` trio below deliberately does not
   * populate that store (its handle is threaded explicitly across
   * `setImmediate` boundaries where AsyncLocalStorage does not survive), so a
   * trio-held handle is invisible here and is NOT joined — which is what keeps
   * this branch from mistaking an explicitly-threaded handle for an ambient
   * one. The QuickJS sandbox drives `ctx.api.transaction(fn)` through that trio
   * rather than through this method, so a VM-side body is outside THIS join —
   * it gets its own, on the trio's `beginTransaction` since #6406, with the
   * same semantics: same handle, `owned: false`, and commit/rollback abstaining
   * in favour of the outer owner. Unattributable handles are the same surface
   * #6167 tracks, and closing that needs handle ownership to become
   * discoverable on `IDataDriver`.
   */
  async transaction(
    callback: (trxCtx: ScopedContext, info: EngineTransactionInfo) => Promise<any>,
    opts?: EngineTransactionOptions,
  ): Promise<any> {
    const engine = this.engine as any;
    // The engine's ambient transaction store (ADR-0034), reached the `as any`
    // way this whole class reaches engine internals. One accessor serves both
    // readers below: the D2 join, and the `run` that publishes a transaction
    // this call opens.
    const txStore = engine?.txStore as
      | {
          getStore(): { transaction: unknown } | undefined;
          run<R>(s: { transaction: unknown; scope?: unknown }, fn: () => R): R;
        }
      | undefined;

    // ADR-0067 D2 — JOIN an already-open ambient transaction instead of opening
    // a nested driver one (#6168). Same first move, same reasons and the same
    // shape as `ObjectQL.transaction`: a nested begin would take a second
    // connection AND would not be covered by the outer rollback, so the outer
    // caller would stop owning the one-and-only commit/rollback.
    //
    // BEFORE the driver/`require` handling on purpose, mirroring the engine:
    // when there is an ambient transaction there IS a transaction, so
    // `require: true` is satisfied by joining it and the degrade is not
    // reachable.
    const ambient = txStore?.getStore();
    if (ambient?.transaction) {
      // The handle is threaded EXPLICITLY into the child context, not left to
      // the ambient store, for the same reason the engine surface threads it:
      // `buildDriverOptions` prefers the explicit handle, and it survives async
      // boundaries the store does not. It is identity-equal to the store's
      // handle, so `transactionCoversDriverFor` still attributes it to the
      // OUTER owner and the #5351 same-origin gate judges it unchanged.
      const joinedCtx = new ScopedContext(
        { ...this.executionContext, transaction: ambient.transaction },
        this.engine
      );
      // JOINED, not owned: the outer caller decides commit vs rollback (#5696).
      return callback(joinedCtx, { owned: false });
    }

    // Find the default driver for transaction support
    const driver = engine.defaultDriver
      ? engine.drivers?.get(engine.defaultDriver)
      : undefined;

    if (!driver?.beginTransaction) {
      const datasource = engine.defaultDriver ?? driver?.name;
      if (opts?.require === true) {
        // Same fail-closed refusal as the engine surface (#5696 point 1).
        throw new TransactionUnsupportedError(datasource ?? '<no default datasource>');
      }
      // No transaction support — execute directly. Declared (ADR-0119 D1), but
      // said out loud since #4619: the caller asked for atomicity and the
      // callback is about to run without any.
      engine.warnTransactionUnsupported?.(datasource);
      return callback(this, { owned: false });
    }

    const trx = await driver.beginTransaction();
    const trxCtx = new ScopedContext(
      { ...this.executionContext, transaction: trx },
      this.engine
    );
    // Publish this transaction into the engine's ambient store so internal
    // queries during writes reuse its connection (ADR-0034) — and so a nested
    // `transaction()` on either surface can JOIN it. The store entry also
    // carries WHICH driver owns the transaction (#4619) so the write path can
    // report a write routed off it; `newTransactionScope` is the engine's,
    // reached the same `as any` way as `txStore` itself.
    const scope = engine.newTransactionScope?.(driver);
    const runIn = <R>(fn: () => Promise<R>): Promise<R> =>
      txStore ? txStore.run({ transaction: trx, scope }, fn) : fn();

    try {
      // Reached only with no ambient transaction to join, so this call really
      // did open one and the callback owns the outcome (#5696 / #6168).
      const result = await runIn(() => callback(trxCtx, { owned: true }));
      if (driver.commit) await driver.commit(trx);
      else if (driver.commitTransaction) await driver.commitTransaction(trx);
      return result;
    } catch (error) {
      if (driver.rollback) await driver.rollback(trx);
      else if (driver.rollbackTransaction) await driver.rollbackTransaction(trx);
      throw error;
    }
  }

  /**
   * Handles this context JOINED (ADR-0067 D2) rather than opened, recorded by
   * {@link beginTransaction} and consumed by {@link releaseJoinedHandle}.
   *
   * A joined handle belongs to an OUTER owner, so this context must not commit
   * or roll it back. Keying by the handle object is what makes the abstention
   * exact — a context that later opens one of its own gets a different handle
   * and closes it normally. Entries are removed by the first commit/rollback
   * that names them, so the set holds at most the transactions currently open
   * through this (per-dispatch, short-lived) context.
   */
  private readonly joinedHandles = new Set<unknown>();

  /**
   * Was `handle` JOINED by this context rather than opened by it? Consumes the
   * record, so the trio's terminal call is also what forgets the handle.
   *
   * Two independent signals, because the trio's callers are exactly the ones
   * that cannot keep a closure on the stack and may not close on the same
   * object they opened on:
   *
   *   1. this context's own {@link joinedHandles} record, and
   *   2. identity with the CURRENT ambient handle — a handle the engine is
   *      holding open right now is, by construction, not one the trio opened
   *      (the trio never publishes into `txStore`, so a trio-owned handle is
   *      never the ambient one).
   *
   * Both point the same way and both fail SAFE: the ambiguous answer is
   * "abstain", never "commit a transaction we do not own".
   */
  private releaseJoinedHandle(handle: unknown): boolean {
    if (this.joinedHandles.delete(handle)) return true;
    if (handle == null) return false;
    const ambient = (this.engine as any)?.txStore?.getStore?.() as
      | { transaction?: unknown }
      | undefined;
    return ambient?.transaction === handle;
  }

  /**
   * Resolve the default driver, if it exposes transaction primitives.
   * Shared by {@link transaction} and the discrete begin/commit/rollback trio.
   */
  private txDriver(): any | undefined {
    const engine = this.engine as any;
    const driver = engine.defaultDriver
      ? engine.drivers?.get(engine.defaultDriver)
      : undefined;
    return driver?.beginTransaction ? driver : undefined;
  }

  /**
   * Discrete transaction primitives — `begin` / `commit` / `rollback` as three
   * separate calls, in contrast to {@link transaction}'s single-callback form.
   *
   * This trio exists for callers that cannot keep a JS closure on the stack for
   * the lifetime of the transaction — chiefly the sandbox runner, where the
   * hook/action body's `ctx.api.transaction(fn)` is driven across many host
   * event-loop turns via deferred promises. With no closure spanning
   * begin→commit there is nothing to hand `txStore.run`, so a transaction this
   * trio opens can never be PUBLISHED into the engine's ambient store; the
   * handle is threaded **explicitly** instead: `begin` returns a child
   * ScopedContext carrying `transaction: trx` in its execution context, and
   * `resolveTx` honors that explicit handle ahead of the ambient store. Every
   * `object(...)` op on the returned context therefore reuses the one
   * connection without relying on ALS — which is also what keeps it working
   * across `setImmediate` boundaries an outside caller may schedule the
   * commit from.
   *
   * Returns `null` when the driver has no transaction support — the caller then
   * runs non-transactionally against `this` (same graceful degrade as
   * {@link transaction}).
   *
   * ## ADR-0067 D2 join (#6406) — the third face of one primitive
   *
   * `begin` JOINS an already-open ambient transaction instead of opening a
   * nested driver one, exactly as `ObjectQL.transaction` always did and as
   * {@link transaction} does since #6168. Without it, a QuickJS body's
   * `ctx.api.transaction(fn)` — which reaches this trio, not {@link transaction}
   * — opened a SECOND driver transaction inside a host `engine.transaction()`:
   * a second connection (the deadlock D2 exists to avoid on a single-connection
   * pool) whose `__txCommit` made its writes SURVIVE the outer rollback, with
   * no error and no log.
   *
   * `owned` in the result is #5696's signal, in the shape this face can carry
   * it: `false` says this call joined and the OUTER caller owns the one and
   * only commit/rollback. Commit and rollback abstain for such a handle
   * ({@link releaseJoinedHandle}) — the guarantee lives HERE rather than in
   * each caller, so a caller that ignores the bit still cannot close a
   * transaction it does not own. An explicit rollback of a joined handle
   * therefore performs NO driver rollback here; it is the same answer the
   * callback faces give, where the joined branch has no rollback of its own and
   * a throw propagates to the outer owner, which rolls the whole unit back.
   *
   * DECLARED LIMIT, measured rather than assumed (#6406): the join reads the
   * engine's ambient `txStore` at BEGIN time. On the sandbox path that store IS
   * readable there — the leaf runs on a chain awaited down from the host's
   * `txStore.run`, so the AsyncLocalStorage context is still current — which is
   * why no separate capture mechanism is needed. What the trio still cannot do
   * is PUBLISH: it has no closure spanning begin→commit to wrap in
   * `txStore.run`, which is why its own handle is threaded explicitly and stays
   * invisible to the ambient readers. A caller whose `begin` is scheduled from
   * OUTSIDE the transaction's async context sees no ambient and opens its own,
   * exactly as before — join is best-effort on visibility, on this face and on
   * both callback faces alike.
   */
  async beginTransaction(): Promise<{ ctx: ScopedContext; handle: unknown; owned: boolean } | null> {
    // ADR-0067 D2 — JOIN before the driver lookup, the same first move and the
    // same position as both callback faces (#6168 / #6406). An ambient
    // transaction IS a transaction, so there is nothing to look a driver up for.
    const ambient = (this.engine as any)?.txStore?.getStore?.() as
      | { transaction?: unknown }
      | undefined;
    if (ambient?.transaction) {
      // Threaded explicitly into the child context, identity-equal to the
      // store's handle — so `buildDriverOptions` binds every op on it to the
      // outer connection and `transactionCoversDriverFor` still attributes the
      // handle to the OUTER owner (#5351 unchanged).
      const ctx = new ScopedContext(
        { ...this.executionContext, transaction: ambient.transaction },
        this.engine
      );
      this.joinedHandles.add(ambient.transaction);
      return { ctx, handle: ambient.transaction, owned: false };
    }
    const driver = this.txDriver();
    if (!driver) return null;
    const trx = await driver.beginTransaction();
    const ctx = new ScopedContext(
      { ...this.executionContext, transaction: trx },
      this.engine
    );
    return { ctx, handle: trx, owned: true };
  }

  /**
   * Commit a handle obtained from {@link beginTransaction}.
   *
   * ABSTAINS for a JOINED handle (#6406): committing a transaction this context
   * did not open would land the inner writes early and take the outcome away
   * from the outer owner — the durability half of the D2 defect.
   */
  async commitTransaction(handle: unknown): Promise<void> {
    if (this.releaseJoinedHandle(handle)) return;
    const driver = this.txDriver();
    if (!driver) return;
    if (driver.commit) await driver.commit(handle);
    else if (driver.commitTransaction) await driver.commitTransaction(handle);
  }

  /**
   * Roll back a handle obtained from {@link beginTransaction}.
   *
   * ABSTAINS for a JOINED handle (#6406), mirroring the callback faces: their
   * joined branch issues no rollback either, and a throw inside it propagates
   * to the outer owner, which rolls back the whole unit of work. Rolling the
   * outer transaction back from here would be the mirror-image error — an inner
   * failure silently discarding writes the outer caller has not finished with.
   */
  async rollbackTransaction(handle: unknown): Promise<void> {
    if (this.releaseJoinedHandle(handle)) return;
    const driver = this.txDriver();
    if (!driver) return;
    if (driver.rollback) await driver.rollback(handle);
    else if (driver.rollbackTransaction) await driver.rollbackTransaction(handle);
  }

  get userId() { return this.executionContext.userId; }
  get tenantId() { return this.executionContext.tenantId; }
  /** Alias for tenantId — matches ObjectQLContext.spaceId convention */
  get spaceId() { return this.executionContext.tenantId; }
  get roles() { return this.executionContext.positions; }
  get isSystem() { return this.executionContext.isSystem; }

  /** Internal: expose the transaction handle for driver-level access */
  get transactionHandle() { return this.executionContext.transaction; }
}
