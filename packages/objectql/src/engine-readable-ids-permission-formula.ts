// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 15] The `ReadableIds` composition, permission and formula
 * resolution bodies of `ObjectQL`, moved out of `engine.ts`:
 * `composeReadableIdsChain` (the chain of composed read scopes),
 * `findUnservableControlledByParentMasters` (the boot screen over
 * `controlled_by_parent` details), `readableIdsScopeOf` (the scope one leaf is
 * composed with), `resolveOptionPermissions`, `permissionResolution`,
 * `resolveFormulaPermissions` and `resolveDefaultPermissions` (an operation's
 * one effective-permission resolution and its three consumers) and
 * `reportFormulaFault` (a formula fault, said once per field).
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited. Each method's docblock stays on the method in
 * `engine.ts`, which is still the contract.
 *
 * What stays in `engine.ts`: `composeReadableIdsAtBoundary` and
 * `refuseUncomposableReadableIdsClasses` (ADR-0139 names them by path),
 * `resolveReadableIdsSecurity` (it hands `this` on as a value),
 * `resolveFormulaRelated` (its return type, `FormulaRelated`, is shared with
 * module helpers that stay, and exporting it reorders the published declaration
 * chunk), and the short ones that do not pay for a host
 * (`uncomposableReadableIdsParent`, `serveFormulaField`, `formulaFaultSink`).
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts`, applied per method as
 * `engine-driver-options.ts` applies it. The class keeps all eight methods with
 * name, modifiers, signature, docblock and position. Seven bodies become one
 * literal of exactly the {@link ReadableIdsPermissionFormulaHost} members that
 * method reads, plus a `.call`. The fields a body reads (`_registry`, `logger`,
 * `_effectiveObjectPermissionsResolver`, `formulaFaultReported`) go as GETTERS,
 * so each read happens when the body makes it, as it did; no moved body assigns
 * a field. The methods they call go as late-bound closures over the instance,
 * so a double or spy set on the engine is still the one a call reaches, and
 * `composeReadableIdsChain`'s recursion re-enters through the method.
 * `resolveOptionPermissions` reads no member of the class, so its method calls
 * the function directly.
 *
 * ## Module helpers
 *
 * `READABLE_IDS_MAX_CHAIN_DEPTH` is read by `composeReadableIdsChain` alone, so
 * it moved with it. Two helpers are read by these bodies AND by bodies that
 * stay: `writeFailureLogMeta` (the write doors' failure logs) and
 * `isExpressionDefault` (`applyFieldDefaults`). One home each: they stay
 * declared in `engine.ts`, exported in place, and are imported here, never
 * copied. The types these bodies share with bodies that stay
 * (`PermissionResolution`, `FormulaPlanEntry`, `ReadableIdsSecurity`,
 * `ReadableIdsChain`) are exported in place the same way and imported as types.
 * Nothing re-exports any of them from the package entry, so the published
 * surface does not move.
 *
 * That import is a run-time module cycle (`engine.ts` imports this module, this
 * module imports `engine.ts`). Nothing here runs at module evaluation, only
 * declarations, and `engine.ts` imports this module after every module this one
 * imports, so the engine's evaluation order is what it was. The published build
 * bundles both files into one, where the cycle does not exist.
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 */

import { ReadableIds, RLS_DENY_FILTER, isControlledByParentMasterField, markFilterSubtreeProvenance } from '@objectstack/spec/data';
import type { FilterCondition } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { toEvalPermissions, type EvalError, type EvalPermissions } from '@objectstack/formula';
import { collectComposableReadableIds, composeReadableIdsLeaves, describeReadableIdsLeaf, readableIdsRefusalError } from './filter-comparand-shape.js';
import type { ComposableReadableIdsSite } from './filter-comparand-shape.js';
import { optionVisibilityReadsPermissions, readsPermissionPredicate } from './validation/rule-validator.js';
import { isExpressionDefault, writeFailureLogMeta } from './engine.js';
import type { FormulaPlanEntry, PermissionResolution, ReadableIdsChain, ReadableIdsSecurity, UnservableControlledByParentMaster } from './engine.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's type on the class is a change here too, and naming a member the
 * class does not have is a compile error. See the module header for which
 * members are getters, and which one also has a setter.
 */
export interface ReadableIdsPermissionFormulaHost {
  readonly _registry: ObjectQL['_registry'];
  readonly logger: ObjectQL['logger'];
  readonly _effectiveObjectPermissionsResolver: ObjectQL['_effectiveObjectPermissionsResolver'];
  readonly formulaFaultReported: ObjectQL['formulaFaultReported'];
  refuseUncomposableReadableIdsClasses: ObjectQL['refuseUncomposableReadableIdsClasses'];
  readableIdsScopeOf: ObjectQL['readableIdsScopeOf'];
  composeReadableIdsChain: ObjectQL['composeReadableIdsChain'];
  uncomposableReadableIdsParent: ObjectQL['uncomposableReadableIdsParent'];
  buildEvalUser: ObjectQL['buildEvalUser'];
  defaultFieldEntries: ObjectQL['defaultFieldEntries'];
}

/**
 * [ADR-0139 D6, as amended — the nested master chain] How deep a chain of
 * composed scopes the engine composes: the scope answered for a leaf in the
 * read's own `where` is one scope deep, the scope answered for a leaf inside
 * it is two, and so on down a master-detail chain whose every master is
 * itself `controlled_by_parent`. A chain deeper than this is refused by name.
 *
 * A COST ceiling, not a semantic rule, and the same cut as the
 * `controlled_by_parent` derivation's (`CBP_MAX_CHAIN_DEPTH`,
 * `packages/plugins/plugin-security`): a detail with seven derived masters
 * above it composes, an eighth derived master is refused there and here.
 * Every authored chain in this repository is one hop, the deepest any consumer
 * has asked for is two, and 8 is four times that. Termination needs no bound —
 * the chain refuses a parent already on its branch — so what this caps is the
 * statement the driver compiles, one nested subquery per level. At the bound
 * the read is REFUSED, loud (D5's envelope), ⛔ never composed partway and
 * never answered "no restriction".
 */
export const READABLE_IDS_MAX_CHAIN_DEPTH = 8;

/**
 * [ADR-0139 D2, D6 as amended] Compose the leaves at `sites` in `node` —
 * the read's `where` at the top level, a parent's composed scope below it —
 * and, first, every leaf a scope answered for one of their parents carries,
 * recursively. Returns `node` rewritten copy-on-write, every leaf replaced
 * by its composed form or `[]`.
 *
 * `ancestors` are the parents whose scopes enclose `node`, outermost first:
 * empty for the read's own `where`, `[P]` inside P's scope, `[P, G]` inside
 * the scope G answered within it. Per distinct parent of `sites`, in walk
 * order:
 *
 *  1. D5's two classes are refused by name, exactly as at the top level
 *     ({@link refuseUncomposableReadableIdsClasses}): a nested parent an
 *     object-scoped middleware narrows, or one bound to another datasource
 *     than the read's object, is refused — the whole chain compiles into the
 *     read's one statement, on the read's datasource.
 *  2. A parent already answered on this read — at any level — is not asked
 *     again: its composed scope is reused by reference.
 *  3. A parent already on `ancestors` is a cycle (its own scope, or a scope
 *     inside it, reaches back to it); a parent whose scope would be the
 *     chain's scope number {@link READABLE_IDS_MAX_CHAIN_DEPTH} + 1 is past
 *     the bound. Both are refused by name, `INTERNAL_ERROR` / 500, before
 *     the service is asked about that parent: a chain the engine cannot
 *     compose whole is not composed partway, and ⛔ never answered "no
 *     restriction".
 *  4. The parent is asked both halves ({@link readableIdsScopeOf}) with the
 *     read's context as it stands; a scope that carries leaves is composed
 *     through this method first, under `[...ancestors, parent]`, and the
 *     rewritten scope is what the parent's leaf is composed with. The
 *     provenance mark the scope carries (`'policy'`) survives the rewrite.
 *
 * A nested leaf outside a `$in` comparand, or a composed leaf the engine did
 * not compose, inside an answered scope is refused by the same walk that
 * refuses it in a caller's `where` ({@link collectComposableReadableIds}):
 * the scope is the `where` of a read of its parent and is judged as one.
 */
export async function composeReadableIdsChain<N>(
  this: Pick<ReadableIdsPermissionFormulaHost, 'refuseUncomposableReadableIdsClasses' | 'readableIdsScopeOf' | 'composeReadableIdsChain'>,
  chain: ReadableIdsChain,
  node: N,
  sites: readonly ComposableReadableIdsSite[],
  ancestors: readonly string[],
): Promise<N> {
  const { object, operation } = chain;
  const parents = this.refuseUncomposableReadableIdsClasses(object, operation, sites);
  for (const parent of parents) {
    if (chain.answers.has(parent)) continue;
    const site = sites.find((s) => s.leaf.object === parent)!;
    const branch = [object, ...ancestors, parent];
    if (ancestors.includes(parent)) {
      throw readableIdsRefusalError(
        object,
        `${operation}('${object}'): ${describeReadableIdsLeaf(site.at, site.leaf)}, inside the read scope of ` +
        `'${ancestors[ancestors.length - 1]}', and the engine composes no such leaf: the chain of read scopes ` +
        `${branch.join(' -> ')} returns to '${parent}', a cycle. The query was NOT run and no driver was asked. ` +
        `A parent's read scope cannot be derived from its own readable ids; fix the read scope the security ` +
        `service answers for '${ancestors[ancestors.length - 1]}'.`,
      );
    }
    if (ancestors.length >= READABLE_IDS_MAX_CHAIN_DEPTH) {
      throw readableIdsRefusalError(
        object,
        `${operation}('${object}'): ${describeReadableIdsLeaf(site.at, site.leaf)}, and the engine composes no ` +
        `such leaf: the chain of read scopes ${branch.join(' -> ')} is ${ancestors.length + 1} scopes deep, and the ` +
        `engine composes a chain at most ${READABLE_IDS_MAX_CHAIN_DEPTH} scopes deep. The query was NOT run and ` +
        `no driver was asked. A master-detail chain this deep is not one the engine composes; read '${parent}' as ` +
        'the caller first and match its ids with a list, or shorten the chain.',
      );
    }
    const answer = chain.security.kind === 'usable'
      ? await this.readableIdsScopeOf(object, operation, parent, chain.security.svc, chain.context)
      : null;
    if (answer === null || answer.scope === undefined) {
      chain.answers.set(parent, answer);
      continue;
    }
    // The scope is the `where` of a read of `parent`: judged as one, and
    // the leaves it carries are composed before this parent's leaf is.
    const nested = collectComposableReadableIds(object, operation, answer.scope, 'where', `${site.at}.scope`);
    chain.answers.set(parent, nested.length === 0
      ? answer
      : { scope: await this.composeReadableIdsChain(chain, answer.scope, nested, [...ancestors, parent]) });
  }
  // A parent with no answer (`null`, or never asked: not registered) is
  // `$in: []`.
  return composeReadableIdsLeaves(node, (leaf) => {
    const answer = chain.answers.get(leaf.object);
    return answer ? ReadableIds.compose(leaf, answer.scope) : [];
  });
}

