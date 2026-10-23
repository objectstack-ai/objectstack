// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 4] The controlled-by-parent read leaf of `SecurityPlugin`, moved
 * out of `security-plugin.ts` whole: the ADR-0055 §2 read derivation, which
 * answers a `controlled_by_parent` object's read with the engine's
 * `ReadableIds` leaf over its master (ADR-0139 D6), and the chain refusal it
 * runs over the registry before it writes that leaf.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same leaf, the same deny sentinel, the same
 * chain guards, failing closed exactly where they did. The one module-level
 * declaration only these bodies read moved with them, also unedited:
 * `CBP_LEAF_READ_VERBS`, with the `ReadableIds` import that
 * `security-plugin.ts` no longer needs. The relation the leaf is derived from
 * stays the class's `resolveCbpRelation` (`security-plugin-cbp-relation.ts`),
 * read through the plugin as before.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 3 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps every method — the published
 * `dist/*.d.ts` lists each one's name, docblock and position — and each body is
 * one literal of exactly the {@link CbpReadFilterHost} members that method
 * reads, plus a `.call`. A method is handed over as a closure that calls it on
 * the plugin at call time, so a test double or spy set on the plugin is still
 * the one the body reaches, and the leaf reaches its chain refusal through the
 * plugin, as before. Both functions are synchronous.
 *
 * The two fields the bodies read go as GETTERS, by the rule cut 1 set: neither
 * is declared `readonly`. `start()` assigns `ql` and `logger` after
 * construction. Each read happens when the body makes it, as before.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * `CBP_MAX_CHAIN_DEPTH` stays there, exported, and is imported here by value:
 * ADR-0055 anchors it by symbol in that file, and the master-write gate's
 * chain walk (`security-plugin-cbp-write-gate.ts`) reads the same bound. It is
 * read only inside a function body, at call time, never while either module
 * evaluates, so the two-way import is safe under ESM, and the published bundle
 * holds one module. `RLS_DENY_FILTER` is imported from `rls-compiler.js`, as
 * `security-plugin.ts` imports it. `CbpRelation` keeps its one declaration in
 * `security-plugin.ts`; this module names it through the class's own signature
 * (below).
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import { CBP_MAX_CHAIN_DEPTH } from './security-plugin.js';
import { ReadableIds } from '@objectstack/spec/data';
import { RLS_DENY_FILTER } from './rls-compiler.js';

/**
 * [ADR-0139 D1] The engine verbs whose `where` may carry a `ReadableIds`
 * leaf — the engine's own `READABLE_IDS_READ_VERBS`. The read derivation
 * answers its leaf for these and nothing for a write verb's predicate: a
 * predicate write is narrowed to the rows the read door returns for the
 * caller's own predicate ({@link SecurityPlugin.readableRowsScopeForPredicateWrite},
 * where the leaf composes) and judged per master by the 2.8 gate
 * ({@link SecurityPlugin.assertControlledByParentWrite}, a verdict, never a
 * scope), so no master set is composed into a write's predicate.
 */
const CBP_LEAF_READ_VERBS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/**
 * A `controlled_by_parent` object's resolved master relation, as the class
 * declares it: the `CbpRelation` interface stays in `security-plugin.ts`
 * beside `cbpRelCache`, and the moved bodies name it exactly as they did.
 */
type CbpRelation = NonNullable<ReturnType<SecurityPlugin['resolveCbpRelation']>>;

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. Every field here is a
 * getter on the host; see the module header.
 */
export interface CbpReadFilterHost {
  readonly logger: SecurityPlugin['logger'];
  readonly ql: SecurityPlugin['ql'];
  controlledByParentChainRefusal: SecurityPlugin['controlledByParentChainRefusal'];
  resolveCbpRelation: SecurityPlugin['resolveCbpRelation'];
}

/** The body of `SecurityPlugin#computeControlledByParentFilter`; the method's docblock there is its contract. */
export function computeControlledByParentFilter(
  this: Pick<CbpReadFilterHost, 'controlledByParentChainRefusal' | 'logger' | 'ql' | 'resolveCbpRelation'>,
  object: string,
  /** The engine verb the answer is composed onto; a write verb answers `null` (ADR-0139 D1). */
  operation: string,
  context: any,
): Record<string, unknown> | null {
  if (!this.ql || !context?.userId) return null;
  const schema = typeof this.ql.getSchema === 'function' ? this.ql.getSchema(object) : null;
  const sharingModel = schema?.sharingModel ?? schema?.security?.sharingModel;
  if (sharingModel !== 'controlled_by_parent') return null;
  if (!CBP_LEAF_READ_VERBS.has(operation)) return null;

  const rel = this.resolveCbpRelation(object);
  // No resolvable master: the deny sentinel, by reference (ADR-0139 D2 step 2).
  if (!rel) return RLS_DENY_FILTER;

  // [ADR-0055 amendment] Chain guards, over the registry, BEFORE the leaf is
  // written. Both answer with the empty master set — the same shape the
  // #5386 sharing-resolution failure answered with, and the same posture: a
  // chain this derivation cannot resolve denies, because the alternative
  // ("no restriction") is the defect being fixed, and the other alternative
  // (the engine's refusal of the same chain) is a 500 for a declared shape.
  const refusal = this.controlledByParentChainRefusal(object, rel);
  if (refusal?.kind === 'cycle') {
    this.logger.error?.(
      `[security] controlled_by_parent derivation found a CYCLE resolving '${object}' ` +
        `(chain: ${refusal.chain.join(' -> ')}) — denying (fail-closed: a chain the derivation ` +
        `cannot resolve admits no child rather than leaving it unrestricted)`,
    );
    return { [rel.fk]: { $in: [] } };
  }
  if (refusal?.kind === 'depth') {
    this.logger.error?.(
      `[security] controlled_by_parent derivation exceeded the chain depth bound ` +
        `(${CBP_MAX_CHAIN_DEPTH}) resolving '${object}' ` +
        `(chain: ${refusal.chain.join(' -> ')}) — denying (fail-closed: a chain the derivation ` +
        `cannot resolve admits no child rather than leaving it unrestricted)`,
    );
    return { [rel.fk]: { $in: [] } };
  }
  return { [rel.fk]: { $in: ReadableIds.of(rel.master) } };
}

/** The body of `SecurityPlugin#controlledByParentChainRefusal`; the method's docblock there is its contract. */
export function controlledByParentChainRefusal(
  this: Pick<CbpReadFilterHost, 'ql' | 'resolveCbpRelation'>,
  object: string,
  rel: CbpRelation,
): { kind: 'cycle' | 'depth'; chain: string[] } | null {
  const chain: string[] = [object];
  let master = rel.master;
  for (;;) {
    if (chain.includes(master)) return { kind: 'cycle', chain: [...chain, master] };
    const schema = typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(master) : null;
    const model = schema?.sharingModel ?? schema?.security?.sharingModel;
    if (model !== 'controlled_by_parent') return null;
    if (chain.length >= CBP_MAX_CHAIN_DEPTH) return { kind: 'depth', chain: [...chain, master] };
    chain.push(master);
    const next = this.resolveCbpRelation(master);
    if (!next) return null;
    master = next.master;
  }
}
