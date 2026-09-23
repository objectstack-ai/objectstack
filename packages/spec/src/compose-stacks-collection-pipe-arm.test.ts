// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19150] `declaresCollection` reads a `pipe` on the side the AUTHOR writes.
 *
 * The walker behind `objectCollectionKeys()` — the key set
 * `objectConflict: 'merge'` refuses to combine (#14848) — read only `def.in`
 * on its `pipe` arm. `z.preprocess(fn, schema)` puts a transform STAGE in `in`
 * and the real, validated schema in `out`, the opposite of `a.transform(fn)`,
 * so a preprocess-wrapped collection key resolved to a `transform` node, fell
 * through to `default: return false`, and left the refusal set in silence —
 * the exact failure direction the derivation exists to close ("a collection
 * key added to the object schema tomorrow would fall back to the wholesale
 * replacement this rule exists to refuse").
 *
 * ## Why this file exists beside `compose-stacks-merge-collection-refusal.test.ts`
 *
 * That file pins the refusal set against `ObjectSchema`'s shape AS IT STANDS.
 * Measured on this tree, exactly one of the 43 top-level keys compiles to a
 * pipe (`titleFormat`, an `a.transform(fn)` pipe carrying a scalar), so the
 * shape as authored today cannot tell a fixed walker from an unfixed one —
 * a pin written only against it would be green either way. The probe keys
 * below are the missing discrimination: a schema shaped like the one the next
 * author will write, walked by the REAL production code through
 * `composeStacks`.
 *
 * ## The three legs
 *
 * - BRIGHT CONTROL — the IN-only reading of the preprocess probe (the arm as
 *   it stood before #19150) resolves to a `transform` and answers "not a
 *   collection". Kept as executable text so the defect stays legible.
 * - MAIN — the same key, walked by the production code, is now IN the refusal
 *   set: `composeStacks` refuses two differing declarations and its message
 *   ENUMERATES the derived set, so the set change is read per key rather than
 *   asserted in prose.
 * - DARK CONTROL — a genuine `.pipe()` whose authored side is a scalar and
 *   whose OUT side is an array stays OUT of the set, and so does a plain
 *   scalar. This is the leg that discriminates the landed rule from the
 *   `in || out` candidate: `in || out` would pull that key IN, and the author
 *   would be told their scalar is a collection.
 *
 * ## Today-invariance
 *
 * The last block asserts, against the UNMOCKED `ObjectSchema`, that all three
 * candidate readings agree on every top-level key — i.e. this change moves no
 * key on today's shape, and `fields` (the one collection `'merge'` merges, and
 * the key PR #19147 wraps in `z.preprocess`) is excluded by NAME either way.
 * It is written to go RED the day that stops being true, which is the day the
 * fix starts doing observable work; the remedy then is to re-measure and
 * re-state the invariant, never to relax the assertion.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

const NAMES = vi.hoisted(() => ({
  /** `z.preprocess(fn, z.array(...))` — IN is the transform, OUT is the array. */
  preprocess: 'probePreprocessCollection',
  /** `.transform(...).pipe(z.array(...))` — authored as a scalar, parsed to an array. */
  pipeScalar: 'probePipeScalarToArray',
  /** A plain scalar: the walk must not reach a collection by any route. */
  scalar: 'probeScalar',
}));

// The probe keys ride on `ObjectSchema.shape` because that shape is the ONLY
// input `objectCollectionKeys()` reads. Nothing else in the module graph is
// replaced: the factory spreads the real module and the real shape.
vi.mock('./data/object.zod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data/object.zod')>();
  const { z: zod } = await import('zod');
  const patched = zod.object({
    ...(actual.ObjectSchema.shape as Record<string, z.ZodType>),
    [NAMES.preprocess]: zod.preprocess((raw) => raw, zod.array(zod.string())).optional(),
    [NAMES.pipeScalar]: zod
      .string()
      .transform((s) => s.split(','))
      .pipe(zod.array(zod.string()))
      .optional(),
    [NAMES.scalar]: zod.string().optional(),
  });
  return { ...actual, ObjectSchema: patched };
});

const { composeStacks, defineStack } = await import('./stack.zod');
const { ObjectSchema } = await import('./data/object.zod');

// ── Independent walkers: the three candidate readings of a `pipe` ──────────
//
// Re-implemented here rather than imported — `declaresCollection` is internal,
// and a pin that imports the subject cannot state what the subject REJECTED.

type Def = {
  type?: string;
  innerType?: unknown;
  in?: unknown;
  out?: unknown;
  options?: unknown[];
  getter?: () => unknown;
};

/** `typeof === 'function'` included: `lazySchema` proxies are callable. */
const defOf = (schema: unknown): Def | undefined =>
  schema === null || (typeof schema !== 'object' && typeof schema !== 'function')
    ? undefined
    : (schema as { _zod?: { def?: Def } })._zod?.def;

const WRAPPERS = ['optional', 'nullable', 'default', 'prefault', 'readonly', 'nonoptional', 'catch'];

type Walk = (schema: unknown, depth?: number) => boolean;

function makeWalk(pipeArm: (def: Def, walk: Walk, depth: number) => boolean): Walk {
  const walk: Walk = (schema, depth = 0) => {
    if (depth > 8) return false;
    const def = defOf(schema);
    if (!def?.type) return false;
    if (def.type === 'array' || def.type === 'record') return true;
    if (WRAPPERS.includes(def.type)) return walk(def.innerType, depth + 1);
    if (def.type === 'lazy') return walk(def.getter?.(), depth + 1);
    if (def.type === 'pipe') return pipeArm(def, walk, depth);
    if (def.type === 'union') return (def.options ?? []).some((o) => walk(o, depth + 1));
    return false;
  };
  return walk;
}

/** The arm as it stood before #19150 — the bright control. */
const inOnlyWalk = makeWalk((def, walk, depth) => walk(def.in, depth + 1));

/** The candidate this change DECLINED (and the shape the sibling test walker took). */
const eitherSideWalk = makeWalk((def, walk, depth) => walk(def.in, depth + 1) || walk(def.out, depth + 1));

/** The landed rule: OUT only when IN is a transform stage. */
const authorableWalk = makeWalk((def, walk, depth) => {
  let node = def.in;
  for (let hops = 0; hops < 8; hops++) {
    const inner = defOf(node);
    if (!inner?.type) break;
    if (inner.type === 'transform') return walk(def.out, depth + 1);
    if (WRAPPERS.includes(inner.type)) {
      node = inner.innerType;
      continue;
    }
    if (inner.type === 'lazy') {
      node = inner.getter?.();
      continue;
    }
    break;
  }
  return walk(def.in, depth + 1);
});

const shapeOf = (schema: unknown): Record<string, unknown> =>
  (schema as { shape: Record<string, unknown> }).shape;

const probe = (key: string): unknown => shapeOf(ObjectSchema)[key];

// ── Stack fixtures, `strict: false` so a probe key survives to composition ──

const mf = (id: string) => ({ id, name: id.split('.').pop()!, version: '1.0.0', type: 'app' as const });

const obj = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { title: { type: 'text' as const } },
  ...extra,
});