/** The body of `ObjectQL#findUnservableControlledByParentMasters`; the method's docblock there is its contract. */
export function findUnservableControlledByParentMasters(
  this: Pick<ReadableIdsPermissionFormulaHost, '_registry' | 'uncomposableReadableIdsParent'>,
): UnservableControlledByParentMaster[] {
  const found: UnservableControlledByParentMaster[] = [];
  for (const object of this._registry.getAllObjects() as Array<{ name?: string; sharingModel?: unknown; fields?: Record<string, unknown> }>) {
    if (object?.sharingModel !== 'controlled_by_parent' || typeof object.name !== 'string') continue;
    const masters = Object.entries(object.fields ?? {}).filter(([, f]) => isControlledByParentMasterField(f));
    if (masters.length !== 1) continue;
    const [field, def] = masters[0];
    const master = (def as { reference?: unknown }).reference;
    if (typeof master !== 'string' || !this._registry.getObject(master)) continue;
    const uncomposable = this.uncomposableReadableIdsParent(object.name, master);
    if (uncomposable) found.push({ detail: object.name, field, master, ...uncomposable });
  }
  return found;
}

/**
 * [ADR-0139 D2 steps 1-2] The scope a leaf over `parent` is composed with,
 * or `null` for `$in: []`. Fails closed on every answer that is not a
 * positive one, and on every throw.
 */
