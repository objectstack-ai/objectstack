// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29986 codemod] The top-level declarations ahead of `ObjectQL` in
// `engine.ts` that moved out whole by `scripts/codemod-split-engine.mjs` (lever
// (b) of ruling 6591753301).
//
// A MOVE, not a redesign: each declaration below is its `engine.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF:
// it imports neither `engine.ts` nor any `engine-*` module, so it is
// evaluated before the class and forms no cycle with it. `engine.ts`
// re-exports, by name, every declaration here it exported before, so every
// importer of `./engine.js` reads what it read.

import { AUDIT_PROVENANCE_FIELDS, ENGINE_UPDATE_UPSERT_REMOVED, FILE_REFERENCE_TYPES, FullTextSearchSchema, QUERY_CURSOR_REMOVED, QUERY_DISTINCT_REMOVED, REFERENCE_VALUE_TYPES, RPC_QUERY_ALIAS_SLOTS, VALID_AST_OPERATORS, foldQueryAliasSlots, isFilterAST, isMultiValueField, lowerFilterCondition, normalizeFilterComparandTypes, parseFilterAST, readAutonumberCounter, referenceCarrierOf, referenceTargetOf, resolveInjectedColumnProvenance } from '@objectstack/spec/data';
import type { DroppedFieldsEvent, FilterCondition, FilterLoweringOptions, HookContext, QueryAST, QueryAliasSlot, ServiceObject } from '@objectstack/spec/data';
import type { EngineFilterJudgement, ISecurityService } from '@objectstack/spec/contracts';
import { assertFilterIsMaterializable, assertListComparandShapes, collectComposableReadableIds, invalidFilterError } from './filter-comparand-shape.js';
import { assertResolvedTemporalTokensInRange, assertTemporalComparandsInterpretable } from './temporal-comparand-door.js';
import type { ResolvedTokenJudge } from './temporal-comparand-door.js';
import { assertTextOperatorTargetsAreStringCapable } from './text-operator-declared-type-door.js';
import { mapRelationConditions, narrowNumberComparands } from './number-comparand-declared-type-door.js';
import { lowerRelationSite } from './relation-filter-lowering.js';
import type { RelationFilterSite } from './relation-filter-lowering.js';
import { SystemFieldName } from '@objectstack/spec/system';
import { judgeCollectionItemOwnerStamp } from '@objectstack/spec/kernel';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { FlowFunctionEffect } from '@objectstack/spec/automation';
import { filterTokenContextFrom, resolveFilterTokens } from '@objectstack/core';
import type { IDataDriver } from '@objectstack/core';
import { ORGANIZATION_OBJECT } from './tenancy/system-write-organization.js';
import { judgePermissionSetOwnerBinding } from '@objectstack/spec/security';
import type { TenantLayer0Verdict } from '@objectstack/spec/security';
import { applyProtection, pluralToSingular } from '@objectstack/spec/shared';
import type { SchemaRegistry } from './registry.js';
import { SEARCHABLE_ENUM_TYPES, SEARCHABLE_TEXTUAL_TYPES } from './search-filter.js';
import { ExpressionEngine, analyzeRelationshipTraversals, isUnparseableDate } from '@objectstack/formula';
import type { EvalError, EvalOptionLabels, EvalPermissions } from '@objectstack/formula';
import { declaredOptionLabels } from './formula-option-labels.js';
import { ASSEMBLED_VIEW_ITEMS_KEY, AssembledViewArtifactSchema, isAggregatedViewContainer, isViewContainerShaped } from '@objectstack/spec';
import type { Expression } from '@objectstack/spec';
import { deriveViewContainerObject } from '@objectstack/metadata/view-container';
import { viewContainerNameRefusal } from './view-container-name-refusal.js';
import { ValidationError } from './validation/record-validator.js';
import type { FieldValidationError } from './validation/record-validator.js';
import { collectReferenceTraversals, referenceTraversalConflicts, staticReadonlyInsertSubject, stripReadonlyFields } from './validation/rule-validator.js';
import type { RelatedFieldBinding, RelatedRecordBinding } from './validation/rule-validator.js';
import { declaredColumnSet } from './declared-read-columns.js';

/**
 * One read of a `sys_migration` flag row: the verdict, plus whether the ledger
 * could actually be consulted to reach it (#4769). Both negatives keep the
 * gate closed; only the conclusive one is worth remembering.
 */
