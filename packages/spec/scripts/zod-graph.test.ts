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
 * ── The unwrap surface, completed at #6098 ────────────────────────────────
 * #5317 fixed the pipe DIRECTION and stopped there, leaving `zodShapeOf` two
 * spellings narrower than its three sibling walkers: no `union` arm, and no
 * `prefault` wrapper. Both are now here, measured together (#6098), and the
 * `view` case below is the one this file used to pin the other way round — it
 * documented that a corrected direction still derived no shape, and it now pins
 * the merged shape that direction actually leads to.
 *
 * What the measurement found, recorded because it is the part a future edit can
 * silently undo: widening this walker cannot widen the consumer's derived-clone
 * BRIDGE, because every object a resolved shape comes from is itself in the BFS
 * closure (`zodChildSchemas` walks union options, wrapper `innerType`s and both
 * pipe sides), so it has already contributed the same (name, instance) pairs.
 * The single new bridge entry the run produced came from a `z.lazy` getter that
 * mints fresh instances per call (`ui/NavigationItem`) and matches nothing, in
 * either direction. What DID move is the query side: 18 defs that answered the
 * `!shape` fail-closed default now answer from their real shape (17 of them
 * `null`, one — `ui/ViewItem` — `derived-clone`).
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

describe('zodShapeOf — union members (#3095, #6098)', () => {
  it('merges every member’s keys', () => {
    const schema = z.union([
      z.object({ shared: z.string(), onlyA: z.string() }),
      z.object({ shared: z.string(), onlyB: z.number() }),
    ]);

    // Pre-#6098 this was null: no union arm, so the walker fell through.
    expect(Object.keys(zodShapeOf(schema) ?? {})).toEqual(['shared', 'onlyA', 'onlyB']);
  });

  it('keeps the FIRST member’s instance when two members declare one name', () => {
    // The documented narrowing: the consumer's bridge is keyed by (name,
    // INSTANCE) and this record holds one instance per name. Pinned so the rule
    // is a decision someone can find, not an accident of `Object.assign` order.
    const first = z.string();
    const second = z.string();
    const shape = zodShapeOf(
      z.union([z.object({ dup: first }), z.object({ dup: second })]),
    );

    expect(shape?.dup).toBe(first);
    expect(shape?.dup).not.toBe(second);
  });

  it('descends a union nested inside a union', () => {
    const schema = z.union([
      z.union([z.object({ deep: z.string() })]),
      z.object({ top: z.string() }),
    ]);

    // `view`'s live shape depends on this: its OUT union's first member is
    // itself a union, and two of the 89 merged keys come only from there.
    expect(Object.keys(zodShapeOf(schema) ?? {})).toEqual(['deep', 'top']);
  });

  it('still returns null for a union with no object member', () => {
    // Widening the walker must not turn "no keys to contribute" into a shape:
    // an empty shape would bridge on nothing and read as a resolved answer.
    expect(zodShapeOf(z.union([z.string(), z.number()]))).toBeNull();
  });

  it('resolves a discriminated union through the same arm', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), a: z.string() }),
      z.object({ kind: z.literal('b'), b: z.string() }),
    ]);

    // In Zod 4.4.3 a discriminated union IS a `union` def, which is why this
    // walker carries no `discriminated_union` arm — one would match nothing.
    // If a Zod upgrade ever splits them, this fails rather than going quiet.
    expect(zodDefOf(schema)?.type).toBe('union');
    expect(Object.keys(zodShapeOf(schema) ?? {})).toEqual(['kind', 'a', 'b']);
  });
});

describe('zodShapeOf — `prefault` wrapper (#6098)', () => {
  it('peels a `prefault` the way every sibling walker already does', () => {
    const schema = z.object({ alpha: z.string() }).prefault({ alpha: 'x' });

    expect(Object.keys(zodShapeOf(schema) ?? {})).toEqual(['alpha']);
  });

  it('sees a preprocess transform parked behind a `prefault`', () => {
    // `SHAPE_WRAPPER_TYPES` is read by `pipeInIsTransform` too, so this is the
    // second half of the same entry: IN unwraps to a transform, so the
    // authorable side is OUT. Reading IN here would hand back the prefault.
    const schema = z.transform((raw: unknown) => raw).prefault('x').pipe(z.object({ beta: z.string() }));

    expect(Object.keys(zodShapeOf(schema as unknown as z.ZodType) ?? {})).toEqual(['beta']);
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

  it('resolves `view`s preprocess OUT union to the MERGE of its members', () => {
    // ── This case is the converted #5317 pin, not a new one ──────────────
    // It used to assert `zodShapeOf(view)` was null and to say why: the
    // direction was right, the union arm was missing, so the one preprocess
    // ROOT in the registry still derived nothing. #6098 added that arm after the
    // measurement it was waiting on, so the same case now pins the shape the
    // corrected direction actually leads to. The direction assertion is kept
    // verbatim — it is the #4488 recurrence guard and is independent of the
    // union arm.
    const schema = getMetadataTypeSchema('view');
    expect(schema).toBeDefined();
    expect(defTypeOf(pipeAuthorableSide(zodDefOf(schema!)!))).toBe('union');

    const shape = zodShapeOf(schema!);
    expect(shape).not.toBeNull();

    // Not a key count (89 today, and every view feature moves it) — one key that
    // ONLY a given member declares, so the assertion fails if the merge ever
    // silently collapses to a single member. All four members are represented,
    // the first of them a nested union:
    expect(Object.keys(shape ?? {})).toEqual(
      expect.arrayContaining([
        'isPinned', // member 0 only — and member 0 is itself a union
        'list', //     the defineView container member
        'pagination', // the flattened list-view member
        'sections', //  the flattened form-view member
      ]),
    );
  });
});
