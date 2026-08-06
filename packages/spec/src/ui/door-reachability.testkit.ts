// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The #4001 campaign's door measurement, as ONE implementation.
 *
 * "Is this schema reachable from an authoring root?" is the question that
 * decides a batch's whole verdict — `strictObject` when the answer is yes,
 * `no door` (reclassify, do not tighten) when it is no. Getting it wrong in the
 * false-positive direction spends a breaking change to produce *"a precisely
 * validated dead slot — the more convincing lie"* (#4583).
 *
 * Not exported from `ui/index.ts` and not a tsup entry, so it never reaches the
 * package's public surface; `*.testkit.ts` is also outside the strictness
 * ledger's `*.zod.ts` walk, so it adds no site to any count.
 *
 * ## Why the obvious walk is wrong twice
 *
 * Both corrections below were found by a control going red, not by reading:
 *
 * 1. **`typeof v !== 'object'` silently halves the graph.** `lazySchema`'s Proxy
 *    target is `function lazyZod() {}`, so every lazy schema is
 *    `typeof 'function'`. Skipping those makes the BFS stop at the first lazy
 *    node and report whole families unreachable (批 15; `build-schemas.ts`'s
 *    equivalent never hit it because it runs under `OS_EAGER_SCHEMAS=1`, where
 *    there are no proxies).
 * 2. **A single shared property is NOT evidence of a derived clone** — this is
 *    #5056, found at 批 16. `.extend()` / `.strip()` produce a clone that shares
 *    no identity with its base but DOES share the base's per-property schema
 *    instances, so a bridge over shared property defs is genuinely needed. The
 *    bridge as first written fired when **any one** property matched under the
 *    same name — and zod's `.describe()` returns a clone that reuses the
 *    `_zod.def` OBJECT **of the instance it was called on**. Because this repo
 *    funnels dozens of shapes through a handful of SHARED leaf instances, every
 *    `SnakeCaseIdentifierSchema.describe(…)` in the spec is def-identical to
 *    every other one, and likewise `I18nLabelSchema`. Two unrelated shapes that
 *    both declare `name` and `label` (i.e. almost every authorable shape here)
 *    therefore bridged, and `WidgetManifestSchema` — a file nothing imports —
 *    measured as REACHABLE. The error is one-directional: it can only produce a
 *    false door, i.e. it can only cause a batch to tighten something dead.
 *
 *    ⚠️ Sharing follows the **receiver instance**, not the shape: two separate
 *    `z.string()` calls build two separate defs and share nothing. #5056's issue
 *    body spelled the fact the other way; the corrected, measured statement and
 *    every builder's verdict are pinned in `door-reachability.testkit.test.ts`,
 *    so a zod upgrade that changes `clone()` semantics goes red rather than
 *    silently changing what this bridge means.
 *
 *    The fix is to ask how much of the shape is shared rather than whether
 *    anything is: a real derived clone carries nearly all of its base's
 *    properties, while a coincidence carries one or two out of twenty.
 *
 *    **Residual bound (#5828), measured and pinned, not latent:** the ratio is
 *    taken over the CANDIDATE's own keys, so a shape whose keys are *all* shared
 *    leaves scores 1.0 however few they are, and still bridges. No threshold in
 *    (0, 1] excludes it, because a genuine `.strip()` scores 1.0 too. It costs
 *    nothing today (the real `no door` shapes measured so far sit far below the
 *    threshold — `WidgetManifestSchema` at 2/19), but read `cloneOverlap` and
 *    the key count before trusting a `derived-clone` verdict on a SMALL shape.
 */

import { getMetadataTypeSchema, listMetadataTypeSchemaTypes } from '../kernel/metadata-type-schemas';
import { ObjectStackSchema } from '../stack.zod';

/**
 * Identity of a schema NODE.
 *
 * Keyed on `_zod.def`, never on the schema binding: `lazySchema` hands out a
 * Proxy unless `OS_EAGER_SCHEMAS=1` while the graph holds the real instances, so
 * comparing bindings reports every root as unreachable. `def` survives the Proxy
 * (the `_zod` facade delegates to the real internals), so it is the one stable
 * key for both identities.
 */
const defOf = (s: unknown): unknown => (s as { _zod?: { def?: unknown } })?._zod?.def;

const shapeOf = (node: unknown): Record<string, unknown> | null => {
  const def = defOf(node) as { type?: string; shape?: Record<string, unknown> } | undefined;
  return def?.type === 'object' && def.shape ? def.shape : null;
};

function childrenOf(node: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    // See correction 1 in the module doc: `typeof v !== 'object'` alone skips
    // every lazy schema, because the Proxy's target is a function.
    if (v === null || (typeof v !== 'object' && typeof v !== 'function') || seen.has(v)) return;
    seen.add(v);
    if (defOf(v)) { out.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v instanceof Map) { for (const x of v.values()) walk(x); return; }
    for (const x of Object.values(v as Record<string, unknown>)) walk(x);
  };
  walk(defOf(node));
  return out;
}