export interface MigrationFlagRead {
  verified: boolean;
  conclusive: boolean;
  /**
   * [#15989] Have the file-family COLUMNS on this deployment moved to the
   * bare-id encoding — `hasMovedFileColumns` over the same row?
   *
   * Carried on the SAME read rather than fetched by a second one, because it
   * is a second question about one row and two reads could answer them out of
   * one another's date. It is `false` on every row that lacks the stamp, on an
   * unverified row, and on every way of not having read a row at all.
   */
  columnsMoved: boolean;
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
 * `registerHook` refuses it where the name is one of the engine's own
 * ({@link UNDISPATCHED_LIFECYCLE_HOOK_EVENTS}, #17713) and warns otherwise.
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
 * Four ordinary paths open such a unit around the dispatch:
 *   - the write door itself, when the object has a metadata-bound `after*`
 *     hook that can abort — blocking with `onError` `abort`, or carrying a
 *     `condition` — so that abort rolls the row back as `HookSchema.onError`
 *     says (#22782, #22856, `opensAfterAbortUnit`);
 *   - a by-id {@link ObjectQL.delete} whose cascade is `'atomic'` — each
 *     dependent's own `afterDelete` fires inside the wrap the parent opened,
 *     and the parent's row removal can still refuse afterwards (#7413). The
 *     PARENT's `afterDelete` is outside that wrap by construction (inside the
 *     door's own unit when the first path opened one); the cascaded
 *     CHILDREN's are not;
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
 * [#17713] Every verb the engine can put on an {@link OperationContext}, as
 * DATA rather than as a second hand-written list.
 *
 * The type annotation is the weld: `Record<Union, true>` is exhaustive in both
 * directions, so a new engine method that widens `OperationContext['operation']`
 * fails to compile here until the verb is added, and a verb dropped from the
 * union makes its entry an excess property. `pnpm typecheck` compiles this file
 * (it is `src`, not the test layer), so the weld is enforced by the package's
 * own type check and not only by a test.
 *
 * It exists so {@link UNDISPATCHED_LIFECYCLE_HOOK_EVENTS} below is DERIVED. A
 * hand-written list of "the events we refuse" would be this card's own defect
 * one layer up: it would go stale the moment a verb is added, and silently.
 */
const ENGINE_OPERATION_VERBS: Record<OperationContext['operation'], true> = {
  find: true,
  findOne: true,
  insert: true,
  update: true,
  delete: true,
  count: true,
  aggregate: true,
};

/**
 * [#17713] The engine's own lifecycle-event NAMESPACE — `before`/`after` × every
 * verb in {@link ENGINE_OPERATION_VERBS}. Fourteen names, of which
 * {@link DISPATCHABLE_HOOK_EVENTS} is the eight the engine actually dispatches.
 */
const ENGINE_LIFECYCLE_HOOK_EVENTS: ReadonlySet<string> = new Set(
  Object.keys(ENGINE_OPERATION_VERBS).flatMap((verb) => {
    const suffix = `${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;
    return [`before${suffix}`, `after${suffix}`];
  }),
);

/**
 * [#17713] The GAP: a name inside the engine's own lifecycle namespace that the
 * engine never dispatches. Derived, never typed out — the difference of the two
 * sets above.
 *
 * Today it is exactly six: `beforeFindOne` / `afterFindOne`, `beforeCount` /
 * `afterCount`, `beforeAggregate` / `afterAggregate`. Registering one of them is
 * REFUSED at the door ({@link assertDispatchableHookEvent}) rather than warned
 * about, because each is a name an author reaches for while believing they are
 * subscribing to an engine lifecycle event — and what they get back is an inert
 * declaration (ADR-0078: no silently inert declaration), which on a read filter
 * means a guardrail that was never armed.
 *
 * ⚠️ The refusal is deliberately scoped to THIS set, not to "anything outside
 * `DISPATCHABLE_HOOK_EVENTS`". A name outside the namespace entirely
 * (`'myPlugin:flush'`) is a plugin dispatching its own event through the public
 * {@link ObjectQL.triggerHooks} — the legitimate reading that made this branch a
 * warn in the first place (#3195). That reading survives untouched; what stops
 * being accepted is a near-miss spelling of the engine's OWN vocabulary, where
 * no such reading exists.
 */
const UNDISPATCHED_LIFECYCLE_HOOK_EVENTS: ReadonlySet<string> = new Set(
  [...ENGINE_LIFECYCLE_HOOK_EVENTS].filter((event) => !DISPATCHABLE_HOOK_EVENTS.has(event)),
);

/**
 * [#17713] Test-visible view of the three sets the refusal is computed from, so
 * a pin can drive its population FROM THE ENGINE instead of restating it — the
 * acceptance criterion this card wrote ("a test per event name the engine
 * exposes but never dispatches") is only meaningful if the population is read,
 * not typed.
 *
 * Module-level export, deliberately NOT added to the package barrel
 * (`src/index.ts` names its exports one by one), so this widens no published
 * surface.
 */
export const HOOK_EVENT_DISPATCH_VOCABULARY = {
  dispatchable: DISPATCHABLE_HOOK_EVENTS,
  lifecycleNamespace: ENGINE_LIFECYCLE_HOOK_EVENTS,
  undispatchedLifecycle: UNDISPATCHED_LIFECYCLE_HOOK_EVENTS,
} as const;

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
 * pairs in the table are wire spellings folded at parse by
 * `QueryWithTransportSchema` / the protocol normalizer — their values need shape
 * lowering (`sort` records, `populate` lists) that belongs to those layers, so
 * the engine deliberately does not fold them.
 */
export const ENGINE_WHERE_SLOTS: readonly QueryAliasSlot[] =
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
 * `find`/`findOne`/`update`/`delete` the bag's DECLARED driver-option keys
 * are the base of the driver options (`buildDriverOptions(object, ctx, bag)`
 * keeps those and nothing else of the bag — `pickDeclaredDriverOptions`),
 * which is how a caller's explicit `tenantId` / `bypassTenantAudit` reaches
 * the driver (pinned in engine.test.ts). `count`/`aggregate` never forward the bag, so these keys
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
 * the `retiredKey` tombstones `cursor`/`distinct`/`upsert` (#8057), which get
 * their tombstone quoted instead of a generic rejection — the schema keeps them
 * ONLY to carry that message, and this runtime path never parses); `searchFields` (read by
 * `find` and `aggregate` at the `$search` expansion, sent by the protocol layer);
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
  'context', 'where', 'multi', 'returning', 'onFieldsDropped', 'onValidationAdvisory', 'onMentionsWithheld', 'onNotice', 'strictReadonlyWrites',
  ...ENGINE_DRIVER_PASSTHROUGH_KEYS,
]);
const ENGINE_DELETE_OPTION_KEYS: ReadonlySet<string> = new Set([
  'context', 'where', 'multi',
  ...ENGINE_DRIVER_PASSTHROUGH_KEYS,
]);
// `search` / `searchFields` are READ by `count` and `aggregate` through the
// same ADR-0061 expander `find` uses ({@link ObjectQL.expandSearchOnOptions}),
// so a count or a grouped answer under a search is over the searched rows.
// Before their schemas declared them they were refused here, and the wire paths
// left them out: the unsearched groups answered, and a paged list's `total`
// under a search was a page-local estimate (#22790).
export const ENGINE_COUNT_OPTION_KEYS: ReadonlySet<string> = new Set(['context', 'where', 'search', 'searchFields']);
const ENGINE_AGGREGATE_OPTION_KEYS: ReadonlySet<string> = new Set([
  'context', 'where', 'groupBy', 'aggregations', 'having', 'timezone',
  'search', 'searchFields',
]);

/**
 * [#27732] A search-field override — `searchFields`, or the object-form
 * `search.fields` — that names no field is refused `400 VALIDATION_ERROR`:
 * an empty list, or a comma string with no name in it (the `GET` door's
 * transport spelling, which reaches the engine as sent). Absent (or `null`)
 * still searches the object's default search fields.
 *
 * `resolveSearchFields` reads an empty override as absent, so the search
 * widened to the whole default set: the caller wrote the key to narrow and was
 * not told. The door refuses this set (`assertSearchFieldsAreSearchable`,
 * #27484) and `QuerySchema.searchFields` / `FullTextSearchSchema.fields`
 * declare the same refusal (#27683); the words are read off that declaration
 * rather than copied, and the status and code are the door's, so
 * `mapDataError` answers an in-process caller and a REST caller alike. Any
 * other value is left to the expansion's existing tolerance.
 */
function refuseSearchOverrideNamingNoField(object: string, requested: unknown, param: string): void {
  const names = typeof requested === 'string'
    ? requested.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(requested) ? requested : undefined;
  if (names === undefined || names.length > 0) return;
  const declared = FullTextSearchSchema.shape.fields.safeParse([]).error?.issues[0]?.message;
  const err: any = new Error(
    `ObjectQL search on '${object}' names no field in '${param}': got ${JSON.stringify(requested)}. The query was not run: `
    + "an empty search-field list was read as no narrowing, which scans the object's default search fields. "
    + `${declared}.`,
  );
  err.status = 400;
  err.code = 'VALIDATION_ERROR';
  err.param = param;
  err.object = object;
  throw err;
}

/**
 * [#28120] …and an override that names no field the search can scan is refused
 * `400 INVALID_FIELD`, the code the door answers the same value with
 * (`assertSearchFieldsAreSearchable`, #4254): every name unknown, unsearchable,
 * or withheld from the scan (`internal: true`, credential types), or no entry a
 * field name at all.
 *
 * `resolveSearchFields` drops the names outside the allowed set and, when none
 * is left, falls back to the whole set — the typo or the renamed field the
 * caller wrote to narrow the search ran over the object's default fields
 * instead, untold. Judged on the set the expansion resolves over (`allowed`),
 * so this refuses exactly the overrides that fallback would have widened. An
 * override naming at least one allowed field is left to the intersection (the
 * engine's tolerance for the other names stands), and an empty `allowed` is
 * left to the expansion's own refusal (#24284), which names that cause.
 */
function refuseSearchOverrideNamingNoSearchableField(
  object: string,
  requested: unknown,
  param: string,
  allowed: readonly string[],
): void {
  const entries = typeof requested === 'string'
    ? requested.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(requested) ? requested : undefined;
  if (entries === undefined || entries.length === 0 || allowed.length === 0) return;
  const allowSet = new Set(allowed);
  if (entries.some((f) => typeof f === 'string' && allowSet.has(f))) return;
  const names = entries.filter((f): f is string => typeof f === 'string');
  const err: any = new Error(
    `ObjectQL search on '${object}' names no searchable field in '${param}': got ${JSON.stringify(requested)}. `
    + 'The query was not run: an override naming none of the fields the search scans was dropped, which '
    + "scans the object's default search fields. Name a searchable field, or leave the override out to "
    + 'search the default fields.',
  );
  err.status = 400;
  err.httpStatus = 400;
  err.code = 'INVALID_FIELD';
  if (names.length > 0) {
    err.field = names[0];
    err.fields = names;
  }
  err.param = param;
  err.object = object;
  throw err;
}

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
 * [#17052] The write doors' failure META, assembled at the call site because
 * the level moved off `error`.
 *
 * ## Why the level moved
 *
 * `insert` / `update` / `delete` each end in a `catch` whose next statement is
 * `throw e`. AGENTS.md → *Degradation log levels* calls that shape out by name:
 * "a failure handed to the CALLER is not a degradation at all … Do not bolt a
 * `logger.error` onto such a site". The requester IS told — the throw is the
 * answer — so an `error` line is a second, louder report of a fact the caller
 * already has, and nothing downstream can tell it apart from a real one. The
 * measured cost was a healthy first boot of every fresh project printing
 * `ERROR Insert operation failed` while `@better-auth/oauth-provider` seeded
 * `sys_oauth_resource` and treated the UNIQUE collision as the no-op its own
 * docblock declares it to be.
 *
 * ## Why the diagnosis needs this helper to survive the move
 *
 * The `Logger` contract (`packages/spec/src/contracts/logger.ts`) gives an
 * `Error` slot to `error` and `fatal` ONLY: `warn(message, meta?)` has two
 * parameters, not three. Handing the redacted driver error to `warn` as `meta`
 * does not merely lose the slot — `Error.message` and `Error.stack` are
 * NON-ENUMERABLE, so every logger that renders meta by spreading it would
 * serialize `{}` and the entry would arrive carrying nothing at all. That is
 * exactly the loss #14095 refused (the failing column, MySQL's index name, the
 * driver's own frames) arriving one level down.
 *
 * So the two shaped-by-ruling properties are preserved by building the meta the
 * way `ObjectLogger.write()` builds it from the slot — `{ …meta, error: {
 * message, stack } }` — rather than by handing over the Error:
 *
 *   - **#8682** the value redaction still runs: callers pass
 *     `redactBoundStatement(...)`, and it is that result's `message`/`stack`
 *     that are read here.
 *   - **#14095** the log still takes the driver's error (the envelope's
 *     `cause`), not the envelope: callers still choose which value to hand in.
 *
 * The non-Error branch mirrors `ObjectLogger.writeErrorLike()`'s own fallback
 * (`{ ...errorOrMeta, ...meta }`, the later argument winning), so a thrown
 * non-Error — or a `DuplicateRecordError` with no `cause` — renders as it did.
 *
 * @param logged The value to report — already redacted by the caller.
 * @param meta   The entry's own meta (`object`, and `developerMessage` on the
 *               delete door).
 */
export function writeFailureLogMeta(
  logged: unknown,
  meta: Record<string, unknown>,
): Record<string, unknown> {
  return logged instanceof Error
    ? { ...meta, error: { message: logged.message, stack: logged.stack } }
    : { ...(logged as Record<string, unknown> | undefined), ...meta };
}

/**
 * [#24948] The refusal of a predicate (`multi`) delete of `sys_organization`:
 * the standard `DELETE_RESTRICTED`, saying to delete by id. An organization is
 * deleted one at a time, through plugin-auth's organization delete: its
 * refusal of an organization that still owns records and its
 * `beforeDeleteOrganization` clean-up of the organization's teams, team members
 * and admin grants run there, once per organization. A delete matching
 * organizations by a filter runs neither, and no caller needs one.
 */
function organizationPredicateDeleteRefusal(): Error {
  const err: any = new Error(
    'Organizations are deleted one at a time, by id: a delete matching organizations by a filter is refused. ' +
      'Delete each organization by its id.',
  );
  err.developerMessage =
    `A predicate delete of ${ORGANIZATION_OBJECT} is refused: organizations are deleted one at a time, because ` +
    "plugin-auth's organization delete refuses an organization that still owns records and removes its teams, " +
    'team members and admin grants per organization, and a predicate delete runs neither. Delete each organization ' +
    `by id (engine.delete('${ORGANIZATION_OBJECT}', { where: { id } })).`;
  err.code = 'DELETE_RESTRICTED';
  err.status = 409;
  err.httpStatus = 409;
  err.object = ORGANIZATION_OBJECT;
  return err;
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
  // [#8057] `update.options.upsert` — declared-but-unenforced (ADR-0049): the
  // key sat on the update allowlist while nothing read it, so `{ upsert: true }`
  // was accepted and silently dropped. Removed rather than implemented; the
  // spec's tombstone carries the create-if-absent prescription (#7867's
  // not-found gate is the semantics a caller must reconcile with).
  upsert: ENGINE_UPDATE_UPSERT_REMOVED,
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
export function rejectUnknownEngineOptions(
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
    `so the call would succeed with the option silently ignored. ` +
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
export function foldEngineOptionAliases<T extends object | undefined>(
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
 * [#20121] Is this non-array `where` a filter OBJECT — the one non-array shape
 * a driver reads as a predicate?
 *
 * The test is the object's built-in tag (`[object Object]`), not its
 * prototype, and each edge shape lands where its measured answer puts it —
 * nothing that answered correctly before this gate is refused by it:
 *
 * - a literal `{…}` and `{}` (match-all, a REAL query — the unscoped-write
 *   detector reads it that way too) → accepted;
 * - `Object.create(null)` and an instance of an author's class with the filter
 *   on its own keys → accepted: both filtered correctly on `driver-memory` and
 *   `SqlDriver`, because a driver reads a filter's own enumerable keys;
 * - `Map`, `Set`, `Date`, a boxed primitive, a `Promise` (an un-awaited filter
 *   builder) → refused: each carries its tag, has no own keys, and was
 *   silently read as "no filter".
 *
 * `undefined` and `null` never reach this test — the caller skips them, and
 * both keep meaning "no filter" (`findOne`'s no-predicate guard and the
 * unscoped-write detector both read `null` as absent).
 */
function isWhereFilterObject(where: unknown): where is Record<string, unknown> {
  return (
    typeof where === 'object'
    && where !== null
    && !Array.isArray(where)
    && Object.prototype.toString.call(where) === '[object Object]'
  );
}

/**
 * [#20121] How a refused non-filter `where` is named in the refusal: the
 * primitive's `typeof` plus its value (bounded), or the object's built-in tag.
 * The `typeof` spelling is the wire door's (`received number`); the value is
 * added because a direct caller has no request to look at.
 */
function describeNonFilterWhere(where: unknown): string {
  if (typeof where === 'object' && where !== null) {
    return Object.prototype.toString.call(where).slice('[object '.length, -1);
  }
  if (typeof where === 'function') return 'function';
  const text = typeof where === 'string' ? JSON.stringify(where) : String(where);
  const bounded = text.length > 80 ? `${text.slice(0, 77)}...` : text;
  return `${typeof where} ${bounded}`;
}

/**
 * [#20121] What a dropped `where` would have done, per verb. The read wording is
 * the wire door's verbatim; a write has no result set, and "every row in
 * scope" is what an unapplied predicate on `multi: true` rewrote or removed.
 */
const UNAPPLIED_WHERE_CONSEQUENCE: Readonly<Record<string, string>> = {
  find: 'returned the unfiltered result set',
  findOne: 'returned the unfiltered result set',
  count: 'returned the unfiltered result set',
  aggregate: 'returned the unfiltered result set',
  update: 'updated every row in scope',
  delete: 'deleted every row in scope',
};

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
 * [#20121] A `where` that is not an array has to be a filter OBJECT, and that
 * is checked FIRST, before any door below: a string, a number, a boolean, a
 * `Map`, a `Date` — anything that is neither absent, a filter object nor an
 * array — is refused with the same `INVALID_FILTER` / 400 envelope the array
 * refusal (3) now carries. See {@link isWhereFilterObject} for the accept set
 * and why each edge shape lands where it does.
 *
 * Returns the SAME reference when `where` is not an array (the overwhelmingly
 * common path allocates nothing), otherwise a shallow copy: the bag belongs to
 * the caller and may be reused (view metadata, flow node config).
 */
export function lowerWhereFilterArray<T extends object | undefined>(
  object: string,
  operation: string,
  bag: T,
  schema?: unknown,
  schemaOf?: (name: string) => unknown,
): T {
  if (!bag) return bag;
  const where = (bag as Record<string, unknown>).where;
  // [#20121] The SHAPE gate, first on this seam and so first on all six verbs
  // that call it (`find`, `findOne`, `count`, `aggregate`, `update`,
  // `delete`) — each calls this before it resolves a driver, so a refusal
  // here means no driver call is made at all.
  //
  // Before it, a string / number / `Map` `where` fell into the object branch
  // below, every door there stepped around it (they walk the keys of a filter
  // object, and it has none), and the driver ignored it: the READ answered the
  // unfiltered set, and a `multi: true` UPDATE or DELETE rewrote or removed
  // every row of the table (measured on `driver-memory` and `SqlDriver`
  // without `SecurityPlugin`, and with it under a system context; with an
  // RLS-scoped caller the RLS `$and` composition put the value where the
  // driver's node gate refuses it). It also stepped past the unscoped-write
  // guard (`dispatchUnscopedMultiWriteHooks`), which reads only an absent or
  // `null` `where` as unscoped.
  //
  // The words are the wire door's (`metadata-protocol`'s normalizer answers
  // `?filter=5` with "must be a filter object or condition array, received
  // number … It was not applied"); the consequence is spelled per verb,
  // because for a write it is not a result set.
  if (where !== undefined && where !== null && !Array.isArray(where) && !isWhereFilterObject(where)) {
    throw invalidFilterError(
      `${operation}('${object}'): 'where' must be a filter object or condition array, ` +
      `received ${describeNonFilterWhere(where)}. It was not applied, and an unapplied filter ` +
      `would have ${UNAPPLIED_WHERE_CONSEQUENCE[operation] ?? UNAPPLIED_WHERE_CONSEQUENCE.find}.`,
    );
  }
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
    // [#15661] The DECLARED-TYPE door for the text operators, third on this
    // seam and third question about the same predicate: the shape gate asks
    // "can this comparand run", the materializable gate asks "is there a column
    // to run it against", and this asks "can that column's declared type ever
    // hold a string". It runs BEFORE the temporal gate below deliberately — a
    // `$startsWith` over a `date` field is refused by that gate today, with the
    // same `INVALID_FILTER` / 400 envelope but a message about the COMPARAND,
    // which sends the author to fix a value that could never have made the
    // filter runnable. Same wire envelope, the ruling's message.
    assertTextOperatorTargetsAreStringCapable(object, operation, schema, where);
    // [#8690] The TEMPORAL-comparand door, fourth on the same seam (#15661's
    // declared-type door was inserted above it) and fourth question about the
    // same predicate: the shape gate asks "can this comparand run", the
    // materializable gate asks "is there a column to run it against", the
    // declared-type gate asks "can that column ever hold a string", and this
    // asks "can that column's storage rule READ this value".
    // It must run BEFORE `resolveWhereTokens` (which is downstream of every
    // caller of this function) because the refusal has to precede the driver —
    // hence the door steps around `{placeholder}` strings rather than judging
    // them; the token resolver refuses the unknown ones a moment later, loudly.
    assertTemporalComparandsInterpretable(object, operation, schema, where);
    // [#20351] The NUMBER-comparand declared-type door, fifth on the same seam
    // and fifth question about the same predicate: is this string a number the
    // declared numeric column can be compared with. It refuses a non-numeric
    // string (`INVALID_FILTER` / 400) and narrows a numeric one to its number,
    // copy-on-write, by `@objectstack/spec/data`'s grammar and verdict. Before
    // the token resolver, like the temporal door: a `{placeholder}` resolves to
    // an id or a date, never a number, so it is refused here unresolved.
    // [#20546] Its walk carries a second arm, asked first at every field: a
    // plain object with no `$` key where a scalar column's value belongs
    // (`{ amount: { a: 1 } }`) is refused `INVALID_FILTER` / 400. Memory
    // answered it with no rows (every row under `$not`), SQL with its own 400.
    // [#20745] …and beneath a relation column (the nested-relation form no
    // driver serves), a structured-JSON column (a whole-value match the
    // drivers share no meaning for) and an undeclared `id`, in words per kind.
    // [#20802] …except the nested-relation form, which this position SERVES:
    // beneath a relation column it is admitted against the related object's
    // declarations (`schemaOf`, the registry) and kept as written — the engine
    // lowers it once it can read (`ObjectQL.lowerRelationConditions`) — or
    // refused in words of its own (a key the related object does not declare,
    // a second level, a related object that is not registered).
    // [#21333] …and the walk's BOOLEAN arm: against a declared boolean field
    // `"true"` / `"false"`, `1` / `0` and `"1"` / `"0"` narrow to their
    // boolean and any other string is refused `INVALID_FILTER` / 400 — the one
    // place a bare query parameter's `"true"` becomes `true`.
    const numeric = narrowNumberComparands(object, operation, schema, where, 'where', { schemaOf });
    // [#7872] The comparand-type door, on the OBJECT form. `parseFilterAST`
    // runs the same walk on everything it lowers or passes through, but
    // NEITHER door routes an object-form filter through it — Door 1 gates on
    // `isFilterAST` first and Door 2 is this very branch — so without this
    // call the dominant form would bypass the door entirely (the #7956
    // divergence matrix arrived through it). Shape gate first (#5869 keeps
    // its pinned wording for the list-operator shapes), type door second;
    // the walk is copy-on-write, so the common path allocates nothing and a
    // narrowed bigint replaces the bag rather than editing the caller's.
    const normalized = normalizeFilterComparandTypes(numeric, `${operation}('${object}')`);
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
  // [#20121] Through `invalidFilterError`, so this refusal carries the
  // `INVALID_FILTER` / 400 envelope the wire door answers the same array with
  // (`malformedFilterArrayError`) — it used to be a bare `Error`, `code` and
  // `status` both `undefined`, a 400-class author error that read as a 500.
  if (!isFilterAST(where)) {
    throw invalidFilterError(
      `${operation}('${object}') received a 'where' array that is not a filter: ` +
      `${JSON.stringify(where)}. A filter array is a comparison [field, operator, value], ` +
      `a logical node ["and"|"or", ...conditions], or a list of those — it is INPUT-ONLY ` +
      `sugar (spec 'FilterArray'), lowered to a FilterCondition here before any driver sees ` +
      `it. This value cannot be lowered, and an unapplied filter would have returned ` +
      `the UNFILTERED result set. Recognised operators: ` +
      `${[...VALID_AST_OPERATORS].sort().join(', ')}. Infix joins ([condA, "or", condB]) are ` +
      `NOT one of the shapes — write the prefix form ["or", condA, condB].`,
    );
  }

  // (2) The declared path.
  // [#9228] The context prefix is passed because `parseFilterAST` now runs the
  // #5869 shape gate itself, one step before this branch could: a scalar `$nin`
  // is refused DURING lowering. Handing it `${operation}('${object}')` is what
  // keeps this branch's pinned `find('deal'): ` prefix on that refusal — and on
  // the #7872 type door's, which `parseFilterAST` has always run and which used
  // to answer this branch unprefixed.
  const condition = parseFilterAST(where, `${operation}('${object}')`);
  if (condition === undefined) {
    // Unreachable by construction — `isFilterAST` accepted the shape, so
    // `parseFilterAST` has a lowering for it. Loud rather than silent because
    // the failure mode of the two spec functions disagreeing is a dropped
    // predicate, i.e. every row (#3948).
    throw new Error(
      `${operation}('${object}'): filter array ${JSON.stringify(where)} passed isFilterAST() ` +
      `but parseFilterAST() lowered it to nothing. Refusing rather than running the query ` +
      `unfiltered.`,
    );
  }
  // [#5869] Door 2's half of the same check USED to be a second
  // `assertListComparandShapes(object, operation, condition)` call here.
  // [#9228] moved the rule into `parseFilterAST` itself, which this branch
  // calls three lines up with the same context — so the call became provably
  // unreachable (nothing between the two can introduce a list operator) and is
  // deleted rather than kept as a gate that reads live and never fires. The
  // OBJECT branch above keeps its call: that `where` never passes
  // `parseFilterAST` at all, which is the whole reason both branches exist.
  // [ADR-0139 D1] The object branch's `ReadableIds` rule, on the LOWERED
  // condition: `parseFilterAST` admits no leaf as a `$in` comparand (it does
  // not opt in, so that spelling is its 400), but a leaf it lowers by
  // reference into any other position is refused here by name, as the object
  // branch refuses it — first, before the doors below read it as a value.
  collectComposableReadableIds(object, operation, condition, 'where');
  // [#8296] Same door as the object branch above, on the LOWERED condition —
  // the array sugar (`[['is_open','=',true]]`) names fields too, and a gate on
  // one branch would answer one mistake two ways depending on the spelling.
  assertFilterIsMaterializable(object, operation, schema, condition);
  // [#15661] Same door as the object branch, on the LOWERED condition — the
  // array sugar (`[['amount','contains','5']]`) names non-text fields too, and
  // a gate on one branch would answer one mistake two ways depending on the
  // spelling.
  assertTextOperatorTargetsAreStringCapable(object, operation, schema, condition);
  // [#8690] Same door as the object branch, on the LOWERED condition — the
  // array sugar (`[['at','>=','last_30_days']]`) names temporal fields too, and
  // a gate on one branch would answer one mistake two ways depending on the
  // spelling.
  assertTemporalComparandsInterpretable(object, operation, schema, condition);
  // [#20351] Same door as the object branch, on the LOWERED condition — the
  // array sugar (`[['amount','>','abc']]`) names numeric fields too. [#20546]
  // …and lowers `['amount', '=', { a: 1 }]` to the no-operator object its
  // second arm refuses. [#21333] …and `['active', '=', 'true']` to the
  // comparand its boolean arm narrows.
  lowered.where = narrowNumberComparands(object, operation, schema, condition, 'where', { schemaOf });
  return lowered as T;
}

/**
 * [#20157] Stage 2 of `where` admission: expand the filter placeholders
 * (`{current_user_id}`, date macros) against the execution context.
 *
 * The one spelling of that step. Execution reaches it through
 * `ObjectQL.resolveWhereTokens` (the read verbs) and `ObjectQL.withResolvedWhere`
 * (`update` / `delete`), and the judge ({@link judgeWhereAdmission}) calls it
 * directly. So "what execution resolves" and "what the judge resolves" cannot
 * drift. An unknown placeholder throws `FILTER_TOKEN_UNKNOWN`; a known one the
 * context carries no value for throws `FILTER_TOKEN_UNRESOLVED`. Neither ever
 * resolves to `null` (see `@objectstack/core`'s `filter-tokens.ts`).
 *
 * [#20844] …and judges what resolved: `judgeResolved` is the position's
 * {@link ResolvedTokenJudge}, handed the condition before and after, and a
 * date macro that resolved outside its column's years is refused there
 * (`INVALID_FILTER` / 400). Required, so no position resolves without it; the
 * resolver is field-agnostic, so the column's kind comes from the position.
 *
 * Returns the input by reference when it holds no placeholder, and then
 * judges nothing.
 */
function resolveWhereFilterTokens<W>(
  where: W,
  context: Parameters<typeof filterTokenContextFrom>[0],
  judgeResolved: ResolvedTokenJudge,
): W {
  const resolved = resolveFilterTokens(where, filterTokenContextFrom(context));
  if (resolved !== where) judgeResolved(where, resolved);
  return resolved;
}

/**
 * [#20844] The `where` position's {@link ResolvedTokenJudge}: each key's kind
 * is its declared field's in `schema`. `path` roots the refusal, as the door's
 * does — `aggregations[i].filter` for a per-aggregation filter.
 */
function whereResolvedTokenJudge(
  object: string,
  operation: string,
  schema: unknown,
  path = 'where',
): ResolvedTokenJudge {
  return (written, resolved) =>
    assertResolvedTemporalTokensInRange(object, operation, schema, written, resolved, path);
}

/**
 * [ADR-0053 D-D1, amended 2026-09-30 — #5930] Stage 2 of every filter
 * position's admission, whole: resolve the placeholders
 * ({@link resolveWhereFilterTokens}), THEN run the shared lowering
 * (`lowerFilterCondition`, `@objectstack/spec/data`) — the `$between` split,
 * the whole-day upper bound and the NULL-polarity guards.
 *
 * The order is the amendment's item 3: the lowering reads the comparand the
 * comparison will run with, so a date macro (`{today}`, `{current_month_end}`)
 * has already become the bare day the whole-day rule widens. Run beside the
 * doors instead, it would meet `{today}` unresolved and leave it bare.
 *
 * ONE function for every position, so no verb can resolve without lowering:
 * `where` on the five read / write verbs (`ObjectQL.resolveWhereTokens`,
 * `ObjectQL.withResolvedWhere`), `aggregations[i].filter` and `having` on
 * `aggregate`, and the judge ({@link judgeWhereAdmission}), which runs the
 * same stage so its verdict is execution's. The lowering never refuses, so it
 * adds no verdict of its own.
 *
 * `lowering` is the position's declared-type reader: this seam reads the
 * object's declarations, so the whole-day rule rewrites a declared
 * `datetime` column only ({@link declaredDatetimeLowering}) — the scope
 * `SqlDriver` holds, so a `date`, `time` or non-temporal column reaches every
 * driver byte-identical to before (the amendment's item 7). An object with no
 * field map has no declarations to read, and there the rule applies
 * type-blind (item 7's other half).
 *
 * [#20844] `judgeResolved` is the position's other declared-type reader: the
 * year range of what resolved ({@link resolveWhereFilterTokens}).
 *
 * Returns the input by reference when nothing resolved and nothing lowered.
 */
export function resolveThenLowerWhere<W>(
  where: W,
  context: Parameters<typeof filterTokenContextFrom>[0],
  lowering: FilterLoweringOptions,
  judgeResolved: ResolvedTokenJudge,
): W {
  return lowerFilterCondition(resolveWhereFilterTokens(where, context, judgeResolved), lowering);
}

/**
 * [ADR-0053 D-D1 item 7 — #5930] The typed reading of one object's filter
 * positions: a column is `datetime` exactly when the object's declared field
 * map says `type: 'datetime'` — the same test `SqlDriver` indexes its
 * `datetimeFields` by, so the columns this seam widens are a subset of the
 * columns every face widens today.
 *
 * [#20822] No field map (an object the registry does not hold, a
 * registry-less host) is a seam that cannot read the declared type, and item 7
 * says what such a seam does: "applies the rewrite type-blind", as the
 * type-blind emitters do (sound on `Field.date` text, where `< next-day`
 * orders exactly as `<= day`). So the reader is omitted and the whole-day
 * rules apply to every column. This branch used to read "no field map" as "no
 * datetime column" and leave the rule to the faces; item 5 retires those
 * copies, and with them gone that reading would have dropped the whole-day
 * bound on every such read.
 */
export function declaredDatetimeLowering(schema: unknown): FilterLoweringOptions {
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (fields === null || typeof fields !== 'object') return {};
  return {
    isDatetimeColumn: (column) =>
      fields !== null
      && typeof fields === 'object'
      && Object.prototype.hasOwnProperty.call(fields, column)
      && ((fields as Record<string, { type?: unknown } | undefined>)[column]?.type === 'datetime'),
  };
}

/**
 * [#20157] Is this thrown value a door's DIAGNOSTIC (the ADR-0112 envelope:
 * a string `code` and a numeric `status`), or something else?
 *
 * Every `where` door raises the envelope: `invalidFilterError`, the
 * materializable door's `INVALID_FIELD`, spec's shape and type faces, and
 * core's `FILTER_TOKEN_*` errors. A throw without it is not a verdict about the
 * filter. It is a fault (the "unreachable by construction" branch of
 * {@link lowerWhereFilterArray}, a bug), and the judge re-throws it rather than
 * dressing it up as one.
 */
function admissionRefusalOf(
  thrown: unknown,
): Extract<EngineFilterJudgement, { ok: false }> | null {
  if (!(thrown instanceof Error)) return null;
  const { code, status } = thrown as Error & { code?: unknown; status?: unknown };
  if (typeof code !== 'string' || typeof status !== 'number') return null;
  return { ok: false, code, status, message: thrown.message };
}

/**
 * [#20157] Judge a `where` against an object WITHOUT executing it: the engine
 * side of `IObjectQLEngine.judgeFilter` (#19995 ruling C).
 *
 * ## The pipeline it runs is the one every verb runs
 *
 * Every verb that takes a `where` (`find`, `findOne`, `count`, `aggregate`,
 * `update`, `delete`) admits it in the same two stages, in the same order:
 *
 * 1. {@link lowerWhereFilterArray}: the shape gate, then (object form)
 *    `assertListComparandShapes` → `assertFilterIsMaterializable` (the dotted,
 *    then the virtual-field verdict) → `assertTextOperatorTargetsAreStringCapable`
 *    → `assertTemporalComparandsInterpretable` → `narrowNumberComparands`
 *    (#20351) → `normalizeFilterComparandTypes`, or (array form) `isFilterAST`
 *    → `parseFilterAST` → the same four field-map doors on the lowered
 *    condition.
 * 2. {@link resolveWhereFilterTokens}: the placeholder resolver, and [#20844]
 *    the year range of each date macro it resolved.
 *
 * [#20802] Execution then lowers each nested-relation condition by READING
 * the related object (`ObjectQL.lowerRelationConditions`); that read admits the
 * condition through the related object's own two stages. The judge runs those
 * two stages on each condition too — as a `find` on the related object — and
 * stops there: which ids the read finds, the cap and the caller's permissions
 * on the related object need data and a caller, and are execution's alone.
 *
 * What differs by verb sits BETWEEN or AROUND those stages and judges
 * something other than `where`: option-key folding and refusal, the driver
 * lookup (`getDriver`, before stage 1 on the writes and between the stages on
 * the reads), `orderBy` / projection doors on `find`, and the per-aggregation
 * and `having` doors on `aggregate`. None of those is part of this judgement.
 * The judge calls the two stage functions themselves, so the doors have one
 * implementation and one order. It never calls a second copy of a walk.
 *
 * ## What it reads
 *
 * The `where` value, the object's declared field map (`schema`, the
 * registry's), and the execution context (for stage 2). No driver, no data,
 * no hook, no middleware. Execution's own stages read nothing more, measured
 * door by door on #20157.
 *
 * A thrown door diagnostic becomes the returned refusal, with the same `code`,
 * `status` and `message` execution raises. Anything else is re-thrown
 * ({@link admissionRefusalOf}).
 */
function judgeWhereAdmission(
  object: string,
  operation: string,
  where: unknown,
  schema: unknown,
  context: Parameters<typeof filterTokenContextFrom>[0],
  schemaOf?: (name: string) => unknown,
): EngineFilterJudgement {
  try {
    const admitted = lowerWhereFilterArray(object, operation, { where }, schema, schemaOf);
    const resolved = resolveWhereFilterTokens(
      admitted.where, context, whereResolvedTokenJudge(object, operation, schema),
    );
    // [#20802] Each nested-relation condition the door admitted: execution
    // reads the related object with it (`ObjectQL.lowerRelationConditions`),
    // and that read admits it through the related object's own doors and
    // resolver — so the judge asks the same of it here, as a `find` on the
    // related object. What the read then finds (the ids, the cap, the caller's
    // permissions) needs data and a caller, and is execution's alone. The rest
    // of the filter is lowered with each condition standing for the empty id
    // set, which the shared lowering treats as it treats any `$in` / `$or`.
    const sites = relationSitesOf(object, operation, resolved, schema, schemaOf);
    for (const site of sites) {
      const inner = judgeWhereAdmission(site.target, 'find', site.condition, schemaOf?.(site.target), context, schemaOf);
      if (!inner.ok) return inner;
    }
    const related = sites.length === 0
      ? resolved
      : mapRelationConditions(object, operation, schema, resolved, {
          schemaOf: schemaOf ?? (() => undefined),
          replace: (site) => lowerRelationSite(site, []),
        });
    lowerFilterCondition(related, declaredDatetimeLowering(schema));
    return { ok: true };
  } catch (thrown) {
    const refusal = admissionRefusalOf(thrown);
    if (refusal) return refusal;
    throw thrown;
  }
}

/**
 * [#20802] The nested-relation conditions a `where` holds, in walk order: the
 * collecting pass of {@link mapRelationConditions} (each admitted site is
 * recorded and kept as written, so nothing is rewritten). Empty for a filter
 * with none, and for a registry-less host (no field map, no relation column).
 */
export function relationSitesOf(
  object: string,
  operation: string,
  where: unknown,
  schema: unknown,
  schemaOf: ((name: string) => unknown) | undefined,
): RelationFilterSite[] {
  const sites: RelationFilterSite[] = [];
  if (where == null) return sites;
  mapRelationConditions(object, operation, schema, where, {
    schemaOf: schemaOf ?? (() => undefined),
    replace: (site) => {
      sites.push(site);
      return { kind: 'value', value: site.condition };
    },
  });
  return sites;
}

/**
 * [#20082] One operation's effective-permission resolution — see
 * `ObjectQL.permissionResolution`. `get()` asks the registered resolver at most
 * once for the operation and hands every caller the same answer, or the same
 * rejection.
 */
export interface PermissionResolution {
  get(): Promise<EvalPermissions>;
}

/**
 * Is this `defaultValue` an Expression envelope (`{ dialect, source }`) —
 * evaluated at insert time — rather than a literal or a runtime token? The one
 * test {@link ObjectQL.applyFieldDefaults} evaluates by and
 * {@link ObjectQL.resolveDefaultPermissions} plans by, so the two can never
 * disagree about which defaults are expressions.
 */
export function isExpressionDefault(dv: unknown): dv is Expression {
  return typeof dv === 'object' && dv !== null
    && Boolean((dv as { dialect?: unknown }).dialect)
    && typeof (dv as { source?: unknown }).source === 'string';
}

export interface FormulaPlanEntry {
  name: string;
  expression: Expression;
  /**
   * [#10280] The field's declared `scale`, when it is one this rounding can
   * honour — see {@link formulaRoundingScale}. `undefined` means "return the
   * evaluator's value verbatim", which is what every formula did before this.
   */
  scale?: number;
  /**
   * [#24197] The reference fields this formula reads ONE hop through, and the
   * related fields it names on each (`record.book.title` → `book → {title}`).
   * Absent when the formula traverses nothing — every formula before #24197,
   * and still the common case — which is what lets such a read skip the
   * related read entirely.
   */
  hops?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * [#24197] Why this formula's traversal cannot be served (a second hop; a
   * reference read both through and as a value), worded for the author. Such a
   * formula is not evaluated: it reads `null` and the fault sink carries this
   * sentence — the lint refuses the same shape with the same words.
   */
  hopConflict?: string;
}

/**
 * `toFixed`'s own domain limit: it throws `RangeError` above 100 fraction
 * digits. `FieldSchema.scale` is `z.number().int().min(0)` with no upper
 * bound, so an author CAN declare more — and a display-precision declaration
 * must never be the reason a read fails.
 */
const MAX_FORMULA_SCALE = 100;

/**
 * [#10280] The `scale` a formula plan entry carries, or `undefined` when the
 * declaration is not one this rounding can honour.
 *
 * Well-formedness is judged with the SAME test the write path uses
 * (`validateFieldValue`'s `scale` branch: `Number.isInteger(def.scale) &&
 * def.scale >= 0`), so one malformed declaration cannot mean two things one
 * layer apart. A malformed `scale` stays UNENFORCED rather than being
 * interpreted — inventing floor/round semantics for `scale: 2.5` in a consumer
 * is the guessing PD #12 forbids, and the producer already refuses it
 * (`FieldSchema.scale` is `z.number().int().min(0)`).
 *
 * The upper bound is `toFixed`'s, not a policy: past {@link MAX_FORMULA_SCALE}
 * the call throws, and asking for more decimal places than an IEEE-754 double
 * carries is a no-op request either way — so the rounding is skipped and the
 * value is returned whole.
 */
function formulaRoundingScale(def: { scale?: unknown } | undefined): number | undefined {
  const scale = def?.scale;
  if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < 0) return undefined;
  return scale <= MAX_FORMULA_SCALE ? scale : undefined;
}

/**
 * [#18408] Is this field's value MULTI-VALUED — the one question, asked of the
 * one predicate `@objectstack/spec` publishes, and the single local seam every
 * site in this file goes through.
 *
 * Maintainer ruling 2026-09-13 (decision batch #128 item 5, option 1′): there
 * is ONE definition of "is this field multi-valued", `isMultiValueField`, and
 * storage follows it. The sites below used to read `field.multiple` raw, which
 * answers `true` on types the spec predicate calls single-valued (`text`,
 * `master_detail`, `tree` …) and `false` on the inherently-multi option types
 * (`multiselect` / `checkboxes` / `tags`) that carry no flag at all. Both
 * directions put this engine on a different list from the storage it writes
 * through: `driver-sql` (#17469) and `os generate migration` (#18199) both ask
 * the predicate now.
 *
 * Takes the field rather than a resolved type because — unlike driver-sql and
 * the CLI generator — no caller in this file applies a type default of its own;
 * a non-string `type` is answered `false` here, the same verdict those two
 * reach through their `field.type || 'string'` resolution.
 *
 * ⛔ The predicate is called, never re-spelled. `MULTI_CAPABLE_TYPES` /
 * `MULTI_OPTION_TYPES` membership written out at a site would be a second
 * answer to a question the ruling gave exactly one.
 */
export function declaredMultiValued(field: { type?: unknown; multiple?: unknown } | null | undefined): boolean {
  return isMultiValueField({
    type: typeof field?.type === 'string' ? field.type : '',
    multiple: field?.multiple === true,
  });
}

/**
 * [#22957] The reference types whose `deleteBehavior` states DELETE SEMANTICS:
 * the relational family the referential delete walk follows.
 *
 * `tree` is a member because the spec says so. `FieldSchema`'s `.overwrite`
 * (`packages/spec/src/data/field.zod.ts`) materializes `deleteBehavior:
 * 'set_null'` on a `tree` beside `lookup`, because the type "is in the
 * relational family, where the key states delete semantics". Its reference is
 * self-referential by contract (`refuseForeignTreeReference`, `object.zod.ts`),
 * so its `cascade` is a subtree delete. The walk used to admit only
 * `master_detail` and `lookup`, so every behaviour a `tree` declared, the
 * materialized default included, was inert: a parent delete left its children
 * holding the deleted id.
 *
 * `user` is not a member of this set: see {@link USER_REFERENCE_TYPE}, which
 * takes part only when it declares a delete outcome of its own.
 */
const DELETE_SEMANTICS_REFERENCE_TYPES: ReadonlySet<string> = new Set(['master_detail', 'lookup', 'tree']);

/**
 * [#29253] A `user` field takes part in the referential delete walk when, and
 * only when, it DECLARES a `deleteBehavior` (one of the enum's three values).
 *
 * It stores like a `lookup` (the target is fixed to `sys_user` by the type,
 * {@link referenceTargetOf}), but the spec's parse materializes no
 * `deleteBehavior` on it: a `user` field that authors nothing declares no
 * delete outcome, so deleting the user leaves it as it was, exactly as before.
 * A `user` field that authors one is a declaration the spec accepts and
 * round-trips, and the walk used to read it never, so an authored `restrict`
 * refused nothing and an authored `cascade` deleted nothing. It now reads like
 * a `lookup`'s authored value: `cascade` deletes the rows holding the deleted
 * user, `set_null` clears them (on a multi-valued field, removes the member),
 * and `restrict` refuses the delete with the walk's own `DELETE_RESTRICTED`;
 * a `set_null` on a REQUIRED `user` field escalates to that refusal as a
 * required `lookup`'s does.
 *
 * Every door that deletes a user reaches this walk: better-auth deletes the
 * user row (admin remove-user, self delete-user) through the plugin-auth
 * adapter's `engine.delete` by id, and the generic data doors refuse a
 * caller-context `sys_user` delete before it (ADR-0092 D2).
 *
 * ⛔ No default is invented here. "Absent" stays outside the walk, because the
 * spec's parse decides what a bare `user` field declares, not this file.
 */
const USER_REFERENCE_TYPE = 'user';
const DECLARED_DELETE_BEHAVIORS: ReadonlySet<string> = new Set(['set_null', 'cascade', 'restrict']);

/**
 * [#22957] Does `fdef` belong to {@link DELETE_SEMANTICS_REFERENCE_TYPES}, or
 * [#29253] is it a `user` field that declares a `deleteBehavior`
 * ({@link USER_REFERENCE_TYPE})? This
 * is the ONE family test every reader of the referential delete walk asks:
 * {@link ObjectQL.cascadeRelationBehavior}, through it the collection walk and
 * the dependents walk, and {@link ObjectQL.planCascadeAtomicity}. So the walk
 * that runs and the verdict on whether it runs as one unit of work cannot
 * disagree about which relations take part. ⛔ Never a type literal at a site.
 */
function statesDeleteSemantics(fdef: { type?: unknown; deleteBehavior?: unknown } | null | undefined): boolean {
  if (typeof fdef?.type !== 'string') return false;
  if (fdef.type === USER_REFERENCE_TYPE) {
    return typeof fdef.deleteBehavior === 'string' && DECLARED_DELETE_BEHAVIORS.has(fdef.deleteBehavior);
  }
  return DELETE_SEMANTICS_REFERENCE_TYPES.has(fdef.type);
}

/**
 * [#29253] The object a delete-walk relation points at. The `reference`
 * carrier is read through the one arbiter ({@link referenceCarrierOf}), so an
 * unreadable carrier still throws and an absent one still answers `undefined`.
 * A `user` field's target is fixed by its type, so it answers `sys_user`
 * ({@link referenceTargetOf}) whether or not the carrier spells it: a raw
 * `{ type: 'user' }` registration names no `reference` and still references a
 * user.
 */
function deleteWalkTargetOf(fdef: { type?: unknown } | null | undefined, reader: string): string | undefined {
  const carrier = referenceCarrierOf(fdef, reader);
  return fdef?.type === USER_REFERENCE_TYPE ? referenceTargetOf(fdef) : carrier;
}

/**
 * Plan the formula pass of a read: which formula fields to evaluate, and —
 * when the caller named a projection — the projection the DRIVER is asked for.
 *
 * A projection naming a formula field is widened to every stored column (plus
 * `id`), because CEL's `record.<field>` reads whatever the formula needs off
 * the full row. That widening is a means of EVALUATING the formula and never
 * an answer: [#22300] `widened` lists the columns it added beyond what the
 * caller named, and {@link withoutFormulaWidening} cuts them back off the rows
 * once the read is done, so the caller gets the projection it declared plus
 * the formula's value. `widened` is absent whenever nothing was widened.
 */
/**
 * ONE plan entry for a field's declared `expression`: the envelope, the
 * rounding scale, and the one hop it reads through a reference field. Shared
 * by the `formula` read plan ({@link planFormulaProjection}) and the stored
 * computed-field write plan ({@link planStoredExpressions}), so a value
 * computed on read and a value computed on write are one semantic.
 */
function formulaPlanEntry(name: string, def: any, fields: any): FormulaPlanEntry {
  // Normalize string-shorthand → Expression envelope (M9 transition).
  const expr: Expression = typeof def.expression === 'string'
    ? { dialect: 'cel', source: def.expression }
    : def.expression;
  const entry: FormulaPlanEntry = { name, expression: expr, scale: formulaRoundingScale(def) };
  // [#24197] The one hop this formula reads through a reference field, if
  // any — judged by the validation-rule path's own collector, so the two
  // seams that serve a hop read the same hops off the same expression.
  const conflicts = referenceTraversalConflicts(expr, fields, 'formula');
  if (conflicts.length > 0) {
    entry.hopConflict = conflicts.map((c) => c.message).join(' ');
  } else {
    const hops = collectReferenceTraversals([expr], fields);
    if (hops.size > 0) entry.hops = hops;
  }
  // Pre-compile to surface syntax errors at planning stage rather than
  // per-row eval. Own-column dependency discovery is not used — CEL reads
  // the row via `record.<field>`; only the hops above are planned.
  ExpressionEngine.compile(expr);
  return entry;
}

function planFormulaProjection(
  schema: any,
  requestedFields: string[] | undefined
): { plan: FormulaPlanEntry[]; projected?: string[]; widened?: string[] } {
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
      plan.push(formulaPlanEntry(f, def, schema.fields));
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
    // [#22300] What the widening added — `id` included when the caller did not
    // name it — is what the read cuts back off once the formulas are computed.
    const named = new Set(requestedFields);
    const widened = Array.from(projected).filter((f) => !named.has(f));
    return { plan, projected: Array.from(projected), ...(widened.length > 0 ? { widened } : {}) };
  }
  // Implicit/full projection — leave projected undefined so the driver
  // returns its default columns (typically *).
  return { plan };
}

/**
 * [#22300] Cut the columns {@link planFormulaProjection} widened a projection
 * by back off what a read RETURNS — the formula saw the full row, the caller
 * does not. Without it, a projection naming a formula field answered with every
 * stored column (tenant, owner, owning unit, audit actors and timestamps, every
 * unnamed field): a flow's `get_record`, whose `config.fields` is declared as
 * "only these fields are read", passed all of them on to whatever its later
 * nodes sent out.
 *
 * ## The answer it restores
 *
 * The same projection without the formula, plus the formula's value: measured
 * on driver-sql (a projection is exactly the named columns — no `id` unless it
 * is named) and pinned against it in `engine-formula-projection-trim.test.ts`.
 * `id` is cut like any other widened column when the caller did not name it.
 * [#26672] The `id` {@link withFileOwnerKey} adds for a file field's owner
 * verdict is cut the same way.
 *
 * ## Where it runs, and why there
 *
 * On the result `find` / `findOne` hand back, AFTER the middleware chain —
 * the last internal consumer. Everything before it keeps reading the widened
 * row exactly as before: the formula pass, `expand`, file-reference
 * resolution, the `afterFind` hooks, the secret mask and the `__search`
 * strip, and the middlewares' post-phase (field-level security's result mask,
 * the audit redactions that judge a row by columns the caller did not name).
 * Cutting earlier would starve those of a column they read today.
 *
 * It REMOVES the widened columns rather than keeping a list: a key an
 * `afterFind` hook derives, or an expanded relation the caller named, is not
 * the widening's and survives. A widened column a hook re-assigns is cut — the
 * caller never named it.
 *
 * Never mutates a row: a row carrying a widened column is replaced by a copy
 * without it, in the row's own key order; a row carrying none is returned as
 * is.
 */
function withoutFormulaWidening<T>(row: T, widened: ReadonlySet<string> | undefined): T {
  if (!widened || !row || typeof row !== 'object' || Array.isArray(row)) return row;
  const source = row as unknown as Record<string, unknown>;
  if (!Object.keys(source).some((key) => widened.has(key))) return row;
  const cut: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!widened.has(key)) cut[key] = source[key];
  }
  return cut as unknown as T;
}

/** {@link withoutFormulaWidening} over a `find` result; anything but an array passes through. */
function rowsWithoutFormulaWidening<T>(rows: T, widened: ReadonlySet<string> | undefined): T {
  if (!widened || !Array.isArray(rows)) return rows;
  return rows.map((row) => withoutFormulaWidening(row, widened)) as unknown as T;
}

/**
 * [#26672] A projection that names a file field reads the record's `id` too,
 * and the key is cut back off the answer like the formula widening is.
 *
 * File-reference hydration judges a reader refused `sys_file` read by the
 * record that OWNS each file (#22637, `readParentDerivedFiles`), matched on
 * that record's `id`. A projection that left `id` out handed it rows with no
 * key, so a file the reader may read answered `{ id, metadataRefused: true }`
 * to `select=<file field>` and the full value to `select=id,<file field>`. The
 * verdict must not depend on whether the caller listed `id`, so the driver is
 * asked for it here and {@link withoutFormulaWidening} trims it at the
 * `return`: the caller still gets exactly the columns it named, and a reader
 * the verdict refuses is still refused.
 *
 * Touches only an explicit projection that names a file field and not `id`;
 * a projection the formula planner widened already carries `id`.
 */
function withFileOwnerKey(
  schema: any,
  requestedFields: string[] | undefined,
  planned: { projected?: string[]; widened?: string[] },
): { projected?: string[]; widened?: string[] } {
  if (!schema?.fields || !Array.isArray(requestedFields) || requestedFields.length === 0) return planned;
  const projected = planned.projected ?? requestedFields;
  if (projected.includes('id')) return planned;
  if (!requestedFields.some((f) => FILE_REFERENCE_TYPES.has((schema.fields as any)[f]?.type))) return planned;
  return { projected: [...projected, 'id'], widened: [...(planned.widened ?? []), 'id'] };
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
    // formula and dotted refusals (#6994, #6924). One vocabulary across the
    // doors: a caller refused at the REST boundary and a caller refused here
    // must not be sent two different ways.
    //
    // [commit e5eeb499c] With the SEARCH axis the agreement is in SUBSTANCE, not in
    // words, and saying otherwise here was simply false — measured from the
    // running doors, #6673's correction emits "Mirror the computed value onto
    // a stored text field on '<object>' and search that instead." All three
    // axes prescribe the same thing (put the value on a stored column of the
    // queried object and query THAT instead); SEARCH narrows the target to a
    // TEXT column, which is right for an axis that scans text-like columns and
    // is a shipped, user-visible message on an axis that already landed.
    //
    // `query-expression-conformance.test.ts` pins that agreement as ONE thing
    // rather than each wording separately, because separate wordings is
    // exactly how #4256 and #6673 drifted apart in the first place. It holds
    // three layers: the four SORT/FILTER doors' emitted remedies compared
    // against EACH OTHER, every axis' exact sentence (SEARCH included — the
    // door this claim used to skip), and the substance none of them may drop.
    // So a rewording of any axis goes red.
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
  // …and `httpStatus`, the SAME number under ADR-0112 D5's spelling. `status` is
  // what every HTTP door in this repo reads (`resolveThrownHttpError`), so it
  // stays; `httpStatus` is what a consumer holding the THROWN error reads —
  // the CLI's `--json` error envelope (`errorCodeFields`) is the measured one,
  // and it saw `code` with no status at all until both spellings were stamped.
  // Two keys, one value, written together at every producer in this package.
  err.httpStatus = 400;
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
 * to no projection at all. Every hook and internal caller reaches this the
 * same way (a saved report's `query.fields` did too, until the saved-report
 * stack was retired in #20102).
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
  err.httpStatus = 400;
  err.code = 'INVALID_FIELD';
  err.field = first;
  err.fields = dotted;
  err.object = object;
  throw err;
}

/**
 * [#24284] The refusal for a non-blank `search` over an object whose RESOLVED
 * search set is empty — no `searchableFields` entry naming a stored field, and
 * no field of a type the auto-default scans (the junction shape: lookups plus
 * a composed formula title). Without it the expansion added no predicate and
 * the read answered every row.
 *
 * `INVALID_FIELD`, the code #4254's explicit-override gate answers on this
 * same axis (and the one a search naming a formula title gets), not
 * `INVALID_QUERY`: the request is well-formed, and what cannot be honoured is
 * a fact about the object's FIELDS. 400 on every door.
 *
 * [#25672] `withheld`: the declared set is not empty, but every field in it is
 * one the caller may not query, so the narrowing in `expandSearchOnAst` left
 * nothing. Same code and status — the search cannot be honoured for this
 * caller either way — with a message that names the cause, not a declaration
 * fault the object does not have.
 */
function emptySearchSetError(object: string, schema: any, internalExcluded: boolean, withheld = false): Error {
  const declared: unknown[] = Array.isArray(schema?.searchableFields) ? schema.searchableFields : [];
  const err: any = withheld ? new Error(
    `Object '${object}' has no field this caller may search, so 'search' cannot be honoured on it: `
    + `every field it searches is one field-level security does not let this caller query. `
    + 'Answering every row instead would read as "everything matched". Grant read access to one of '
    + `its searchable fields, or filter on a field this caller can read.`,
  ) : new Error(
    `Object '${object}' has no searchable field, so 'search' cannot be honoured on it`
    + (declared.length > 0
      ? `: its 'searchableFields' (${declared.join(', ')}) names no stored field`
      : `: it declares no 'searchableFields', and none of its fields is a type the default `
        + `search scans (${[...SEARCHABLE_TEXTUAL_TYPES, ...SEARCHABLE_ENUM_TYPES].join(' / ')})`)
    + (internalExcluded ? " ('internal: true' fields are never searched)" : '')
    + '. Answering every row instead would read as "everything matched". Declare '
    + `'searchableFields' on '${object}' naming a stored field, or mirror the composed title `
    + `onto a stored text field and search that.`,
  );
  err.status = 400;
  err.httpStatus = 400;
  err.code = 'INVALID_FIELD';
  err.object = object;
  err.param = 'search';
  return err;
}

/**
 * [#8682 / #8738] The DECLARED-FIELD DOOR on the WRITE paths — `insert()` and,
 * since #8738, `update()`: a key the object does not declare is refused by the
 * SCHEMA, before anything is produced for a request that is about to be refused
 * anyway.
 *
 * ONE condition, ONE implementation, deliberately — the two verbs sit in the
 * same file and share the shape of the problem, so #8738 gave this function its
 * second caller rather than a second predicate to drift against. The verdict is
 * a question about a payload and an object's field map; neither term knows
 * which verb asked.
 *
 * ## What ran before this door existed
 *
 * Nothing rejected an undeclared write key. The row travelled the whole insert
 * path and was refused at the very end by the DRIVER — `table crm_account has
 * no column named zzz_nonexistent_field` — which `mapDataError` then translated
 * into the (correct, unchanged) `400 INVALID_FIELD` the caller sees. The client
 * answer was never the defect; what happened behind it was. Measured on
 * `origin/main` for one mistyped key:
 *
 *   - an id, a normalized name, owner/creator resolution and the column
 *     defaults were all produced;
 *   - the app's `beforeInsert` hooks RAN, and their derived values reached the
 *     statement (`period_label = 'Q3 2026'`, computed for a request nobody
 *     would ever store);
 *   - an AUTONUMBER was issued and CONSUMED — the log-independent observable,
 *     and the one this door is pinned on: a valid create before the bad request
 *     numbered `ACC-000013`, the bad request took `ACC-000014` into the void,
 *     and the next valid create came back `ACC-000015`. A sequence gap is
 *     permanent and visible to end users on a document number.
 *
 * A hook is not a pure function — it writes rows, calls out, stamps ledgers —
 * so "it ran and we threw the result away" is not a no-op, it is a side effect
 * of a request the server had already decided to refuse.
 *
 * ## The UPDATE path had the same hole (#8738), measured the same way
 *
 * #8738 filed the update half as INFERRED, not measured, and asked for it to be
 * reproduced before anyone implemented against it. It was, on `origin/main` @
 * `e5eeb499c`, with a real engine and a recording driver — and it reproduces on
 * BOTH branches of the verb:
 *
 *   - by-id   `driver.update`     received `zzz_nonexistent_field` and refused it;
 *   - multi   `driver.updateMany` received it and refused it likewise;
 *   - `beforeUpdate` RAN first on both, and its derived value reached the
 *     statement — the recorded payload was `{ name, zzz_nonexistent_field,
 *     description: 'derived-for-bad' }`, where `description` is the hook's, not
 *     the caller's. The card's `period_label = 'Q3 2026'` shape, one verb over.
 *
 * What it does NOT have is the insert path's durable damage: no autonumber is
 * issued on update, so nothing user-visible is consumed by the refused request.
 * The hook side effect and `declared = enforced` (PD #10) are the whole case —
 * which is why the pin here is the HOOK, not a sequence gap.
 *
 * ## Why HERE and not one step later
 *
 * This runs as the first act inside the middleware body: after middleware (a
 * middleware may legitimately rewrite `data`, and judging the caller's keys
 * before it ran would refuse rows a sanitizing middleware had already fixed),
 * and before `applyFieldDefaults` — hence before the defaults, the summary
 * seeding, the hooks, the strips, validation, the autonumber and the statement.
 * The same placement, and the same argument, as {@link assertWriteAllowed} and
 * `enforceTransactionOrigin` one level up: a refusal this early costs nothing.
 * Like those two it throws without logging — the caller is told exactly what is
 * wrong, and a client typo is not a server fault to record at ERROR.
 *
 * `update()` places it by the same rule, which lands it one step EARLIER in
 * that verb's body than a naive reading suggests: first act inside the
 * middleware body, so ahead of the prior-record read as well as the hooks and
 * both strips. Ahead of the read is not incidental — a refused write should not
 * cost a driver round-trip either, and the read exists to serve `previous`, the
 * `readonlyWhen` gate and the not-found gate, none of which a refused payload
 * reaches. It is also ahead of the dispatch ladder's own `reject` verdict, so a
 * call that is BOTH mis-keyed and missing its `id`/`multi` is answered on the
 * payload: the ladder's message is about how to address rows and would send an
 * author hunting for the wrong defect, while `INVALID_FIELD` names the typo.
 *
 * ## The verdict is the SCHEMA's field map, and the wire answer is unchanged
 *
 * `INVALID_FIELD` + 400, and the message is byte-identical to the one
 * `mapDataError`'s driver-string branch produced (`Unknown field 'x' on object
 * 'y'`) — so this moves WHERE the refusal is decided without moving what the
 * caller reads. One condition keeps one wire shape however it was noticed, the
 * same rule the read path's dotted-projection and unmaterializable-sort doors
 * record. The driver-string branch stays where it is: it still backstops schema
 * drift (a DECLARED field whose physical column is missing), which this door by
 * construction cannot see.
 *
 * ## Where this door deliberately has NO opinion
 *
 * A door that cannot see the field map must not invent an opinion about it —
 * the read-path doors' rule, and it decides two cases here:
 *
 *  - **`schema.fields` absent** (a registry-less host), and **`schema.fields`
 *    EMPTY**. An empty map is indistinguishable from an unpopulated one: a real
 *    registered object always carries at least its primary key, and the
 *    registry injects the tenancy and audit columns on top, so zero declared
 *    fields means the host did not fill the map in — not that the object
 *    forbids every key. Refusing everything on that reading would be a verdict
 *    made from an absence, which is what this clause exists to prevent.
 *  - **`id` / `created_at` / `updated_at`**, which are tolerated even when the
 *    map does not list them. This mirrors `find()` / `findOne()`, which add
 *    exactly these three to their known set for exactly this reason: they are
 *    provisioned by the platform rather than authored, so an object may legally
 *    omit them from its declaration while the physical table has them. Same
 *    three names, same rationale, so a key accepted by a read is not refused by
 *    a write.
 *
 * In every one of those cases the driver remains the backstop it has always
 * been — nothing is widened, the refusal simply moves back to where it was.
 *
 * @returns one entry per row: an `Error` for a row carrying undeclared keys,
 *   `undefined` for a row that passes. Per row rather than throw-on-first
 *   because the partial-success path (`insertMany`) reports per row and must
 *   cull the bad rows instead of failing the batch around them.
 */
export function undeclaredWriteFieldErrors(
  object: string,
  schema: { fields?: unknown } | undefined,
  rows: readonly unknown[],
): Array<Error | undefined> {
  const out: Array<Error | undefined> = new Array(rows.length);
  // [#21571] The declared set and its "no opinion" cases (no map, an array
  // map, an empty map) are `declaredColumnSet`'s, shared with the read verbs'
  // default projection — one answer to "is this a column of the object".
  const declared = declaredColumnSet(schema);
  if (!declared) return out;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const undeclared = Object.keys(row as Record<string, unknown>).filter((key) => !declared.has(key));
    if (undeclared.length === 0) continue;
    const err: any = new Error(`Unknown field '${undeclared[0]}' on object '${object}'`);
    err.status = 400;
    err.httpStatus = 400;
    err.code = 'INVALID_FIELD';
    err.field = undeclared[0];
    err.fields = undeclared;
    err.object = object;
    out[i] = err as Error;
  }
  return out;
}

/**
 * [#20805] The computed-field door: take every caller-supplied key that names a
 * declared `formula` field out of a write payload, and say which keys went.
 *
 * ## Why a strip
 *
 * A `formula` field is virtual. The engine computes it on every read
 * ({@link applyFormulaPlan}) and no driver has a column for it
 * (`driver-sql`'s `createColumn` emits none), so a full read returns the key
 * and a record written back carries it — the ordinary round trip of a form
 * save, a flow's `update_record`, or `GET` then `PUT`. Before this door the key
 * reached the driver and the driver decided, so the answer split by family:
 * SQL refused the whole statement with its own text (`table … has no column
 * named …`, no status, no field) and the schemaless family stored the value as
 * a shadow column nothing reads. {@link undeclaredWriteFieldErrors} cannot see
 * it: the field IS declared.
 *
 * The platform already has one answer for a declared field a caller cannot
 * write — strip the value, complete the write, report the strip through
 * `onFieldsDropped` (`DroppedFieldsEventSchema`: "stripping is legitimate
 * semantics, not an error") — and a computed field takes it, under its own
 * `reason`, `computed`. ⛔ Never `readonly`, which it is not: the static
 * `readonly` strip exempts `isSystem`, and this one runs in EVERY context
 * because the value has nowhere to land for any caller. ⛔ Never a refusal
 * either: a `400` would make `formula` the one caller-read-only type that
 * refuses where `readonly`, `readonlyWhen` and the primary key strip, and it
 * would refuse every round trip of every object that declares one.
 *
 * ## Where it runs
 *
 * Beside the declared-field door, as the first act of each write verb's body
 * and of {@link ObjectQL.validate} over the same rows: before the defaults, the
 * hooks and every other strip. So a hook is never handed a value that will not
 * be stored (the #16344 invariant), a `formula` field also declared
 * `readonly: true` is reported once, as `computed`, and the preview strips
 * exactly what the write strips. The REPORT is the verb's own report site,
 * beside the other strips' (`insertDrops` on insert, `reportDroppedFields` at
 * the confluence on update) — so `strictReadonlyWrites`, whose coverage is
 * derived from what `onFieldsDropped` reports, refuses a computed drop too.
 *
 * ⛔ Keyed on `type === 'formula'` literally — the test the read path's
 * projection and `driver-sql`'s `fieldHasColumn` use. `summary` is NOT here: a
 * roll-up HAS a column, and a caller-supplied value is persisted (measured on
 * #20805, SQLite and memory) — a separate question, not this door's.
 *
 * Pure: the caller's objects are never mutated. A row keeps its reference when
 * nothing was taken, else it is a shallow copy without the keys.
 *
 * @param refused the declared-field door's per-row verdicts, index-aligned: a
 *   row that door refused is left exactly as it is and counts toward nothing.
 * @returns the rows as the strip leaves them (index-aligned with the input);
 *   the union of the keys it took, in first-seen order — one report per call,
 *   the shape every insert-side strip already reports in; and `droppedPerRow`,
 *   the keys taken from EACH row (index-aligned, `[]` for a row it left alone).
 *   The union and the per-row lists are the same strip's one result read two
 *   ways: the per-row lists are what {@link droppedFieldEvents} attributes
 *   to a row on `validate` and on `insertMany`'s outcomes.
 */
export function stripComputedWriteFields(
  schema: { fields?: unknown } | undefined,
  rows: readonly unknown[],
  refused?: readonly unknown[],
): { rows: unknown[]; dropped: string[]; droppedPerRow: string[][] } {
  const out = rows.slice();
  const dropped: string[] = [];
  const droppedPerRow: string[][] = rows.map(() => []);
  const fields = schema?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { rows: out, dropped, droppedPerRow };
  const computed = Object.entries(fields as Record<string, { type?: unknown } | null | undefined>)
    .filter(([, def]) => def?.type === 'formula')
    .map(([name]) => name);
  if (computed.length === 0) return { rows: out, dropped, droppedPerRow };
  for (let i = 0; i < out.length; i++) {
    if (refused?.[i] !== undefined) continue;
    const row = out[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    // Own-property, never `in` — the same reason `stripReadonlyFields` gives.
    const taken = computed.filter((name) => Object.prototype.hasOwnProperty.call(row, name));
    if (taken.length === 0) continue;
    const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    for (const name of taken) {
      delete copy[name];
      if (!dropped.includes(name)) dropped.push(name);
    }
    droppedPerRow[i] = taken;
    out[i] = copy;
  }
  return { rows: out, dropped, droppedPerRow };
}

/**
 * The strip report as `DroppedFieldsEvent`s: one event per reason, `computed`
 * before `readonly`, then `stored_expression` (#24690) — the order the passes
 * run — and an empty list when nothing was taken.
 *
 * ONE builder for both channels the create-side strips report through, so
 * they cannot disagree on a reason or its order: the batch-level union (the
 * `onFieldsDropped` events of `insert` and {@link ObjectQL.validate}, unchanged
 * by the per-row channel) and the per-row lists (`results[i].droppedFields` on
 * `validate`, `droppedFields` on an `ok` outcome of `insertMany`). The per-row
 * lists are recorded at the strips themselves, never reconstructed from the
 * union: "which rows supplied N" is not "which rows dropped N" once a hook can
 * exempt a key on one row and not another.
 */
export function droppedFieldEvents(
  object: string,
  computed: readonly string[],
  readonly: readonly string[],
  storedExpression: readonly string[] = [],
): DroppedFieldsEvent[] {
  const events: DroppedFieldsEvent[] = [];
  if (computed.length > 0) events.push({ object, fields: [...computed], reason: 'computed' });
  if (readonly.length > 0) events.push({ object, fields: [...readonly], reason: 'readonly' });
  // [#24690] Last: the stored-expression pass runs after every strip.
  if (storedExpression.length > 0) events.push({ object, fields: [...storedExpression], reason: 'stored_expression' });
  return events;
}

/**
 * [#21682] The keys the CALLER sent on each row of an insert, recorded at
 * `insert`'s entry, BEFORE the middleware chain runs, and keyed by the row
 * OBJECT.
 *
 * `insert` takes its caller snapshot (`suppliedPerRow`) inside the middleware
 * chain's innermost step, so by then a write middleware may already have
 * filled the payload: `@objectstack/organizations` fills an absent
 * `organization_id` with the active organization, and
 * `@objectstack/plugin-security` fills an absent `owner_id` with the acting
 * user. Both write IN PLACE, onto the very row objects recorded here. Without
 * this record the snapshot reads those fills as keys the caller sent, so the
 * static-`readonly` strip took the platform's own `organization_id` and
 * `droppedFields` reported it, on every walled create that named no
 * organization. The console announces every non-empty `droppedFields` as a
 * warning toast. This is the insert-side twin of the update path's #8093
 * (ADDRESSING IS NOT PAYLOAD): a value the platform put on the payload is
 * not one the caller lost.
 *
 * Keyed by IDENTITY, not by index, so the answer survives a middleware that
 * reorders a batch. A row a middleware REPLACED wholesale has no entry, and
 * {@link callerSuppliedRow} then keeps every key it carries: the verdict from
 * before this record existed. That is the over-reporting direction, never the
 * under-stripping one.
 *
 * ⛔ No name list. Which keys are the platform's is answered by WHEN they
 * appeared, so a new stamping middleware is covered without being named here.
 */
function callerKeySets(data: unknown): WeakMap<object, ReadonlySet<string>> {
  const sets = new WeakMap<object, ReadonlySet<string>>();
  for (const row of Array.isArray(data) ? data : [data]) {
    if (row !== null && typeof row === 'object' && !sets.has(row)) {
      sets.set(row, new Set(Object.keys(row)));
    }
  }
  return sets;
}

/**
 * One row of `insert`'s caller snapshot: a shallow COPY of the row as the
 * middleware chain handed it on, keeping only the keys the caller sent
 * (`sent`, from {@link callerKeySets}).
 *
 * Only WHICH keys is narrowed. A kept key keeps the value the chain handed
 * on, so every key the caller did send is judged exactly as it was before
 * #21682. `sent` undefined means "this row has no record" and keeps every key.
 */
function callerSuppliedRow(row: unknown, sent: ReadonlySet<string> | undefined): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...((row ?? {}) as Record<string, unknown>) };
  if (sent) {
    for (const key of Object.keys(copy)) {
      if (!sent.has(key)) delete copy[key];
    }
  }
  return copy;
}

/**
 * [#24822] Whether ONE write's static-`readonly` passes leave a non-system
 * caller's `organization_id` on the row for the Layer 0 wall's verdict instead
 * of taking it. The ONE answer both write verbs read: the insert's subject
 * ({@link insertStaticReadonlySubject}) and the update's
 * ({@link updateStaticReadonlySubject}).
 *
 * Three things must hold, and the first is the wall's own word:
 *
 *  1. `wallJudgesOrganization`: the seam the wall installed on THIS write
 *     declares that it judges the stored rows' organization
 *     (`PostHookWriteImageCheck.judgesOrganization`). The caller reads that
 *     member once, for a non-system caller only. [#25062] The write preview
 *     reads the same value from the wall's verdict on each row
 *     (`WriteWallRowVerdict`). Nothing here derives it: where no wall judged
 *     the column, the strip takes a caller's value exactly as before.
 *  2. The object is one the INSERT strip judges, with the column in that
 *     subject ({@link staticReadonlyInsertSubject}). So never the reserved
 *     `sys_` namespace or a platform-internal `managedBy` bucket, whose own
 *     field-write governance a spare must not pre-empt. The UPDATE strip runs
 *     on those objects too (it applies neither exclusion), so on an update
 *     this condition is what keeps a `sys_` row's organization exactly as
 *     before: the update spare covers exactly the objects the insert spare
 *     covers.
 *  3. The column is the platform's injected tenant column, the one
 *     `TENANT_SCOPE_FIELD_DEF` declares read-only on the platform's behalf. An
 *     AUTHORED `organization_id` declared `readonly: true` is the author's own
 *     declaration, and declaration is enforcement: it keeps the strip. Which
 *     one this is, is the registry's own provenance reader, never a second
 *     copy.
 *
 * Why the column is left on the row where all three hold: the wall has
 * already refused, before this engine ran, every supplied value it does not
 * admit, and it judges the stored rows again after the hooks: an insert's
 * rows, an update's prior row merged with the final payload, and on the
 * predicate path every matched row merged with it. So a value that reaches the
 * strip is one the wall admitted, and taking it put another organization in
 * its place (the active one stamped on an insert, the row's own kept on an
 * update). That is a silent replacement of an admitted input, which ADR-0105
 * D5 and the organizations runtime's stamp rule out.
 */
function staticReadonlySparesOrganization(schema: unknown, wallJudgesOrganization: boolean): boolean {
  if (!wallJudgesOrganization) return false;
  const subject = staticReadonlyInsertSubject(schema as any);
  if (!subject || !Object.prototype.hasOwnProperty.call(subject.fields, SystemFieldName.ORGANIZATION_ID)) return false;
  return resolveInjectedColumnProvenance(schema, SystemFieldName.ORGANIZATION_ID) !== 'author';
}

/**
 * [#24822] The fields ONE insert's static-`readonly` passes may judge: the
 * {@link staticReadonlyInsertSubject} view, without `organization_id` where
 * {@link staticReadonlySparesOrganization} spares it.
 *
 * ONE function for both passes that read the subject, the pre-hook withhold
 * and the post-hook strip, so the hook view and the stored row cannot
 * disagree about the column. [#25062] The write preview's strip reads it too.
 */
export function insertStaticReadonlySubject(
  schema: unknown,
  wallJudgesOrganization: boolean,
): ReturnType<typeof staticReadonlyInsertSubject> {
  const subject = staticReadonlyInsertSubject(schema as any);
  if (!subject || !staticReadonlySparesOrganization(schema, wallJudgesOrganization)) return subject;
  const fields = { ...subject.fields };
  delete fields[SystemFieldName.ORGANIZATION_ID];
  return Object.keys(fields).length > 0 ? { name: subject.name, fields } : null;
}

/**
 * [#24822] The schema view ONE update's static-`readonly` passes judge: the
 * object's whole registered schema, because the update strip applies neither
 * of the insert subject's exclusions, without `organization_id` where
 * {@link staticReadonlySparesOrganization} spares it. `schema` itself
 * otherwise, so every update the spare does not reach is judged exactly as
 * before.
 *
 * ONE function for every pass that asks the update's static strip: the
 * pre-hook hide pass (what `beforeUpdate` is shown), the by-id and predicate
 * strips (what is stored), and {@link staticReadonlyStoredView}, which the
 * `readonlyWhen` strips and the master-detail settlement read. `update()`
 * reads the wall's flag once and hands that one value to all of them, so the
 * hook view and the stored row cannot disagree about the column. [#25062] The
 * `update`-mode preview's strip reads it too.
 */
export function updateStaticReadonlySubject(schema: unknown, wallJudgesOrganization: boolean): unknown {
  if (!staticReadonlySparesOrganization(schema, wallJudgesOrganization)) return schema;
  const { name, fields } = schema as { name?: string; fields: Record<string, unknown> };
  const kept = { ...fields };
  delete kept[SystemFieldName.ORGANIZATION_ID];
  return { name, fields: kept };
}

/**
 * [#22306] The insert side of the #16344 invariant — a hook is never handed a
 * value that will not be stored. Takes out of ONE caller row every value the
 * create-side static-`readonly` strip will take, before the defaults and
 * before `beforeInsert`, and says what it took.
 *
 * ## What was measured broken
 *
 * `insert()` dispatched `beforeInsert` on the caller's payload and ran the
 * runtime-owned and static-`readonly` strips after it. A hook that stamps a
 * read-only column only when it is absent — `if (!data.stage_entry_date)` —
 * saw the caller's value, stood down, and the strip then took that value: the
 * row stored NULL where the hook would have stamped today. Real engine over
 * `driver-sql` (better-sqlite3), non-system context: caller value present ⇒
 * stored `stage_entry_date` NULL; key absent ⇒ stored the hook's stamp. The
 * update path has hidden these values from its hooks since #16344; insert
 * did not.
 *
 * ## The SAME function as the strip, so the two cannot disagree
 *
 * `stripReadonlyFields` over {@link staticReadonlyInsertSubject} with no
 * `preserveAudit` — the function, subject and options the post-hook
 * static-`readonly` strip (`staticReadonlyCreateStrip`) runs. Before any hook
 * has run there is no hook write to spare, so what it would take here is what
 * it WILL take after the hooks unless a hook assigns the key. A key it would
 * keep — middleware-filled (not in `supplied`), or on a `sys_` or
 * platform-internal object — is still shown to the hook.
 *
 * ⛔ Runtime-owned values (`autonumber`) are NOT withheld, though the
 * runtime-owned strip takes them after the hooks too. #6339 keeps the caller's
 * record number visible to `beforeInsert` on purpose, so a guard can report
 * what the caller submitted — pinned as "the hook can still SEE the
 * caller-submitted record number" (`engine-insert-runtime-owned-strip.test.ts`)
 * and by #14259's provenance seam. Moving that is a decision of its own, not a
 * rider on this one.
 *
 * ⚠️ One narrowing, and it is the create side's own declared channel rather
 * than a second opinion: under `preserveAudit` the audit timeline
 * (`AUDIT_PROVENANCE_FIELDS`) stays visible. The static strip takes those keys
 * on a create whatever the flag says (the 2026-08-08 ruling made its
 * `preserveAudit` exemption UPDATE-only), but the historical-import channel the
 * 2026-09-06 ruling (#15964) kept working reinstates them THROUGH the audit
 * binder's `preserveAudit` branch (`record.created_at ?? now`, `plugin.ts`) —
 * a `beforeInsert` hook reading the caller's value and assigning it back, which
 * the strip then keeps as a hook write. Those values ARE stored, so they are
 * not withheld; withholding them would erase every historical `created_at` an
 * import carries. A business `readonly` column under `preserveAudit` is still
 * withheld: the create side strips it (and says so in the WARN).
 *
 * ## Why before the DEFAULTS
 *
 * So the hook is shown exactly the row a caller who never sent the key would
 * have produced: `applyFieldDefaults` then fills a withheld key from its
 * `defaultValue`, just as it fills any absent key, and that default IS what
 * the create stores for it (`staticReadonlyCreateStrip` re-derives it after
 * the strip). A forged `approval_status: 'approved'` is shown as `'draft'`,
 * never as a hole — the hook cannot tell the two callers apart, which is the
 * point. A key with no default reads absent, which is what the row will hold.
 *
 * Pure: neither the caller's row nor `supplied` is touched. The row keeps its
 * reference when nothing was taken, else it is a shallow copy without the keys.
 *
 * [#24822] `wallJudgesOrganization` spares `organization_id` here exactly as
 * the post-hook strip spares it ({@link insertStaticReadonlySubject}). A value
 * the wall judges will be stored, so the hook is shown it.
 *
 * @returns the row the hook view is built from, and the withheld keys with the
 *   caller's values (`undefined` when nothing was withheld) — handed back after
 *   the hooks by {@link handBackWithheldInsertReadonly}.
 */
function withholdInsertReadonlyFromHooks(
  schema: unknown,
  row: Record<string, unknown>,
  supplied: Readonly<Record<string, unknown>>,
  preserveAudit: boolean,
  wallJudgesOrganization: boolean,
): { row: Record<string, unknown>; withheld: Record<string, unknown> | undefined } {
  let subject = insertStaticReadonlySubject(schema, wallJudgesOrganization);
  if (subject && preserveAudit) {
    const fields = { ...subject.fields };
    for (const name of AUDIT_PROVENANCE_FIELDS) delete fields[name];
    subject = Object.keys(fields).length > 0 ? { name: subject.name, fields } : null;
  }
  if (!subject) return { row, withheld: undefined };
  // No logger and no `strictReadonlyWrites`, deliberately: this pass is SILENT
  // by construction. The strip after the hooks owns every word said about
  // these keys — the WARN, `onFieldsDropped`, the strict refusal — and says it
  // over the handed-back payload exactly as it did before this pass existed.
  const shown = stripReadonlyFields(subject as any, row, supplied, undefined) as Record<string, unknown>;
  if (shown === row) return { row, withheld: undefined };
  const withheld: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (!(key in shown)) withheld[key] = row[key];
  }
  return { row: shown, withheld };
}

/**
 * [#22306] The other end of {@link withholdInsertReadonlyFromHooks}: put the
 * caller's withheld values back on a row after its `beforeInsert` dispatch is
 * SEALED, wherever the hook did not write the key — so the strips below judge,
 * take, re-default, WARN, report and (under `strictReadonlyWrites`) refuse
 * exactly the payload they judged before the hide existed.
 *
 * The update path's hand-back (#16344), carried over with one addition the
 * insert view needs: a withheld key may have been SHOWN holding its
 * `defaultValue` (`shown`), so "the hook left it alone" is not always "the key
 * is absent". Per key:
 *
 *  - present and `undefined` ⇒ the `data.x = data.x` self-assignment of a key
 *    the hook was shown absent. Undone (deleted, dropped from the record) and
 *    handed back, as on update: no driver can store `undefined`, and the write
 *    must read exactly as it would with no hook at all.
 *  - absent ⇒ handed back unless the hook was shown a value there, in which
 *    case the hook REMOVED it, and the removal stands — the row a caller who
 *    never sent the key would have stored.
 *  - present, record available ⇒ handed back unless a hook assigned the key
 *    (`hookWrittenKeys`): an untouched default is replaced by the caller's
 *    value, which the static strip then takes and re-defaults to the same
 *    value it showed.
 *  - present, no record (a hook replaced the payload object) ⇒ the #5591 value
 *    test: handed back only while it still holds exactly what was shown.
 *
 * ⛔ Never over a hook's write, and placed AFTER the seal: a hand-back inside
 * the recording window would enter the record as a hook write, and the strip
 * would then keep the caller's forgery as the hook's — the laundering #14088
 * exists to prevent. Every key handed back is dropped from the returned record
 * for the same reason.
 *
 * @returns the row's `hookWrittenKeys`, narrowed by every key handed back
 *   (`undefined` stays `undefined`).
 */
function handBackWithheldInsertReadonly(
  target: Record<string, unknown>,
  withheld: Readonly<Record<string, unknown>>,
  shown: ReadonlyMap<string, unknown>,
  hookWrittenKeys: ReadonlySet<string> | undefined,
): ReadonlySet<string> | undefined {
  let narrowed: Set<string> | undefined;
  for (const [key, callerValue] of Object.entries(withheld)) {
    const present = Object.prototype.hasOwnProperty.call(target, key);
    let handBack: boolean;
    if (present && target[key] === undefined) {
      delete target[key];
      handBack = true;
    } else if (!present) {
      handBack = !shown.has(key);
    } else if (hookWrittenKeys !== undefined) {
      handBack = !hookWrittenKeys.has(key);
    } else {
      handBack = shown.has(key) && Object.is(target[key], shown.get(key));
    }
    if (!handBack) continue;
    target[key] = callerValue;
    if (hookWrittenKeys?.has(key)) {
      narrowed ??= new Set(hookWrittenKeys);
      narrowed.delete(key);
    }
  }
  return narrowed ?? hookWrittenKeys;
}

/**
 * Evaluate formula virtual fields against the raw rows a driver handed back —
 * the read path (`find` / `findOne`) and, since #5504, the write path's
 * response hydration.
 *
 * Since #10280 this is also where a formula field's declared `scale` is
 * applied: the value is rounded on its way onto the record, so every consumer
 * of every one of those three call sites inherits the same rounded number.
 * {@link roundFormulaValue} carries the arithmetic and the reason the rounding
 * belongs at this producer rather than in the validator.
 *
 * The eval context is built ONCE per call and reused for every row × every
 * formula field, and that is where this function's determinism comes from: one
 * `now`, so a `now()`/`today()` formula cannot drift mid-operation, plus
 * `os.user` / `os.org` resolved from the execution context (so a computed field
 * can reference the caller, e.g. `os.user.id`). Previously this passed only
 * `{ record }`, so `now()`/`today()` ran against live wall-clock and user/org
 * were unreachable.
 *
 * [#20082] `permissions` is the acting subject's effective object-permission
 * map, the one `current_user.can(object, verb)` answers from. The CALLER
 * resolves it — at most once per operation, and only when a planned formula
 * calls `can` ({@link ObjectQL.resolveFormulaPermissions}) — because this
 * function is synchronous and owns no resolver. `undefined` is "no permission
 * data", never an empty map: a `can`-calling formula then fails to evaluate and
 * reads `null`, the rule every formula that does not evaluate follows here, and
 * the caller has already said why in its log line.
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
/**
 * [#10280] Apply a formula field's declared `scale` to the value its
 * expression just produced.
 *
 * ## Why the rounding lives HERE and not in the validator
 *
 * `validateFieldValue`'s `scale` branch is the package's only other `.scale`
 * reader and the tempting seam — and it is the wrong one. That branch enforces
 * `scale` by REJECTION (`max_scale`) under the maintainer's 2026-08-11 ruling,
 * because a caller-supplied value has somebody to refuse and silently rounding
 * it would be silently altering their data. A formula result is
 * platform-computed: there is nobody to refuse, and the alternative to
 * rounding is not "the author's exact number", it is fifteen digits of IEEE-754
 * tail on a record page. Two different values, two different answers, one
 * declaration — so the rounding is applied at the PRODUCER, on plan entries
 * that are `type === 'formula'` only, and the rejection path is left
 * structurally untouched.
 *
 * ## The arithmetic
 *
 * `Number(v.toFixed(scale))`, the same expression objectui's `computeRow`
 * (`GridField.tsx`) uses for a grid's client-side computed column, so the two
 * halves of one platform round a computed number the same way. Per ECMA-262
 * `toFixed` extracts the sign first and then picks the larger `n` on a tie:
 * round-half-**away from zero** on the magnitude. Measured, because the
 * opposite was believed at dispatch time: `2.5 → 3`, `1.25 → 1.3`,
 * `0.125 → 0.13`, `-1.5 → -2`, `-2.5 → -3`. ⚠️ Negatives round away from zero,
 * NOT toward `+Infinity`.
 *
 * Three guards, each closing a measured failure rather than a hypothetical:
 *
 *  - **`typeof value === 'number'`** — a formula legitimately returns a string
 *    (`"tier:" + record.tier`), a boolean, or `null`, and `'x'.toFixed` does
 *    not exist. Without this guard one scale-declaring string formula throws
 *    and takes down every read of every record of that object.
 *  - **`Number.isFinite`** — `NaN.toFixed(2)` yields the STRING `'NaN'`, and
 *    `1.0 / 0.0` really does reach here as `Infinity`. Both round-trip through
 *    `Number(...)` unchanged, so this guard alters no value; it is kept so the
 *    helper is total by construction rather than by a coincidence of two
 *    library behaviours. (For `|v| >= 1e21` `toFixed` returns exponential form,
 *    `'1e+21'`, which `Number()` round-trips losslessly — the rounding degrades
 *    to a no-op instead of corrupting the value, so that case needs no guard.)
 *  - **negative zero** — `(-0.001).toFixed(2)` is `'-0.00'` and `Number()`
 *    makes that `-0`. It JSON-serializes as `0`, but `Intl.NumberFormat`
 *    formats it as `-0.00`, which would put a brand-new display wart on the
 *    very record page this issue is about. Normalized to `+0` at the producer,
 *    where it costs one comparison, rather than in each renderer.
 */
function roundFormulaValue(value: unknown, scale: number | undefined): unknown {
  if (scale === undefined) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const rounded = Number(value.toFixed(scale));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * [#22019] Where {@link applyFormulaPlan} reports a formula it could not
 * evaluate: the field it was computing and the evaluator's own error. The
 * engine binds one per call to the object being read, so the report names the
 * (object, field) pair — see {@link ObjectQL.formulaFaultSink}.
 */
type FormulaFaultSink = (field: string, error: EvalError) => void;

/**
 * [#24197] What a formula read hands {@link applyFormulaPlan} for the hops its
 * plan reads: the per-row related bindings
 * ({@link ObjectQL.resolveFormulaRelated}), or — when this read serves no hop
 * at all — the sentence saying why, which every traversing formula of the read
 * then reports.
 *
 * [#24410] `undeclared` is decided per FORMULA, never per reference: the
 * related fields a reference's target does not declare, which the shared read
 * never asks for. A formula naming one of them reads `null` with the
 * `undeclared-field` reason; a sibling reading only declared fields through the
 * same reference is served from the shared read exactly as it is alone.
 */
type FormulaRelated = {
  readonly bindings: (row: Record<string, unknown>) => RelatedRecordBinding | undefined;
  readonly undeclared: ReadonlyMap<string, { readonly object: string; readonly fields: ReadonlySet<string> }>;
} | string;

/**
 * [#24410] The named related fields a reference's target does not DECLARE —
 * the one reading both seams that serve a hop make of it: the shared loader
 * ({@link ObjectQL.resolveOneHopRelated}) and the formula read, which judges
 * them per formula ({@link ObjectQL.resolveFormulaRelated}).
 *
 * [#8215] The PRIMARY KEY counts as declared, though no field map carries it:
 * `record.<fk>.id` is the repair the traversal conflict refusal prescribes. An
 * unknown target (`declared` absent) declares nothing to judge against, so
 * nothing is undeclared.
 */
export function undeclaredRelatedFields(
  declared: Record<string, unknown> | undefined,
  named: Iterable<string>,
): string[] {
  if (!declared) return [];
  return [...named].filter((n) => n !== SystemFieldName.ID && !(n in declared));
}

/** [#24197] Why a hop was not served where no reader supplied one. */
const FORMULA_HOP_NOT_SERVED =
  'this evaluation reads no related record — only a read (`find` / `findOne`) or a write\'s response '
  + 'preloads the one hop a formula reads through a reference';

/**
 * [#24197] The record ONE formula is evaluated against: a shallow copy whose
 * reference fields this formula reads through carry the related row, or the
 * reason it cannot be evaluated at all.
 *
 * The validation path's verdicts, kept ({@link RelatedFieldBinding}): a related
 * record that was not found — or that this reader may not read, which a
 * caller-authority read cannot tell apart and must not — a related object that
 * declares no such field, and a failed read each leave the formula UNEVALUATED,
 * so it reads `null` WITH a reason, never a value computed over a record that
 * was not there. ⛔ Never a fallback evaluated in its place: an optional read
 * would turn "not found" into the author's empty-reference default, which is
 * data the reader cannot tell from a real answer.
 *
 * An EMPTY reference is the one case that is evaluated: the author can say
 * what an empty reference means (`record.book.?title.orValue('—')`), and the
 * field keeps its stored empty value, so a plain read through it faults
 * exactly as before and the fault names the repair (`empty`).
 *
 * Per formula, onto a copy: hydrating replaces a reference's stored id with a
 * row, and a sibling formula that reads the id, and the record the read
 * returns, must keep seeing the id.
 */
function formulaHopScope(
  rec: Record<string, unknown>,
  hops: ReadonlyMap<string, ReadonlySet<string>>,
  related: FormulaRelated | undefined,
): { ok: true; record: Record<string, unknown>; empty: string[] } | { ok: false; reason: string } {
  if (related === undefined || typeof related === 'string') {
    return { ok: false, reason: related ?? FORMULA_HOP_NOT_SERVED };
  }
  // [#24410] This formula's own undeclared reads first, before any row: they
  // are a fault of the expression, whatever the record holds.
  for (const [field, named] of hops) {
    const missing = related.undeclared.get(field);
    const own = missing ? [...named].filter((n) => missing.fields.has(n)) : [];
    if (missing && own.length > 0) {
      return {
        ok: false,
        reason: formulaHopRefusal(field, { object: missing.object, unavailable: 'undeclared-field', undeclaredFields: own }, named),
      };
    }
  }
  const binding = related.bindings(rec);
  let copy: Record<string, unknown> | undefined;
  const empty: string[] = [];
  for (const [field, named] of hops) {
    const b = binding?.[field];
    if (!b) return { ok: false, reason: FORMULA_HOP_NOT_SERVED };
    // ⛔ Only the row this record's own foreign key names.
    if (b.row && b.row.id != null && String(b.row.id) === String(rec[field])) {
      if (!copy) copy = { ...rec };
      copy[field] = b.row;
      continue;
    }
    if (!b.row && b.unavailable === 'no-reference') { empty.push(field); continue; }
    return { ok: false, reason: formulaHopRefusal(field, b, named) };
  }
  return { ok: true, record: copy ?? rec, empty };
}

/**
 * [#24197] The sentence a formula that could not read its hop reports. It names
 * the RELATED object and field, as the validation path's refusal does, and it
 * never says WHICH of "not found" and "not readable by this reader" held: a
 * reader who may not see the related record learns nothing from the formula.
 */
function formulaHopRefusal(field: string, b: RelatedFieldBinding, named: ReadonlySet<string>): string {
  const columns = [...named].sort().map((n) => `'${n}'`).join(', ');
  const on = `\`${field}\` (object '${b.object}')`;
  switch (b.unavailable) {
    case 'undeclared-field': {
      const missing = (b.undeclaredFields ?? []).map((n) => `'${n}'`).join(', ') || columns;
      return `the formula reads ${missing} through ${on}, but '${b.object}' declares no such field: fix the `
        + `expression, or declare ${missing} on '${b.object}' — not on the object carrying this formula`;
    }
    case 'unreadable':
      return `the formula reads ${columns} through ${on}, and that read failed, so it has no value`;
    case 'no-reference':
    case 'unresolved':
    default:
      return `the formula reads ${columns} through ${on}, and the record it names was not found by this `
        + 'read (it does not exist, or this reader may not read it), so it has no value';
  }
}

/**
 * What a formula field reports when it evaluated to the invalid Date that
 * `date()` / `datetime()` answer for text they cannot parse
 * ({@link isUnparseableDate}). An EMPTY source is not this fault: it reads
 * `null` and says nothing. The record's text is not quoted — a log line is no
 * place for row data.
 */
const UNPARSEABLE_DATE_FAULT =
  'date() / datetime() was handed text it cannot parse as a date, so the formula has no value on this record; '
  + 'they take ISO text (`2026-03-04`, `2026-03-04T09:30:00Z`), a timestamp or epoch milliseconds, and an empty '
  + 'source reads null without a report.';

function applyFormulaPlan(
  plan: FormulaPlanEntry[],
  records: any[],
  execCtx?: ExecutionContext,
  permissions?: EvalPermissions,
  onFault?: FormulaFaultSink,
  related?: FormulaRelated,
  /**
   * [#26608] What `label(record.<field>)` reads: the object's option labels,
   * built once per call by {@link readerOptionLabels} (a read, in the reader's
   * locale) or {@link declaredOptionLabels} (a stored expression). `undefined`
   * when no formula of the plan calls `label()`.
   */
  optionLabels?: EvalOptionLabels,
): void {
  if (!plan.length) return;
  const now = new Date();
  const timezone = execCtx?.timezone;
  const user = execCtx?.userId ? { id: String(execCtx.userId), positions: execCtx?.positions ?? [] } : undefined;
  const org = execCtx?.tenantId ? { id: String(execCtx.tenantId) } : undefined;
  for (const rec of records) {
    if (rec == null) continue;
    for (const fp of plan) {
      // [#24197] A traversal the one-hop read cannot serve is not evaluated:
      // it reads null and says why, in the lint's own words.
      if (fp.hopConflict) {
        rec[fp.name] = null;
        onFault?.(fp.name, { kind: 'runtime', message: fp.hopConflict });
        continue;
      }
      let scope: Record<string, unknown> = rec;
      let empty: string[] = [];
      if (fp.hops) {
        const hop = formulaHopScope(rec, fp.hops, related);
        if (!hop.ok) {
          rec[fp.name] = null;
          onFault?.(fp.name, { kind: 'runtime', message: hop.reason });
          continue;
        }
        scope = hop.record;
        empty = hop.empty;
      }
      const evaluated = ExpressionEngine.evaluate(fp.expression, { now, timezone, user, org, permissions, optionLabels, record: scope });
      // An invalid Date minted from text `date()` could not parse evaluates
      // `ok` (a predicate relies on that) but serializes to the `null` an empty
      // source gives: for a field it is a fault, said like any other.
      const r = evaluated.ok && isUnparseableDate(evaluated.value)
        ? { ok: false as const, error: { kind: 'runtime' as const, message: UNPARSEABLE_DATE_FAULT } }
        : evaluated;
      if (r.ok) {
        rec[fp.name] = roundFormulaValue(r.value, fp.scale);
        continue;
      }
      // [#22019] The answer stays `null` — a formula that cannot be computed
      // has no value, and changing what a read returns is a protocol change.
      // What changes is that the fault is no longer swallowed (ADR-0032: a
      // call site must not silently turn a bad expression into `null`): the
      // sink names the field and the evaluator's error.
      rec[fp.name] = null;
      onFault?.(fp.name, empty.length === 0 ? r.error : {
        ...r.error,
        // [#24197] The fault on a record whose reference is EMPTY names the
        // repair first; the evaluator's own message follows it.
        message: `${empty.map((f) => `\`${f}\``).join(', ')} holds no single reference on this record (it is `
          + 'empty, or holds several), so the formula has no related record to read through it; to give the '
          + `formula a value while it is empty, write the optional read \`record.${empty[0]}.?<related field>.orValue('…')\`.\n${r.error.message}`,
      });
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
 *  - [#20082] the permission map comes from the same place find's does:
 *    `permissionsFor` is the engine's {@link ObjectQL.resolveFormulaPermissions}
 *    bound to the WRITE's own resolution, so a write that already resolved the
 *    map for a default or an option gate reuses it rather than asking again.
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
async function hydrateWriteFormulas(
  schema: any,
  results: unknown[],
  execCtx: ExecutionContext | undefined,
  permissionsFor: (plan: FormulaPlanEntry[], records: readonly unknown[]) => Promise<EvalPermissions | undefined>,
  onFault?: FormulaFaultSink,
  /** [#24197] The hops the plan reads, resolved over `records` as a read resolves them. */
  relatedFor?: (plan: FormulaPlanEntry[], records: ReadonlyArray<Record<string, unknown>>) => Promise<FormulaRelated | undefined>,
  /** [#26608] The option labels `label()` reads, in the writer's locale — the reader of this response. */
  optionLabelsFor?: (plan: FormulaPlanEntry[]) => EvalOptionLabels | undefined,
): Promise<void> {
  const records = results.filter(
    (r): r is Record<string, unknown> => r != null && typeof r === 'object',
  );
  if (records.length === 0) return;
  const { plan } = planFormulaProjection(schema, undefined);
  if (plan.length === 0) return;
  applyFormulaPlan(
    plan, records, execCtx, await permissionsFor(plan, records), onFault, await relatedFor?.(plan, records),
    optionLabelsFor?.(plan),
  );
}

/**
 * [#24619] The stored computed fields: every field that is NOT a `formula`
 * and declares an `expression`. Such a field has a column, so a summary can
 * roll it up (a summary aggregates stored columns, never an on-read formula),
 * and its value is the engine's to compute on every write — the declared
 * `expression` over the row the write stores. A client-sent value never
 * stands: it is overwritten by the computed one, the way the console grid
 * already recomputes the column client-side. Planned with the `formula` read
 * plan's own entry builder ({@link formulaPlanEntry}), so the scale rounding
 * and the one hop are the read's.
 *
 * An empty plan for an object declaring none — the common case — so a write
 * on an ordinary object pays a field-name loop and nothing else.
 */
function planStoredExpressions(schema: any): FormulaPlanEntry[] {
  const fields = schema?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return [];
  const plan: FormulaPlanEntry[] = [];
  for (const [name, def] of Object.entries(fields as Record<string, any>)) {
    if (def && typeof def === 'object' && def.type !== 'formula' && def.expression) {
      plan.push(formulaPlanEntry(name, def, fields));
    }
  }
  return plan;
}

/** [#25073] {@link storedExpressionsReading}'s per-source member reads, bounded like the rule validator's cache. */
const storedExpressionReadsCache = new Map<string, ReadonlySet<string> | null>();
const STORED_EXPRESSION_READS_CACHE_CAP = 512;

/** The `record.<field>` names one plan entry reads, or `null` when the platform's member reader cannot say. */
function storedExpressionReads(entry: FormulaPlanEntry): ReadonlySet<string> | null {
  const expr = entry.expression as { dialect?: string; source?: unknown } | undefined;
  if (!expr || (expr.dialect !== undefined && expr.dialect !== 'cel') || typeof expr.source !== 'string') return null;
  const hit = storedExpressionReadsCache.get(expr.source);
  if (hit !== undefined) return hit;
  const analysis = analyzeRelationshipTraversals(expr.source);
  const reads = analysis ? new Set([...analysis.bareFields, ...analysis.traversals.keys()]) : null;
  if (storedExpressionReadsCache.size < STORED_EXPRESSION_READS_CACHE_CAP) storedExpressionReadsCache.set(expr.source, reads);
  return reads;
}

/**
 * [#25073] The entries of a stored-expression plan that read one of `fields`
 * (the object's `autonumber` fields), directly or through another entry that
 * does, in plan order: the stored fields an insert must compute again once
 * the record number is issued, because every earlier pass ran before it
 * existed.
 *
 * Reads are the platform's one member reader's (`analyzeRelationshipTraversals`,
 * `record.x`, `record.?x`, `record['x']`, inside `has()` too), so this cannot
 * disagree with the lint about which spellings name a field. An entry whose
 * reads it cannot name (another dialect) counts as a reader: computing it
 * twice costs a pass, missing it stores a stale value.
 */
function storedExpressionsReading(plan: FormulaPlanEntry[], fields: ReadonlySet<string>): FormulaPlanEntry[] {
  if (plan.length === 0 || fields.size === 0) return [];
  const moved = new Set(fields);
  const readers = new Set<FormulaPlanEntry>();
  for (let grew = true; grew;) {
    grew = false;
    for (const entry of plan) {
      if (readers.has(entry)) continue;
      const reads = storedExpressionReads(entry);
      if (reads !== null && ![...reads].some((name) => moved.has(name))) continue;
      readers.add(entry);
      moved.add(entry.name);
      grew = true;
    }
  }
  return plan.filter((entry) => readers.has(entry));
}

/** The `autonumber` fields an object declares. */
function autonumberFieldNames(schema: any): Set<string> {
  const names = new Set<string>();
  const fields = schema?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return names;
  for (const [name, def] of Object.entries(fields as Record<string, any>)) {
    if (def?.type === 'autonumber') names.add(name);
  }
  return names;
}

/** What {@link computeStoredExpressions} reads its permission map, fault sink and hops from. */
interface StoredExpressionServing {
  permissionsFor: (plan: FormulaPlanEntry[], records: readonly unknown[]) => Promise<EvalPermissions | undefined>;
  onFault?: FormulaFaultSink;
  relatedFor?: (plan: FormulaPlanEntry[], records: ReadonlyArray<Record<string, unknown>>) => Promise<FormulaRelated | undefined>;
  /**
   * [#26608] The option labels `label()` reads — always the DECLARED ones
   * ({@link declaredOptionLabels}): a stored value is computed once and read by
   * every later reader and by search, so it never depends on the writer's locale.
   */
  optionLabelsFor?: (plan: FormulaPlanEntry[]) => EvalOptionLabels | undefined;
}

/**
 * [#24619] Compute a stored-expression plan over each IMAGE — the row the
 * write stores: the stored row merged with the patch on an update, the
 * defaulted payload on an insert — and answer each image's computed values,
 * index-aligned. Evaluates against shallow COPIES, so an image is never
 * mutated; the caller writes the values onto the payload it hands the driver.
 * An expression that does not evaluate computes `null`, the formula read
 * path's answer, with the fault reported once through `onFault`.
 */
async function computeStoredExpressions(
  plan: FormulaPlanEntry[],
  images: ReadonlyArray<Record<string, unknown>>,
  execCtx: ExecutionContext | undefined,
  serving: StoredExpressionServing,
): Promise<Array<Record<string, unknown>>> {
  if (plan.length === 0 || images.length === 0) return images.map(() => ({}));
  const scratch = images.map((image) => ({ ...image }));
  applyFormulaPlan(
    plan, scratch, execCtx, await serving.permissionsFor(plan, scratch), serving.onFault,
    await serving.relatedFor?.(plan, scratch), serving.optionLabelsFor?.(plan),
  );
  return scratch.map((row) => {
    const values: Record<string, unknown> = {};
    for (const entry of plan) values[entry.name] = row[entry.name];
    return values;
  });
}

/**
 * [#25073] The stored fields an insert computes again once it holds a record
 * number ({@link storedExpressionsReading}), with what computing them reads.
 */
interface AutonumberReaders {
  readonly plan: FormulaPlanEntry[];
  readonly execCtx: ExecutionContext | undefined;
  readonly serving: StoredExpressionServing;
  /** The {@link ObjectQL.registerInsertRecomputeListener} listeners, told per row; absent when none is registered. */
  readonly recomputed?: (row: Record<string, unknown>, fields: string[]) => Promise<void>;
}

/**
 * [#25073] Compute the readers again over rows that now carry their issued
 * number, and write the values onto the rows the driver is handed — the step
 * that makes the stored value the declared expression over the stored row.
 * The replaced-value report is NOT made again: it judged the caller's value
 * once, before validation and before any number existed.
 */
async function recomputeAutonumberReaders(
  readers: AutonumberReaders | undefined,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (!readers || readers.plan.length === 0 || rows.length === 0) return;
  const computed = await computeStoredExpressions(readers.plan, rows, readers.execCtx, readers.serving);
  rows.forEach((row, k) => Object.assign(row, computed[k]));
  if (!readers.recomputed) return;
  const fields = readers.plan.map((entry) => entry.name);
  for (const row of rows) await readers.recomputed(row, fields);
}

/**
 * [#24619] The one value a PREDICATE update can store for each stored
 * computed field, judged over every matched row. `updateMany` writes ONE
 * patch to all of them, so a field is set only when the patch moves it to the
 * same value on every row; a patch that does not move it at all (it touches
 * none of the expression's inputs) leaves the column alone, and a caller-sent
 * value for it is taken out of the patch either way — it never stands. A patch
 * that moves it to different values on different rows cannot be one
 * statement, and is refused before anything is written: update those rows by
 * id, where each is computed from its own stored row.
 */
function settleBulkStoredExpressions(
  plan: FormulaPlanEntry[],
  patch: Record<string, unknown>,
  before: ReadonlyArray<Record<string, unknown>>,
  after: ReadonlyArray<Record<string, unknown>>,
  object: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };
  const refused: FieldValidationError[] = [];
  for (const entry of plan) {
    delete out[entry.name];
    const moved = after.some((values, i) => !Object.is(values[entry.name], before[i]?.[entry.name]));
    if (!moved) continue;
    const first = after[0]?.[entry.name];
    if (after.every((values) => Object.is(values[entry.name], first))) {
      out[entry.name] = first;
      continue;
    }
    refused.push({
      field: entry.name,
      code: 'invalid_value',
      message: `'${entry.name}' on '${object}' is computed from its expression on every write, and this `
        + 'update changes its inputs on rows where it then computes different values, which one update of '
        + 'all the matched rows cannot store; update those rows by id, so each is computed from its own row',
    });
  }
  if (refused.length > 0) throw new ValidationError(refused);
  return out;
}

/**
 * [#24619] Write a by-id update's computed values onto its patch: a key the
 * caller (or a hook) sent is overwritten, and a key the patch does not carry
 * is added only when the computed value differs from the stored one — a patch
 * that moves none of the expression's inputs writes nothing extra.
 */
function applyStoredExpressionsToPatch(
  patch: Record<string, unknown>,
  computed: Record<string, unknown>,
  prior: Record<string, unknown> | null | undefined,
): void {
  for (const [name, value] of Object.entries(computed)) {
    if (Object.prototype.hasOwnProperty.call(patch, name) || !Object.is(prior?.[name], value)) patch[name] = value;
  }
}

/**
 * [#24690] The stored computed fields whose CALLER value this write replaced —
 * reported through `onFieldsDropped` under `stored_expression`, so a client
 * that sent `amount: 1` is told its value did not stand, as #3407 rules for
 * every other write-path strip, rather than reading success over a row that
 * holds the computed value.
 *
 * A field is reported when all three hold:
 *  - the caller SENT it (`supplied`, the write's entry snapshot of the
 *    caller's values — never the live payload, which the pre-hook pass and the
 *    hooks have since written to);
 *  - it is still on the payload the compute pass reads (`present`): a value
 *    another strip took — a stored expression field also declared `readonly`
 *    — is that strip's to report, under its own reason, never twice;
 *  - the value STORED differs from the caller's on at least one row
 *    (`stored`: the one row of an insert or a by-id update, every matched row
 *    of a predicate update). A client that sends the computed value — the
 *    console grid's consistent save — is told nothing, because nothing it
 *    sent was replaced.
 *
 * `Object.is`, the comparison the compute passes themselves use: the caller's
 * values were normalized (blank and numeric strings) before the snapshot.
 */
function replacedStoredExpressionFields(
  plan: readonly FormulaPlanEntry[],
  supplied: Readonly<Record<string, unknown>> | undefined,
  present: Readonly<Record<string, unknown>> | null | undefined,
  stored: ReadonlyArray<Readonly<Record<string, unknown>>>,
): string[] {
  if (!supplied || !present) return [];
  const replaced: string[] = [];
  for (const { name } of plan) {
    if (!Object.prototype.hasOwnProperty.call(supplied, name)) continue;
    if (!Object.prototype.hasOwnProperty.call(present, name)) continue;
    if (stored.some((row) => !Object.is(row?.[name], supplied[name]))) replaced.push(name);
  }
  return replaced;
}

/**
 * Materialize ONE declared `formula` field against a record already in hand —
 * the read path's own evaluation, narrowed to a single field, with no round
 * trip (#11293).
 *
 * ## Why this exists rather than a second evaluator
 *
 * A hook body cannot reach a formula field: `ctx.previous` / `ctx.input` carry
 * STORED columns, and a formula is computed on read, so a body that wants the
 * record's title has to rebuild the formula inline. Measured in the exemplar
 * app: five inline reimplementations of a record title inside hook bodies, four
 * of them re-composing a `nameField` that is a formula. Each copy can drift
 * from the declaration it copies, silently — which is the whole defect, so the
 * remedy must not itself be a copy. This calls
 * {@link planFormulaProjection} + {@link applyFormulaPlan}: the same plan
 * builder, the same `Expression` normalization (string shorthand → CEL
 * envelope), the same `scale` rounding and the same evaluation scope the read
 * and write paths use. One formula semantic, not a hook-path dialect (PD #12).
 *
 * ## Narrowed to one field ON PURPOSE
 *
 * `planFormulaProjection(schema, undefined)` — the shape `find` and
 * {@link hydrateWriteFormulas} use — plans EVERY formula field on the schema
 * and `ExpressionEngine.compile`s each one at planning stage. Asking for one
 * title would then throw on an unrelated malformed formula elsewhere on the
 * object. Passing `[field]` plans exactly the requested field, so the blast
 * radius of a title lookup is the title's own declaration.
 *
 * ## Read-path parity, including how it fails
 *
 * Both failure modes are the read path's, unchanged: a formula that does not
 * COMPILE throws (as it does on every `find` of the object), while a formula
 * that compiles and does not EVALUATE yields `null` — `applyFormulaPlan`'s own
 * `r.ok ? … : null`. A caller therefore cannot mistake "this title could not be
 * computed" for a computed value.
 *
 * ⚠️ One scope difference, named rather than hidden [#20082]: this helper is
 * synchronous and passes NO permission map, so a formula that calls
 * `current_user.can(…)` does not evaluate here and yields `null` by the rule
 * above. [#24197] For the same reason it preloads no relationship hop, so a
 * formula reading `record.<reference>.<field>` yields `null` here too. The read and write paths resolve the map first
 * ({@link ObjectQL.resolveFormulaPermissions}); a helper with no resolver cannot.
 * [#26608] And it holds no i18n service, so `label(record.<field>)` reads the
 * DECLARED option labels here ({@link declaredOptionLabels}), whatever
 * `execCtx.locale` says.
 * A caller that holds a read channel and wants the read's answer calls
 * {@link ObjectQL.serveFormulaField} (through `ScopedContext.serveFormulaField`).
 *
 * Returns `undefined` when `field` is not a declared formula field, which is
 * how a caller tells "read the stored column instead" from "the formula
 * produced nothing". Evaluates against a shallow COPY: `applyFormulaPlan`
 * writes the value onto the record it is handed, and the records reaching here
 * are the engine's own hook payloads, observed by everything downstream.
 */
export function evaluateFormulaField(
  schema: unknown,
  record: Record<string, unknown>,
  field: string,
  execCtx?: ExecutionContext,
): unknown {
  const { plan } = planFormulaProjection(schema as any, [field]);
  if (plan.length === 0) return undefined;
  const scratch: Record<string, unknown> = { ...record };
  // [#24197] Synchronous, so it preloads no hop: a formula reading through a
  // reference yields `null` here, as a `can()` formula does above.
  applyFormulaPlan(plan, [scratch], execCtx, undefined, undefined, undefined, declaredOptionLabels(schema, plan));
  return scratch[field];
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
   * [#9719, widened to `beforeUpdate` by #9974] Opt-in: ALSO dispatch this
   * handler ONCE with the whole-operation context when a predicate
   * (`multi: true`) WRITE arrives with no caller predicate at all
   * (`options.where` absent or `null`) — BEFORE any matched row is resolved.
   *
   * Why the extra dispatch exists: since #5038/#5574 the predicate path
   * dispatches `beforeUpdate` / `beforeDelete` per matched row, with
   * `input.id` bound — so a guard that refuses the OPERATION SHAPE (the #4757
   * unscoped-multi-delete refusal on `sys_attachment`, the #4630 one on
   * `sys_comment`) never saw the shape it guards: the by-id branch of the
   * handler shadowed it on every dispatch, and a zero-match unscoped write
   * dispatched nothing at all. "Nothing to authorize" and "nothing was ever
   * queried" are different verdicts, so the shape check cannot ride the
   * per-row fan-out; it needs the one dispatch that happens regardless of what
   * the predicate matches.
   *
   * ## Why it covers both write verbs
   *
   * #9719 shipped it on `beforeDelete` only, and refused it elsewhere, because
   * extending it to `beforeUpdate`'s predicate path changes what the engine
   * ACCEPTS on the far hotter update path — a product-behaviour decision, not
   * drift. That decision was taken (#9974, maintainer ruling 2026-08-19,
   * option A) on the recoverability asymmetry: a delete leaves a trace of who
   * removed what, an overwrite leaves none — the old value is gone on the spot
   * with nothing to restore from — and a forgotten `where` is the mistake
   * generated code makes most often. So the LESS guarded verb was the one
   * whose failure is LESS recoverable. One flag now covers both, rather than a
   * `dispatchUnscopedMultiUpdate` sibling: the flag is already per-REGISTRATION
   * and per-EVENT, so "delete only" is still said exactly — declare the flag on
   * the `beforeDelete` registration and omit it from the update one, and the
   * whole-operation call is then dispatched for the declared verb alone (the
   * dispatcher reads the entries of ONE event, then filters those on the flag).
   *
   * ⚠️ That idiom is deliberately stated WITHOUT naming a live registration.
   * It used to name one: `sys_attachment` declared #4757's delete refusal on
   * `beforeDelete` and on no update registration — true when this paragraph was
   * written (#9974), false since commit da891e0ef gave that guard's update verb a refusal
   * of its own. A replacement exemplar would only be the next referent free to
   * move, so none is named: the past-tense sentence cannot be falsified by the
   * tree moving on, because it is a claim about what those two cards did rather
   * than about today's registrations.
   *
   * Deliberately a REGISTRATION declaration, not an engine-wide rule: the
   * engine stays neutral (no behaviour change for objects whose guards do not
   * declare it — generalizing the refusal to every guarded object is a
   * separate product decision), and the policy — who is refused, with what
   * error — stays in the ONE handler that already declares and tests it. Valid
   * on `beforeUpdate` / `beforeDelete` registrations only
   * ({@link assertValidUnscopedMultiWriteFlag}); dispatched by
   * {@link ObjectQL.dispatchUnscopedMultiWriteHooks}.
   */
  dispatchUnscopedMultiWrite?: boolean;
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
 * That read is deliberately UNCHANGED, and commit 708431313 says why: flipping it would turn
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
 * [commit 708431313] Registration-time refusal for the `object` (ALLOW) face, closing
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
 * [commit 708431313] Refuse a scope whose two faces cancel each other out —
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

/**
 * [#9719, widened by #9974] The events whose predicate branch actually reads
 * {@link HookEntry.dispatchUnscopedMultiWrite}. Declared as data beside the
 * assert so the refusal message and the accept set cannot drift apart, and so
 * adding a third verb is one edit rather than a rule to restate.
 */
const UNSCOPED_MULTI_WRITE_EVENTS = ['beforeUpdate', 'beforeDelete'] as const;

/**
 * [#9719, widened by #9974] Registration-time refusal for
 * {@link HookEntry.dispatchUnscopedMultiWrite} on any event whose dispatch
 * never reads it.
 *
 * The flag is consumed by exactly two dispatch sites — the predicate branches
 * of `ObjectQL.update()` and `ObjectQL.delete()` — so on every other event it
 * would register "successfully" and never fire: ADR-0078's silently inert
 * declaration, the same shape the two scope asserts above refuse. Statically
 * decidable, so refused at the door rather than warned about.
 *
 * ⚠️ The accept set widened by RULING, not to make the assert quieter: until
 * #9974 this refused `beforeUpdate` too, and its comment named that as "a
 * product-behaviour decision of its own". The decision was taken (option A,
 * 2026-08-19), so `beforeUpdate` is now a declared reader — and every OTHER
 * event is still refused on exactly the original grounds.
 */
function assertValidUnscopedMultiWriteFlag(
  dispatchUnscopedMultiWrite: boolean | undefined,
  event: string,
): void {
  if (!dispatchUnscopedMultiWrite) return;
  if ((UNSCOPED_MULTI_WRITE_EVENTS as readonly string[]).includes(event)) return;
  throw new Error(
    `[ObjectQL] Hook '${event}' declares \`dispatchUnscopedMultiWrite\`, which only the `
    + `${UNSCOPED_MULTI_WRITE_EVENTS.map((e) => `'${e}'`).join(' / ')} dispatches read — on this `
    + 'event the flag would register successfully and then never fire (ADR-0078: no silently '
    + 'inert declaration). Register the guard on one of those events, or drop the flag.',
  );
}

/**
 * [#17713] The per-seam prescription for a refused lifecycle event — what the
 * author should have written instead, named concretely.
 *
 * The two seams are different repairs, and an author who is told only "this
 * never fires" cannot tell them apart:
 *
 *  - **`*FindOne`** — the capability EXISTS and the author already has it.
 *    `beforeFind`/`afterFind` fire for `findOne` too (the event attaches to
 *    record materialization, not to the engine method), so the fix is a
 *    one-word rename and nothing is lost.
 *  - **`*Count` / `*Aggregate`** — there is no hook seam at all, by design
 *    (`HookEvent` in `@objectstack/spec/data` says so: read authorization and
 *    row filtering are the middleware's job). `count()` and `aggregate()` run
 *    the middleware chain with the query AST on the operation context, so the
 *    repair is a DIFFERENT API, not a different event name. This is the half
 *    that would have saved the consumer on #17713: their read filter sat on
 *    `beforeCount`, so a `limit`ed list's `total` counted rows the caller could
 *    not see, and a `groupBy` was not narrowed at all.
 */
function undispatchedLifecycleEventPrescription(event: string): string {
  if (event === 'beforeFindOne' || event === 'afterFindOne') {
    const covering = event === 'beforeFindOne' ? 'beforeFind' : 'afterFind';
    return (
      `\`${covering}\` already covers \`findOne\` — the read events fire for BOTH \`find\` and `
      + `\`findOne\`, because the event attaches to record materialization, not to the engine `
      + `method. Register on '${covering}' instead; the handler sees single-record reads there.`
    );
  }
  const verb = event.startsWith('before') ? event.slice(6) : event.slice(5);
  const method = `${verb.charAt(0).toLowerCase()}${verb.slice(1)}`;
  return (
    `\`${method}()\` dispatches no hook at all, by design — it runs the MIDDLEWARE chain only, `
    + 'with the query AST on the operation context. Filter it with '
    + '`engine.registerMiddleware(fn)`, reading `ctx.operation === \'count\' | \'aggregate\'` and '
    + 'composing your predicate onto `ctx.ast.where` — the same seam RLS and sharing already use, '
    + 'so the scoping applies to the driver call itself. ⚠️ A read filter written as a HOOK does '
    + 'not narrow a `total` or a `groupBy`: those surfaces would keep answering over rows the '
    + 'caller cannot see.'
  );
}

/**
 * [#17713] Registration-time refusal for an event inside the engine's OWN
 * lifecycle namespace that the engine never dispatches — see
 * {@link UNDISPATCHED_LIFECYCLE_HOOK_EVENTS} for how that population is derived
 * and why the refusal stops there.
 *
 * This was a `warn` from #3195 until #17713. The warning was loud (~40 lines a
 * boot on the reporting install) and still useless: the registration SUCCEEDED,
 * so a downstream consumer's read filters on `beforeFindOne` and `beforeCount`
 * sat inert through every boot while the surface reported them registered. That
 * is ADR-0078's prohibited fourth state — parsed, unmarked, silently inert — on
 * an authorable seam, and on this seam the inert declaration is a GUARDRAIL: the
 * author believes they narrowed what a caller can see, and they did not.
 *
 * A throw rather than a strict-mode-only failure, on the same reading as the
 * four asserts above: the shape is statically decidable at the call site, it
 * carries no recoverable intent that a warning could preserve, and a mode nobody
 * turns on is a rule nobody gets. The `after*` names are refused alongside the
 * `before*` ones even though the card only measured the `before*` half — they
 * are the same gap, and refusing half a derived set would reintroduce the
 * hand-written list.
 *
 * ⛔ NOT a general "unknown event names are refused". An event outside the
 * namespace is left exactly as it was — a warn, then registered — so a plugin
 * that dispatches its own events through the public {@link ObjectQL.triggerHooks}
 * keeps working. That is the reading #3195 wrote down as the reason not to
 * reject, and it is untouched here: this narrows the accept set by six names,
 * not to eight.
 */
function assertDispatchableHookEvent(event: string): void {
  if (!UNDISPATCHED_LIFECYCLE_HOOK_EVENTS.has(event)) return;
  throw new Error(
    `[ObjectQL] Hook '${event}' is an engine lifecycle event name the engine never dispatches, `
    + 'so the registration would succeed and the handler would never run (ADR-0078: no silently '
    + `inert declaration). ${undispatchedLifecycleEventPrescription(event)} `
    + `Dispatched events: ${[...DISPATCHABLE_HOOK_EVENTS].join(', ')}.`,
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
  /**
   * [#15813 / ADR-0131 D8] What the Layer 0 tenant wall DECIDED for this
   * operation — recorded by the enforcement layer (`@objectstack/plugin-security`)
   * at the moment it composes the wall onto the operation's predicate, and
   * read by the bulk data-event producer ({@link ObjectQL.publishBulkDataEvent})
   * to stamp `BulkDataEvent.organizationId`.
   *
   * The seam ruled on #15706: the wall is computed ONCE, where every input is
   * visible (the posture in force, the caller's organization scope and the
   * object's tenancy clauses — which, since ADR-0131 D7, include the
   * deployment's #12699 platform-global declaration, recorded on the
   * registered object as `systemFields.tenant: false`), and its decision
   * travels here as a value. A reader
   * answers from this member ALONE and re-derives nothing — a re-derivation
   * is a mirror of the wall, and a mirror structurally sees only the clauses
   * it was taught (the #15706 mislabel).
   *
   * Three states, all honest: ABSENT — no wall was composed on this
   * operation (a system context, no enforcement layer mounted, a by-id write
   * with no predicate); `{ kind: 'none' }` — the wall ran and contributed no
   * predicate; a named verdict (`organization` / `organizations` / `deny`).
   * The shape is `TenantLayer0VerdictSchema` (`@objectstack/spec/security`);
   * a value that does not parse reads as absent, never as an organization.
   */
  tenantLayer0Verdict?: TenantLayer0Verdict;
  /**
   * [commit a016f08b8] The INSERT post-image seam — where an enforcement layer gets to
   * judge the row that will actually be stored.
   *
   * An `insert` has no pre-image, so a middleware's only image of the write is
   * `opCtx.data`: the caller's payload as it arrived, before `applyFieldDefaults`
   * and before the `beforeInsert` hooks. A value the app DERIVES server-side —
   * an organization copied from a parent, a denormalised scoping field a caller
   * is deliberately not allowed to choose — is not on that image, so a predicate
   * over it judges a value that never lands and ignores the one that does.
   * Measured on 17.3.0: the same identity, same object, same second, an insert
   * carrying the stamped value was admitted and the identical insert leaving it
   * to the hook was refused, while the stored row was identical either way — and
   * an insert naming an IN-SCOPE value for a parent in ANOTHER organization was
   * admitted with the parent's organization stored on it.
   *
   * So the enforcement layer installs its judgement here instead of running it
   * against `opCtx.data`, and {@link ObjectQL.insert} calls it once the
   * `beforeInsert` chain has produced the row — before the first producer with
   * a side effect (the secret channel, the autonumber, the statement), so a
   * refusal still costs nothing. An ARRAY insert is one operation: every live
   * row is judged in the same call.
   *
   * [#19950] A PREDICATE `update` (`multi: true`, no row address) uses the same
   * seam. The middleware cannot know which rows the write will change: they
   * are the rows the COMPOSED AST selects, and that AST is complete only after
   * every middleware has run. So {@link ObjectQL.update} calls it on that path,
   * once the payload is final, with every matched row merged with the payload.
   *
   * [#19989] A by-id `update` uses it too. A middleware can read that one row,
   * but only BEFORE the `beforeUpdate` chain runs, so its image is the change
   * set as sent and a hook that rewrites a judged field is never judged. So
   * {@link ObjectQL.update} calls it on the by-id path as well, once the
   * payload is final, with the prior row merged with the payload.
   *
   * ABSENT is the ordinary state — no enforcement layer is mounted, or the
   * write is one it does not gate. The engine never invents one.
   */
  postHookWriteImageCheck?: PostHookWriteImageCheck;

  /**
   * [ADR-0142 D4] The by-id write PRECONDITION: an equality predicate over the
   * stored row (`{ <field>: <value> }`) the write is conditional on. Set by an
   * enforcement layer's middleware — the ownership gate sets `{ owner_id: null }`
   * on a claim, so two members claiming at once produce exactly one owner — and
   * by the engine's own assignment cursor (`{ version }`). Engine-internal:
   * reachable from no data door, and read only on a by-id `update`.
   *
   * The engine lowers the write to the driver's conditional
   * `updateMany(object, { where: { id, ...expect } }, data)`; one affected row
   * is re-read by id and the by-id branch continues unchanged (hooks, formulas,
   * the event, the roll-up, the response); zero rows answer 409
   * `CONCURRENT_UPDATE` ("the record was taken"). A driver with no `updateMany`
   * degrades to the pre-image check its setter already made, and the write
   * goes through unconditionally, logged once per process at `warn`.
   */
  writePrecondition?: Readonly<Record<string, unknown>>;
}

/**
 * [commit a016f08b8] The judgement {@link OperationContext.postHookWriteImageCheck}
 * carries, and the acknowledgement its installer reads back.
 *
 * `evaluate` receives the images the driver is about to store, and REFUSES by
 * throwing. On an `insert` those are the rows exactly as the `beforeInsert`
 * chain left them, only the live ones (a row the declared-field door culled
 * from a partial batch is never judged: it will not be written). On a
 * predicate `update` they are the matched rows, each merged with the final
 * payload; on a by-id `update` ([#19989]) the one prior row merged with the
 * final payload. It is called at most once per operation.
 *
 * `honoured` is set by the engine immediately before `evaluate` runs. It exists
 * so the installer can fail CLOSED on a seam that was never called: an
 * enforcement layer that moved its gate here and finds the flag unset on the
 * way out knows its check did not happen, and says so loudly rather than
 * reading an unjudged write as an allowed one.
 */
export interface PostHookWriteImageCheck {
  evaluate(rows: readonly Record<string, unknown>[]): void | Promise<void>;
  honoured?: boolean;
  /**
   * [#24822] Declared by the installer, and only by it: `evaluate` holds every
   * row it is handed to the Layer 0 tenant wall on `organization_id`. It
   * admits the value or refuses the write by throwing. On an `insert` those
   * rows are the inserted rows; on an `update` they are the stored images:
   * the one prior row merged with the final payload on the by-id path, and
   * every matched row merged with it on the predicate path.
   * `@objectstack/plugin-security` sets it at step 3.7, only where it
   * composes the wall's own parts into the insert's or the single-payload
   * update's seam. A seam that carries a business `check` alone does not
   * judge the organization, and neither does a platform operator's seam that
   * crosses the wall, so neither sets it; nor is it set on an update whose
   * payload is an array, where step 3.7 installs no seam of its own.
   *
   * {@link ObjectQL.insert} and {@link ObjectQL.update} read this member, and
   * nothing else, to decide one thing: whether a non-system caller's explicit
   * `organization_id` stays on the row for that judgement or is taken by the
   * static-`readonly` strip (the platform's tenant column declares
   * `readonly: true`). Set, the value is stored as sent where the wall admits
   * it and refused where it does not: an insert's is never silently replaced
   * by the active organization (ADR-0105 D5), and an update's re-point is
   * never silently dropped in favour of the row's own organization. Only the
   * platform's injected column is spared, and only on an object the insert's
   * static-`readonly` strip judges, so never a `sys_` or platform-internal
   * object. An AUTHORED `organization_id` declared `readonly: true` keeps the
   * strip. An emptied value on an update is not spared into storage: the wall
   * refuses it (`null` or `''`), on the payload and on the stored image.
   * Absent or `false`, the strip runs exactly as before. The engine never
   * sets it, and never derives it from the posture or the context: that
   * would be a mirror of the wall, and a mirror is wider than the wall
   * wherever the wall is not mounted. [#25062] The write preview, which
   * installs no seam, reads the same value from the wall's verdict on each
   * row instead ({@link WriteWallRowVerdict}, `ObjectQL.registerWriteWallVerdict`).
   */
  judgesOrganization?: boolean;
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

/**
 * [#22445] Did the read door serve this value AS STORED — can the caller read
 * the stored value in full? The `update`-mode preview keeps a stored column
 * only when this holds for it (see `storedRows` in `ObjectQL.validate`), and
 * [#22474] the preview keeps a master-detail header column only when this
 * holds for it (see `ObjectQL.resolvePreviewParents`).
 *
 * Both values come off the same driver read shape (`driver.findOne` under the
 * same `buildDriverOptions`; for a header, the read door's `find` under the
 * caller's context and under the write's elevated one), so a column nothing
 * transformed compares equal by construction; what differs is what the read
 * path REWROTE for this caller (a partial mask, a masked secret, a read hook's
 * rewrite). Structural, not identity: the two reads are two driver calls, so a
 * `Date`, an array or a JSON object arrives as two equal objects.
 *
 * ⛔ Fails CLOSED: a pair it cannot prove equal — another object kind (a
 * buffer, a class instance), a nesting past the depth bound — answers `false`,
 * and the column is judged as empty. That direction can only make the preview
 * refuse or admit on less than the write knows; the other direction would
 * judge a value the caller may not read.
 */
export function servedAsStored(served: unknown, stored: unknown, depth = 0): boolean {
  if (Object.is(served, stored)) return true;
  if (depth >= 16) return false;
  if (served instanceof Date || stored instanceof Date) {
    return served instanceof Date && stored instanceof Date && served.getTime() === stored.getTime();
  }
  if (Array.isArray(served) || Array.isArray(stored)) {
    return Array.isArray(served) && Array.isArray(stored) && served.length === stored.length
      && served.every((item, i) => servedAsStored(item, stored[i], depth + 1));
  }
  const plain = (v: unknown): v is Record<string, unknown> => {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };
  if (!plain(served) || !plain(stored)) return false;
  const servedKeys = Object.keys(served);
  return servedKeys.length === Object.keys(stored).length
    && servedKeys.every((k) => Object.prototype.hasOwnProperty.call(stored, k) && servedAsStored(served[k], stored[k], depth + 1));
}

/** Merge read-path execution context from the query and the trailing options. */
export function mergeReadContext(
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
export function shouldSkipStateMachine(ctx?: ExecutionContext): boolean {
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
 * "Which of these tombstoned `sys_file` rows is something still holding?"
 * (commit c3c72a4bc).
 *
 * Takes the whole tombstoned set from ONE record read and returns the subset
 * still held, as a set of stringified ids. Batched rather than per-row on
 * purpose: hydration runs over many rows per read, so asking per file would be
 * N queries per read.
 *
 * The engine declares this shape but never implements it — "still held" has one
 * definition (`findFileHolder`, the union of `sys_attachment` join rows and the
 * `ref_*` ownership columns) and it lives in the storage package. See
 * `ObjectQL.registerHeldFileResolver`.
 */
export type HeldFileResolver = (
  rows: Array<Record<string, any>>,
) => Promise<Set<string>>;

/**
 * "Of these `ownerObject` records, whose field-owned files may this caller
 * read?" — the download door's field-owned verdict (ADR-0104 D3; #22637,
 * maintainer ruling B on #22624).
 *
 * Takes every owner record id one hydration needs judged and returns the
 * subset whose files the caller may read, as stringified ids. Batched for the
 * same reason as {@link HeldFileResolver}: one call per read, never one per
 * row.
 *
 * The engine declares this shape but never implements it. The verdict — a
 * declared `fileAccessDelegate` asked and failing closed, otherwise the
 * caller's read of the owner record — has one definition, the field-owned arm
 * of the storage package's download authorizer, and a copy here would be a
 * second predicate for one file. See `ObjectQL.registerFieldOwnedFileReadAuthorizer`.
 */
export type FieldOwnedFileReadAuthorizer = (
  ownerObject: string,
  ownerIds: string[],
  context: ExecutionContext,
) => Promise<Set<string>>;

/**
 * [#25062] The Layer 0 tenant write wall's answer for ONE row of a write
 * preview ({@link ObjectQL.validate}): admitted, saying whether the wall judges
 * the row's `organization_id` (the value
 * {@link PostHookWriteImageCheck.judgesOrganization} is set from on the
 * write), or refused with the write's own `code` and `message`. A refused
 * `field` is `organization_id` when the wall refused a value the row carries,
 * and `_record` when it refused the caller's state (no active organization).
 */
export type WriteWallRowVerdict =
  | { readonly admitted: true; readonly judgesOrganization: boolean }
  | {
      readonly admitted: false;
      readonly field: 'organization_id' | '_record';
      readonly code: string;
      readonly message: string;
    };

/**
 * [#25062] "What does the Layer 0 tenant write wall answer for each of these
 * rows?" One verdict per row, in order, or `null` when the wall is not asked
 * for this write (the engine then judges the rows as if nothing were
 * registered).
 *
 * The engine declares this shape but never implements it. The wall has one
 * definition, the enforcement layer's own (`@objectstack/plugin-security`'s
 * step 3.7), and the verdict travels here as a value: a copy of the wall in
 * the engine would be the mirror the `judgesOrganization` member forbids. See
 * `ObjectQL.registerWriteWallVerdict`.
 */
export type WriteWallVerdict = (
  object: string,
  operation: 'insert' | 'update',
  context: unknown,
  rows: readonly Record<string, unknown>[],
) => Promise<readonly WriteWallRowVerdict[] | null>;

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
  // Data Protocol — shared option lists. FIRST, so a source's lists are in the
  // registry before anything later in this loop reads them; objects do not
  // depend on the order (they resolve a list lazily, on the next fold), so this
  // is the declared loading order (`picklist` loads before `object`), not a
  // precondition. Both are dispatched to their own registry verbs in
  // `registerMetadataCollections`: the extensions merge into the list they
  // name instead of registering as items of their own.
  'picklists', 'picklistExtensions',
  // UI Protocol
  'actions', 'views', 'pages', 'dashboards', 'reports', 'datasets', 'themes',
  // Automation Protocol
  'flows', 'workflows', 'approvals', 'webhooks',
  'jobs',
  // Security Protocol — `capabilities` is here for the same reason as
  // `permissions` (#5870, #4967 Part 2): the ONLY seam that stamps
  // ADR-0010 provenance is `registerItem` → `applyProtection`, so a
  // collection missing from this list reaches no registry with a
  // `_packageId`. The declared-capability seeder (retired by ADR-0131 D3)
  // resolved the owning package as `cap._packageId ?? cap.packageId`; while `capabilities`
  // sat outside this list the first half could never be satisfied and
  // `readDeclared(ql, 'capability')` returned nothing, which made the
  // author-side `packageId` — documented as the FALLBACK — mandatory,
  // and its omission a silent, unenforced authorization declaration.
  //
  // [#22203] `positions` for the same reason, and with a write-door
  // consequence: ADR-0090 D3 renamed `roles` to `positions`, and the rename
  // reached the artifact door's map but never this list, so a stack-declared
  // position had no registry entry under its package. The metadata save door
  // decides "a code package ships this" from exactly that entry
  // (`isArtifactBacked` → `getArtifactItem`), so a save over a package's
  // position took the runtime-create tier and was accepted, although the type
  // registry declares `position` `allowEnvironmentOverlay: false`. With the entry
  // present the door's type-level refusal covers it like every other
  // `security`-domain type (`engine-security-catalog-package-door.test.ts`).
  // `roles` stays in the list as the inert retired spelling it already was.
  'roles', 'positions', 'permissions', 'capabilities', 'profiles', 'sharingRules', 'policies',
  // [ADR-0142 D1/D5] Ownership queues and the assignment rules that route
  // inserted rows into them — both read from the registry on every use (the
  // queue service, the assignment seam), so a declaration must reach it with
  // its package stamped, as every collection on this list does.
  'queues', 'assignmentRules',
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
 * `list / form / listViews / formViews` for a single object and is keyed by
 * the OBJECT it binds to, not by its own row identity — which is what
 * `/api/v1/meta/views/:object`, `getViewsByObject()` and
 * `GET /meta/view?object=` all address it by.
 *
 * ⚠️ [commit 3c1bbd2a8] The sentence that used to stand here — "per spec, `ViewSchema`
 * does NOT have a top-level `name` field" — is measurably false and was the
 * premise for consulting `item.name` first. `ViewSchema` declares an optional
 * `name` (`view.zod.ts`), described there as "supplied by the metadata door;
 * for an object-scoped container it is the object name". "Is the object name"
 * is a CONVENTION the door does not enforce, so the two never actually had to
 * agree — and where they disagreed, this registrar and the other two picked
 * different keys for the same document.
 */
function resolveMetadataItemName(key: string, item: any): string | undefined {
  if (!item) return undefined;
  // [commit 3c1bbd2a8] The aggregated `views` CONTAINER branch, taken FIRST and answered
  // by the shared derivation. Everything below is unchanged.
  //
  // This registrar used to consult `item.name` before anything else, for every
  // key including this one — so a container written as
  // `{ name: 'lead_views', object: 'crm_lead', list: {…} }` registered under
  // `lead_views` here while the artifact/HMR SOURCE registrar
  // (`MetadataPlugin._parseAndRegisterArtifact`) and the runtime door
  // (`expandRuntimeViewContainer`) both registered it under `crm_lead`. Same
  // document, two source registrars, two registry keys and two sets of expanded
  // item names, with `getViewsByObject()` / `GET /meta/view?object=` answering
  // for the object only when the right registrar happened to load it.
  //
  // The 2026-08-07 meta-rule settles the direction rather than taste: one
  // operation with two inconsistent implementations, the side bound by a
  // DECLARATION wins. `ViewSchema.object`'s own `.describe()` names its readers
  // (`getViewsByObject()` / `GET /meta/view?object=`); this loop's old order
  // argued from item identity, which declares nothing about the binding. So the
  // container branch adopts `deriveViewContainerObject` — by import, because a
  // fourth hand-copy of a chain that already exists three times is the defect
  // this repair exists to close, not the repair.
  //
  // The gate is `isAggregatedViewContainer`, which is what makes this the
  // CONTAINER branch and nothing wider: it is false for every artifact carrying
  // a `viewKind`, so the assembled `viewItems:` channel below (standalone
  // ViewItems and flattened list/form overlays — every member of
  // `AssembledViewArtifactSchema` requires `viewKind`) still resolves by its own
  // `name` first, which is its identity and not a binding.
  //
  // `item.id` is untouched and stays reachable for every other key. It cannot
  // fire for a spec-valid container: `ViewSchema` is a `strictObject` that
  // declares `name` and `object` and no `id`, so an `id` on a container is
  // refused at the authoring and metadata doors before this seam sees it.
  if (key === 'views' && isAggregatedViewContainer(item)) {
    return deriveViewContainerObject(item);
  }
  if (item.name) return item.name;
  if (item.id) return item.id;
  if (key === 'views') {
    // A `views` entry that is NOT an aggregated container and carries neither
    // `name` nor `id` — e.g. a flattened overlay whose optional `name` was
    // omitted. Same derivation, and identical to the chain that used to be
    // written out here: with `item.name` already known falsy, the helper's
    // trailing `name` term contributes nothing.
    return deriveViewContainerObject(item);
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
 * [#4889] The master id a detail row's `parent` binding resolves against:
 * the write's own value for the FK when it carries one (a REPOINT must be
 * judged against the master it lands on), else the prior row's. Only a scalar
 * id counts — an expanded relation object or an array is not an id this read
 * can bind, and guessing one would be worse than leaving `parent` unbound.
 *
 * [#19853] "Carries one" means the write STORES it: the UPDATE paths hand this
 * the payload view `settleMasterDetailLanding` returns, which no longer holds
 * an FK a later strip would have taken back out, so the prior row's FK — the
 * header the row keeps — answers instead.
 */
export function masterIdOf(
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
 * [#19887] The UPDATE payload as the static `readonly` strip will leave it —
 * `data` without every key that strip takes back out — which is the view a
 * `readonlyWhen` predicate's `record` binding is built from
 * (`ReadonlyWhenStripOptions.stored`).
 *
 * The conditional strip runs BEFORE the static one, so the payload it is
 * handed still holds a value a non-system caller forged for a statically
 * `readonly` field. Judged over that payload, `amount` locked by
 * `record.status == 'closed'` read the forged `status: 'open'`, stayed
 * writable, and the static strip then removed the `status`: the closed row
 * committed with its locked amount rewritten. The strips keep their order —
 * each still reports its own fields under its own reason — and only what the
 * predicate reads moves.
 *
 * The same verdict {@link staticReadonlyStripTakes} asks for one key, asked
 * for all of them by the same function with the same arguments: `data` itself
 * when the strip does not run (a system caller), and a key a hook wrote, a
 * value a hook overwrote or a column `preserveAudit` keeps all stay, because
 * the write stores them. Silent for the same reason.
 *
 * [#24822] ...and over the same view of the schema: the one
 * {@link updateStaticReadonlySubject} answers for `strip.wallJudgesOrganization`,
 * the flag `update()` reads once off the wall's seam and hands to the strips
 * themselves. So where the wall judges the update's organization, a re-point
 * the strip leaves on the row is in this view too, and a `readonlyWhen`
 * predicate reading `record.organization_id` reads the organization the row is
 * stored in. The master-detail settlement forwards the update's descriptor
 * object unchanged, so the flag reaches {@link staticReadonlyStripTakes} on that
 * path too. Absent, the view is the whole schema's, exactly as before.
 */
export function staticReadonlyStoredView(
  schema: unknown,
  data: Record<string, unknown>,
  supplied: Readonly<Record<string, unknown>>,
  strip: {
    runs: boolean;
    preserveAudit: boolean;
    hookWrittenKeys: ReadonlySet<string> | undefined;
    wallJudgesOrganization?: boolean;
  },
): Record<string, unknown> {
  if (!strip.runs) return data;
  return stripReadonlyFields(
    updateStaticReadonlySubject(schema, strip.wallJudgesOrganization === true) as any, data, supplied, undefined,
    { preserveAudit: strip.preserveAudit, hookWrittenKeys: strip.hookWrittenKeys },
  ) ?? data;
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

/**
 * A datasource *definition* as the engine keeps it (ADR-0015) — the declarative
 * facts a datasource states about itself, not a live connection (that is
 * {@link ObjectQL.registerDriver}).
 *
 * Named rather than restated inline because three sites share it: the private
 * index, {@link ObjectQL.registerDatasourceDef} which writes it, and
 * {@link ObjectQL.listDatasourceDefs} which reads it back. Three copies of one
 * shape is a second de-facto contract that drifts silently, and the drift this
 * one produces is a credentials handle missing from a `sys_secret` sweep.
 *
 * The keys are a deliberate SUBSET of the spec's authored datasource surface
 * (`ExternalDatasourceSettingsSchema` in `@objectstack/spec`) — the engine
 * carries only what it has a use for. ⛔ Not a mirror of the spec block and not
 * a place to grow one: `validation` and `queryTimeoutMs` are absent because
 * nothing in this engine reads them.
 */
export interface DatasourceDef {
  name: string;
  /**
   * [#27277] The driver id the datasource selects. Read to decide whether the
   * engine floors the datasource's driver (`needsExternalDriverFloor`: a
   * non-managed datasource on a driver id that is not built in).
   */
  driver?: string;
  schemaMode?: string;
  external?: {
    /** Datasource-wide write gate — ADR-0015 §5.3 Gate 3. */
    allowWrites?: boolean;
    /**
     * Reference into the secrets store, never an inline credential. Valid in
     * EVERY `schemaMode` — it is the one `external` key a managed datasource
     * may carry (#8153) — so a reader sweeping for handles must not filter by
     * schema mode.
     */
    credentialsRef?: string;
    /**
     * [#29762] The datasource's plugin-driver row cap (`external.rowCap`).
     * Read by the floor on every read (`resolveExternalRowCap`), so a
     * redefinition takes effect without re-wrapping the driver.
     */
    rowCap?: number;
  };
}

/**
 * [#22305] The records ONE by-id cascade delete removes, collected before any
 * of them is judged — see {@link ObjectQL.cascadeDeleteRelations}.
 *
 * Without it, every level of the depth-first walk judged its own `restrict`
 * refusals with no knowledge of the cascade that called it: a record the same
 * cascade was about to delete refused the delete of its sibling, and whether
 * it got the chance depended on which object was registered first. The triage
 * ruling on #22305 is the rule this set exists to apply: a child that is itself
 * in the cascade set never restricts a sibling in the same set.
 *
 * Engine-internal and never part of a context: it rides
 * {@link ObjectQL.cascadeDeleteSets}, an `AsyncLocalStorage`, so no request
 * input can name a record into it, and a caller that passed no context still
 * passes none.
 */
export interface CascadeDeleteSet {
  /**
   * Object name → ids the cascade deletes, the root included. Collected by a
   * read-only walk across every CASCADING relation before any write, so it is
   * complete before the first refusal is judged.
   */
  readonly members: Map<string, Set<string>>;
  /**
   * Object name → ids whose own referential walk has started, in progress or
   * done. The walk never re-enters one, which is what makes a cycle in the
   * data terminate and what keeps a row reached by two paths from being
   * deleted twice.
   */
  readonly entered: Map<string, Set<string>>;
  /**
   * The #12166 elevation records already filed, one per deleted record per
   * referenced object, so the collection walk and the deleting walk, which
   * read the same relations, file each record once between them.
   */
  readonly elevationsFiled: Set<string>;
  /**
   * [#26718] Member key ({@link cascadeMemberKey}) → the members a
   * CASCADING relation reaches from it directly, every edge the collection
   * walk read, a row reached by two paths included. The reach of one member
   * inside the set ({@link cascadeReachOf}) is read from it: which rows the
   * delete removes only BECAUSE that member goes.
   */
  readonly cascadeEdges: Map<string, Array<{ object: string; id: string | number }>>;
  /**
   * [#27004] Relation key ({@link cascadeMemberKey} of the referencing object
   * and its field) → the ids of the referenced object whose walk has finished
   * that relation: every row outside the set has had them cleared. A walk
   * over a root SET reads each relation once for many records, so a
   * multi-valued row read for one of them may still list a member an earlier
   * one has removed from it; the remainder written leaves those out too.
   */
  readonly cleared: Map<string, Set<string>>;
}

/** [#26718] One member of a {@link CascadeDeleteSet}, as a single key. */
export function cascadeMemberKey(object: string, id: unknown): string {
  return JSON.stringify([object, String(id)]);
}

/** Is `id` of `object` in this index of a {@link CascadeDeleteSet}? */
export function cascadeSetHas(index: Map<string, Set<string>>, object: string, id: unknown): boolean {
  return id != null && index.get(object)?.has(String(id)) === true;
}

/** Add `id` of `object`; `true` when it was not there yet. */
export function cascadeSetAdd(index: Map<string, Set<string>>, object: string, id: unknown): boolean {
  let ids = index.get(object);
  if (!ids) { ids = new Set(); index.set(object, ids); }
  const key = String(id);
  if (ids.has(key)) return false;
  ids.add(key);
  return true;
}

/**
 * [#23221] The one child delete a cascade walk is issuing, for that delete to
 * recognise itself by — see {@link ObjectQL.cascadeIssuedDeletes}. The walk
 * opens one per `cascade` dependent, around its own `delete()` call, and the
 * `delete()` whose object and id match claims it.
 */
interface CascadeIssuedDelete {
  /** The child object the walk is deleting from, as the registry names it. */
  readonly object: string;
  /** The child row's id, as a string (the walk's `String(depId)`). */
  readonly id: string;
  /**
   * Set by the `delete()` that recognised itself. One token, one dispatch: a
   * later delete of the same row inside that call (a hook's own) finds it
   * claimed and is not marked.
   */
  claimed: boolean;
}

/**
 * [ADR-0010 §3.7] Stamp a manifest item with its owning package's
 * `(packageId, packageVersion)` before the registry stores it: the call the
 * artifact loader makes (`metadata/plugin.ts`), so both load paths serve one
 * envelope. The registry's own `applyProtection` knows the id only, and
 * `applyProtection` stamps a key only while it is unset, so the version
 * stamped here is the one the item keeps. With no version this does nothing:
 * the registry stamps the id, exactly as before.
 */
export function stampPackage<T>(item: T, packageId: string, packageVersion: string | undefined): T {
  if (packageVersion !== undefined) applyProtection(item as any, { packageId, packageVersion });
  return item;
}

/**
 * [ADR-0086 D3] The registration door's refusal of a permission set whose body
 * `packageId` disagrees with the package {@link ObjectQL.registerApp} registers
 * it under (`ownerId`; none for a manifest that carries no id).
 *
 * The judgement and its words are the one judge every door of the rule calls,
 * `judgePermissionSetOwnerBinding` (`@objectstack/spec/security`, whose header
 * holds the verdict table): the stack schema runs it at the build door
 * (`defineStack`, `os validate`, `os build`, the artifact door's parse), so this
 * seam is the door for a manifest no schema parse judged — a programmatic
 * `registerApp`, a nested plugin, a `strict: false` stack, a package installed
 * from a stored manifest. ⛔ Never a second comparison here.
 *
 * `VALIDATION_ERROR` / 400, thrown before the set is filed: the envelope of
 * this seam's other body-against-key refusal, the divergent view-container
 * `name` (`viewContainerNameRefusal`), which the same loop throws one statement
 * earlier. `issues[]` locates the key, as the metadata write doors' refusal of
 * the same rule does. No code is minted.
 *
 * Exported for the stack's RESIDUAL registration (`registerUnclaimedTopLevelItems`
 * in `plugin.ts`), which files a top-level permission set under the stack's id
 * and refuses the same set in this same envelope. ⛔ Never rebuild the envelope
 * at a second door.
 */
export function permissionSetOwnerRegistrationRefusal(
  item: unknown,
  name: string,
  ownerId: string | undefined,
): (Error & { code: 'VALIDATION_ERROR'; status: 400; httpStatus: 400; issues: Array<{ path: string; message: string; code: string }> }) | undefined {
  const refusal = judgePermissionSetOwnerBinding(item, name, ownerId, 'register');
  if (!refusal) return undefined;
  const err = new Error(refusal.message) as Error & {
    code: 'VALIDATION_ERROR'; status: 400; httpStatus: 400; issues: Array<{ path: string; message: string; code: string }>;
  };
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.httpStatus = 400;
  err.issues = [{ path: 'packageId', message: refusal.issueMessage, code: 'custom' }];
  return err;
}

/**
 * [#28534] The `_packageId` each item object was stamped with BY A
 * REGISTRATION of this process — written onto the caller's own object by
 * `stampPackage` / `registerItem`, recorded by {@link noteRegistrationStamp}.
 * Weakly held and process-wide: the earlier registration may have been
 * another engine's. Read by {@link collectionItemOwnerStampRefusal} only.
 */
const REGISTRATION_WRITTEN_STAMPS = new WeakMap<object, unknown>();

/**
 * [#28534] Record that a registration just wrote `item`'s `_packageId`: it was
 * unset before (`stampBefore`) and is set now. A stamp the object already
 * carried is never recorded, so it stays a stamp the body arrived with.
 */
function noteRegistrationStamp(item: unknown, stampBefore: unknown): void {
  if (stampBefore !== undefined || !item || typeof item !== 'object') return;
  const written = (item as { _packageId?: unknown })._packageId;
  if (written !== undefined) REGISTRATION_WRITTEN_STAMPS.set(item, written);
}

/**
 * [#28534] The registration door's refusal of a collection item whose body
 * already carries a `_packageId` other than the package it is registered under
 * (`ownerId`; none for a manifest that carries no id).
 *
 * `_packageId` is the ADR-0010 envelope stamp: the package that registered the
 * item, written by the door (`stampPackage` here, `registerItem` behind it,
 * both through `applyProtection`). `applyProtection` writes it only while it is
 * `undefined`, and every item schema that spreads `MetadataProtectionFields`
 * (a connector entry among them) declares the key, so a body could arrive
 * wearing ANOTHER package's id and keep it: an installed package naming the
 * host's own id, or an id no package holds, and every reader that asks an
 * item's owner (the connector materializer judging whose root a file ref
 * resolves against, the disabled-package filter, the ADR-0130 artifact gates)
 * then reads a stamp the body wrote about itself.
 *
 * Refused rather than overwritten, beside the two other body-against-key
 * refusals of the same loop (the divergent view-container `name`, the
 * permission set's `packageId`): resolving a disagreement between the body and
 * the key it is filed under silently, in either direction, files the item
 * under something nobody wrote (commit d0ee598e6). A stamp EQUAL to the owner
 * is accepted — it is what an item re-registered under its own package (a
 * ledger rehydrate, an artifact the metadata door already stamped in place
 * with the same body id) carries. `null` and the empty string are stamps too:
 * neither is overwritten by `applyProtection`, so either would survive as an
 * owner no row answers.
 *
 * The judgement and its words are the one judge both doors of the rule call,
 * `judgeCollectionItemOwnerStamp` (`@objectstack/spec/kernel`, whose header
 * holds the verdict table and the collections): the stack schema runs it at
 * the build door (`defineStack`, `os validate`, `os build`, the artifact door's
 * parse), so this seam is the door for a body no schema parse judged — an
 * installed body, a programmatic `registerApp`, a nested plugin, a
 * `strict: false` stack. ⛔ Never a second comparison here. What stays here is
 * the exemption below, which is this process's state, not a body rule.
 *
 * `VALIDATION_ERROR` / 400, `issues[]` at `_packageId`: the envelope of
 * {@link permissionSetOwnerRegistrationRefusal}. Exported for the stack's
 * RESIDUAL registration (`registerUnclaimedTopLevelItems` in `plugin.ts`),
 * which files top-level items under the residual owner and refuses the same
 * stamp in this same envelope. ⛔ Never rebuild the envelope at a second door.
 *
 * ## A stamp a registration wrote is not a body's claim
 *
 * `stampPackage` and `registerItem` stamp the CALLER'S object in place, so an
 * item object registered once keeps that registration's `_packageId` for as
 * long as it lives — a module constant handed to a second registration (a
 * fixture another test registered under its own package, measured in
 * `engine-picklist.test.ts`) arrives wearing the first registration's stamp,
 * which no body wrote. Those stamps are recorded where they are written
 * ({@link noteRegistrationStamp}) and are not refused here: the item
 * registers as it always has. Only a stamp the object ARRIVED with is judged —
 * which every installed body's is, since an install door parses its body
 * fresh, so no registration has touched it.
 */
export function collectionItemOwnerStampRefusal(
  item: unknown,
  type: string,
  name: string,
  ownerId: string | undefined,
): (Error & { code: 'VALIDATION_ERROR'; status: 400; httpStatus: 400; issues: Array<{ path: string; message: string; code: string }> }) | undefined {
  if (item && typeof item === 'object') {
    const stamped = (item as { _packageId?: unknown })._packageId;
    if (stamped !== undefined && REGISTRATION_WRITTEN_STAMPS.get(item) === stamped) return undefined;
  }
  const refusal = judgeCollectionItemOwnerStamp(item, type, name, ownerId, 'register');
  if (!refusal) return undefined;
  const issueMessage = refusal.issueMessage;
  const err = new Error(refusal.message) as Error & {
    code: 'VALIDATION_ERROR'; status: 400; httpStatus: 400; issues: Array<{ path: string; message: string; code: string }>;
  };
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.httpStatus = 400;
  err.issues = [{ path: '_packageId', message: issueMessage, code: 'custom' }];
  return err;
}

/**
 * [#28697] {@link collectionItemOwnerStampRefusal} for the two collections a
 * package body files through verbs of their own rather than the collection
 * loop: its OBJECTS (`registerObject`, the array and the name-keyed map form)
 * and its APPS (`registerApp`: each `apps[]` entry the loop would register,
 * and the body itself when it registers as its own app). The first refusal
 * found, in that order, or `undefined`.
 *
 * Asked BEFORE the body registers anything, so a refused body leaves no
 * package record, object or app behind. An app wearing another package's
 * `_packageId` kept it (`applyProtection` stamps an unset key only), and every
 * reader that asks an app's owner — the per-package list filter, the
 * disabled-package filter, the packaged-base gate — then filed it under the
 * package it named. An object's stamp is read by the action-parse predicate
 * of `registerObject` (`schema._packageId ?? packageId`). Refused, not
 * overwritten, for the reason the collection loop refuses: one judge, so the
 * build door (the stack schema, which judges `objects` and `apps` too) and
 * this door cannot disagree.
 *
 * Called by {@link ObjectQL.registerApp} and by a nested plugin's
 * registration (`registerPlugin`, which registers objects and the plugin
 * itself as an app, and no `apps[]`).
 *
 * @param body    The package body or nested plugin, as it arrived.
 * @param ownerId The package the door registers it under.
 * @param scope   Which of the app shapes this door registers.
 */
export function packageBodyObjectAndAppOwnerStampRefusal(
  body: any,
  ownerId: string | undefined,
  scope: { apps: boolean; selfAsApp: boolean },
): ReturnType<typeof collectionItemOwnerStampRefusal> {
  const objects = body?.objects;
  if (objects && typeof objects === 'object') {
    const entries: Array<[unknown, unknown]> = Array.isArray(objects)
      ? objects.map((def: any) => [def?.name, def])
      : Object.entries(objects);
    for (const [name, def] of entries) {
      const refusal = collectionItemOwnerStampRefusal(def, 'object', typeof name === 'string' && name !== '' ? name : '(unnamed)', ownerId);
      if (refusal) return refusal;
    }
  }
  if (scope.apps && Array.isArray(body?.apps)) {
    for (const app of body.apps) {
      // The loop registers an app with a name only; a nameless one is skipped.
      const appName = app?.name || app?.id;
      if (!appName) continue;
      const refusal = collectionItemOwnerStampRefusal(app, 'app', String(appName), ownerId);
      if (refusal) return refusal;
    }
  }
  if (scope.selfAsApp) {
    const refusal = collectionItemOwnerStampRefusal(body, 'app', String(body?.name), ownerId);
    if (refusal) return refusal;
  }
  return undefined;
}

/**
 * [#28697] Every refusal the collection seam (`registerMetadataCollections`)
 * raises that the body alone decides, asked over a package body or a nested
 * plugin BEFORE anything of the package registers. The first refusal found,
 * walking the collections and items in the order the seam registers them, or
 * `undefined`.
 *
 * Asked first so a body refused by one of them leaves nothing of the package
 * registered, and a refused re-register of an installed id leaves that
 * install as it was. Every judge here reads the item, its derived name, the
 * source label and the owning id, and nothing the registry holds, so asking
 * it first gives the same answer in the same words. ⛔ No second copy of any
 * judge: each is the one function its own record names.
 *
 * Called by {@link ObjectQL.registerApp} for the body (`'manifest'`) and for
 * each nested plugin (`'nested plugin'`, under the parent's id, as
 * `registerPlugin` registers it).
 */
export function packageBodyCollectionRefusal(
  source: any,
  ownerId: string,
  sourceLabel: string,
): Error | undefined {
  for (const key of METADATA_ARRAY_KEYS) {
    // A `picklistExtensions` entry is not an item (the seam hands it to
    // `registerPicklistExtension`, whose refusal reads the registry).
    if (key === 'picklistExtensions') continue;
    const items = (source as any)?.[key];
    if (!Array.isArray(items) || items.length === 0) continue;
    for (const item of items) {
      const itemName = resolveMetadataItemName(key, item);
      // The seam skips (and warns about) an item with no derivable name.
      if (!itemName) continue;
      // [commit d0ee598e6] The DIVERGENT-container refusal (maintainer ruling
      // 2026-09-03, direction 2). The collection seam used to reconcile a
      // container's own `name` to the derived key silently: the author's
      // field discarded with no diagnostic, while
      // the OTHER source registrar
      // (`MetadataPlugin._parseAndRegisterArtifact` ->
      // `assertMetadataRegisterContract`, #7378 row 1) hard-failed the
      // whole artifact load on that very same document. One document,
      // two SOURCE registrars, opposite outcomes, and which one an
      // author got depended on how their package was loaded. #7378
      // row 1 already rules that resolving a name/key disagreement
      // silently "in either direction" files the item under a key the
      // caller never wrote, so the boot loop converges onto the
      // refusal; the artifact door was not moved onto the rewrite.
      //
      // MEASURED, and it is why only this site changed: the second
      // `toRegister` ternary in the seam (the assembled
      // `viewItems:` channel below) cannot carry a container at all —
      // `AssembledViewArtifactSchema` is the view vocabulary MINUS the
      // container branch, and every body it admits is
      // `isAggregatedViewContainer === false`. Its ternary can only
      // MINT a `name` onto an overlay that has none; it can never
      // discard an authored one, because `resolveMetadataItemName`
      // reads a non-container's own `name` FIRST.
      //
      // Scope is the ruling's named main risk, so the gate is three
      // independent narrowings and each one is load-bearing. The first
      // stays here:
      //   * `key === 'views'` — the seam is the GENERIC metadata loop; no
      //     other kind changes behaviour and they all keep the
      //     reconcile.
      // The other two — the CONTAINER branch only, and `name` present
      // AND different — and the message, the envelope and the reason
      // the prose is this seam's own live in `viewContainerNameRefusal`
      // (`view-container-name-refusal.ts`).
      //
      // [#20331] Moved there so that `os validate` runs the SAME
      // judgment, in the same words, instead of passing a document this
      // loop then refuses at boot. The message and the envelope moved
      // unchanged. The `!itemName` skip just above is this loop's
      // precondition for the check, so the function carries it too: it
      // answers `undefined` for a falsy derived key, and a door calling
      // it without this loop cannot refuse an entry this loop skips.
      // ⛔ Do not re-inline it here, and do not write a second copy of
      // it anywhere else: one judge, two doors.
      if (key === 'views') {
        const refusal = viewContainerNameRefusal(item, sourceLabel, ownerId);
        if (refusal) return refusal;
      }
      // [ADR-0086 D3] A permission set whose body `packageId` disagrees
      // with the package the seam registers it under is refused, in
      // the same envelope as the container refusal above:
      // `registerItem` stamps `ownerId` as the set's `_packageId`, the
      // owner every reader reads, so the body's key used to be
      // registered over in silence. See
      // {@link permissionSetOwnerRegistrationRefusal}.
      if (key === 'permissions') {
        const refusal = permissionSetOwnerRegistrationRefusal(item, itemName, ownerId);
        if (refusal) return refusal;
      }
      // [#28534] …and an item of ANY collection whose body already wears
      // a `_packageId` other than `ownerId`: `stampPackage` and
      // `registerItem` stamp the owner only while the key is unset, so
      // the body's own stamp used to win. See
      // {@link collectionItemOwnerStampRefusal}.
      {
        const refusal = collectionItemOwnerStampRefusal(item, pluralToSingular(key), itemName, ownerId);
        if (refusal) return refusal;
      }
      // [#5320] The `views:` tighten — containers ONLY, the contract the
      // stack schema has always declared (`stack.zod.ts`,
      // `z.array(ViewSchema)`). The seam used to register EVERY entry
      // as type `view` — the "runtime wider than schema" hole #5320
      // records: a ViewItem or flattened overlay that `defineStack`
      // refuses registered there in silence. Judged by the SAME
      // classifier the manifest assemblers partition with
      // (`isViewContainerShaped`), so a produced manifest cannot carry
      // a `views:` entry the seam refuses. Deliberately a SHAPE-CLASS
      // judgement, not a full `ViewSchema.parse`: which class an entry
      // belongs to is the seam's contract; whether a container's
      // internals are well-formed stays the authoring/publish doors'
      // job (defineStack, `os validate`, the metadata door).
      // The envelope and the words: {@link viewsEntryNotContainerRefusal},
      // which the residual registration throws too. Judged on the body the
      // seam registers (its `name` reconciled to the derived key).
      if (key === 'views') {
        const toRegister = item.name === itemName ? item : { ...item, name: itemName };
        if (!isViewContainerShaped(toRegister)) return viewsEntryNotContainerRefusal(itemName, sourceLabel, ownerId);
      }
    }
  }
  // [#5320] The `viewItems:` channel, each entry judged by its schema and
  // the PARSED body's owner stamp (#28534), as the seam registers it.
  const assembledItems = (source as any)?.[ASSEMBLED_VIEW_ITEMS_KEY];
  if (Array.isArray(assembledItems)) {
    for (const item of assembledItems) {
      const parsed = AssembledViewArtifactSchema.safeParse(item);
      if (!parsed.success) return assembledViewItemRefusal(item, parsed.error, sourceLabel, ownerId);
      const body = parsed.data as Record<string, unknown>;
      const itemName = resolveMetadataItemName('views', body);
      if (!itemName) continue;
      const refusal = collectionItemOwnerStampRefusal(body, 'view', itemName, ownerId);
      if (refusal) return refusal;
    }
  }
  return undefined;
}

/**
 * [#28697] The seed step's owner-stamp refusal ({@link collectionItemOwnerStampRefusal},
 * #28534: the one collection filed outside the collection seam), asked over a
 * package body's `data` datasets before anything of the package registers.
 * The first refusal found, or `undefined`. Called by {@link ObjectQL.registerApp}.
 */
export function packageBodySeedDataRefusal(manifest: any, ownerId: string): Error | undefined {
  const seedData = manifest?.data;
  if (!Array.isArray(seedData)) return undefined;
  for (const dataset of seedData) {
    // The seed step registers a dataset with a target object only.
    if (!dataset?.object) continue;
    const refusal = collectionItemOwnerStampRefusal(dataset, 'data', String(dataset.object), ownerId);
    if (refusal) return refusal;
  }
  return undefined;
}

/**
 * [#5320] The refusal of a `viewItems:` entry its schema
 * (`AssembledViewArtifactSchema`) does not admit: `INVALID_METADATA` / 422,
 * naming the entry and its source. Asked by {@link packageBodyCollectionRefusal}
 * and by the collection seam, which parses the entry again for the body it
 * registers. ⛔ Never a second copy of the text.
 */
export function assembledViewItemRefusal(
  item: unknown,
  error: { issues: ReadonlyArray<{ message: string }> },
  sourceLabel: string,
  ownerId: string | undefined,
): Error & { code: 'INVALID_METADATA'; status: 422; httpStatus: 422 } {
  const itemName = resolveMetadataItemName('views', item) ?? '(unnamed)';
  const err = new Error(
    `Invalid \`${ASSEMBLED_VIEW_ITEMS_KEY}:\` entry '${itemName}' from ${sourceLabel} '${ownerId}': `
    + 'the assembled-manifest channel carries non-container view artifacts only — a ViewItem '
    + 'record (`viewKind` + `config`) or a flattened list/form overlay '
    + '(`AssembledViewArtifactSchema`, @objectstack/spec). A view CONTAINER travels in `views:`. '
    + `First issue: ${error.issues[0]?.message ?? 'no issue detail'}`,
  ) as Error & { code: 'INVALID_METADATA'; status: 422; httpStatus: 422 };
  err.code = 'INVALID_METADATA';
  err.status = 422;
  err.httpStatus = 422;
  return err;
}

/**
 * [#28697] Stamp an app object ({@link stampPackage}) and register it through
 * the registry's app verb, recording the stamp the registration writes onto
 * the caller's own object ({@link noteRegistrationStamp}): `stampPackage` (with
 * a version) and `registerItem` (without one) stamp the object in place, so a
 * module constant handed to a second registration arrives wearing the first
 * one's stamp, which no body wrote. The stamp before is read BEFORE
 * `stampPackage`, the order the collection and seed loops keep, so a versioned
 * registration is recorded too.
 */
export function registerAppNotingStamp(
  registry: SchemaRegistry,
  app: any,
  ownerId: string,
  ownerVersion: string | undefined,
): void {
  const stampBefore = (app as { _packageId?: unknown } | null | undefined)?._packageId;
  registry.registerApp(stampPackage(app, ownerId, ownerVersion), ownerId);
  noteRegistrationStamp(app, stampBefore);
}

/**
 * [#5320] The registration door's refusal of a `views:` entry that is not a
 * view CONTAINER (`isViewContainerShaped` is false: a ViewItem's
 * `viewKind`/`config`, a flattened overlay's inline view config): the stack
 * `views:` collection carries containers only, the contract the stack schema
 * declares (`z.array(ViewSchema)`). The caller judges the shape; this is the
 * envelope and the words — `INVALID_METADATA` / 422, naming the entry by the
 * name it would be filed under and the source it came from.
 *
 * Called by {@link ObjectQL.registerApp}'s metadata loop and by the stack's
 * RESIDUAL registration (`registerUnclaimedTopLevelItems` in `plugin.ts`, with
 * the `manifest` source label), so a residual entry and a body's are refused
 * in one spelling. ⛔ Never a second copy of the text.
 */
export function viewsEntryNotContainerRefusal(
  itemName: string | undefined,
  sourceLabel: string,
  ownerId: string | undefined,
): Error & { code: 'INVALID_METADATA'; status: 422; httpStatus: 422 } {
  const err = new Error(
    `Invalid \`views:\` entry '${itemName}' from ${sourceLabel} '${ownerId}': the stack `
    + '`views:` collection carries view CONTAINERS only. `viewKind`/`config`/inline view '
    + 'config belong to a single VIEW, not to the container — wrap it: '
    + '`defineView({ list: { type, data, columns, … } })`, or name it — '
    + '`defineView({ listViews: { my_view: { … } } })`. A machine-assembled manifest '
    + `(package export, environment artifact) carries non-container view artifacts under `
    + `\`${ASSEMBLED_VIEW_ITEMS_KEY}:\` instead — re-export the package with a runtime that `
    + 'writes that channel.',
  ) as Error & { code: 'INVALID_METADATA'; status: 422; httpStatus: 422 };
  err.code = 'INVALID_METADATA';
  err.status = 422;
  err.httpStatus = 422;
  return err;
}

/**
 * {@link stampPackage} for an authored OBJECT definition, on a shallow copy.
 * The registry stamps an object schema on its own copy (`applySystemFields`
 * and friends run first), so `registerApp` leaves the caller's definition
 * unstamped, and a manifest registered twice, or recorded by a second install,
 * shows the same objects both times. `applyProtection` writes top-level keys
 * only, so a shallow copy holds every key it touches.
 */
export function stampObjectPackage(def: ServiceObject, packageId: string, packageVersion: string | undefined): ServiceObject {
  return packageVersion === undefined ? def : stampPackage({ ...def }, packageId, packageVersion);
}

/**
 * [ADR-0139 D2] What the `ReadableIds` composition asks of the registered
 * `ISecurityService`: both halves of a read, the object-level one through
 * `canReadObject` or, when a service predates that optional method, the
 * `allowed` of its `explain`.
 */
export type ReadableIdsSecurity = Pick<ISecurityService, 'getReadFilter'> & Partial<Pick<ISecurityService, 'canReadObject' | 'explain'>>;

/** The three resolutions of the `security` service (`ObjectQL#resolveReadableIdsSecurity`). */
type ReadableIdsSecurityResolution =
  | { kind: 'usable'; svc: ReadableIdsSecurity }
  | { kind: 'absent' }
  | { kind: 'unusable'; why: string };

/**
 * [ADR-0139 D2, D6 as amended] One read's `ReadableIds` composition, carried
 * through the chain of composed scopes (`ObjectQL#composeReadableIdsChain`):
 * the read's object and verb (every refusal names them), the security
 * resolution made once for the read, the caller's context handed to every
 * level as it stands, and the answers — per parent object, `{ scope }` with
 * the scope already composed, or `null` for `$in: []` — so a parent is asked
 * once per read at whichever level it first appears.
 */
export interface ReadableIdsChain {
  readonly object: string;
  readonly operation: 'find' | 'findOne' | 'count' | 'aggregate';
  readonly security: ReadableIdsSecurityResolution;
  readonly context: ExecutionContext | undefined;
  readonly answers: Map<string, { scope: FilterCondition | undefined } | null>;
}

/**
 * [ADR-0139 D5.2 / D5.3] A `controlled_by_parent` detail whose master the
 * engine composes no `ReadableIds` leaf over —
 * `ObjectQL#findUnservableControlledByParentMasters`, refused at boot by
 * `ObjectQLPlugin`.
 */
export type UnservableControlledByParentMaster = {
  /** The `controlled_by_parent` detail. */
  readonly detail: string;
  /** Its one required `master_detail` field. */
  readonly field: string;
  /** The object that field names. */
  readonly master: string;
} & (
  | { readonly class: 'object-scoped-read-middleware' }
  | { readonly class: 'other-datasource'; readonly objectDatasource: string | undefined; readonly parentDatasource: string | undefined }
);

/**
 * [ADR-0139 D2] The engine slot where `ObjectQLPlugin` puts the SOURCE the
 * `ReadableIds` composition reads the registered `ISecurityService` from: a
 * function that resolves the kernel's `security` service when a leaf is
 * composed, never at init, so plugin-registration order cannot decide
 * whether a leaf is composed or denied. Written by assignment, so the last
 * registration wins.
 *
 * An empty slot is a DEFINED state, and it fails closed: so does a slot that
 * holds something other than a function, a source that answers nothing or
 * throws, and a service that cannot answer both halves of a read. Each
 * answers every leaf `$in: []` (`ObjectQL#resolveReadableIdsSecurity`).
 *
 * A wiring seam between this package's plugin and its engine, and nothing
 * more: ⛔ not a member of `ObjectQL`, and ⛔ not re-exported by `index.ts` or
 * `core.ts`, so it adds nothing to the surface either entry publishes. A
 * `Symbol.for` key (the shape `plugin.ts` already uses for its string-keyed
 * `skipSchemaSync` slot), so every bundle of this package — both entries,
 * ESM and CJS — names the one slot.
 */
export const SECURITY_SERVICE_SOURCE_SLOT: unique symbol = Symbol.for('objectstack.objectql.securityServiceSource');

/**
 * [ADR-0142 D4] The engine's own channel for {@link OperationContext.writePrecondition}
 * on an `update` it issues itself (the assignment cursor). A module-private
 * symbol, so no options object a door builds — and nothing outside this
 * module — can carry it.
 */
const WRITE_PRECONDITION_OPTION: unique symbol = Symbol('objectql.writePrecondition');

// [#29986 codemod] Declared above without `export`, and read by `engine.ts` or a section module.
export {
  AUTONUMBER_COLLISION_ATTEMPTS, AUTONUMBER_SEED_PAGE_SIZE, AutonumberReaders, CascadeIssuedDelete,
  DISPATCHABLE_HOOK_EVENTS, ENGINE_AGGREGATE_OPTION_KEYS, ENGINE_DELETE_OPTION_KEYS, ENGINE_FIND_OPTION_KEYS,
  ENGINE_QUERY_SLOTS, ENGINE_UPDATE_OPTION_KEYS, ENGINE_WIRE_ONLY_SLOTS, FormulaFaultSink, FormulaRelated,
  IssuedAutonumber, METADATA_ARRAY_KEYS, ReadableIdsSecurityResolution, StoredExpressionServing, TransactionScope,
  WIRE_ONLY_CANONICAL_SHAPES, WRITE_PRECONDITION_OPTION, applyFormulaPlan, applyStoredExpressionsToPatch,
  assertDispatchableHookEvent, assertHookScopeNotSelfCancelling, assertOrderByIsMaterializable,
  assertProjectionHasNoDottedPaths, assertValidHookExcludeObjects, assertValidHookObject,
  assertValidUnscopedMultiWriteFlag, autonumberFieldNames, callerKeySets, callerSuppliedRow, computeStoredExpressions,
  deleteWalkTargetOf, describeNonFilterWhere, emptySearchSetError, formulaPlanEntry, handBackWithheldInsertReadonly,
  hydrateWriteFormulas, isWhereFilterObject, judgeWhereAdmission, noteRegistrationStamp,
  organizationPredicateDeleteRefusal, planFormulaProjection, planStoredExpressions, readStoredAutonumberCounter,
  recomputeAutonumberReaders, refuseSearchOverrideNamingNoField, refuseSearchOverrideNamingNoSearchableField,
  replacedStoredExpressionFields, resolveMetadataItemName, resolveWhereFilterTokens, rowsWithoutFormulaWidening,
  settleBulkStoredExpressions, statesDeleteSemantics, storedExpressionsReading, whereResolvedTokenJudge,
  withFileOwnerKey, withholdInsertReadonlyFromHooks, withoutFormulaWidening,
};
