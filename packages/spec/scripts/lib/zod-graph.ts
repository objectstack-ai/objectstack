// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Zod-graph walkers behind the authorable-surface deletion gate (#4650).
 *
 * `build-schemas.ts` is a top-level script with side effects, so these are
 * extracted for the same reason `schema-index` (#4696), `format-type` (#4912),
 * `schema-name` (#4592) and `def-key-collisions` (#5832) were: the only other
 * way to assert on them is to run the whole generator and read what it wrote,
 * and "what it wrote" is exactly the evidence a silent walker miss destroys.
 *
 * The miss in question is the one this module exists to pin — see
 * `pipeAuthorableSide` below (#4488 / #5074 / #5317).
 */
import { z } from 'zod';

export function zodDefOf(schema: z.ZodType): Record<string, unknown> | null {
  const def = (schema as unknown as { _zod?: { def?: unknown } })._zod?.def;
  return def && typeof def === 'object' ? (def as Record<string, unknown>) : null;
}

/**
 * Every Zod schema instance a node's def references directly: shape values,
 * union options, pipe in/out, record key/value, array element, wrapper inner
 * types — found by walking the def's plain objects/arrays generically instead
 * of enumerating node kinds (which would silently miss the next kind Zod
 * adds). Two edges a generic def walk cannot see are added explicitly:
 * `z.lazy` hides its target behind `getter()`, and check-clones (`.refine()`,
 * `.describe()`, …) point back at the schema they cloned via `_zod.parent` —
 * the clone is what a parent schema embeds (`ViewSchema.refine(…)` inside
 * ViewMetadataSchema), while the BASELINE def is the original.
 *
 * Note this walk is direction-agnostic on purpose: it recurses into EVERY def
 * value, so a pipe contributes both `in` and `out`. That is why the pipe-side
 * bug below never affected BFS reachability itself — only the shape derivation.
 */
export function zodChildSchemas(schema: z.ZodType): z.ZodType[] {
  const out: z.ZodType[] = [];
  const def = zodDefOf(schema);
  if (!def) return out;
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (v instanceof z.ZodType) {
      out.push(v);
      return;
    }
    if (typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v instanceof Map) {
      for (const x of v.values()) walk(x);
      return;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(def);
  if (def.type === 'lazy' && typeof def.getter === 'function') {
    try {
      const inner = (def.getter as () => unknown)();
      if (inner instanceof z.ZodType) out.push(inner);
    } catch {
      // An unresolvable lazy getter has no graph to traverse; the schema it
      // would have produced cannot be parsed against either.
    }
  }
  const parent = (schema as unknown as { _zod?: { parent?: unknown } })._zod?.parent;
  if (parent instanceof z.ZodType) out.push(parent);
  return out;
}

/**
 * Wrapper defs that carry their subject in `innerType` and never change its shape.
 *
 * Deliberately the set `zodShapeOf` already used, byte for byte, so #5317 moves
 * ONLY the pipe direction. `prefault` — which the three sibling walkers below do
 * unwrap — is knowingly absent; adding it is a separate, separately measured
 * change (filed as its own finding, not smuggled in here).
 */
const SHAPE_WRAPPER_TYPES = new Set([
  'optional',
  'nullable',
  'default',
  'catch',
  'readonly',
  'nonoptional',
]);

/** Does this pipe's IN side resolve to a `transform` — i.e. is it a `z.preprocess`? */
function pipeInIsTransform(inSide: z.ZodType, depth: number): boolean {
  if (depth > 12) return false;
  const def = zodDefOf(inSide);
  if (!def) return false;
  if (def.type === 'transform') return true;
  if (def.type === 'lazy' && typeof def.getter === 'function') {
    try {
      const inner = (def.getter as () => unknown)();
      return inner instanceof z.ZodType ? pipeInIsTransform(inner, depth + 1) : false;
    } catch {
      return false;
    }
  }
  if (typeof def.type === 'string' && SHAPE_WRAPPER_TYPES.has(def.type) && def.innerType instanceof z.ZodType) {
    return pipeInIsTransform(def.innerType, depth + 1);
  }
  return false;
}

/**
 * The authorable side of a `pipe` def — the side a metadata author writes.
 *
 * Two different constructs compile to the same `pipe` node, and their authorable
 * sides are OPPOSITE:
 *
 *   - `a.transform(fn)` — IN is `a`, the accepted input shape; OUT is the
 *     transform. Authors write the **IN** side.
 *   - `z.preprocess(fn, schema)` — IN is the **TRANSFORM**; OUT is `schema`.
 *     Authors write the **OUT** side.
 *
 * Reading `def.in` unconditionally therefore hands back a transform for every
 * preprocess node, and a transform has no shape — so the caller concludes "no
 * shape" and silently stops governing that schema. Silently is the whole
 * problem: nothing anywhere reports it.
 *
 * This is the #4488 blind spot, and this is its FOURTH independent site:
 *
 *   1. `scripts/liveness/check-liveness.mts:191-205` — #4488, after
 *      `TranslationItemSchema`'s retired-dialect preprocess (#3778) made
 *      `translation` "walk to no shape, ungovernable";
 *   2. `src/kernel/metadata-authoring-lint.ts` — #5074;
 *   3. `src/system/metadata-form-zod-reconciliation.test.ts` — #5074;
 *   4. here — deliberately deferred out of #5074 because moving it can move
 *      generated evidence, then fixed as #5317 once that move was measured.
 *
 * Measured on the 25 registered metadata-type roots (2026-08-07): `action` is an
 * `a.transform(fn)` pipe (`in=object out=transform`) and must keep reading IN —
 * it resolves to a 43-key shape either way; `view` is a `z.preprocess` pipe
 * (`in=transform out=union`, the console-decoration strip of #5074) and was
 * reading the transform.
 *
 * The unwrap before the transform test matters: a preprocess node's IN can sit
 * behind a `lazy`/wrapper, and a transform one level down is still a transform.
 */
export function pipeAuthorableSide(def: Record<string, unknown>, depth = 0): z.ZodType | null {
  const inSide = def.in instanceof z.ZodType ? def.in : null;
  const outSide = def.out instanceof z.ZodType ? def.out : null;
  if (inSide && pipeInIsTransform(inSide, depth)) return outSide;
  return inSide ?? outSide;
}

/**
 * Unwrap pipes/wrappers/lazies down to a plain object def's shape, if any.
 *
 * Returns `null` for anything that is not (or does not unwrap to) a single
 * object node — a union included. See the `zod-graph.test.ts` pin for what that
 * means for `view`, whose preprocess OUT is a union.
 */
export function zodShapeOf(schema: z.ZodType, depth = 0): Record<string, unknown> | null {
  if (depth > 12) return null;
  const def = zodDefOf(schema);
  if (!def) return null;
  if (def.type === 'object') {
    const shape = def.shape;
    return shape && typeof shape === 'object' ? (shape as Record<string, unknown>) : null;
  }
  if (def.type === 'pipe') {
    const side = pipeAuthorableSide(def);
    return side ? zodShapeOf(side, depth + 1) : null;
  }
  if (def.type === 'lazy' && typeof def.getter === 'function') {
    try {
      const inner = (def.getter as () => unknown)();
      if (inner instanceof z.ZodType) return zodShapeOf(inner, depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof def.type === 'string' && SHAPE_WRAPPER_TYPES.has(def.type) && def.innerType instanceof z.ZodType) {
    return zodShapeOf(def.innerType, depth + 1);
  }
  return null;
}
