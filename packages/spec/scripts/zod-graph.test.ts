// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the pipe-direction rule in `scripts/lib/zod-graph.ts` (#5317).
 *
 * ── The recurrence this file exists to stop ───────────────────────────────
 * `a.transform(fn)` and `z.preprocess(fn, a)` compile to the SAME `pipe` node,
 * and the side an author writes is opposite in the two cases: IN for the first,
 * OUT for the second. A walker that reads `def.in` unconditionally therefore
 * hands back a transform for every preprocess node, derives no shape from it,
 * and silently stops governing that schema.
 *
 * That bug has now been found and fixed FOUR times, independently:
 *
 *   1. `scripts/liveness/check-liveness.mts` — #4488, after
 *      `TranslationItemSchema`'s retired-dialect preprocess (#3778) made
 *      `translation` "walk to no shape, ungovernable";
 *   2. `src/kernel/metadata-authoring-lint.ts` — #5074;
 *   3. `src/system/metadata-form-zod-reconciliation.test.ts` — #5074;
 *   4. `scripts/lib/zod-graph.ts` — #5317, the site #5074 deliberately left
 *      alone because moving it can move generated evidence.
 *
 * Three sites carried the #4488 lesson as a code comment and it recurred anyway.
 * So the fourth one gets an assertion instead: the synthetic cases below fail on
 * the pre-#5317 code, and the live-graph cases fail the moment a NEW preprocess
 * registration appears that the walker cannot resolve.
 *
 * ── What is deliberately NOT asserted ─────────────────────────────────────
 * "Every preprocess root resolves to a real shape" is the pin the issue asked
 * for, and it is not true of `view` — the one preprocess ROOT in the registry —
 * because its OUT is a `z.union`, and `zodShapeOf` has no union branch. Fixing
 * the pipe direction is necessary but not sufficient there. Asserting the
 * literal sentence would mean either a failing test or a union branch smuggled
 * in unmeasured, so what is pinned instead is the fact that actually holds and
 * that actually catches recurrence #5: no pipe in the registry ever resolves its
 * authorable side to a TRANSFORM. `view` passes that (its side is the union);
 * a regressed walker does not.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { pipeAuthorableSide, zodDefOf, zodShapeOf } from './lib/zod-graph';
import {
  getMetadataTypeSchema,
  listMetadataTypeSchemaTypes,
} from '../src/kernel/metadata-type-schemas';
import { InlineActionSchema } from '../src/ui/action.zod';

const defTypeOf = (schema: z.ZodType | null): string | undefined =>
  schema ? (zodDefOf(schema)?.type as string | undefined) : undefined;

describe('zodShapeOf — pipe direction (#4488, #5074, #5317)', () => {
  it('reads the OUT side of a `z.preprocess` — the shape the author writes', () => {
    const schema = z.preprocess((raw) => raw, z.object({ alpha: z.string(), beta: z.number() }));

    // Pre-#5317 this returned null: `def.in` is the preprocess transform.
    expect(Object.keys(zodShapeOf(schema) ?? {})).toEqual(['alpha', 'beta']);
  });

  it('still reads the IN side of an `a.transform(fn)` — the opposite pipe', () => {
    const schema = z.object({ alpha: z.string() }).transform((v) => v.alpha);

    // The regression guard for `action`, the registry's one transform-pipe root:
    // taking OUT here would break exactly what taking IN breaks for preprocess.
    expect(Object.keys(zodShapeOf(schema) ?? {})).toEqual(['alpha']);
  });

  it('sees a preprocess transform hidden behind a lazy or a wrapper', () => {
    // `z.preprocess` over a lazily-constructed transform: the IN side is a
    // `lazy` whose target is the transform, so a bare `def.in.type` test misses
    // it. `lazySchema()` produces this shape whenever OS_EAGER_SCHEMAS is unset.
    const viaLazy = z.preprocess((raw) => raw, z.object({ alpha: z.string() }));
    const lazyWrapped = z.lazy(() => viaLazy);
    expect(Object.keys(zodShapeOf(lazyWrapped) ?? {})).toEqual(['alpha']);

    const optionalWrapped = z.preprocess((raw) => raw, z.object({ beta: z.string() })).optional();
    expect(Object.keys(zodShapeOf(optionalWrapped) ?? {})).toEqual(['beta']);
  });

  it('resolves a REAL preprocess node in the shipped graph to its real shape', () => {
    // `InlineActionSchema` is `lazySchema(() => z.preprocess(normalizeInlineAction,
    // actionObject().pick({…}).partial({…}).refine(…)))` — a live preprocess whose
    // OUT is an object, so it is the specimen the issue's pin describes. Pre-#5317
    // `zodShapeOf` returned null for it and the deletion gate fell through to its
    // fail-closed default; now it reads the twelve keys an inline action accepts.
    const shape = zodShapeOf(InlineActionSchema as unknown as z.ZodType);

    expect(shape).not.toBeNull();
    expect(Object.keys(shape ?? {})).toEqual(
      expect.arrayContaining(['type', 'target', 'params', 'confirmText', 'opensInNewTab']),
    );
  });
});