export async function readableIdsScopeOf(
  this: Pick<ReadableIdsPermissionFormulaHost, 'logger'>,
  object: string,
  operation: string,
  parent: string,
  svc: ReadableIdsSecurity,
  context: ExecutionContext | undefined,
): Promise<{ scope: FilterCondition | undefined } | null> {
  const deny = (why: string, e?: unknown): null => {
    this.logger.warn(
      `[ObjectQL] ${operation}('${object}'): the ReadableIds leaf over '${parent}' is answered $in: [] ` +
      `(fail-closed) — ${why}`,
      e === undefined ? undefined : writeFailureLogMeta(e, { object, parent }),
    );
    return null;
  };
  let admitted: boolean;
  try {
    admitted = typeof svc.canReadObject === 'function'
      ? (await svc.canReadObject(parent, context)) === true
      : (await svc.explain!({ object: parent, operation: 'read' }, context))?.allowed === true;
  } catch (e) {
    return deny('the object-level read admission threw', e);
  }
  if (!admitted) return null;
  let scope: unknown;
  try {
    scope = await svc.getReadFilter(parent, context);
  } catch (e) {
    return deny('getReadFilter() threw', e);
  }
  if (scope === undefined) return { scope: undefined };
  if (scope === RLS_DENY_FILTER) return null;
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) {
    return deny(`getReadFilter() answered ${scope === null ? 'null' : Array.isArray(scope) ? 'an array' : typeof scope}, not a filter`);
  }
  return { scope: markFilterSubtreeProvenance(scope as FilterCondition, 'policy') };
}

