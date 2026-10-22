// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D2] The engine's `ReadableIds` composition, IN MEMORY, for the
 * suites in this package that drive the security middleware over an engine
 * double and evaluate the filter it injected with `matchesFilterCondition`.
 *
 * Since the `controlled_by_parent` derivation answers the engine's leaf
 * (ADR-0139 D6, the seventh consumer), the filter the middleware writes for a
 * detail read is `{ masterFK: { $in: ReadableIds.of(master) } }` — a value no
 * in-memory matcher can evaluate, because the leaf stands for a scope the
 * engine composes at its executor boundary from the security service's own
 * two halves of a read of the master. A double that evaluates the injected
 * filter therefore needs that composition done for it, and this is it: the
 * same five steps `ObjectQL#composeReadableIdsAtBoundary` runs, over the
 * double's rows —
 *
 *  1. `canReadObject(P)` false or a throw ⇒ `$in: []`;
 *  2. `getReadFilter(P)`: `undefined` ⇒ every row of P; the deny sentinel, by
 *     identity, or a throw ⇒ `$in: []`; any other scope ⇒ the ids of P's rows
 *     it matches, the leaves IT carries composed first (the nested master
 *     chain, ADR-0139 D6 as amended), under the same caller context;
 *  3. a parent already on the branch is a cycle, and a chain deeper than the
 *     engine's bound is refused, both by a throw — the engine's own answer,
 *     so a suite that reaches either here is measuring a chain the plugin's
 *     registry walk should have closed first;
 *  4. a parent the double holds no rows for answers `$in: []`, as a parent
 *     the registry does not hold does in the engine.
 *
 * ⛔ Not a second composer for production: D5's two classes (a master on
 * another datasource, a master an object-scoped read middleware narrows) are
 * refused at boot and are not modelled; the tenant wall is the driver's and a
 * double has none. The real composition is pinned on the real stack in this
 * package (`controlled-by-parent-leaf-switch.test.ts`,
 * `readable-ids-nested-compose.test.ts`, `readable-ids-delegated-compose.test.ts`)
 * and in `@objectstack/objectql`'s own suites; what this testkit lets a
 * fake-engine suite keep pinning is WHICH ROWS the derivation admits, with
 * the master's scope answered by the real security service.
 */

import { RLS_DENY_FILTER, isComposedReadableIds, isReadableIds } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';

/** The engine's `READABLE_IDS_MAX_CHAIN_DEPTH`: scopes composed above the read's own `where`. */
const MAX_CHAIN_DEPTH = 8;

export interface InMemoryReadableIdsSecurity {
  /** The rows of object `P` the double holds — `undefined` for an object it does not hold. */
  readonly rows: (object: string) => readonly Record<string, unknown>[] | undefined;
  readonly canReadObject: (object: string, context: unknown) => Promise<boolean>;
  readonly getReadFilter: (object: string, context: unknown) => Promise<unknown>;
}

/**
 * `where` with every `$in: ReadableIds.of(P)` leaf replaced by the ids of P's
 * rows the caller may read, copy-on-write; a subtree holding no leaf is
 * returned by reference. `null` and `undefined` pass through.
 */
export async function composeReadableIdsInMemory<T>(
  where: T,
  context: unknown,
  security: InMemoryReadableIdsSecurity,
): Promise<T> {
  const answers = new Map<string, unknown[]>();
  const resolve = async (parent: string, ancestors: readonly string[]): Promise<unknown[]> => {
    const known = answers.get(parent);
    if (known) return known;
    if (ancestors.includes(parent)) {
      throw new Error(`[readable-ids testkit] the chain of read scopes ${[...ancestors, parent].join(' -> ')} returns to '${parent}', a cycle`);
    }
    if (ancestors.length >= MAX_CHAIN_DEPTH) {
      throw new Error(`[readable-ids testkit] the chain of read scopes ${[...ancestors, parent].join(' -> ')} is deeper than ${MAX_CHAIN_DEPTH}`);
    }
    const deny = (): unknown[] => {
      answers.set(parent, []);
      return [];
    };
    const rows = security.rows(parent);
    if (!rows) return deny();
    let admitted: boolean;
    try {
      admitted = (await security.canReadObject(parent, context)) === true;
    } catch {
      return deny();
    }
    if (!admitted) return deny();
    let scope: unknown;
    try {
      scope = await security.getReadFilter(parent, context);
    } catch {
      return deny();
    }
    if (scope === RLS_DENY_FILTER) return deny();
    let matched: readonly Record<string, unknown>[];
    if (scope === undefined || scope === null) {
      matched = rows;
    } else {
      const composed = await rewrite(scope, [...ancestors, parent]);
      matched = rows.filter((row) => matchesFilterCondition(row, composed as never));
    }
    const ids = matched.map((row) => row.id).filter((id) => id !== undefined && id !== null);
    answers.set(parent, ids);
    return ids;
  };
  const rewrite = async (value: unknown, ancestors: readonly string[]): Promise<unknown> => {
    if (value === null || typeof value !== 'object') return value;
    if (isComposedReadableIds(value)) {
      throw new Error('[readable-ids testkit] a composed leaf reached the composition: the engine refuses one it did not compose');
    }
    if (Array.isArray(value)) {
      let out: unknown[] | undefined;
      for (let i = 0; i < value.length; i++) {
        const next = await rewrite(value[i], ancestors);
        if (next !== value[i]) (out ??= [...value])[i] = next;
      }
      return out ?? value;
    }
    let out: Record<string, unknown> | undefined;
    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key];
      const next = key === '$in' && isReadableIds(item)
        ? await resolve(item.object, ancestors)
        : await rewrite(item, ancestors);
      if (next !== item) (out ??= { ...(value as Record<string, unknown>) })[key] = next;
    }
    return out ?? value;
  };
  return (await rewrite(where, [])) as T;
}
