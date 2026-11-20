// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D1, D4] The engine's executor seam for the FIXED-READ LEAVES
 * (`@objectstack/spec/data`'s `isFixedReadLeaf`: `SharedRecordIds` today,
 * ADR-0147's leaf on the card that adds it), built once in the two-leaf shape.
 *
 * A fixed-read leaf arrives composed: the engine composes nothing for it. The
 * seam checks where it sits, on which verb and for whom, recognises the two
 * classes it is never handed to a driver in, consults the driver's
 * declaration, and hands the leaf to the driver as it stands, by reference.
 * Every refusal is ADR-0139 D3's envelope, `INTERNAL_ERROR` / 500
 * (`@objectstack/core`'s `fixedReadLeafRefusal`), ⛔ never `INVALID_FILTER`:
 * no request can spell the leaf, so the fault is a composition's.
 *
 * ## Where it runs
 *
 *  - **The comparand door** (`filter-comparand-shape.ts#assertListComparandShapes`:
 *    both branches of `lowerWhereFilterArray`, an aggregate's `having` and its
 *    aggregations' filters). The door admits a leaf of a brand in
 *    `ENGINE_FIXED_READ_LEAF_BRANDS` as a `$in` comparand, then
 *    `collectFixedReadLeaves` (`fixed-read-leaf-position.ts`) refuses, by
 *    name, every leaf out of position or on the wrong verb, before a later
 *    door reads it as a value.
 *  - **The executor boundary** of a read verb
 *    (`engine-security-resolvers.ts#composeReadableIdsAtBoundary`), on the
 *    FINAL AST after the middleware chain, the before-hooks and the
 *    `ReadableIds` composition, immediately before the driver call; and the
 *    **executor's entry** of an `update` and a `delete`, before their prior-row
 *    reads reach the driver. There {@link passFixedReadLeaves} runs every
 *    check, so a leaf a middleware or a hook wrote meets the same rules as one
 *    a caller wrote, and a leaf inside a composed scope meets them too.
 *
 * ## The rules
 *
 *  - **Position and verb (D1, ③ ruled A)** — `fixed-read-leaf-position.ts`.
 *  - **Recipient (D4).** The leaf is admitted only when the identity it names
 *    is the user of the context the operation runs under, or that context's
 *    delegator (ADR-0090 D10, `onBehalfOf.userId`); a system context
 *    (`isSystem: true`) is the one exemption. Absence is never system. ⛔ The
 *    check compares and never replaces: the recipient stays the producer's.
 *  - **The two classes (D4, ② as ruled)** — {@link fixedReadLeafClassOf}.
 *  - **The declaration (D4, Q2 as ruled).** The leaf reaches the driver only
 *    when its `DriverCapabilities.fixedReadLeaves` names it
 *    ({@link driverEvaluatesFixedReadLeaf}); otherwise the operation is
 *    refused before the driver is called. ⛔ No list fallback, ever.
 *
 * ## The log
 *
 * The refusal is logged at `error` once per evaluator wherever it occurs
 * (`@objectstack/core`'s `logRefusalOnce`): once per driver for a declaration
 * it lacks, once per engine for every other fault. The door holds no logger,
 * so each verb runs its door calls through {@link atFixedReadLeafDoor}, which
 * logs a door refusal on the SAME per-engine flag the boundary's refusals use:
 * a refusal at the door and one at the boundary log one line between them.
 *
 * ⛔ No boot refusal and no producer here: the class-② boot check and R2's
 * share-arm answer land with the producer (ADR-0155 plan step 6), and until
 * then nothing on main writes the leaf. `index.ts` re-exports two readers
 * from this module and nothing else (plan step 5): {@link fixedReadLeafClassOfEngine}
 * and {@link driverEvaluatesFixedReadLeaf}.
 */

import { fixedInnerReadOf, fixedReadLeafNameOf, type FixedReadLeaf, type FixedReadLeafName } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { describeFixedReadLeaf, fixedReadLeafRefusal, logRefusalOnce, type ReadableIdsRefusalLog } from '@objectstack/core';
import { hookNamesObject, type HookEntry } from './engine-top-level.js';
import {
  FIXED_READ_LEAF_SEAM,
  collectFixedReadLeaves,
  fixedReadLeafRulesOf,
  fixedReadLeafSeamRefusal,
  isFixedReadLeafSeamRefusal,
} from './fixed-read-leaf-position.js';
import { driverNameOf } from './relation-semi-join.js';
import { securityResolversHost } from './engine-facet-hosts.js';
import type { ObjectQL } from './engine.js';

/** The hook events whose registration for the inner table BY NAME is D4's second class. */
const FIND_HOOK_EVENTS = Object.freeze(['beforeFind', 'afterFind'] as const);

/**
 * [ADR-0155 D4, ② as ruled] Does `driver` evaluate the fixed-read leaf
 * `name`? Its `DriverCapabilities.fixedReadLeaves` lists the name; absence is
 * none. The one reader of the declaration: the seam's consult now, and the
 * producer's up-front answer (R2) when it lands (ADR-0155 plan step 6), which
 * reaches the driver through `IDataEngine.getDriverForObject`.
 */
export function driverEvaluatesFixedReadLeaf(driver: { readonly supports?: unknown } | undefined, name: FixedReadLeafName): boolean {
  const supports = driver?.supports;
  if (supports === null || typeof supports !== 'object') return false;
  const names = (supports as { fixedReadLeaves?: unknown }).fixedReadLeaves;
  return Array.isArray(names) && names.includes(name);
}

/** What the seam reads off the engine: `SecurityResolversHost` carries every member. */
export interface FixedReadLeafSeamHost {
  /** The engine itself: the driver an operation dispatches to, and the key of its once-per-engine log. */
  readonly facade: { getDriverForObject(object: string): { readonly name?: unknown; readonly supports?: unknown } | undefined };
  readonly logger: ReadableIdsRefusalLog;
  readonly hooks: ReadonlyMap<string, readonly Pick<HookEntry, 'object' | 'excludeObjects'>[]>;
  hasObjectMiddleware(object: string): boolean;
  resolveDatasourceBinding(object: string): { readonly datasource: string } | undefined;
}

/** Which of D4's two classes a leaf falls in, and what names it. */
export type FixedReadLeafClass =
  | { readonly class: 'other-datasource'; readonly object: string; readonly table: string; readonly objectDatasource: string | undefined; readonly tableDatasource: string | undefined }
  | { readonly class: 'registration-by-name'; readonly table: string; readonly registration: string };

/**
 * [ADR-0155 D4, ② as ruled] Which of the two classes the seam recognises
 * `leaf` falls in, or `undefined` when neither; the ONE recognition, which the
 * analytics native compiler asks before it compiles (ADR-0155 plan step 5).
 *
 *  1. **Another datasource**: the object the leaf names is bound to another
 *     datasource than the table its fixed inner read reads
 *     (`resolveDatasourceBinding`), so no driver evaluates the subquery.
 *  2. **A registration for the table BY NAME**: an object-scoped middleware
 *     (`hasObjectMiddleware`) or a `beforeFind` / `afterFind` hook that names
 *     it (`hookNamesObject`), which today's read of the table runs and the
 *     subquery would read around. A registration that names no object, or
 *     `'*'`, is outside the class (D4's boundary).
 *
 * At this step both answer with the refusal (R1). ⛔ The seam never reads
 * around either.
 */
export function fixedReadLeafClassOf(host: FixedReadLeafSeamHost, leaf: FixedReadLeaf): FixedReadLeafClass | undefined {
  const { table } = fixedInnerReadOf(leaf);
  const object = fixedReadLeafRulesOf(leaf).position(leaf).object;
  const objectDatasource = host.resolveDatasourceBinding(object)?.datasource;
  const tableDatasource = host.resolveDatasourceBinding(table)?.datasource;
  if (objectDatasource !== tableDatasource) return { class: 'other-datasource', object, table, objectDatasource, tableDatasource };
  if (host.hasObjectMiddleware(table)) {
    return { class: 'registration-by-name', table, registration: `an object-scoped middleware registered for '${table}'` };
  }
  for (const event of FIND_HOOK_EVENTS) {
    if ((host.hooks.get(event) ?? []).some((entry) => hookNamesObject(entry, table))) {
      return { class: 'registration-by-name', table, registration: `a ${event} hook registered for '${table}' by name` };
    }
  }
  return undefined;
}

/**
 * [ADR-0155 D4, plan step 5] The public face of {@link fixedReadLeafClassOf}
 * for one engine: which of D4's two classes `leaf` falls in on `engine`, or
 * `undefined` when neither. The recognition is the seam's own, run over the
 * host the executor boundary reads (`securityResolversHost`), so a caller that
 * must decline before it compiles (the analytics native compiler, ADR-0155 Q2
 * as ruled) asks it here and ⛔ restates neither class.
 *
 * Read-only: it reads the engine's datasource bindings, its object-scoped
 * middlewares and its find hooks, and calls no driver and logs nothing.
 */
export function fixedReadLeafClassOfEngine(engine: ObjectQL, leaf: FixedReadLeaf): FixedReadLeafClass | undefined {
  return fixedReadLeafClassOf(securityResolversHost.of(engine), leaf);
}

/** The once-per-evaluator log's flags: one per engine for the seam's faults, one per driver for a declaration it lacks. */
const LOGGED = new WeakMap<object, { logged: boolean }>();

function flagOf(evaluator: object): { logged: boolean } {
  let flag = LOGGED.get(evaluator);
  if (flag === undefined) LOGGED.set(evaluator, (flag = { logged: false }));
  return flag;
}

/** What the door's half of the log reads: the engine its flag is keyed on, and the engine's logger. */
export interface FixedReadLeafDoorHost {
  readonly facade: object;
  readonly logger: ReadableIdsRefusalLog | undefined;
}

/** Log `err` once for the engine `host.facade` names when it is the seam's refusal; any other error is not this log's. */
function logSeamRefusalOnce(host: FixedReadLeafDoorHost, err: unknown): void {
  if (isFixedReadLeafSeamRefusal(err)) logRefusalOnce(err as Error, host.logger, flagOf(host.facade), 'evaluator');
}

/**
 * [ADR-0155 D4] Run `door`, one of a verb's door calls (`lowerWhereFilterArray`,
 * or `assertListComparandShapes` on `having` or an aggregation's filter), and
 * when it throws the seam's refusal for a fixed-read leaf out of position or on
 * the wrong verb, log it at `error` on the engine's flag, the one
 * {@link passFixedReadLeaves} logs on, then re-throw it unchanged. Any other
 * error, an unbranded copy's `INVALID_FILTER` / 400 among them, passes through
 * unlogged here.
 */
export function atFixedReadLeafDoor<T>(host: FixedReadLeafDoorHost, door: () => T): T {
  try {
    return door();
  } catch (err) {
    logSeamRefusalOnce(host, err);
    throw err;
  }
}

/**
 * [ADR-0155 D4] The executor seam's pass-through: judge every fixed-read leaf
 * in `node` (an operation's `where`, or the `path` clause) for an operation on
 * `object` under `context`, and return when each may be handed to the driver
 * as it stands; otherwise throw the refusal, logged once per evaluator.
 *
 * It edits nothing: an admitted leaf reaches the driver by reference.
 */
export function passFixedReadLeaves(
  host: FixedReadLeafSeamHost,
  object: string,
  operation: string,
  node: unknown,
  context: ExecutionContext | undefined,
  path = 'where',
): void {
  let sites: ReturnType<typeof collectFixedReadLeaves>;
  try {
    sites = collectFixedReadLeaves(object, operation, node, path);
    for (const { leaf, at } of sites) {
      if (context?.isSystem !== true && !fixedReadLeafRulesOf(leaf).principalAdmitted(leaf, context)) {
        throw fixedReadLeafSeamRefusal(object, operation, at, leaf,
          'the identity it names is neither the user of the context this operation runs under nor that context\'s '
          + 'delegator, and the context is not a system context: a scope that arrives composed is trusted only for '
          + 'the principal it was composed for, and the engine never replaces it. Build the scope under this context.');
      }
      const recognised = fixedReadLeafClassOf(host, leaf);
      if (recognised?.class === 'other-datasource') {
        throw fixedReadLeafSeamRefusal(object, operation, at, leaf,
          `'${recognised.object}' is bound to datasource '${String(recognised.objectDatasource)}' while `
          + `'${recognised.table}' is bound to '${String(recognised.tableDatasource)}': no driver evaluates the fixed `
          + `inner read across two datasources. Bind '${recognised.object}' to the datasource of '${recognised.table}', `
          + 'or have the producer write no leaf for it.');
      }
      if (recognised?.class === 'registration-by-name') {
        throw fixedReadLeafSeamRefusal(object, operation, at, leaf,
          `the host carries ${recognised.registration}, which a read of '${recognised.table}' runs and the fixed inner `
          + `read would read around: the engine never reads around it. Remove that registration for `
          + `'${recognised.table}', or have the producer write no leaf on this host.`);
      }
    }
  } catch (err) {
    logSeamRefusalOnce(host, err);
    throw err;
  }
  if (sites.length === 0) return;
  const driver = host.facade.getDriverForObject(object);
  for (const { leaf, at } of sites) {
    const name = fixedReadLeafNameOf(leaf) as FixedReadLeafName;
    if (driverEvaluatesFixedReadLeaf(driver, name)) continue;
    const err = fixedReadLeafRefusal(
      FIXED_READ_LEAF_SEAM,
      `${operation}('${object}'): ${describeFixedReadLeaf(at, leaf)}, and driver '${driverNameOf(driver)}' does not `
      + `evaluate it: its supports.fixedReadLeaves does not list ${name}. The operation was NOT run and no driver `
      + `was asked, rather than answer a short or an unscoped set. Bind '${object}' to a driver that evaluates `
      + `${name}, or have the producer write no leaf for it; a driver lists the name only once its filter compiler `
      + 'evaluates the leaf exactly.',
      object,
    );
    logRefusalOnce(err, host.logger, flagOf((driver as object | undefined) ?? host.facade), 'evaluator');
    throw err;
  }
}