/**
 * [#18783] The permission map one write's option gates are evaluated with —
 * resolved at most ONCE for the whole write (a batch insert, a by-id update,
 * an N-row bulk update, a `validate()` preview), never per row and never per
 * predicate, and never kept past the call: the contract member is
 * request-scoped, and a map held across writes would serve a grant that may
 * since have been revoked.
 *
 * Asked ONLY when the write can need it — a resolver is registered, the write
 * has an acting user (`current_user` is otherwise unbound and `can` asks
 * about nobody), and some payload PICKS an option whose `visibleWhen` calls
 * `can` ({@link optionVisibilityReadsPermissions}, the evaluator's own
 * picker). Every other write pays nothing, and cannot be refused by a
 * resolution it never depended on.
 *
 * The answer goes through `toEvalPermissions`, formula's one door into
 * `EvalContext.permissions`, so a map that is not the published shape is
 * refused here rather than answering `can()` confidently wrong.
 *
 * Returns a per-payload accessor, the shape {@link resolvePredicateRelated}
 * hands back:
 *
 *  - a payload that picks no `can`-gated option gets `undefined`;
 *  - one that does gets the map;
 *  - when the resolution THREW (or the map was refused), one that does gets
 *    the throw, re-raised untouched: the write fails CLOSED, with the
 *    resolution's own error. ⛔ It is never read as "no grants", which would
 *    publish a failure as a measured denial of everything.
 */
export async function resolveOptionPermissions(
  schema: unknown,
  payloads: ReadonlyArray<Record<string, unknown> | null | undefined>,
  resolution: PermissionResolution | undefined,
): Promise<(payload: Record<string, unknown> | null | undefined) => EvalPermissions | undefined> {
  const none = (): undefined => undefined;
  // [#20082] The write's ONE resolution ({@link permissionResolution}) —
  // `undefined` on exactly the two conditions this method used to test
  // itself: no resolver registered, or no acting user.
  if (!resolution) return none;
  const fields = (schema as { fields?: Parameters<typeof optionVisibilityReadsPermissions>[0] } | null | undefined)?.fields;
  const needs = (payload: Record<string, unknown> | null | undefined): boolean =>
    optionVisibilityReadsPermissions(fields, payload);
  if (!payloads.some(needs)) return none;
  let permissions: EvalPermissions;
  try {
    permissions = await resolution.get();
  } catch (err) {
    return (payload) => {
      if (needs(payload)) throw err;
      return undefined;
    };
  }
  return (payload) => (needs(payload) ? permissions : undefined);
}

/**
 * [#20082] ONE operation's effective-permission resolution — the single
 * resolver ask every consumer inside that operation shares. On a write those
 * are its CEL `defaultValue`s ({@link resolveDefaultPermissions}), its option
 * gates ({@link resolveOptionPermissions}) and the formula fields on its
 * response ({@link resolveFormulaPermissions}); on a read, its formula fields.
 * The contract member's "resolve it ONCE per request" is kept per engine
 * operation: a write that carries a `can` default, a `can` option gate and a
 * `can` formula asks the resolver once, not three times.
 *
 * `undefined` when there is nothing to ask — no resolver registered, or no
 * acting user (`current_user` is then unbound, and `can` asks about nobody).
 * Every consumer then passes NO permission data: ⛔ never an empty map, which
 * is a real answer ("holds nothing") and would deny confidently.
 *
 * Lazy and memoised for the operation: the ask happens when the first consumer
 * NEEDS the map, never earlier, and a later consumer awaits the same promise —
 * its rejection included, so one failed resolution is the same failure
 * everywhere in the operation rather than a second, possibly different, ask.
 * The answer goes through `toEvalPermissions`, formula's one door into
 * `EvalContext.permissions`, so an off-shape map fails here like a throw.
 * ⛔ Never kept past the operation: each operation mints its own, because a map
 * held across operations would serve a grant that may since have been revoked.
 */
