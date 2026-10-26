// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE IMPORT BOUNDARY CONVEYS THE PROTOCOL'S OWN GUIDANCE (objectui#9034).
 *
 * `../zod/imported-defaults.ts` promises "the same keys, the same checks, the
 * same descriptions and the same accept set". The description half was the one
 * that was NOT true: across `@objectstack/spec` 17.4.0, every described
 * `ZodDefault` node reachable from the published surface came back with no
 * description at all, and every described CONTAINER node lost theirs as well.
 * Zero survived either way.
 *
 * ⚠️ The two integers this paragraph used to quote for those populations —
 * "2024 of the 2024" and "1364" — are DELETED rather than corrected
 * (objectui#9103). They were not values: they were LOWER BOUNDS, produced by a
 * pairing that stopped dead at every `.optional().default()` node, and a
 * hand-copied integer cannot say how much it failed to look at. The live
 * figures are printed by the census below, derived at run time from the spec
 * version actually installed:
 *
 *     pnpm --filter @object-ui/types exec vitest run \
 *       src/__tests__/imported-defaults-describe-9034.test.ts
 *
 * ⛔ Nothing in this file ASSERTS an integer copied out of that print. Every
 * assertion is a floor, a total-equals-kept identity, or an emptiness, so an
 * upstream spec release moves the populations without looking like a
 * regression here.
 *
 * ## Why it was two losses with one cause, and why the cause is not obvious
 *
 * A zod 4 description is NOT `def` state. `.describe(d)` stores `{description: d}`
 * in `z.globalRegistry` — a WeakMap keyed by the NODE — and the `description`
 * getter reads back through `_zod.parent`, a link only zod's own `clone()`
 * sets. So:
 *
 *  - `.removeDefault()` returns the INNER node, which never carried the outer
 *    node's registry entry. The protocol spells its guidance
 *    `.default(v).describe(d)`, so `d` sat on the node that was discarded.
 *  - `cloneWithDef` builds `new Ctor({...def})`. It copies `def` faithfully —
 *    `def.checks` above all, which is what it exists for — and copies the
 *    description NOT AT ALL, because the description was never in `def`.
 *
 * The module's `lazy` arm already named description loss as the defect it
 * guards against, and named `cloneWithDef` as the guard. That sentence was half
 * wrong: the clone rule saves `def.checks`, and did not save the description.
 *
 * ## What this file pins
 *
 *  1. **The zod facts the fix rests on.** If a later zod propagates the
 *     description through `.removeDefault()`, or puts it back in `def`, the
 *     carry becomes redundant — that must be RED here, not discovered by
 *     someone re-deriving it years later.
 *  2. **The population, re-derived.** Not the number quoted above: the walk
 *     that produced it, run again, over the subpath list read out of the spec's
 *     own `exports` map so a new subpath cannot slip past unmeasured.
 *  3. **⭐ The identity property, which this fix must not buy its way past.**
 *     A subtree with no `ZodDefault` in it still comes back REFERENCE-EQUAL. A
 *     carry implemented by rebuilding nodes that did not need rebuilding would
 *     pass every value assertion in this file and break the one property batch
 *     #90's reversibility argument rests on.
 *  4. **⛔ The spec's graph is not mutated.** The carry runs 267 times on a
 *     branch whose replacement node IS one of the spec's own objects. A carry
 *     that wrote metadata in place instead of cloning would strip-and-relabel
 *     `@objectstack/spec` for every other consumer in the workspace, and every
 *     other assertion here would still be green.
 *
 *  5. **⭐ The instrument, before anything it measures (objectui#9103).** The
 *     census pairs the spec's graph against its stripped twin node by node,
 *     and a pairing that goes wrong does not raise: it walks off the graph,
 *     stops, and reports a SMALLER population with nothing lost — "0 lost"
 *     true by construction because it never looked. So the pairing is
 *     self-tested first on a hand-built corpus whose answer is counted off the
 *     source, and the superseded rule is kept and run as the control that
 *     fires on the real surface.
 *
 * Every count below carries a control that FIRES. A differential whose two
 * sides are the same object, or a census that matched nothing, is green for
 * reasons that have nothing to do with objectui#9034.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { stripImportedDefaults } from '../zod/imported-defaults.js';
import type { WalkableDef } from '../zod/node-derivation.js';

/* ── the graph reader ─────────────────────────────────────────────────────── */

// ⭐ `WalkableDef` ITSELF, ⛔ no longer a module-local copy of it. The copy here
// declared `rest?: z.ZodType` — the spelling objectui#9491 removed from the
// shared declaration, because zod 4 mints an OWN `rest` key holding `null` —
// and then cast around its own declaration to read the `null` that declaration
// refused. Importing the honest one deletes the copy and the cast together, and
// a future drift in the shared type now reaches this file instead of being
// mirrored past it (objectui#9692).
const defOf = (node: z.ZodType): WalkableDef =>
  (node as unknown as { _zod: { def: WalkableDef } })._zod.def;
const optinOf = (node: z.ZodType): string | undefined =>
  (node as unknown as { _zod: { optin?: string } })._zod.optin;
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

/**
 * Does a node of this `type` live in the subtree? Used to split the population.
 *
 * ⚠️ Stops at a `z.lazy` when looking FOR one, and forces the getter otherwise —
 * a recursive spec subtree whose getter builds a fresh graph per call defeats
 * the seen-set, so the node budget is the real terminator.
 */
const reaches = (root: z.ZodType, type: string): boolean => {
  const seen = new Set<z.ZodType>();
  const stack = [root];
  let budget = 20_000;
  while (stack.length && budget-- > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    if (defOf(n).type === type) return true;
    if (defOf(n).type === 'lazy' && type === 'lazy') return true;
    for (const [, c] of childrenOf(n)) stack.push(c);
  }
  return false;
};
const hasDefault = (root: z.ZodType): boolean => reaches(root, 'default');
const hasLazy = (root: z.ZodType): boolean => reaches(root, 'lazy');

/**
 * Does the subtree hold a tuple with no rest element?
 *
 * ⭐ This WAS the carve-out. objectui#9088 has landed, so it is now a POPULATION
 * SELECTOR pointing the other way: these exports are the ones the fix moved, and
 * the assertion below requires every one of them to come back reference-equal.
 *
 * The defect it used to excuse: zod spells "no rest element" as
 * `def.rest === null`, and the `tuple` arm compared that against the `undefined`
 * its own `def.rest ? … : undefined` produced, so `null === undefined` was false
 * and EVERY rest-less tuple was rebuilt whether or not anything beneath it had
 * changed. The arm now copies `def.rest` instead of normalising it.
 *
 * ⛔ Do NOT re-add the exclusion to make a future red go away. A rest-less tuple
 * being rebuilt is the defect objectui#9088 closed, not a permitted exception —
 * the walker has exactly ONE of those, the `lazy` arm.
 */
const hasRestlessTuple = (root: z.ZodType): boolean => {
  const seen = new Set<z.ZodType>();
  const stack = [root];
  let budget = 20_000;
  while (stack.length && budget-- > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    const d = defOf(n);
    if (d.type === 'tuple' && d.rest === null) return true;
    if (d.type === 'lazy') continue;
    for (const [, c] of childrenOf(n)) stack.push(c);
  }
  return false;
};

/* ── the pairing walker, and how it picks the `default` arm's twin ─────────── */

/**
 * ⭐ WHICH NODE IS THE STRIPPED TWIN OF A DEFAULT'S INNER TYPE (objectui#9103).
 *
 * `../zod/imported-defaults.ts`'s `default` arm, re-derived from the file:
 *
 *     const inner = walk(schema.removeDefault());
 *     const next  = isAlreadyOptional(inner) ? inner : z.optional(inner);
 *     out = carryRegistryMeta(schema, next);
 *
 * The re-wrap is CONDITIONAL. So the twin of `removeDefault()` is
 * `after.innerType` when a wrap was added, and `after` ITSELF when it was not —
 * and only the SOURCE side still knows which, because `optin` is what the
 * walker branched on and `optin` is invariant under the walk.
 *
 *  - `'inner-optin'` asks the unwrapped SOURCE node the same question
 *    `isAlreadyOptional` asks. The live rule. ⚠️ Since zod 4.6
 *    (objectui#11073) "omissible" is two rungs: a `ZodDefault` answers
 *    `optin: 'defaulted'`, not `'optional'`. The walker only ever sees such a
 *    node AFTER walking it, which turns the rung into `'optional'`; the source
 *    side still carries `'defaulted'`, so this rule counts either rung.
 *  - `'output-type'` is ⛔ the superseded rule, kept ONLY as the control that
 *    fires and ⛔ never used for a published figure. It asked the OUTPUT's
 *    `def.type === 'optional'`; on the `.optional().default()` spelling the
 *    output is a `ZodOptional` whether or not a wrap was added, so it paired
 *    the spec's own `ZodOptional(T)` against `walk(T)`, no child label matched,
 *    and the recursion STOPPED. Every population taken under it is a lower
 *    bound — which is why the docblock above no longer quotes one.
 */
type DefaultArmRule = 'inner-optin' | 'output-type';

interface Tally {
  nodesVisited: number;
  referenceEqualNodes: number;
  describedDefaults: number;
  describedDefaultsKept: number;
  describedDefaultsLost: string[];
  /** Described `ZodDefault` nodes whose unwrapped inner was ALREADY omissible. */
  alreadyOptionalInner: number;
  /**
   * EVERY default arm whose unwrapped inner was already omissible, described or
   * not — objectui#9103's population. Overwhelmingly the `.optional().default()`
   * spelling; a default directly under a default lands here too, because a
   * `ZodDefault` is omissible as well (`optin: 'defaulted'` since zod 4.6).
   */
  alreadyOptionalArms: number;
  /** `.describe().default()` — the description sits on the node UNDER the default. */
  describedInnerUnderDefault: number;
  /** …where the OUTER node is described too, and the two say different things. */
  describedInnerDisagrees: number;
  rebuiltDescribed: number;
  rebuiltDescribedLost: string[];
  /** ⭐ Pairs whose two sides are not the same kind of node — see `pairRoots`. */
  misaligned: string[];
  /** …where no child label matched either, so the walk stopped there. */
  misalignedStops: number;
}

/**
 * Walk each `(before, after)` pair in lockstep and tally what crossed.
 *
 * ⭐ THE ALIGNMENT INVARIANT, which is what objectui#9103 added. The strip
 * changes a node's KIND in exactly one place — the `default` arm — so at every
 * other node the two sides must report the same `def.type`. A pair that does
 * not is a defect in THIS walk, not a finding about the strip, and it is
 * counted rather than left invisible: a mis-paired node almost never has a
 * matching child label either, so the walk stops and every "nothing was lost"
 * assertion downstream is true by construction beneath it.
 */
const pairRoots = (roots: readonly [string, z.ZodType][], rule: DefaultArmRule): Tally => {
  const t: Tally = {
    nodesVisited: 0,
    referenceEqualNodes: 0,
    describedDefaults: 0,
    describedDefaultsKept: 0,
    describedDefaultsLost: [],
    alreadyOptionalInner: 0,
    alreadyOptionalArms: 0,
    describedInnerUnderDefault: 0,
    describedInnerDisagrees: 0,
    rebuiltDescribed: 0,
    rebuiltDescribedLost: [],
    misaligned: [],
    misalignedStops: 0,
  };
  const seen = new Set<z.ZodType>();

  const pair = (before: z.ZodType, after: z.ZodType, path: string, depth: number): void => {
    if (depth > 60 || seen.has(before)) return;
    seen.add(before);
    t.nodesVisited++;
    if (before === after) { t.referenceEqualNodes++; return; }

    const bd = defOf(before);
    const ad = isZod(after) ? defOf(after) : undefined;
    const bDesc = before.description;
    const aDesc = isZod(after) ? after.description : undefined;

    const misaligned = bd.type !== 'default' && ad !== undefined && ad.type !== bd.type;
    if (misaligned) t.misaligned.push(`${path} :: ${bd.type} paired against ${ad!.type}`);

    if (bd.type === 'default') {
      if (bDesc !== undefined) {
        t.describedDefaults++;
        if (aDesc === bDesc) t.describedDefaultsKept++;
        else t.describedDefaultsLost.push(`${path} :: ${JSON.stringify(bDesc)} -> ${JSON.stringify(aDesc)}`);
      }
      // Unwrapped through `.removeDefault()`, the call the walker itself makes,
      // rather than by reaching for `def.innerType` behind its back. Section 1
      // pins the two equal, so a zod that changed one and not the other reddens
      // there instead of silently re-pointing this walk.
      const removed = (before as unknown as { removeDefault: () => z.ZodType }).removeDefault();
      const innerWasOptional = optinOf(removed) !== undefined;
      if (innerWasOptional) {
        t.alreadyOptionalArms++;
        if (bDesc !== undefined) t.alreadyOptionalInner++;
      }
      if (removed.description !== undefined) {
        t.describedInnerUnderDefault++;
        if (bDesc !== undefined && removed.description !== bDesc) t.describedInnerDisagrees++;
      }

      const wrapped = rule === 'inner-optin'
        ? !innerWasOptional
        : ad?.type === 'optional' && ad.innerType !== undefined;
      if (wrapped && ad?.type !== 'optional') {
        t.misaligned.push(`${path} :: the re-wrap expected a ZodOptional twin, found ${ad?.type ?? 'a non-schema'}`);
      }
      const twin = wrapped ? ad?.innerType : (isZod(after) ? after : undefined);
      if (twin) pair(removed, twin, `${path}(default)`, depth + 1);
      else {
        t.misaligned.push(`${path} :: the default arm found no twin for its inner type`);
        t.misalignedStops++;
      }
      return;
    }

    if (bDesc !== undefined) {
      t.rebuiltDescribed++;
      if (aDesc !== bDesc) {
        t.rebuiltDescribedLost.push(`${path} [${bd.type}] :: ${JSON.stringify(bDesc)} -> ${JSON.stringify(aDesc)}`);
      }
    }

    const aMap = new Map(isZod(after) ? childrenOf(after) : []);
    const kids = childrenOf(before);
    let matched = 0;
    for (const [label, child] of kids) {
      const twin = aMap.get(label);
      if (twin) { matched++; pair(child, twin, `${path}${label}`, depth + 1); }
    }
    if (misaligned && kids.length > 0 && matched === 0) t.misalignedStops++;
  };

  for (const [name, root] of roots) pair(root, stripImportedDefaults(root), name, 0);
  return t;
};

/**
 * Every described node in a subtree, paired with the description it carries NOW.
 *
 * Used by the non-mutation pin, which re-reads these same node objects after a
 * strip: a carry that relabelled its target in place would show up here and
 * nowhere else.
 *
 * ⚠️ Forces `z.lazy` getters, exactly as `reaches` does. A recursive spec
 * subtree whose getter mints a fresh graph per call defeats the seen-set, so
 * the node budget is the real terminator and some collected nodes belong to a
 * throwaway graph — harmless, since a throwaway node is never the one a
 * mutation would damage.
 */
const describedNodes = (root: z.ZodType): [z.ZodType, string][] => {
  const seen = new Set<z.ZodType>();
  const out: [z.ZodType, string][] = [];
  const stack = [root];
  let budget = 20_000;
  while (stack.length && budget-- > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    if (n.description !== undefined) out.push([n, n.description]);
    for (const [, c] of childrenOf(n)) stack.push(c);
  }
  return out;
};

/* ── the population, read out of the spec's own `exports` map ─────────────── */

interface Census extends Tally {
  specVersion: string;
  subpathsDeclared: number;
  subpathsLoaded: number;
  loadFailures: string[];
  roots: [string, z.ZodType][];
}

/**
 * Built at MODULE SCOPE, not in a `beforeAll`.
 *
 * The census dynamically imports every published spec subpath, and a cold Vite
 * transform inside a hook is billed to `hookTimeout` — so the test would pass
 * or fail on machine load rather than on the code it covers. At module scope
 * the same cost lands in the import phase, which no timeout applies to. The
 * `object-ui/no-dynamic-import-in-test-hook` lint rule enforces exactly this.
 */
const buildCensus = async (): Promise<Census> => {
  const pkg = (await import('@objectstack/spec/package.json', { with: { type: 'json' } })) as {
    default: { version: string; exports: Record<string, unknown> };
  };
  // Every subpath the spec publishes, minus the two that are not modules. Read
  // rather than listed, so a subpath added upstream is measured or RED.
  const subpaths = Object.keys(pkg.default.exports).filter(
    (k) => k !== './package.json' && k !== './openapi.json',
  );

  const loadFailures: string[] = [];
  const roots: [string, z.ZodType][] = [];
  let subpathsLoaded = 0;
  for (const sp of subpaths) {
    const specifier = sp === '.' ? '@objectstack/spec' : `@objectstack/spec/${sp.slice(2)}`;
    let mod: Record<string, unknown>;
    try {
      mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
    } catch (err) {
      loadFailures.push(`${specifier}: ${String(err).split('\n')[0]}`);
      continue;
    }
    subpathsLoaded++;
    for (const [name, value] of Object.entries(mod)) {
      if (isZod(value)) roots.push([`${specifier}#${name}`, value]);
    }
  }

  return {
    specVersion: pkg.default.version,
    subpathsDeclared: subpaths.length,
    subpathsLoaded,
    loadFailures,
    roots,
    ...pairRoots(roots, 'inner-optin'),
  };
};

const census: Census = await buildCensus();

/* ── 1. the zod facts the fix rests on ────────────────────────────────────── */

describe('the zod 4 facts that make the carry necessary (objectui#9034)', () => {
  const described = z.string().default('x').describe('DESC');

  it('a description is registry state, NOT `def` state', () => {
    expect(described.description).toBe('DESC');
    expect(
      'description' in (defOf(described) as unknown as Record<string, unknown>),
      'zod now keeps the description in `def` — `cloneWithDef` may carry it on its own and ' +
        '`withDescriptionOf` in `../zod/imported-defaults.ts` may be redundant. Re-measure before deleting it.',
    ).toBe(false);
  });

  it('⭐ `.removeDefault()` does NOT propagate the description to the unwrapped node', () => {
    // The whole card rests on this. If a later zod propagates it, the `default`
    // arm's carry is a no-op rather than a fix, and this test says so first.
    expect(
      (described as unknown as { removeDefault: () => z.ZodType }).removeDefault().description,
      'zod now propagates the description through `.removeDefault()` — re-measure objectui#9034',
    ).toBeUndefined();
  });

  it('⭐ `.removeDefault()` returns the very node `def.innerType` holds', () => {
    // The census unwraps through `.removeDefault()` because the walker does,
    // and then reads that node's `optin` to know which branch the walker took.
    // If a zod ever made these two different objects, the census would pair one
    // node against a DIFFERENT node's twin, silently — this is the only place
    // that would say so.
    expect(
      (described as unknown as { removeDefault: () => z.ZodType }).removeDefault(),
      'zod no longer returns `def.innerType` from `.removeDefault()` — the census pairing (objectui#9103) ' +
        'unwraps through one and branches on the other, and must be re-derived before it is trusted',
    ).toBe(defOf(described).innerType);
  });

  it('⭐ `optin` tells the two default spellings apart — and the OUTPUT does not (objectui#9103)', () => {
    const bare = z.string().default('x');
    const alreadyOptional = z.string().optional().default('x');
    expect(defOf(bare).type).toBe('default');
    expect(defOf(alreadyOptional).type).toBe('default');

    // The source side knows which spelling it is…
    expect(
      optinOf(defOf(bare).innerType!),
      'a bare default unwraps to a REQUIRED node, which is why the strip re-wraps it',
    ).toBeUndefined();
    expect(
      optinOf(defOf(alreadyOptional).innerType!),
      '`.optional().default()` unwraps to an already-omissible node, which the strip leaves alone',
    ).toBe('optional');

    // …and the output side does NOT. This is objectui#9103's defect stated as a
    // zod fact: a pairing that branches on the output's `def.type` cannot tell
    // "the strip added a wrap" from "the wrap was already there".
    const armOf = (schema: z.ZodType): string =>
      defOf(defOf(stripImportedDefaults(z.object({ k: schema }))).shape!.k).type;
    expect(
      [armOf(bare), armOf(alreadyOptional)],
      'the two spellings now produce DIFFERENT output kinds — the output\'s `def.type` would be a valid ' +
        'discriminator again and the census could go back to it',
    ).toEqual(['optional', 'optional']);
  });

  it('⭐ a raw `new Ctor({...def})` rebuild — what `cloneWithDef` does — drops the description', () => {
    // The firing control for the SECOND half of the defect: the clone rule
    // preserves `def.checks` and preserved nothing about the description, which
    // is why `cloneWithDef` has to ask for it explicitly.
    const node = z.object({ k: z.string() }).describe('CONTAINER');
    const Ctor = (node as unknown as { constructor: new (d: WalkableDef) => z.ZodType }).constructor;
    const raw = new Ctor({ ...defOf(node) });
    expect(node.description).toBe('CONTAINER');
    expect(
      raw.description,
      'a def-copying rebuild now carries the description by itself — `withDescriptionOf` may be redundant',
    ).toBeUndefined();
  });

  it('`.describe()` CLONES, so carrying a description never mutates its target', () => {
    const target = z.string().optional();
    const carried = target.describe('CARRIED');
    expect(carried).not.toBe(target);
    expect(target.description).toBeUndefined();
    expect(carried.description).toBe('CARRIED');
  });
});

/* ── 2. hand-built controls, both halves, known to fire ───────────────────── */

describe('hand-built controls — each fires on the region it tests', () => {
  it('a described `ZodDefault` member keeps its description across the strip', () => {
    const src = z.object({ k: z.string().default('x').describe('MEMBER-DESC') });
    expect(defOf(defOf(src).shape!.k).type, 'the control does not exercise the `default` arm').toBe('default');
    expect(defOf(src).shape!.k.description).toBe('MEMBER-DESC');

    const out = stripImportedDefaults(src);
    expect(defOf(out).shape!.k.description).toBe('MEMBER-DESC');
    expect(defOf(defOf(out).shape!.k).type, 'the default survived the strip').not.toBe('default');
    expect(optinOf(defOf(out).shape!.k), 'the member stopped being omissible').toBe('optional');
  });

  it('a described CONTAINER rebuilt because of a default beneath it keeps its description', () => {
    const src = z.object({ k: z.string().default('x') }).describe('CONTAINER-DESC');
    const out = stripImportedDefaults(src);
    expect(out, 'the control does not exercise `cloneWithDef` — nothing was rebuilt').not.toBe(src);
    expect(out.description).toBe('CONTAINER-DESC');
  });

  it('the `.optional().default()` spelling keeps the OUTER description and clones its replacement', () => {
    // The 267-node branch: `.removeDefault()` hands back a node that is already
    // omissible, so the replacement IS the inner node. Carrying by mutation
    // there would relabel the caller's own object.
    const inner = z.string().optional();
    const src = z.object({ k: inner.default('x').describe('OUTER-DESC') });
    const out = stripImportedDefaults(src);
    expect(defOf(out).shape!.k.description).toBe('OUTER-DESC');
    expect(defOf(out).shape!.k, 'the replacement IS the caller\'s node — a carry here would mutate it').not.toBe(inner);
    expect(inner.description, 'the caller\'s node was relabelled in place').toBeUndefined();
  });

  it('the strip INVENTS no description where the source had none', () => {
    const src = z.object({ k: z.string().describe('INNER-ONLY').optional().default('x') });
    expect(defOf(src).shape!.k.description, 'the control is not testing what it claims').toBeUndefined();
    expect(defOf(stripImportedDefaults(src)).shape!.k.description).toBeUndefined();
  });

  it('⭐ a described subtree with NO default comes back REFERENCE-EQUAL, description intact', () => {
    const src = z.object({ k: z.string().describe('INNER') }).describe('IDENTITY');
    expect(stripImportedDefaults(src)).toBe(src);
    expect(stripImportedDefaults(src).description).toBe('IDENTITY');
  });
});

/* ── 2b. the instrument itself, on a corpus whose answer is counted by hand ── */

describe('the census pairing is measured BEFORE it is pointed at the spec (objectui#9103)', () => {
  /**
   * ⭐ A pairing walk cannot be checked against the surface it measures. When it
   * goes wrong it does not raise — it walks off the graph, stops, and reports a
   * SMALLER population with nothing lost, which is indistinguishable from a
   * clean boundary. So it is run first over five hand-built schemas whose
   * answers are counted off the literals below, ⛔ never copied out of a run.
   */
  const corpus = (): [string, z.ZodType][] => [
    // 1 described default; no `.optional().default()` anywhere.
    ['bare', z.object({ a: z.string().default('x').describe('A') })],
    // ⭐ objectui#9103's worked example. 2 described defaults (K, J); the K arm
    // is `.optional().default()`, and J lives underneath it.
    //
    // ⚠️ The card spells the default value `{}`; zod types `.default()` against
    // the schema's INPUT, so the value is filled in here. The pairing never
    // reads a default's VALUE — only the node kinds around it — so this is a
    // type-level spelling difference and not a different case.
    ['card', z.object({
      k: z.object({ j: z.string().default('x').describe('J') }).optional().default({ j: 'x' }).describe('K'),
    })],
    // 3 described defaults (O, P, Q); two nested `.optional().default()` arms,
    // so a rule that stops at the first one sees exactly O.
    ['deep', z.object({
      o: z.object({
        p: z.object({ q: z.string().default('q').describe('Q') }).optional().default({ q: 'q' }).describe('P'),
      }).optional().default({ p: { q: 'q' } }).describe('O'),
    })],
    // 2 described defaults (K, E); E sits under an ARRAY under the arm, so the
    // blind spot is not specific to objects.
    ['array', z.object({
      k: z.array(z.string().default('e').describe('E')).optional().default([]).describe('K'),
    })],
    // 1 described default (N) over a default-under-a-default. ⭐ BOTH rules pair
    // this one correctly — it is here so the differential below cannot be
    // explained by "the new rule just counts more everywhere".
    ['nested', z.object({ n: z.string().default('a').default('b').describe('N') })],
  ];

  // Counted off the five literals above, ⛔ not read off a run.
  const DESCRIBED_DEFAULTS = 1 + 2 + 3 + 2 + 1; // 9
  const ALREADY_OPTIONAL_ARMS = 0 + 1 + 2 + 1 + 1; // 5 — `nested`'s inner is a ZodDefault, which is omissible

  it('⭐ the live rule sees every described default the corpus holds', () => {
    const t = pairRoots(corpus(), 'inner-optin');
    expect(t.describedDefaults, 'the pairing lost sight of a described default it was handed').toBe(DESCRIBED_DEFAULTS);
    expect(t.alreadyOptionalArms).toBe(ALREADY_OPTIONAL_ARMS);
    expect(t.describedDefaultsKept).toBe(t.describedDefaults);
    expect(t.describedDefaultsLost).toEqual([]);
    expect(t.misaligned, 'the live rule mis-paired a node on a corpus built to be paired correctly').toEqual([]);
    expect(t.misalignedStops).toBe(0);
  });

  it('⛔ the superseded rule is blind on the same corpus — the control that FIRES', () => {
    const t = pairRoots(corpus(), 'output-type');
    // `bare` 1 + `card` 1 (stops at K) + `deep` 1 (stops at O) + `array` 1
    // (stops at K) + `nested` 1 = 5 of the 9 the corpus holds.
    expect(
      t.describedDefaults,
      'the superseded rule no longer under-counts this corpus — if zod stopped making the two default ' +
        'spellings look alike on the output side, objectui#9103\'s defect is gone and this control is dead',
    ).toBe(5);
    // One per arm actually REACHED: `card`'s K, `deep`'s O, `array`'s K. `deep`'s
    // P is never reached, which is the point.
    expect(t.misaligned.length).toBe(3);
    expect(t.misalignedStops, 'every mis-paired node also stopped the walk').toBe(3);
    expect(t.nodesVisited).toBeLessThan(pairRoots(corpus(), 'inner-optin').nodesVisited);
  });

  it('⭐ the differential is the blind spot and nothing else', () => {
    const live = pairRoots(corpus(), 'inner-optin');
    const blind = pairRoots(corpus(), 'output-type');
    // Every described default the superseded rule missed is one beneath an
    // `.optional().default()` arm: J, P, Q, E. Both rules agree on `bare` and
    // `nested`, which carry no such arm above a described default.
    expect(live.describedDefaults - blind.describedDefaults).toBe(4);
    // ⭐ objectui#9103's worked example, re-derived rather than quoted: on
    // `card` the superseded rule "sees 1 of 2 described defaults".
    expect(pairRoots([corpus()[1]], 'output-type').describedDefaults).toBe(1);
    expect(pairRoots([corpus()[1]], 'inner-optin').describedDefaults).toBe(2);
    expect(pairRoots([corpus()[0], corpus()[4]], 'inner-optin').describedDefaults).toBe(
      pairRoots([corpus()[0], corpus()[4]], 'output-type').describedDefaults,
    );
  });
});

/* ── 3. the published spec surface, re-derived ────────────────────────────── */

describe('every described node survives the boundary, across the whole published spec surface', () => {
  it('positive control — the census loaded a real surface, with nothing swallowed', () => {
    expect(census.loadFailures, 'a subpath failed to load and was counted as clean').toEqual([]);
    expect(census.subpathsLoaded).toBe(census.subpathsDeclared);
    expect(census.subpathsDeclared, 'the spec publishes far fewer subpaths than it did').toBeGreaterThan(12);
    expect(census.roots.length, 'no schema-shaped exports found — every count below is vacuous').toBeGreaterThan(500);
    expect(census.nodesVisited, 'the walk barely moved — every count below is vacuous').toBeGreaterThan(5_000);
  });

  it('⭐ reports the live populations — printed, ⛔ never pinned to an integer', () => {
    // ⭐ objectui#9103: this print REPLACES the hand-copied figures the docblock
    // used to carry. A figure quoted in prose is a figure taken against some
    // tree nobody can name later; these are taken against the spec version
    // named on the first line, by the same pairing every assertion below uses.
    console.log(
      `[objectui#9103 census] @objectstack/spec ${census.specVersion} · ` +
        `${census.subpathsLoaded}/${census.subpathsDeclared} subpaths · ${census.roots.length} roots\n` +
        `  nodesVisited=${census.nodesVisited} referenceEqual=${census.referenceEqualNodes} ` +
        `ratio=${(census.referenceEqualNodes / census.nodesVisited).toFixed(4)}\n` +
        `  describedDefaults=${census.describedDefaults} kept=${census.describedDefaultsKept} ` +
        `lost=${census.describedDefaultsLost.length}\n` +
        `  rebuiltDescribed=${census.rebuiltDescribed} lost=${census.rebuiltDescribedLost.length}\n` +
        `  alreadyOptionalArms=${census.alreadyOptionalArms} (described: ${census.alreadyOptionalInner})\n` +
        `  describedInnerUnderDefault=${census.describedInnerUnderDefault} ` +
        `(disagreeing with the outer description: ${census.describedInnerDisagrees})\n` +
        `  misaligned=${census.misaligned.length} stops=${census.misalignedStops}`,
    );
    expect(census.nodesVisited, 'the walk visited nothing — every figure printed above is vacuous').toBeGreaterThan(5_000);
  });

  it('⭐ `.describe().default()` DOES occur — the spelling objectui#9034 reported as absent', () => {
    // objectui#9034 stated, as measured, that no reachable node is spelled
    // `.describe().default()`. It is not: some carry a description on the node
    // UNDER the default, and some of those disagree with the outer one. Both
    // survive the strip — the outer through `carryRegistryMeta`, the inner
    // because it is the node that is kept — so nothing is broken, but the
    // sentence was wrong and this is the population that says so.
    expect(
      census.describedInnerUnderDefault,
      'no described inner under any default — `.describe().default()` really is absent now, so ' +
        'objectui#9034\'s sentence has become true and this control no longer measures anything',
    ).toBeGreaterThan(0);
    expect(census.describedInnerDisagrees).toBeGreaterThan(0);
  });

  it('positive control — the described-default population is large and the branch is exercised', () => {
    expect(
      census.describedDefaults,
      'no described `ZodDefault` reached the boundary — the assertion below cannot fail',
    ).toBeGreaterThan(500);
    expect(
      census.alreadyOptionalInner,
      'the `.optional().default()` branch was never taken — its non-mutation is untested',
    ).toBeGreaterThan(0);
    expect(
      census.rebuiltDescribed,
      'no described container was rebuilt — `cloneWithDef`\'s carry is untested',
    ).toBeGreaterThan(200);
  });

  it('⭐ not one described `ZodDefault` loses its description', () => {
    expect(census.describedDefaultsLost.slice(0, 10)).toEqual([]);
    expect(census.describedDefaultsKept).toBe(census.describedDefaults);
  });

  it('⭐ not one rebuilt container loses its description', () => {
    expect(census.rebuiltDescribedLost.slice(0, 10)).toEqual([]);
  });

  it('⭐ the pairing stayed ALIGNED across the whole surface (objectui#9103)', () => {
    // ⭐ THE PIN THIS CARD EXISTS FOR. Without it the two "not one … loses its
    // description" assertions above are partly true BY CONSTRUCTION: the
    // superseded rule stopped at every `.optional().default()` arm, so it could
    // not have seen a loss beneath one. This says the walk actually got there.
    expect(
      census.alreadyOptionalArms,
      'no default arm on the published surface unwraps to an already-omissible node — objectui#9103\'s ' +
        'population is empty on this spec version, so this pin proves nothing and the control below is dead',
    ).toBeGreaterThan(100);
    expect(
      census.misaligned.slice(0, 10),
      'a node was paired against a twin of a DIFFERENT kind. The strip changes a node\'s kind in exactly ' +
        'one place — the `default` arm — so this is a defect in the pairing in THIS file, not a finding ' +
        'about `../zod/imported-defaults.ts`, and every assertion above is true by construction beneath it.',
    ).toEqual([]);
    expect(census.misalignedStops, 'the walk stopped early somewhere — the population above is a lower bound').toBe(0);
  });

  it('⛔ the superseded pairing rule is measurably blind HERE — the control that FIRES', () => {
    // The corpus self-test above proves the old rule is blind on schemas built
    // to expose it. This proves the published spec surface actually contains
    // that shape, so the correction is not theoretical — and it republishes, as
    // a derived number rather than a quoted one, exactly how much the figures in
    // objectui#9034's prose were under-counting.
    const blind = pairRoots(census.roots, 'output-type');
    console.log(
      `[objectui#9103 control] superseded rule: misaligned=${blind.misaligned.length} ` +
        `stops=${blind.misalignedStops} nodesVisited=${blind.nodesVisited} (live ${census.nodesVisited}) ` +
        `referenceEqual=${blind.referenceEqualNodes} (live ${census.referenceEqualNodes}) ` +
        `describedDefaults=${blind.describedDefaults} (live ${census.describedDefaults}) ` +
        `rebuiltDescribed=${blind.rebuiltDescribed} (live ${census.rebuiltDescribed})`,
    );
    expect(
      blind.misaligned.length,
      'the superseded rule pairs this surface correctly — either zod stopped making the two default ' +
        'spellings look alike on the output side, or the spec stopped publishing `.optional().default()`',
    ).toBeGreaterThan(0);
    expect(
      blind.misalignedStops,
      'a mis-paired node did NOT stop the walk — the two populations have come apart and the ' +
        'under-count below is no longer explained by the blind spot alone',
    ).toBe(blind.misaligned.length);
    expect(blind.describedDefaults).toBeLessThan(census.describedDefaults);
    expect(blind.rebuiltDescribed).toBeLessThan(census.rebuiltDescribed);
    expect(blind.nodesVisited).toBeLessThan(census.nodesVisited);
  });
});

/* ── 4. the identity property, and the spec's graph left alone ────────────── */

describe('the carry buys nothing at the identity property\'s expense', () => {
  it('positive control — the population SPLITS, so neither branch below is vacuous', () => {
    const withDefault = census.roots.filter(([, s]) => hasDefault(s));
    const withNone = census.roots.filter(([, s]) => !hasDefault(s));
    expect(withDefault.length, 'nothing carries a default — the carry is untested').toBeGreaterThan(50);
    expect(withNone.length, 'everything carries a default — the identity half is untested').toBeGreaterThan(50);
  });

  it('⭐ every export with nothing to strip comes back REFERENCE-EQUAL', () => {
    // The walker's ONE documented exception is the `lazy` arm: it cannot answer
    // "was anything stripped below me?" without forcing the getter, so it always
    // rebuilds. That exception is measured separately below rather than folded
    // into this set, so it can neither hide a regression nor grow unnoticed.
    //
    // ⭐ There used to be a SECOND exclusion here for rest-less tuples. It was a
    // carve-out for objectui#9088, that card has landed, and it is deleted rather
    // than narrowed — so the exports it used to excuse are back inside this
    // assertion and have to satisfy it like everything else.
    const clean = census.roots.filter(([, s]) => !hasDefault(s));
    const plain = clean.filter(([, s]) => !hasLazy(s));
    expect(plain.length, 'no clean export free of both exceptions — this assertion is vacuous').toBeGreaterThan(50);

    const broken = plain.filter(([, s]) => stripImportedDefaults(s) !== s).map(([n]) => n);
    expect(
      broken.slice(0, 10),
      'a clean subtree was rebuilt. The identity property is batch #90\'s reversibility made literal: ' +
        'carrying a description must never rebuild a node the walk did not already rebuild.',
    ).toEqual([]);
  });

  it('the ONLY clean exports that are rebuilt are behind a `z.lazy` — ONE exception, not two', () => {
    // Pins the exception's SHAPE, not just its size: every clean export that is
    // rebuilt reaches a `z.lazy`, and every clean export behind a `z.lazy` is
    // rebuilt. A future carry that started rebuilding something else would land
    // in the first set and go red here even if the counts happened to match.
    const clean = census.roots.filter(([, s]) => !hasDefault(s));
    const behindLazy = clean.filter(([, s]) => hasLazy(s));
    expect(behindLazy.length, 'no clean export sits behind a `z.lazy` — that exception is untested').toBeGreaterThan(0);

    const excused = new Set(behindLazy.map(([n]) => n));
    const rebuilt = clean.filter(([, s]) => stripImportedDefaults(s) !== s).map(([n]) => n);
    expect(
      rebuilt.filter((n) => !excused.has(n)).slice(0, 10),
      'a clean export was rebuilt that is NOT behind a `z.lazy` — that is an identity-property break ' +
        'outside the walker\'s one documented exception',
    ).toEqual([]);
    expect(
      behindLazy.filter(([, s]) => stripImportedDefaults(s) === s).length,
      'a clean export behind a `z.lazy` came back reference-equal — the `lazy` arm no longer always ' +
        'rebuilds, so `../zod/imported-defaults.ts`\'s docblock is now wrong',
    ).toBe(0);
  });

  it('⭐ the exports that USED to be carved out are now reference-equal (objectui#9088)', () => {
    // ⭐ This replaces the carve-out rather than deleting it outright. Removing
    // the exclusion alone would leave the population silently untested the day
    // the spec stops publishing a rest-less tuple; this asserts the population
    // is non-empty AND that every member satisfies the property the carve-out
    // used to suppress, which is strictly more than the carve-out ever said.
    const clean = census.roots.filter(([, s]) => !hasDefault(s));
    const restless = clean.filter(([, s]) => !hasLazy(s) && hasRestlessTuple(s));
    expect(
      restless.length,
      'no clean export holds a rest-less tuple — objectui#9088\'s population is empty on this spec ' +
        'version, so this assertion proves nothing and the corpus needs re-deriving',
    ).toBeGreaterThan(0);

    const stillRebuilt = restless.filter(([, s]) => stripImportedDefaults(s) !== s).map(([n]) => n);
    expect(
      stillRebuilt.slice(0, 10),
      'a clean export holding a rest-less tuple was REBUILT — objectui#9088 has regressed: the `tuple` ' +
        'arm is normalising `def.rest` to `undefined` again, so `null === undefined` is false for every ' +
        'rest-less tuple and the identity property is broken wherever one occurs',
    ).toEqual([]);

    // ⭐ PROVING REMOVAL: restore `: undefined` at the `tuple` arm's `const rest`
    // in `../zod/imported-defaults.ts` and THREE assertions in this file redden,
    // ⛔ not one. Measured with that single line reverted and nothing else:
    //
    //   - this one;
    //   - `⭐ every export with nothing to strip comes back REFERENCE-EQUAL`;
    //   - `the ONLY clean exports that are rebuilt are behind a z.lazy`.
    //
    // ⚠️ The count matters because it is what the note is FOR: a reader who
    // reverts the line, sees three reds, and was promised one has no way to tell
    // an over-broad pin from a correct one. The fenced file's own note on this
    // same ablation names the wider population; this one was the narrower of the
    // two and is corrected to agree with it (objectui#9103).
  });

  it('⭐ most visited nodes are reference-equal — the walk did not start rebuilding the world', () => {
    // A carry implemented by rebuilding every node on the way down would keep
    // every description and leave this ratio on the floor, with no other symptom.
    expect(census.referenceEqualNodes / census.nodesVisited).toBeGreaterThan(0.5);
  });

  it('⛔ the spec\'s own graph still carries every default AND every description', () => {
    // ⚠️ objectui#9103: this name used to over-claim its body. The body read
    // `hasDefault` on the FIRST 200 carriers and never read a description, so
    // the "AND every description" half was words. Both halves are checked now,
    // across every carrier rather than a prefix, and the description half
    // carries its own non-vacuity floor — a mutation-detector with nothing to
    // detect is the failure mode this file exists to refuse.
    const carriers = census.roots.filter(([, s]) => hasDefault(s));
    expect(carriers.length, 'nothing to check — this control does not fire').toBeGreaterThan(50);

    const before = carriers.map(([name, schema]) => [name, schema, describedNodes(schema)] as const);
    const describedCount = before.reduce((n, [, , d]) => n + d.length, 0);
    expect(
      describedCount,
      'no described node under any carrier — the description half of this assertion is vacuous',
    ).toBeGreaterThan(500);

    const mutated: string[] = [];
    for (const [name, schema, described] of before) {
      stripImportedDefaults(schema);
      if (!hasDefault(schema)) mutated.push(`${name} :: the default was stripped IN PLACE`);
      for (const [node, desc] of described) {
        if (node.description !== desc) {
          mutated.push(
            `${name} :: a description was rewritten IN PLACE ${JSON.stringify(desc)} -> ${JSON.stringify(node.description)}`,
          );
        }
      }
    }
    expect(
      mutated.slice(0, 10),
      'the spec\'s own graph was mutated — every other consumer in the workspace sees it',
    ).toEqual([]);
  });
});
