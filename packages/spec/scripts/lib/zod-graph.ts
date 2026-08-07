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
 * `prefault` closes the last spelling gap against the sibling walkers (#6098).
 * Measured on the shipped graph at that change: the 25 metadata-type roots reach
 * **zero** `prefault` nodes, and `.prefault(` has no call site anywhere in
 * `packages/`, so this entry moves no verdict and no bridge today — it is
 * parity, not a fix. It is worth having anyway because the alternative is the
 * #4488 failure class: five walkers over the same Zod vocabulary
 * (`check-liveness.mts`, `metadata-authoring-lint.ts`,
 * `metadata-form-zod-reconciliation.test.ts`, `metadata-type-schemas.test.ts`,
 * `shared/strict-object.ts`) already peel `prefault`, so the first author to
 * write one would have had exactly this walker — the one feeding the deletion
 * gate — stop resolving a shape, silently.
 *
 * Read by `pipeInIsTransform` as well as `zodShapeOf`, so a preprocess transform
 * parked behind a `prefault` is now seen from both ends, deliberately.
 */
const SHAPE_WRAPPER_TYPES = new Set([
  'optional',
  'nullable',
  'default',
  'catch',
  'readonly',
  'nonoptional',
  'prefault',
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
 * The merged shape of a `union` node — every member's keys, first member wins on
 * a name two members both declare (#6098).
 *
 * Why merge at all: a metadata type may register a UNION of shapes rather than a
 * single object (#3095 — `view` is the shipped specimen: a `defineView`
 * container, a flattened list view, a flattened form view). All three sibling
 * walkers already cross that node — `keyPosture` and `keysOf` by merging every
 * member, `check-liveness`'s `shapeOf` by taking the first object member — and
 * only this one stopped there and returned `null`.
 *
 * Why the merging rule and not `check-liveness`'s first-member rule: the two
 * walkers are asked different questions. `shapeOf` governs a ledger of the
 * canonical authorable CONTAINER, so "first object member" is its answer by
 * design. This one feeds reachability, where a missed key can only ever waive a
 * tombstone — so it takes the widest reading, exactly like `keysOf`.
 *
 * ⚠️ The one honest narrowing: the return type is one instance per name, while
 * the consumer's bridge is keyed by (name, INSTANCE). When two members declare
 * the same name with different instances — measured: 11 of the 92 union nodes in
 * the root closure — only the first member's instance survives into this record,
 * so a bridge that would have matched a later member's instance is not tested
 * for. Measured at #6098 against a last-member-wins build of this same function:
 * identical verdicts for all 1610 defs, so nothing turns on the choice today. If
 * it ever does, the fix belongs in the consumer's bridge (a name → instance SET),
 * never in a looser test here.
 */
function mergedUnionShape(def: Record<string, unknown>, depth: number): Record<string, unknown> | null {
  if (!Array.isArray(def.options)) return null;
  let merged: Record<string, unknown> | null = null;
  for (const option of def.options) {
    if (!(option instanceof z.ZodType)) continue;
    const shape = zodShapeOf(option, depth + 1);
    if (!shape) continue;
    merged ??= {};
    for (const [name, prop] of Object.entries(shape)) {
      if (!(name in merged)) merged[name] = prop;
    }
  }
  return merged;
}

/**
 * Unwrap pipes/wrappers/lazies/unions down to an object shape, if any.
 *
 * Returns `null` for anything that does not resolve to at least one object node
 * — a union of primitives included, since it has no keys to contribute.
 *
 * A union resolves to the MERGE of its members (see `mergedUnionShape`). In Zod
 * 4.4.3 `z.discriminatedUnion` carries `def.type === 'union'` too (verified,
 * #6098), so it needs no branch of its own — the `discriminated_union` arms the
 * sibling walkers carry match nothing in this version and are deliberately not
 * copied here.
 */
export function zodShapeOf(schema: z.ZodType, depth = 0): Record<string, unknown> | null {
  if (depth > 12) return null;
  const def = zodDefOf(schema);
  if (!def) return null;
  if (def.type === 'object') {
    const shape = def.shape;
    return shape && typeof shape === 'object' ? (shape as Record<string, unknown>) : null;
  }
  if (def.type === 'union') return mergedUnionShape(def, depth);
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
