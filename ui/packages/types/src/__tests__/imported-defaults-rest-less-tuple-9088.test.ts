// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE IDENTITY PROPERTY HOLDS FOR A REST-LESS TUPLE (objectui#9088).
 *
 * `../zod/imported-defaults.ts` states the property in the walker's own
 * docblock: "A node is rebuilt ONLY if the walk actually changed something
 * beneath it. A subtree with no `ZodDefault` in it therefore comes back
 * REFERENCE-EQUAL to the spec's own object." That is decision batch #90's
 * reversibility argument made literal, and it is the argument on which option A
 * was taken over option B.
 *
 * It was false for EVERY rest-less tuple, and the contradiction was one
 * operator wide.
 *
 * ## The mechanism
 *
 * Zod 4.4.3 spells "no rest element" as `def.rest === null` — a real, OWN key
 * holding `null`. Measured over the whole shipped `zod@4.4.3/v4` tree (176 files,
 * 88 `.js` + 88 `.cjs`), the statement that mints it,
 * `const rest = hasRest ? _paramsOrRest : null`, occurs at 6 locations — 3
 * logical sites x 2 module formats: `classic/schemas.{js,cjs}`,
 * `mini/schemas.{js,cjs}` and `core/api.{js,cjs}`, the last being where zod's
 * `tuple` factory lives.
 *
 * ⚠️ The count is pinned to zod 4.4.3 and to that corpus. An earlier revision of
 * this docblock said "exactly one site" and named `classic/schemas.cjs` alone —
 * a 2-file corpus that excluded `core/api.cjs`, which is precisely the file the
 * `tuple` factory is in. A census is only reproducible if its corpus is stated
 * AND its corpus is the one that could have contradicted it.
 *
 * The `tuple` arm normalised the other side of the comparison to `undefined`:
 *
 *     const rest = def.rest ? walk(def.rest) : undefined;   // the defect
 *
 * `unchanged` compares by `===`, and `null === undefined` is `false`. So the
 * pair never matched, the arm always took the `cloneWithDef` branch, and a
 * tuple with nothing to strip beneath it was rebuilt anyway.
 *
 * ⛔ The repair is to stop normalising — `: def.rest` — so a `null` is compared
 * against a `null`. ⛔ NOT to relax `unchanged` to `==`: that would make
 * `null == undefined` true for every arm at once and paper over a real zod-4
 * spelling distinction other arms may come to depend on.
 *
 * ## What this file pins
 *
 *  1. **The zod facts the fix rests on.** If a later zod spells "no rest
 *     element" as an absent key, or starts minting `null` into a def member the
 *     walker reads, that must be RED here rather than rediscovered later.
 *  2. **The subject**, plus the two controls that fire the other way — a tuple
 *     WITH a rest element, and a schema with no tuple at all — so a green here
 *     cannot come from the identity property being trivially true.
 *  3. **⭐ The rebuild half, for BOTH shapes.** Compare-like-with-like fixes the
 *     comparison; it must not change what the clone produces when the walk DID
 *     change something. A rest-less tuple that is legitimately rebuilt must
 *     still come out with `def.rest === null`, not `undefined`.
 *  4. **⛔ The other direction (binding from objectui#9102).** The input graph
 *     is `@objectstack/spec`'s own, shared with every workspace consumer, so
 *     nothing here may mutate it — and a subtree with no `ZodDefault` must
 *     still come back reference-equal.
 *  5. **The `:246`@`b8a006883d` = `:274`@head verdict**, which is the triage
 *     fence's census answered as a measurement rather than read off the tuple
 *     result. (The `def.out` site moved because the repair's own comment block
 *     was inserted above it; a quoted line is only a measurement against a
 *     stated sha.)
 *
 * ⭐ Every assertion below records the removal that proves it — the mutation
 * that makes THIS assertion red. A proof that lives only in a pull-request body
 * is one refactor away from vacuous.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { stripImportedDefaults } from '../zod/imported-defaults.js';
import type { WalkableDef } from '../zod/node-derivation.js';

/* ── the graph reader ─────────────────────────────────────────────────────── */

// ⭐ `WalkableDef` ITSELF — and the reason this file no longer mirrors it is the
// same reason it mirrored it before. The copy that stood here declared
// `rest?: z.ZodType | null` while `../zod/node-derivation.ts` declared
// `rest?: z.ZodType`: this file measures the `null`, the shared declaration
// refused it, so the honest spelling had to be local. objectui#9491 moved that
// spelling into the shared declaration, so a copy can now only DRIFT from it —
// and it had already drifted in two sibling pin files (objectui#9692).
//
// ⚠️ ONE member reads differently, and it is ⛔ NOT this file's measurement being
// narrowed: the copy also declared `out?: z.ZodType | null`, where the shared
// declaration says `out?: z.ZodType`. The `out` census below reads through a
// probe annotated `unknown`, deliberately, so that no declaration — local or
// shared — decides the answer it asks. The shared `out` is itself re-derived
// against the installed zod by `walkable-def-null-mint-9491.test.ts`, which
// fails if zod ever mints a `null` there.
const defOf = (node: z.ZodType): WalkableDef =>
  (node as unknown as { _zod: { def: WalkableDef } })._zod.def;
const isZod = (v: unknown): v is z.ZodType =>
  v !== null && (typeof v === 'object' || typeof v === 'function') && '_zod' in (v as object);

/** Children of a node, labelled so the stripped twin's matching child can be found. */
const childrenOf = (s: z.ZodType): [string, z.ZodType][] => {
  const d = defOf(s);
  const out: [string, z.ZodType][] = [];
  switch (d.type) {
    case 'object': for (const [k, v] of Object.entries(d.shape ?? {})) out.push([`.${k}`, v]); break;
    case 'union': (d.options ?? []).forEach((o, i) => out.push([`|${i}`, o])); break;
    case 'array': if (d.element) out.push(['[]', d.element]); break;
    case 'tuple':
      (d.items ?? []).forEach((it, i) => out.push([`[${i}]`, it]));
      if (d.rest) out.push(['[...]', d.rest]);
      break;
    case 'record': if (d.valueType) out.push(['{}', d.valueType]); break;
    case 'intersection':
      if (d.left) out.push(['&L', d.left]);
      if (d.right) out.push(['&R', d.right]);
      break;
    case 'pipe':
      if (d.in) out.push(['>in', d.in]);
      if (d.out) out.push(['>out', d.out]);
      break;
    case 'lazy': if (d.getter) out.push(['~lazy', d.getter()]); break;
    case 'default': case 'optional': case 'nullable':
    case 'nonoptional': case 'readonly': case 'catch':
      if (d.innerType) out.push([`(${d.type})`, d.innerType]);
      break;
    default: break;
  }
  return out;
};

/* ── 1. the zod facts the fix rests on ────────────────────────────────────── */

describe('the zod 4.4.3 facts the fix rests on (objectui#9088)', () => {
  it('⭐ "no rest element" is an OWN key holding `null`, not an absent key', () => {
    const d = defOf(z.tuple([z.number(), z.number()]));

    // All three halves matter and they are different claims. If a later zod
    // drops the key instead of nulling it, the first goes red; if it nulls a
    // different way, the second does. `: def.rest` survives BOTH — it copies
    // whatever is there — which is precisely why it is the repair rather than
    // an `=== null` special case.
    expect(Object.prototype.hasOwnProperty.call(d, 'rest'), 'zod stopped emitting a `rest` key at all').toBe(true);
    expect(d.rest, 'zod no longer spells "no rest element" as `null`').toBeNull();
    expect(d.rest === undefined, 'the pair the old arm compared is no longer mismatched').toBe(false);

    // ⭐ PROVING REMOVAL: change `toBeNull()` to `toBeUndefined()` and this test
    // goes red on zod 4.4.3 — the assertion reads the real def, not a literal.
  });

  it('a tuple WITH a rest element holds the schema itself, so `: def.rest` copies it unchanged', () => {
    const rest = z.string();
    const d = defOf(z.tuple([z.number()], rest));
    expect(d.rest).toBe(rest);

    // ⭐ PROVING REMOVAL: pass a different schema to `z.tuple`'s second argument
    // and `toBe` fails — identity, not shape, is what is asserted.
  });

  it('⭐ `rest` is the ONLY def member the walker reads that zod ever mints as `null`', () => {
    // This is the triage fence's census (`def.X ? walk(def.X) : undefined`)
    // answered as a MEASUREMENT. That census had TWO hits at `b8a006883d` — the
    // `tuple` arm's `def.rest` at `:223` and the `pipe` arm's `def.out` at
    // `:246` — and a verdict on the second read off the first would be
    // worthless. ⚠️ At this head ONE remains: the `tuple` hit is gone, removed
    // by this card's own repair, and `def.out` now sits at `:274`.
    //
    // ⛔ The control here does NOT share the suspect part of the instrument: the
    // SAME probe, applied to `rest`, returns `null`. So a green on `out` is the
    // probe reporting a real absence, not the probe being unable to see a null.
    const probe = (node: z.ZodType, key: 'rest' | 'out'): unknown => defOf(node)[key];

    // every spelling zod 4.4.3 offers that produces a `pipe` def
    const pipes: [string, z.ZodType][] = [
      ['transform', z.string().transform((x) => x)],
      ['preprocess', z.preprocess((x) => x, z.string())],
      ['explicit pipe', z.pipe(z.string().transform((s) => s.length), z.number())],
      ['chained pipe', z.string().pipe(z.string().min(1))],
    ];
    for (const [label, node] of pipes) {
      expect(defOf(node).type, `${label} is not a pipe`).toBe('pipe');
      expect(probe(node, 'out'), `${label}: def.out is nullish — the \`pipe\` arm has the tuple defect too`).not.toBeNull();
      expect(probe(node, 'out'), `${label}: def.out is undefined`).not.toBeUndefined();
    }

    // the control leg: the identical probe DOES see a null when one is there
    expect(probe(z.tuple([z.number()]), 'rest'), 'the probe cannot see a null at all — every reading above is vacuous').toBeNull();

    // ⭐ PROVING REMOVAL: delete the control leg and the test still passes while
    // proving nothing — which is exactly why the leg is in the same `it`.
  });
});

/* ── 2. the subject, with the two controls that fire the other way ────────── */

describe('⭐ the identity property holds for a rest-less tuple (objectui#9088)', () => {
  it('a rest-less tuple with nothing to strip comes back REFERENCE-EQUAL', () => {
    const subject = z.tuple([z.number(), z.number()]);
    expect(
      stripImportedDefaults(subject),
      'a rest-less tuple was REBUILT though nothing beneath it changed — the identity property in ' +
        '`../zod/imported-defaults.ts` is false again, and with it batch #90\'s reversibility argument',
    ).toBe(subject);

    // ⭐ PROVING REMOVAL: restore `: undefined` at the `tuple` arm's `const rest`
    // and this assertion is the one that reddens.
  });

  it('CONTROL — a tuple WITH a rest element was always identity, and still is', () => {
    const subject = z.tuple([z.number()], z.string());
    expect(subject).toBe(stripImportedDefaults(subject));

    // ⭐ PROVING REMOVAL: this control is NOT vacuous — make the arm walk the
    // rest into a fresh node (e.g. `walk(def.rest) ?? def.rest` replaced by
    // `z.string()`) and it reddens while the subject above stays green.
  });

  it('CONTROL — a schema with no tuple at all was always identity, and still is', () => {
    const subject = z.object({ a: z.string() });
    expect(subject).toBe(stripImportedDefaults(subject));
  });

  it('CONTROL — the identity property does NOT hold where something IS stripped', () => {
    // Without this leg the three above are all satisfiable by a `stripImportedDefaults`
    // that is literally `(x) => x`, which would pass every identity assertion in
    // this file and strip nothing.
    const subject = z.tuple([z.number().default(1)]);
    expect(stripImportedDefaults(subject), 'the walker returned its input though there WAS a default to strip').not.toBe(subject);
  });
});

/* ── 3. the rebuild half — both shapes still clone correctly ──────────────── */

describe('⭐ the clone still produces the right def for BOTH tuple shapes (objectui#9088)', () => {
  it('a REST-LESS tuple that is legitimately rebuilt keeps `def.rest === null`', () => {
    // The card's open question. `cloneWithDef` spreads the ORIGINAL def and then
    // the patch, and the arm omits `rest` from the patch for a rest-less tuple —
    // so `rest: null` has to survive from the spread. If it came out `undefined`
    // the node would be a different shape from the one zod builds, and the NEXT
    // walk of it would take a different branch.
    const subject = z.tuple([z.number().default(1), z.string()]);
    const stripped = stripImportedDefaults(subject);

    expect(stripped, 'nothing was rebuilt, so this test is measuring the wrong branch').not.toBe(subject);
    expect(defOf(stripped).type).toBe('tuple');
    expect(
      defOf(stripped).rest,
      'the rebuilt rest-less tuple lost zod\'s `null` spelling and came out `undefined` — a shape zod ' +
        'itself never builds',
    ).toBeNull();
    expect(defOf(stripped).items).toHaveLength(2);

    // the strip actually happened, and only where it should have
    expect(defOf(defOf(stripped).items![0]).type, 'item 0 still carries its default').not.toBe('default');
    expect(defOf(stripped).items![1], 'item 1 had nothing to strip and should be the SAME node').toBe(
      defOf(subject).items![1],
    );

    // ⭐ PROVING REMOVAL, verified: replace the arm's
    // `...(def.rest ? { rest: rest! } : {})` with `rest: rest ?? undefined` and
    // THIS assertion is the only one in the file that reddens — the identity
    // assertions above stay green, so it varies only the claim it is making.
  });

  it('a tuple WITH a rest element that is rebuilt keeps a walked rest', () => {
    const subject = z.tuple([z.number().default(1)], z.string().default('x'));
    const stripped = stripImportedDefaults(subject);

    expect(stripped).not.toBe(subject);
    const rest = defOf(stripped).rest;
    expect(rest, 'the rebuilt tuple lost its rest element entirely').toBeTruthy();
    expect(defOf(rest as z.ZodType).type, 'the rest element was not walked — its default survived').not.toBe('default');

    // ⭐ PROVING REMOVAL: drop `rest` from the patch object and the rest element
    // arrives unstripped — red on the last assertion.
  });

  it('a tuple whose rest alone carries the default is rebuilt, items shared by reference', () => {
    const item = z.number();
    const subject = z.tuple([item], z.string().default('x'));
    const stripped = stripImportedDefaults(subject);

    expect(stripped).not.toBe(subject);
    expect(defOf(stripped).items![0], 'an item with nothing to strip was rebuilt anyway').toBe(item);
  });
});

/* ── 4. the other direction — binding from objectui#9102 ──────────────────── */

describe('⛔ the repair does not regress the property in the other direction (objectui#9102)', () => {
  it('a DEEP subtree with no `ZodDefault` anywhere still comes back reference-equal', () => {
    const subject = z.object({
      a: z.array(z.tuple([z.string(), z.number()])),
      b: z.union([z.tuple([z.boolean()]), z.tuple([z.string()], z.number())]),
      c: z.record(z.string(), z.tuple([z.tuple([z.number()])])),
    });
    expect(stripImportedDefaults(subject), 'a clean subtree was rebuilt').toBe(subject);
  });

  it('⛔ the input graph is NOT mutated — it is the spec\'s own object elsewhere', () => {
    const inner = z.number().default(1);
    const subject = z.tuple([inner]);
    const beforeType = defOf(defOf(subject).items![0]).type;

    stripImportedDefaults(subject);

    expect(defOf(subject).items![0], 'the input tuple\'s item was REPLACED in place').toBe(inner);
    expect(defOf(defOf(subject).items![0]).type, 'the input tuple was stripped IN PLACE').toBe(beforeType);
    expect(defOf(subject).rest, 'the input tuple\'s `rest` was rewritten in place').toBeNull();

    // ⭐ PROVING REMOVAL: make the arm assign into `def` (e.g. `def.items = items`)
    // instead of cloning and all three redden.
  });
});

/* ── 5. the population, re-derived over the published spec surface ────────── */

/**
 * ⭐ THE COUNTING RULE, published beside the number, because a number without
 * its rule is not a reading — and two incomparable figures for "reference
 * equality on this surface" are already in this card's record.
 *
 *  - CORPUS: every subpath in `@objectstack/spec`'s own `exports` map except
 *    `./package.json` and `./openapi.json`, read from the map rather than
 *    listed; every named export of each that answers `isZod` is a ROOT.
 *  - WALK: each root is paired with `stripImportedDefaults(root)` and the two
 *    are descended in lockstep by LABELLED children. A `before` node is
 *    counted ONCE, on first arrival (shared subgraphs are not double-counted).
 *    Depth cap 60.
 *  - DENOMINATOR `nodesVisited`: distinct `before` nodes reached.
 *  - NUMERATOR `referenceEqualNodes`: those for which `before === after`. A
 *    reference-equal node ENDS that branch — its subtree is equal by identity,
 *    so descending it would count nodes the walk never had to consider.
 *
 * ⚠️ That last clause is why this figure is NOT comparable to a whole-graph
 * node count, and it is the same rule `imported-defaults-describe-9034.test.ts`
 * uses, so the two files' figures ARE comparable to each other.
 *
 * ⭐ AND IT IS THE WRONG INSTRUMENT FOR THIS CARD, which is worth writing down
 * because the figure moves the COUNTERINTUITIVE way. Terminating at reference
 * equality means a node that BECOMES reference-equal takes its whole subtree out
 * of the count — so repairing the `tuple` arm made both the numerator and the
 * denominator SHRINK, and the ratio drift slightly DOWN, while strictly more of
 * the surface is reference-equal than before. Read alone, that looks like a
 * regression; it is the rule working as designed.
 *
 * ⇒ RULE B, below, is the instrument that answers this card. It walks the
 * BEFORE graph exhaustively — never terminating early — so the denominator is a
 * FIXED corpus of distinct spec nodes that does not move when the fix lands, and
 * the numerator can only rise. Both rules are reported; neither is a summary of
 * the other.
 */
interface Census {
  roots: number;
  // RULE A — terminates at reference equality (the `…-describe-9034.test.ts` rule)
  nodesVisited: number;
  referenceEqualNodes: number;
  // RULE B — exhaustive walk of the BEFORE graph; fixed denominator
  fixedCorpusNodes: number;
  fixedCorpusReferenceEqual: number;
  restlessTupleRoots: number;
}

const buildCensus = async (): Promise<Census> => {
  const pkg = (await import('@objectstack/spec/package.json', { with: { type: 'json' } })) as {
    default: { exports: Record<string, unknown> };
  };
  const subpaths = Object.keys(pkg.default.exports).filter(
    (k) => k !== './package.json' && k !== './openapi.json',
  );

  const roots: z.ZodType[] = [];
  for (const sp of subpaths) {
    const specifier = sp === '.' ? '@objectstack/spec' : `@objectstack/spec/${sp.slice(2)}`;
    let mod: Record<string, unknown>;
    try {
      mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const value of Object.values(mod)) if (isZod(value)) roots.push(value);
  }

  let nodesVisited = 0;
  let referenceEqualNodes = 0;
  const seen = new Set<z.ZodType>();
  const pair = (before: z.ZodType, after: z.ZodType, depth: number): void => {
    if (depth > 60 || seen.has(before)) return;
    seen.add(before);
    nodesVisited++;
    if (before === after) { referenceEqualNodes++; return; }
    const aMap = new Map(isZod(after) ? childrenOf(after) : []);
    for (const [label, child] of childrenOf(before)) {
      const twin = aMap.get(label);
      if (twin) pair(child, twin, depth + 1);
    }
  };
  for (const root of roots) pair(root, stripImportedDefaults(root), 0);

  // ── RULE B: exhaustive. Never stops at a reference-equal node, so the
  // denominator is a fixed corpus of distinct spec nodes and the numerator is
  // the count of those the walker hands back unchanged.
  let fixedCorpusNodes = 0;
  let fixedCorpusReferenceEqual = 0;
  const seenB = new Set<z.ZodType>();
  const pairB = (before: z.ZodType, after: z.ZodType | undefined, depth: number): void => {
    if (depth > 60 || seenB.has(before)) return;
    seenB.add(before);
    fixedCorpusNodes++;
    if (before === after) fixedCorpusReferenceEqual++;
    // ⛔ `lazy` is not descended: its getter builds a fresh graph per call, so
    // the seen-set cannot terminate it and the corpus would not be fixed.
    if (defOf(before).type === 'lazy') return;
    const aMap = new Map(isZod(after) ? childrenOf(after) : []);
    for (const [label, child] of childrenOf(before)) pairB(child, aMap.get(label), depth + 1);
  };
  for (const root of roots) pairB(root, stripImportedDefaults(root), 0);

  // how many roots hold a rest-less tuple at all — the population this card moves
  let restlessTupleRoots = 0;
  const holdsRestlessTuple = (root: z.ZodType): boolean => {
    const s = new Set<z.ZodType>();
    const stack = [root];
    let budget = 20_000;
    while (stack.length && budget-- > 0) {
      const n = stack.pop()!;
      if (s.has(n)) continue;
      s.add(n);
      const d = defOf(n);
      if (d.type === 'tuple' && d.rest === null) return true;
      if (d.type === 'lazy') continue;
      for (const [, c] of childrenOf(n)) stack.push(c);
    }
    return false;
  };
  for (const root of roots) if (holdsRestlessTuple(root)) restlessTupleRoots++;

  return { roots: roots.length, nodesVisited, referenceEqualNodes, fixedCorpusNodes, fixedCorpusReferenceEqual, restlessTupleRoots };
};

const census: Census = await buildCensus();

describe('the published spec surface, re-derived (objectui#9088)', () => {
  it('⭐ reports the reference-equality figure under the rule in this file\'s docblock', () => {
    // Printed, not pinned to an exact number: the figure moves whenever the spec
    // publishes a schema, and a pinned integer would make an unrelated upstream
    // release look like a regression here. What IS pinned is the floor below.
    console.log(
      `[objectui#9088 census] roots=${census.roots}\n` +
        `  RULE A (terminating)  nodesVisited=${census.nodesVisited} ` +
        `referenceEqual=${census.referenceEqualNodes} ` +
        `notReferenceEqual=${census.nodesVisited - census.referenceEqualNodes} ` +
        `ratio=${(census.referenceEqualNodes / census.nodesVisited).toFixed(4)}\n` +
        `  RULE B (exhaustive)   fixedCorpusNodes=${census.fixedCorpusNodes} ` +
        `referenceEqual=${census.fixedCorpusReferenceEqual} ` +
        `ratio=${(census.fixedCorpusReferenceEqual / census.fixedCorpusNodes).toFixed(4)}\n` +
        `  restlessTupleRoots=${census.restlessTupleRoots}`,
    );
    expect(census.roots, 'the spec surface loaded as zero roots — every figure here is vacuous').toBeGreaterThan(50);
    expect(census.nodesVisited, 'the walk visited nothing').toBeGreaterThan(1000);
    expect(census.fixedCorpusNodes, 'rule B walked nothing').toBeGreaterThan(census.nodesVisited);
  });

  it('⭐ the population this card moves is NON-EMPTY on the published surface', () => {
    expect(
      census.restlessTupleRoots,
      'no published spec export holds a rest-less tuple — this card\'s whole population is empty here, ' +
        'so every figure above is measuring something else',
    ).toBeGreaterThan(0);
  });

  it('⭐ reference equality is the MAJORITY outcome on the published surface', () => {
    // The floor, not the figure. Before this card it was already above a half;
    // the card moves it up, and a regression that started rebuilding the world
    // would drive it under.
    expect(census.referenceEqualNodes / census.nodesVisited).toBeGreaterThan(0.5);
  });
});