const stackWith = (id: string, extra: Record<string, unknown>) =>
  defineStack({ manifest: mf(id), objects: [obj('shared', extra)] }, { strict: false });

/** The thrown message, or `null` when the composition is accepted. */
function refusal(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const composedShared = (left: Record<string, unknown>, right: Record<string, unknown>) => {
  const out = composeStacks([stackWith('com.example.a', left), stackWith('com.example.b', right)], {
    objectConflict: 'merge',
  });
  return (out.objects ?? []).find((o) => o.name === 'shared') as Record<string, unknown> | undefined;
};

const refuse = (key: string, left: unknown, right: unknown) =>
  refusal(() => composedShared({ [key]: left }, { [key]: right }));

describe('#19150 — the probe keys are the shapes this pin is about (anti-vacuity)', () => {
  it('the preprocess probe is a pipe whose IN is a transform and whose OUT is the array', () => {
    const def = defOf(defOf(probe(NAMES.preprocess))?.innerType);
    expect(def?.type).toBe('pipe');
    expect(defOf(def?.in)?.type).toBe('transform');
    expect(defOf(def?.out)?.type).toBe('array');
  });

  it('the `.pipe()` probe is a pipe whose authored side is a scalar and whose OUT is an array', () => {
    const def = defOf(defOf(probe(NAMES.pipeScalar))?.innerType);
    expect(def?.type).toBe('pipe');
    // IN is itself the `.transform()` pipe — a pipe, NOT a transform stage, so
    // the authorable side stays IN and resolves to the authored `string`.
    expect(defOf(def?.in)?.type).toBe('pipe');
    expect(defOf(defOf(def?.in)?.in)?.type).toBe('string');
    expect(defOf(def?.out)?.type).toBe('array');
  });
});

describe('#19150 BRIGHT CONTROL — the pre-fix reading of the preprocess probe', () => {
  it('reading IN alone answers "not a collection" — the silent direction', () => {
    expect(inOnlyWalk(probe(NAMES.preprocess))).toBe(false);
  });

  it('the authorable-side reading answers "collection"', () => {
    expect(authorableWalk(probe(NAMES.preprocess))).toBe(true);
  });

  it('resolves a transform stage that sits BEHIND a wrapper on the IN side', () => {
    // The shape `scripts/zod-graph.test.ts` pins for `pipeAuthorableSide`: the
    // unwrap before the transform test is load-bearing, because a transform one
    // level down is still a transform.
    const wrapped = z
      .transform((raw: unknown) => raw)
      .prefault('x')
      .pipe(z.array(z.string()));
    expect(inOnlyWalk(wrapped)).toBe(false);
    expect(authorableWalk(wrapped)).toBe(true);
  });
});

describe('#19150 MAIN — the preprocess-wrapped collection key is IN the refusal set', () => {
  it('refuses two differing declarations, naming the object, the key and both stacks', () => {
    const msg = refuse(NAMES.preprocess, ['a'], ['b']);
    expect(msg).toContain(
      `composeStacks conflict: object 'shared' is defined in multiple stacks and its ` +
        `'${NAMES.preprocess}' is declared with different values by 'com.example.a' (stack #0) and ` +
        `'com.example.b' (stack #1).`,
    );
  });

  it('the derived set the refusal ENUMERATES carries the key — the per-key reading', () => {
    const msg = refuse(NAMES.preprocess, ['a'], ['b']) ?? '';
    const enumerated = /Any other object-level collection \(([^)]*)\) is not merged/.exec(msg)?.[1] ?? '';
    const derived = enumerated.split(', ').filter(Boolean);
    expect(derived).toContain(NAMES.preprocess);
    // …and the keys it carried before this change are all still there, in order.
    expect(derived.filter((k) => k !== NAMES.preprocess)).toEqual([
      'indexes',
      'fieldGroups',
      'requiredPermissions',
      'validations',
      'activityMilestones',
      'highlightFields',
      'listViews',
      'searchableFields',
      'actions',
    ]);
  });

  it('identical declarations still compose — the refusal is about DIFFERING values only', () => {
    expect(refuse(NAMES.preprocess, ['a'], ['a'])).toBeNull();
  });
});