export function permissionResolution(
  this: Pick<ReadableIdsPermissionFormulaHost, '_effectiveObjectPermissionsResolver' | 'buildEvalUser'>,
  context: ExecutionContext | undefined,
): PermissionResolution | undefined {
  const resolver = this._effectiveObjectPermissionsResolver;
  if (!resolver || !this.buildEvalUser(context)) return undefined;
  let pending: Promise<EvalPermissions> | undefined;
  return {
    // `Promise.resolve().then(...)` so a resolver that throws SYNCHRONOUSLY is
    // memoised as a rejection too, rather than escaping `get()` un-memoised
    // and being asked again by the next consumer.
    get: () => (pending ??= Promise.resolve()
      .then(() => resolver(context))
      .then((answer) => toEvalPermissions(answer))),
  };
}

/**
 * [#20082] The permission map a batch of `formula` fields is evaluated with —
 * a read's (`find`, `findOne`) or a write response's
 * ({@link hydrateWriteFormulas}).
 *
 * Asked only when it can change an answer: the context binds an acting user
 * (the way {@link applyFormulaPlan} binds `current_user` — a truthy `userId`),
 * some planned formula CALLS `can` ({@link readsPermissionPredicate}, the same
 * reading the option gate uses), and there is a record to evaluate. Every
 * other read pays nothing, and a whole `find` asks at most once, never per row.
 *
 * A read cannot refuse a row because one computed field lacks data, so when
 * the map cannot be had the formula keeps the rule every formula that does not
 * evaluate follows on this path — it reads `null` — and this method says so,
 * once per operation, at `warn`, naming the object, the fields and the reason:
 *
 *  - `no-permission-source`: no resolver is registered. NO map is passed (the
 *    contract member's rule for an absent method), so `can()` keeps its own
 *    loud refusal and the field reads `null`.
 *  - `permission-resolution-failed`: the resolution threw, or answered a map
 *    that is not the published shape. Fail CLOSED: ⛔ never read as "no
 *    grants" (an empty map would publish a confident `false`) and ⛔ never a
 *    grant — the field reads `null`, with the resolution's error in the line.
 *
 * `warn`, not `error`: a formula is computed on read and nothing is persisted
 * from it, so the degradation is visible to whoever reads the field.
 */
export async function resolveFormulaPermissions(
  this: Pick<ReadableIdsPermissionFormulaHost, 'logger'>,
  object: string,
  plan: readonly FormulaPlanEntry[],
  records: readonly unknown[],
  context: ExecutionContext | undefined,
  resolution: PermissionResolution | undefined,
): Promise<EvalPermissions | undefined> {
  if (!context?.userId) return undefined;
  if (!records.some((r) => r != null && typeof r === 'object')) return undefined;
  const fields = plan.filter((entry) => readsPermissionPredicate(entry.expression)).map((entry) => entry.name);
  if (fields.length === 0) return undefined;
  if (!resolution) {
    this.logger.warn(
      `formula field(s) ${fields.join(', ')} on '${object}' call current_user.can(), and no `
      + 'effective-permission source is registered, so they read null: compose a security '
      + 'service that registers one (registerEffectiveObjectPermissionsResolver) for can() to '
      + 'be answered',
      { object, fields, reason: 'no-permission-source' },
    );
    return undefined;
  }
  try {
    return await resolution.get();
  } catch (error) {
    this.logger.warn(
      `formula field(s) ${fields.join(', ')} on '${object}' call current_user.can(), and the `
      + 'effective-permission resolution failed, so they read null on this read (failed closed: '
      + 'neither a grant nor a denial was assumed)',
      { object, fields, reason: 'permission-resolution-failed', error },
    );
    return undefined;
  }
}

