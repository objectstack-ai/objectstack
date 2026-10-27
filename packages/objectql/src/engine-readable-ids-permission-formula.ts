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
const READABLE_IDS_MAX_CHAIN_DEPTH = 8;

/** The body of `ObjectQL#composeReadableIdsChain`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#readableIdsScopeOf`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#resolveOptionPermissions`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#permissionResolution`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#resolveFormulaPermissions`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#reportFormulaFault`; the method's docblock there is its contract. */
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

/** The body of `ObjectQL#resolveDefaultPermissions`; the method's docblock there is its contract. */
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