describe('pipeAuthorableSide — the registered metadata-type roots (#5317)', () => {
  /** Every registered root that compiles to a `pipe`, with its resolved side. */
  const pipeRoots = listMetadataTypeSchemaTypes().flatMap((type) => {
    const schema = getMetadataTypeSchema(type);
    if (!schema) return [];
    const def = zodDefOf(schema);
    if (def?.type !== 'pipe') return [];
    return [{ type, def, side: pipeAuthorableSide(def) }];
  });

  it('finds the registry pipes this pin was written against', () => {
    // Not a snapshot of the registry — just proof the cases below are not
    // vacuously green because every root stopped being a pipe.
    expect(pipeRoots.map((r) => r.type).sort()).toEqual(expect.arrayContaining(['action', 'view']));
  });

  it.each(['action', 'view'])(
    'never resolves `%s` to a transform — the #4488 failure mode',
    (type) => {
      const root = pipeRoots.find((r) => r.type === type);
      expect(root, `${type} is no longer a pipe root — update this pin deliberately`).toBeDefined();
      expect(defTypeOf(root!.side)).not.toBe('transform');
    },
  );

  it('resolves every registry pipe root to a non-transform side', () => {
    // The recurrence guard proper: a NEW preprocess registration that the walker
    // reads from the wrong end fails here on the day it lands, not three issues later.
    for (const { type, side } of pipeRoots) {
      expect(defTypeOf(side), `metadata type '${type}' resolved to a transform`).not.toBe('transform');
    }
  });

  it('keeps `action` (an `a.transform(fn)` root) resolving to its object shape', () => {
    // The direction that was already right, pinned so a future edit cannot fix
    // preprocess by breaking transform.
    const schema = getMetadataTypeSchema('action');
    expect(schema).toBeDefined();
    expect(defTypeOf(pipeAuthorableSide(zodDefOf(schema!)!))).toBe('object');
    expect(Object.keys(zodShapeOf(schema!) ?? {}).length).toBeGreaterThan(10);
  });

  it('documents that `view`s preprocess OUT is a union, so it still derives no shape', () => {
    // Honest pin of the measured state rather than the issue's expectation: the
    // direction is now right (the side is the union, not the transform), but
    // `zodShapeOf` has no union branch, so `view` still yields null. Whoever adds
    // that branch will land here — and should re-measure the derived-clone bridge
    // before doing so (#5056: a new bridge can mark a dead shape reachable).
    const schema = getMetadataTypeSchema('view');
    expect(schema).toBeDefined();
    expect(defTypeOf(pipeAuthorableSide(zodDefOf(schema!)!))).toBe('union');
    expect(zodShapeOf(schema!)).toBeNull();
  });
});