/** How a schema was (or was not) reached from the authoring roots. */
export type DoorVerdict = 'direct' | 'derived-clone' | 'unreachable';

export interface DoorMeasurement {
  /** `direct` / `derived-clone` mean there IS a door; `unreachable` means there is not. */
  verdict: (schema: unknown) => DoorVerdict;
  /** Fraction of the candidate's own shape shared with the best-matching visited object. */
  cloneOverlap: (schema: unknown) => number;
  /** Nodes walked — a sanity floor for "the graph actually got built". */
  nodeCount: number;
  /** Roots walked from. */
  rootCount: number;
}

/**
 * A schema is treated as a derived clone when it shares at least this much of
 * its own shape, by property def identity under the same name, with one visited
 * object node.
 *
 * Chosen against both ends of the measured range rather than by taste: real
 * derivations sit far above it (`PageSchema.extend(…)` at 0.96,
 * `ObjectListViewSchema.strip()` at 1.0 — both pinned as the bridge's positive
 * control), and 批 16's false positive sits far below (`WidgetManifestSchema`,
 * 2 shared keys of 19 — `name` and `label`, both shared LEAVES rather than
 * shared structure, measured 0.105).
 *
 * Note the chart family this bridge was originally written for measures
 * `direct`, not `derived-clone`: `ChartConfigSchema` is in the graph outright.
 * So `chart.test.ts` does not exercise this limb at all, and neither does any
 * other consumer — which is why the testkit's own test file owns the positive
 * control for it. Without that, narrowing the bridge to "never fires" would
 * leave every consumer green.
 */
const DERIVED_CLONE_MIN_OVERLAP = 0.5;

/**
 * BFS the in-memory Zod graph from every metadata-type root plus `defineStack`'s
 * `ObjectStackSchema` — the closure `build-schemas.ts` uses for the #4650
 * deletion check.
 *
 * `extraRoots` exists for the control every measurement owes: inject a synthetic
 * carrier for the schema under test and the verdict MUST flip. Without it,
 * "unreachable" and "the walker is broken" are the same output.
 */
export function measureDoors(extraRoots: readonly unknown[] = []): DoorMeasurement {
  const roots: unknown[] = [];
  for (const type of listMetadataTypeSchemaTypes()) {
    const s = getMetadataTypeSchema(type);
    if (s) roots.push(s);
  }
  roots.push(ObjectStackSchema, ...extraRoots);

  const visitedDefs = new Set<unknown>();
  const visitedShapes: Array<Record<string, unknown>> = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const node = queue.pop();
    const def = defOf(node);
    if (!def || visitedDefs.has(def)) continue;
    visitedDefs.add(def);
    const shape = shapeOf(node);
    if (shape) visitedShapes.push(shape);
    for (const child of childrenOf(node)) queue.push(child);
  }

  const cloneOverlap = (schema: unknown): number => {
    const shape = shapeOf(schema);
    if (!shape) return 0;
    const entries = Object.entries(shape);
    if (entries.length === 0) return 0;
    let best = 0;
    for (const visited of visitedShapes) {
      let shared = 0;
      for (const [name, prop] of entries) {
        const d = defOf(prop);
        if (d && defOf(visited[name]) === d) shared++;
      }
      if (shared > best) best = shared;
    }
    return best / entries.length;
  };

  const verdict = (schema: unknown): DoorVerdict => {
    const def = defOf(schema);
    if (!def) return 'unreachable';
    if (visitedDefs.has(def)) return 'direct';
    return cloneOverlap(schema) >= DERIVED_CLONE_MIN_OVERLAP ? 'derived-clone' : 'unreachable';
  };

  return { verdict, cloneOverlap, nodeCount: visitedDefs.size, rootCount: roots.length };
}