describe('#19150 DARK CONTROL — keys whose verdict must not move', () => {
  it('a genuine `.pipe()` authored as a scalar composes by later-wins, and is NOT refused', () => {
    expect(refuse(NAMES.pipeScalar, 'a', 'b')).toBeNull();
    expect(composedShared({ [NAMES.pipeScalar]: 'a' }, { [NAMES.pipeScalar]: 'b' })?.[NAMES.pipeScalar]).toBe('b');
  });

  it('`in || out` WOULD have moved that key — which is why the landed rule is not `in || out`', () => {
    expect(eitherSideWalk(probe(NAMES.pipeScalar))).toBe(true);
    expect(authorableWalk(probe(NAMES.pipeScalar))).toBe(false);
    expect(inOnlyWalk(probe(NAMES.pipeScalar))).toBe(false);
  });

  it('a plain scalar key composes by later-wins', () => {
    expect(refuse(NAMES.scalar, 'a', 'b')).toBeNull();
    expect(composedShared({ [NAMES.scalar]: 'a' }, { [NAMES.scalar]: 'b' })?.[NAMES.scalar]).toBe('b');
  });

  it('an ordinary collection key is refused exactly as before', () => {
    const msg = refuse('actions', [{ name: 'approve' }], [{ name: 'archive' }]);
    expect(msg).toContain("its 'actions' is declared with different values");
  });
});

describe("#19150 TODAY-INVARIANCE — the fix moves no key on today's ObjectSchema", () => {
  const realShape = async (): Promise<Record<string, unknown>> => {
    const actual = await vi.importActual<typeof import('./data/object.zod')>('./data/object.zod');
    return shapeOf(actual.ObjectSchema);
  };

  const setUnder = (shape: Record<string, unknown>, walk: Walk) =>
    Object.keys(shape).filter((key) => key !== 'fields' && walk(shape[key]));

  it('all three candidate readings derive the SAME refusal set', async () => {
    const shape = await realShape();
    const inOnly = setUnder(shape, inOnlyWalk);
    expect(setUnder(shape, authorableWalk), 'the landed rule moved a key on the real shape').toEqual(inOnly);
    expect(setUnder(shape, eitherSideWalk), '`in || out` would move a key on the real shape').toEqual(inOnly);
    expect(inOnly).toEqual([
      'indexes',
      'fieldGroups',
      'requiredPermissions',
      'validations',
      'activityMilestones',
      'highlightFields',
      'listViews',
      'searchableFields',
      'actions',
    ]);
  });

  it("'fields' is excluded by NAME, so its own reading cannot move the set either way", async () => {
    const shape = await realShape();
    expect(Object.keys(shape)).toContain('fields');
    expect(setUnder(shape, inOnlyWalk)).not.toContain('fields');
    expect(setUnder(shape, authorableWalk)).not.toContain('fields');
  });
});