/**
 * [#22019] A formula field that did not evaluate, reported ONCE per
 * (object, field) per engine instance.
 *
 * ## What it closes
 *
 * {@link applyFormulaPlan} answers `null` for a formula it cannot evaluate,
 * and said nothing. A formula calling an unregistered function
 * (`sqrt(record.amount)`) therefore read `null` on every row of every read
 * and every write response, with no line anywhere to say why — the silent
 * swallow ADR-0032 forbids at a call site. The answer stays `null` (what a
 * read returns is protocol); the fault is now said.
 *
 * ## Level and rate
 *
 * `warn`, on AGENTS.md's one question: a formula is computed on read and
 * nothing is persisted from it, so the degradation is a field reading `null`
 * — visible to whoever reads it — never a write that claims to land and does
 * not. That is the reading {@link resolveFormulaPermissions} makes for the
 * same `null`.
 *
 * Once per pair per engine instance, as {@link warnCascadeNotAtomic} says its
 * piece once per object: a list read evaluates a faulting formula once per
 * row, and a line per row is the volume that gets a log skimmed. A later
 * fault on the same pair is not re-reported, even with a different error —
 * the first line already names the field to fix.
 */
export function reportFormulaFault(
  this: Pick<ReadableIdsPermissionFormulaHost, 'formulaFaultReported' | 'logger'>,
  object: string,
  field: string,
  error: EvalError,
): void {
  const key = JSON.stringify([object, field]);
  if (this.formulaFaultReported.has(key)) return;
  this.formulaFaultReported.add(key);
  // The evaluator's message carries the source and a caret on the lines after
  // its first; the first line goes in the sentence, the whole of it in the meta.
  const headline = error.message.split('\n', 1)[0];
  this.logger.warn(
    `formula field '${field}' on '${object}' could not be evaluated, so it reads null wherever this `
    + `fault holds (${error.kind}: ${headline}). If the expression itself is at fault — an unknown `
    + 'function, a missing field — `os validate`, or a re-save of the object, refuses it with a located '
    + 'message; if it faults on some records\' values, guard the operands it reads. Reported once per '
    + 'object and field per engine instance.',
    { object, field, kind: error.kind, error: error.message },
  );
}

/**
 * [#20082] The permission map a write's CEL `defaultValue`s are evaluated with
 * — a per-row accessor, the shape {@link resolveOptionPermissions} hands back,
 * over the write's ONE {@link permissionResolution}.
 *
 * Asked only when a row will really be defaulted by an expression that calls
 * `can`: the write has an acting user (the way {@link applyFieldDefaults}
 * binds `current_user` — a truthy `userId`), and the row leaves such a field
 * without a value (`applyFieldDefaults`' own `!= null` test). A row that
 * supplies the field, and an object whose defaults never call `can`, pay
 * nothing and cannot be refused by a resolution they never depended on.
 *
 *  - no resolution (no resolver registered): every row gets `undefined` — NO
 *    map. The default then does not evaluate and is left unset with
 *    `applyFieldDefaults`' existing warn, which carries formula's own "carries
 *    no permission data" refusal; a `required` field so defaulted is refused
 *    by required-validation, exactly as before this seam existed.
 *  - the resolution threw (or its map was refused): a row that needs it gets
 *    the throw, re-raised untouched — the write fails CLOSED with the
 *    resolution's own error, as an option gate's does. ⛔ Never read as "no
 *    grants", which would STORE `false` as though it had been measured.
 */
export async function resolveDefaultPermissions(
  this: Pick<ReadableIdsPermissionFormulaHost, 'defaultFieldEntries'>,
  object: string,
  rows: ReadonlyArray<unknown>,
  context: ExecutionContext | undefined,
  resolution: PermissionResolution | undefined,
  onlyFields?: readonly string[],
): Promise<(row: unknown) => EvalPermissions | undefined> {
  const none = (): undefined => undefined;
  if (!resolution || !context?.userId) return none;
  const gated = (this.defaultFieldEntries(object) ?? [])
    .filter((f) => !onlyFields || onlyFields.includes(f.name))
    .filter((f) => isExpressionDefault(f.defaultValue) && readsPermissionPredicate(f.defaultValue))
    .map((f) => f.name);
  if (gated.length === 0) return none;
  const needs = (row: unknown): boolean =>
    row != null && typeof row === 'object'
    && gated.some((name) => (row as Record<string, unknown>)[name] == null);
  if (!rows.some(needs)) return none;
  let permissions: EvalPermissions;
  try {
    permissions = await resolution.get();
  } catch (err) {
    return (row) => {
      if (needs(row)) throw err;
      return undefined;
    };
  }
  return (row) => (needs(row) ? permissions : undefined);
}
