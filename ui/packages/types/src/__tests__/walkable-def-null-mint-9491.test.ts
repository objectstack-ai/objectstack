// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE DECLARATION ADMITS WHAT ZOD ACTUALLY MINTS — AND NOTHING MORE (objectui#9491).
 *
 * `../zod/node-derivation.ts` declares `WalkableDef`, the def member set both
 * walkers in this package read. Every member but one is declared
 * `z.ZodType | undefined`, and for every member but one that is the truth. The
 * exception is `rest`: zod 4 spells "this tuple has no rest element" as an OWN
 * `rest` key holding `null`.
 *
 * ## Why a test rather than a comment
 *
 * The declaration used to say `rest?: z.ZodType`, and that is not a cosmetic
 * drift — it is what licensed objectui#9088. The `tuple` arm in
 * `../zod/imported-defaults.ts` normalised the absent case to `undefined`
 * because the declared type said `undefined` was the absent case; `unchanged`
 * compares by `===`; `null === undefined` is false; and so EVERY rest-less
 * tuple was rebuilt. The author read the type, the type was wrong, and `tsc`
 * agreed with them. A wrong type is more expensive than a wrong implementation
 * because it makes the next author do every step right and still be wrong.
 *
 * ⇒ what has to stay true is an AGREEMENT between two things that move
 * independently: a hand-written declaration in this repository, and a value
 * minted inside an installed dependency. Prose cannot hold an agreement like
 * that; only something that re-derives both halves can. So this file probes the
 * INSTALLED zod rather than restating a version-stamped reading of it — a zod
 * bump that moves either half reddens here instead of being rediscovered from
 * a rebuilt schema months later.
 *
 * ## Both halves, because "only `rest`" is load-bearing
 *
 *  1. **`rest` IS minted `null`** — subject, plus the rest-BEARING control that
 *     fires the other way, so a green cannot come from the probe reading
 *     nothing.
 *  2. **⭐ No other member is** — swept across the node kinds the walkers meet.
 *     Without this half, the honest repair for `rest` reads like a licence to
 *     spell `| null` on any member that looks similar, which would declare
 *     something zod does not do and reopen the same class from the other side.
 *  3. **The declaration agrees with 1 and 2** — pinned through `tsc` (this
 *     package's `type-check` compiles `src/**\/*.test.ts` via
 *     `tsconfig.test.json`), so narrowing `rest` back, or widening a sibling to
 *     match it, fails to COMPILE rather than failing quietly.
 *
 * ## ⛔ What this file does NOT re-derive, said rather than left to read as live
 *
 * The SOURCE-level half of objectui#9491's census — a grep over zod's shipped
 * tree for a `null` bound to a walkable member name — is ⛔ NOT mechanised
 * here, while objectui#9683's body reads as though both halves were. Stated
 * rather than left implicit, per commandment #9: prose that declares something
 * checked is derived once and never again.
 *
 * What IS re-derived instead is the matrix's WIDTH: the last describe block
 * below reads both walkers' own sources and fails when either names a node kind
 * this matrix does not build, so a kind a walker can meet cannot fall outside
 * the sweep silently (objectui#9692). A member zod mints `null` into only on a
 * kind NEITHER walker names is outside both halves — and outside anything
 * either walker can read.
 *
 * ⛔ Nothing here asserts walker BEHAVIOUR: the rest-less-tuple identity
 * property and the rebuild half are `imported-defaults-rest-less-tuple-9088.test.ts`'s
 * subject and stay there. This file is about the type telling the truth.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { internals, type WalkableDef } from '../zod/node-derivation.js';

/**
 * Does `T` admit `null`? Resolved by the compiler; the runtime assertions below
 * exist so the answer is also READ — an unused type alias proves nothing and a
 * lint rule would be right to delete it.
 */
type AdmitsNull<T> = null extends T ? true : false;

/**
 * Every member of `WalkableDef` — i.e. the whole surface the walkers read.
 *
 * ⭐ DERIVED from `keyof WalkableDef`, ⛔ not hand-copied beside it. The
 * `Record` demands a key for every member, so a member added to the interface
 * and not added here fails to COMPILE. Hand-copied, the same omission dropped
 * that member from the sweep below with no symptom at all: the instrument would
 * go QUIET rather than red, and a quiet instrument reads exactly like a clean
 * one (objectui#9692).
 */
const WALKABLE_MEMBER_SET: Record<keyof WalkableDef, true> = {
  type: true, shape: true, options: true, items: true, element: true, rest: true,
  valueType: true, keyType: true, left: true, right: true, in: true, out: true,
  innerType: true, catchall: true, getter: true,
};
const WALKABLE_MEMBERS = Object.keys(WALKABLE_MEMBER_SET) as (keyof WalkableDef)[];

const defOf = (node: z.ZodType): WalkableDef => internals(node)._zod.def;

/**
 * The node kinds these walkers can meet, each built the way a schema author
 * would build it. ⚠️ The sweep below is only as wide as this matrix — so a node
 * kind added to either walker's `switch` belongs here on the same change.
 *
 * ⭐ That rule is re-derived at the bottom of this file, ⛔ not left to the next
 * author's memory: it stood as a comment while three kinds both walkers name
 * were missing from here (objectui#9692).
 */
const leaf = z.number();
const MATRIX: Record<string, z.ZodType> = {
  'tuple (rest-less)': z.tuple([z.number(), z.number()]),
  'tuple (empty)': z.tuple([]),
  'tuple (with rest)': z.tuple([z.number()], z.string()),
  object: z.object({ a: leaf }),
  'object (strict)': z.object({ a: leaf }).strict(),
  'object (loose)': z.object({ a: leaf }).loose(),
  union: z.union([z.number(), z.string()]),
  discriminatedUnion: z.discriminatedUnion('type', [
    z.object({ type: z.literal('a') }),
    z.object({ type: z.literal('b') }),
  ]),
  array: z.array(leaf),
  record: z.record(z.string(), leaf),
  map: z.map(z.string(), leaf),
  set: z.set(leaf),
  intersection: z.intersection(z.object({ a: leaf }), z.object({ b: leaf })),
  'pipe (transform)': z.string().transform((s) => s.length),
  'pipe (preprocess)': z.preprocess((v) => v, z.string()),
  lazy: z.lazy(() => leaf),
  optional: z.optional(leaf),
  nullable: z.nullable(leaf),
  default: leaf.default(1),
  prefault: leaf.prefault(1),
  promise: z.promise(leaf),
  catch: leaf.catch(0),
  readonly: z.object({ a: leaf }).readonly(),
  nonoptional: z.optional(leaf).nonoptional(),
  string: z.string(),
  literal: z.literal('a'),
  enum: z.enum(['a', 'b']),
  never: z.never(),
  // The three kinds both walkers name whose arms return the node as-is. They
  // mint no walkable member at all, so they cost the sweep nothing — but the
  // rule above says a kind either walker names belongs here, and a matrix that
  // does not meet it silently bounds the sweep to less than the walkers reach.
  custom: z.custom<string>((value) => typeof value === 'string'),
  transform: z.transform((value: unknown) => value),
  function: z.function(),
};

/** `[member, node label]` for every walkable member observed holding `null`. */
const nullMints = (): [string, string][] => {
  const hits: [string, string][] = [];
  for (const [label, node] of Object.entries(MATRIX)) {
    const def = defOf(node) as unknown as Record<string, unknown>;
    for (const member of WALKABLE_MEMBERS) {
      if (Object.hasOwn(def, member) && def[member] === null) hits.push([member, label]);
    }
  }
  return hits;
};

describe('zod mints `null` into exactly one walkable def member (objectui#9491)', () => {
  it('⭐ a rest-less tuple carries an OWN `rest` key holding `null`', () => {
    const def = defOf(z.tuple([z.number(), z.number()])) as unknown as Record<string, unknown>;

    // Three separate claims, and the fix rests on all three. An absent key, or
    // an `undefined` value, would each make `: undefined` the correct spelling
    // in the `tuple` arm again — and each would arrive without a symptom.
    expect(Object.hasOwn(def, 'rest')).toBe(true);
    expect(def.rest).toBeNull();
    expect(def.rest).not.toBeUndefined();

    // PROVING REMOVAL: declare `rest` absent-as-undefined here (`def.rest`
    // asserted `toBeUndefined`) and this reddens on the installed zod.
  });

  it('the control fires the other way: a tuple WITH a rest element holds a node there', () => {
    const def = defOf(z.tuple([z.number()], z.string()));

    expect(def.rest).not.toBeNull();
    expect(def.rest && '_zod' in def.rest).toBe(true);
  });

  it('⭐ no OTHER member the walkers read is ever minted `null`', () => {
    const members = [...new Set(nullMints().map(([member]) => member))].sort();

    // The uniqueness claim, as a set rather than a count — a count says nothing
    // about WHICH member moved, and which member moved is the entire question.
    expect(members).toEqual(['rest']);

    // ⇒ if a later zod mints `null` into another member, this is the assertion
    // that reddens, and the repair is to widen THAT member in `WalkableDef` and
    // pin it below — ⛔ not to relax this expectation.
    //
    // PROVING REMOVAL: add `element` to the expected set and this reddens,
    // which is what says the sweep is reading the matrix rather than a
    // hard-coded answer.
  });

  it('⭐ every member observed holding `null` is minted by a tuple, not by a wrapper', () => {
    // Guards the reading above against a matrix that happens to contain only
    // tuples: the labels are carried so the source of each hit is named.
    const labels = [...new Set(nullMints().map(([, label]) => label))].sort();

    expect(labels).toEqual(['tuple (empty)', 'tuple (rest-less)']);
  });
});

describe('`WalkableDef` agrees with that mint, and the agreement is compiled (objectui#9491)', () => {
  it('⭐ `rest` admits `null`', () => {
    // ⛔ Not a restatement of the line in `node-derivation.ts`: `tsc` resolves
    // `AdmitsNull` from the declaration itself, so narrowing `rest` back to
    // `z.ZodType | undefined` makes this a type ERROR — the package's
    // `type-check` compiles this file, so the error is a gate and not a
    // suggestion. That compile failure is the real pin; the `expect` is here so
    // the value is read.
    const restAdmitsNull: AdmitsNull<WalkableDef['rest']> = true;

    expect(restAdmitsNull).toBe(true);
  });

  it('⭐ the siblings do NOT admit `null`, which is the half that keeps this honest', () => {
    // `out` is named first because it is the near miss: a pipe's `out` holds an
    // opaque transform, it sits one arm away from `rest` in both walkers, and
    // the sweep above measures it clean. Copying `| null` onto it would declare
    // an absent case zod never produces, and every read guarding against it
    // would be dead code no test could ever reach.
    const outAdmitsNull: AdmitsNull<WalkableDef['out']> = false;
    const elementAdmitsNull: AdmitsNull<WalkableDef['element']> = false;
    const itemsAdmitsNull: AdmitsNull<WalkableDef['items']> = false;

    expect([outAdmitsNull, elementAdmitsNull, itemsAdmitsNull]).toEqual([false, false, false]);
  });
});

/* ── the two source-level halves, read rather than restated ───────────────── */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..');
/** Read a module of this package as TEXT. Rooted on this file, ⛔ never on `process.cwd()`. */
const readSource = (rel: string): string => readFileSync(join(SRC_DIR, rel), 'utf8');

/**
 * The node kinds a walker's source NAMES: its `case` arms, plus the `lazy` test
 * both walkers run before their `switch`.
 */
const kindsNamedBy = (source: string): string[] => [
  ...[...source.matchAll(/^\s*case '([a-zA-Z]+)':/gm)].map((m) => m[1]),
  ...[...source.matchAll(/def\.type === '([a-zA-Z]+)'/g)].map((m) => m[1]),
];

describe('the matrix is as wide as the walkers, which is the rule it states (objectui#9692)', () => {
  it('⭐ every node kind either walker NAMES is built by the matrix', () => {
    const named = new Set([
      ...kindsNamedBy(readSource('zod/imported-defaults.ts')),
      ...kindsNamedBy(readSource('strict-authoring-face.ts')),
    ]);

    // The controls ride the SAME reader, because a reader that matched nothing
    // — a renamed file, a `switch` re-spelled past this regex — satisfies the
    // assertion below vacuously and reads exactly like a matrix that is wide
    // enough.
    expect(named.size, 'the walker reader matched nothing — everything below is vacuous').toBeGreaterThan(0);
    expect([...named], 'the reader missed the `switch` arms').toContain('tuple');
    expect([...named], 'the reader missed the pre-`switch` `lazy` arm').toContain('lazy');

    const built = new Set(Object.values(MATRIX).map((node) => defOf(node).type));
    const unbuilt = [...named].filter((kind) => !built.has(kind)).sort();

    expect(
      unbuilt,
      'a node kind a walker names is not built by MATRIX, so the null sweep never visits it — ' +
        'add one entry per kind rather than narrowing this assertion',
    ).toEqual([]);

    // ⇒ the other direction is deliberately NOT asserted: the matrix is WIDER
    // than the walkers on purpose, because a kind no arm names is still a LEAF a
    // walker meets and hands back.
    //
    // PROVING REMOVAL: delete one of the `custom` / `transform` / `function`
    // entries from MATRIX and this reddens naming it.
  });
});

describe('the comparison objectui#9088\'s repair rests on is still STRICT (objectui#9692)', () => {
  it('⭐ `unchanged` in the import boundary compares with `===`, never `==`', () => {
    // ⚠️ Only pinnable at source level, and that is a reading rather than a
    // preference: `unchanged` is module-local, the values it would confuse are
    // `null` and `undefined`, and no arm hands it that cross-pair today — so
    // relaxing the operator is invisible to every behavioural pin in this
    // package. Measured on objectui#9692, at the head that filed it: relaxing
    // it to `==` left the neighbouring walker pin files entirely green, while
    // restoring the pre-objectui#9088 normalisation reddened three of them —
    // so that green was a real absence, not a blind suite.
    //
    // It is the single most tempting future loosening now that the parameter
    // admits `null`, and `null == undefined` would re-license the objectui#9088
    // defect class for EVERY arm at once.
    const source = readSource('zod/imported-defaults.ts');

    // The pattern admits BOTH spellings and the assertion reads the one it
    // found, so this fails in both directions it can fail: relaxed to `==`, or
    // re-spelled past the reader.
    const match = /children\.every\(\(\[before, after\]\) => before (===?) after\)/.exec(source);

    expect(
      match,
      '`unchanged` no longer matches this pin — re-point it at the comparison, ⛔ do not delete it',
    ).not.toBeNull();
    expect(
      match?.[1],
      'the comparison was relaxed to `==`, which makes `null == undefined` true for every arm at once',
    ).toBe('===');

    // PROVING REMOVAL: relax the operator in `../zod/imported-defaults.ts` and
    // this is the only assertion in this package that reddens.
  });
});
