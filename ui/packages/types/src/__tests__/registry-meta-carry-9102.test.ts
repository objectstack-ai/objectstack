// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE IMPORT BOUNDARY CONVEYS THE PROTOCOL'S REGISTRY METADATA, AT BOTH SITES
 * (objectui#9102).
 *
 * objectui#9086 taught `../zod/imported-defaults.ts` to carry a node's
 * DESCRIPTION across a derivation. objectui#9102 measured the two things that
 * fix left standing:
 *
 *  1. **The carry was one key wide, and the wrong key was defended.** The
 *     boundary's docblock enshrined "the description and nothing else" on a
 *     rationale about `id` — and on this surface `id` does not occur at all,
 *     while `title` and `externalVocabulary` sit on `ZodDefault` nodes the
 *     walker unwraps. `@objectstack/spec` emits `{default, description, title,
 *     type}` for a datasource `host`; this package emitted `{description,
 *     type}`. ⭐ Narrower than the protocol on a published surface is the
 *     direction the platform has ruled against.
 *  2. **The sibling rebuild was never widened.** `../strict-authoring-face.ts`
 *     carried the identical `new Ctor({...def, ...patch})` spelling in its own
 *     local copy, and it rebuilds EVERY container it walks — so the derived
 *     strict twin dropped the descriptions this repository's own mirrors
 *     declare, wholesale.
 *
 * Both now go through one helper, `../zod/node-derivation.ts`. That sharing is
 * itself asserted below, because two copies is how the two drifted apart.
 *
 * ## What this file pins
 *
 *  1. **The zod facts the carry rests on.** If a later zod puts registry state
 *     in `def`, stops cloning on `.meta()`, or stops writing `_idmap` from
 *     `add()`, the design below changes — that must be RED here, not discovered
 *     years later by someone re-deriving it.
 *  2. **⭐ The carry set is a real bound AND the protocol fits inside it.** The
 *     vocabulary is enumerated rather than spread, so the census re-derives
 *     every registry key on every published spec subpath and fails when one is
 *     on neither the carry list nor the refusal list. Without that half, a
 *     bounded list silently re-creates the defect one key later.
 *  3. **⛔ `id` is refused, and `_idmap` is not touched.** Not "the spec happens
 *     not to use it here" — that is a fact about today's spec.
 *  4. **Both sites, re-derived.** The published spec surface for site ①, the
 *     published node face for site ②.
 *  5. **⭐ The identity property, which this fix must not buy its way past.** A
 *     subtree with no `ZodDefault` still comes back REFERENCE-EQUAL.
 *  6. **⛔ The spec's graph is not mutated.**
 *
 * Every count below carries a control that FIRES. A census that matched nothing
 * is green for reasons that have nothing to do with objectui#9102.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARRIED_REGISTRY_META_KEYS,
  REFUSED_REGISTRY_META_KEYS,
  carryRegistryMeta,
  cloneWithDef,
  type WalkableDef,
} from '../zod/node-derivation.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';
// ⚠️ THROUGH THE BARREL, deliberately. `../strict-authoring-face.ts` is the deep
// module of a declared module cycle, and `strict-authoring-face-8345.test.ts`
// pins the barrel as its SOLE entry — a direct specifier here turns that pin
// red, which is how this import was caught. The source-reading assertions at
// the bottom of this file address that module by PATH, never by specifier.
import { deriveStrictAuthoringSchema } from '../zod/index.zod.js';
import { SchemaNodeSchema } from '../zod/base.zod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..');

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
const isZod = (v: unknown): v is z.ZodType =>
  v !== null && (typeof v === 'object' || typeof v === 'function') && '_zod' in (v as object);
/**
 * The node's registry metadata AS THE CARRY READS IT — through the published
 * accessor, ⛔ never through a registry lookup keyed by the node object.
 *
 * ⭐ The two are different readings on this surface, and that is the whole of
 * objectui#9102's second round. `@objectstack/spec` publishes most schemas as
 * lazy cross-module `new Proxy(functionTarget, …)` wrappers; the proxy's `get`
 * trap resolves the real schema and BINDS any function it returns, so
 * `node.meta()` runs `real.meta()` and answers the real's entry, while
 * `z.globalRegistry.get(proxy)` answers only the real's ANCESTORS — nothing
 * ever registered the proxy itself. A census written on the map route is blind
 * to every proxied node's own metadata and reports a clean surface it never
 * looked at.
 */
const metaOf = (node: z.ZodType): Record<string, unknown> | undefined =>
  node.meta() as Record<string, unknown> | undefined;

/** The map route, kept ONLY so the differential between the two can be asserted. */
const metaViaRegistryMap = (node: z.ZodType): Record<string, unknown> | undefined =>
  z.globalRegistry.get(node) as Record<string, unknown> | undefined;

/** A node's zod traits — the set `$constructor` stamps on every instance. */
const traitsOf = (node: z.ZodType): string[] => [
  ...(node as unknown as { _zod: { traits: Set<string> } })._zod.traits,
];

/**
 * Is this node one of `@objectstack/spec`'s lazy cross-module proxies?
 *
 * ⛔ NOT a `typeof === 'function'` test ALONE. That test opens the probe below,
 * but as a cheap pre-filter rather than as the discriminator — nothing zod
 * builds is callable, so it is also the step that already answers `false` for a
 * `$ZodObjectJIT` instance. Such an instance is an ORDINARY OBJECT, EVERY `z.object()` carries
 * that trait, and the "JIT" names eval-compiled PARSE CODE; the trait is
 * therefore no discriminator either, since the wrapper forwards `_zod` — traits
 * included — to the real schema behind it and answers `$ZodObjectJIT` right
 * along with it. ⭐ The discriminating probe is the proxy invariant: the wrapper
 * installs an `ownKeys` trap over a FUNCTION target, so
 * `Object.getOwnPropertyNames` cannot satisfy the invariant and THROWS, where
 * an ordinary node answers normally. Both halves are re-derived below rather
 * than asserted here, in the control this docblock's claims rest on.
 *
 * ⚠️ Also spelled as a helper so TypeScript does not narrow the argument to
 * `never` at the call site: `z.ZodType` is not declared callable, so an inline
 * `typeof n === 'function'` makes every later property read an error on a node
 * that answers the guard perfectly well at runtime.
 */
const isSpecLazyProxy = (node: z.ZodType): boolean => {
  if (typeof node !== 'function') return false;
  try {
    Object.getOwnPropertyNames(node);
    return false;
  } catch {
    return true;
  }
};

/** Children of a node, labelled so a derived twin's matching child can be found. */
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

const reaches = (root: z.ZodType, type: string): boolean => {
  const seen = new Set<z.ZodType>();
  const stack = [root];
  let budget = 20_000;
  while (stack.length && budget-- > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    if (defOf(n).type === type) return true;
    for (const [, c] of childrenOf(n)) stack.push(c);
  }
  return false;
};

/**
 * Does the subtree hold a tuple with no rest element?
 *
 * ⭐ This USED to name the import boundary's SECOND identity-property
 * exception, and it was excused below. objectui#9088 repaired it, so the
 * walker now has exactly ONE identity-property exception — the `lazy` arm —
 * and this helper selects a POPULATION the boundary is expected to get right
 * rather than a set to be excused.
 *
 * The defect it used to describe: zod spells "no rest element" as
 * `def.rest === null`, and the `tuple` arm compared that against the
 * `undefined` its own `def.rest ? … : undefined` produced, so
 * `null === undefined` was false and every rest-less tuple was rebuilt whether
 * or not anything beneath it had changed. The arm now copies `def.rest`.
 *
 * ⛔ Do NOT re-add an exclusion built on this helper to make a future red go
 * away. A rest-less tuple being rebuilt is the defect objectui#9088 closed, and
 * the assertion below is what keeps this file from going blind to it — measured:
 * while the exclusion stood, restoring the defect left this whole file at
 * 34/34 green.
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

/* ── the published spec surface, read out of the spec's own `exports` map ──── */

interface Census {
  subpathsDeclared: number;
  subpathsLoaded: number;
  loadFailures: string[];
  roots: [string, z.ZodType][];
  /** Every registry key seen on the surface (accessor route) -> distinct nodes carrying it. */
  keyPopulation: Map<string, number>;
  /** The same census taken on the registry-map route, so the blind spot is measurable. */
  keyPopulationViaMap: Map<string, number>;
  /** Nodes carrying a key other than `description`, by the path they were found at. */
  nonDescriptionNodes: string[];
  /** `@objectstack/spec` lazy proxies reached on this surface. */
  proxyNodes: number;
  /** Proxies whose accessor route answers metadata at all. */
  proxiesWithMeta: number;
  /** Of those, how many the registry-map route reads IDENTICALLY, and how many it does not. */
  proxyMetaMapAgrees: number;
  proxyMetaMapDisagrees: number;
  /** Proxies carrying non-`description` metadata — the population the map route would silently drop. */
  proxyNonDescriptionNodes: string[];
  /** Nodes where `.description` answers but `.meta()?.description` does not — the retired fallback's occasions. */
  descriptionFallbackOccasions: string[];
  /** Registry entry + parent + def snapshots that MOVED across both derivations. */
  mutatedNodes: string[];
  snapshottedNodes: number;
  /** Rebuilt nodes whose carried keys survived, and those that did not. */
  rebuiltWithMeta: number;
  rebuiltWithMetaKept: number;
  rebuiltWithMetaLost: string[];
  nodesVisited: number;
}

/**
 * Built at MODULE SCOPE, not in a `beforeAll`. The census dynamically imports
 * every published spec subpath, and a cold Vite transform inside a hook is
 * billed to `hookTimeout`, so the test would pass or fail on machine load
 * rather than on the code it covers. At module scope the same cost lands in the
 * import phase, which no timeout applies to — which is also what the
 * `object-ui/no-dynamic-import-in-test-hook` rule enforces.
 */
const buildCensus = async (): Promise<Census> => {
  const pkg = (await import('@objectstack/spec/package.json', { with: { type: 'json' } })) as {
    default: { exports: Record<string, unknown> };
  };
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

  const keyPopulation = new Map<string, number>();
  const keyPopulationViaMap = new Map<string, number>();
  const nonDescriptionNodes: string[] = [];
  const proxyNonDescriptionNodes: string[] = [];
  const descriptionFallbackOccasions: string[] = [];
  let proxyNodes = 0;
  let proxiesWithMeta = 0;
  let proxyMetaMapAgrees = 0;
  let proxyMetaMapDisagrees = 0;
  const seenKeys = new Set<z.ZodType>();
  let nodesVisited = 0;

  // Every node's registry entry, `_zod.parent` and def identity BEFORE either
  // derivation runs, so "the spec's graph is left as it was found" can be
  // asserted as a real differential instead of proxied through a side effect.
  const snapshot = new Map<z.ZodType, string>();
  const stateOf = (node: z.ZodType): string =>
    JSON.stringify({
      meta: metaOf(node) ?? null,
      map: metaViaRegistryMap(node) ?? null,
      hasParent: (node as unknown as { _zod: { parent?: unknown } })._zod.parent !== undefined,
      type: defOf(node).type,
      keys: defOf(node).shape ? Object.keys(defOf(node).shape!).join(',') : null,
    });

  const censusKeys = (node: z.ZodType, path: string, depth: number): void => {
    if (depth > 60 || seenKeys.has(node)) return;
    seenKeys.add(node);
    nodesVisited++;
    snapshot.set(node, stateOf(node));

    const meta = metaOf(node);
    const viaMap = metaViaRegistryMap(node);
    const proxy = isSpecLazyProxy(node);
    if (proxy) proxyNodes++;

    if (meta) {
      for (const key of Object.keys(meta)) keyPopulation.set(key, (keyPopulation.get(key) ?? 0) + 1);
      if (Object.keys(meta).some((k) => k !== 'description')) {
        nonDescriptionNodes.push(path);
        if (proxy) proxyNonDescriptionNodes.push(path);
      }
      if (proxy) {
        proxiesWithMeta++;
        if (JSON.stringify(viaMap ?? null) === JSON.stringify(meta)) proxyMetaMapAgrees++;
        else proxyMetaMapDisagrees++;
      }
    }
    if (viaMap) {
      for (const key of Object.keys(viaMap)) keyPopulationViaMap.set(key, (keyPopulationViaMap.get(key) ?? 0) + 1);
    }
    if (node.description !== undefined && meta?.description === undefined) {
      descriptionFallbackOccasions.push(path);
    }

    for (const [label, c] of childrenOf(node)) censusKeys(c, `${path}${label}`, depth + 1);
  };
  for (const [name, root] of roots) censusKeys(root, name, 0);

  // The differential: every node the walk REBUILT, against its source.
  let rebuiltWithMeta = 0;
  let rebuiltWithMetaKept = 0;
  const rebuiltWithMetaLost: string[] = [];
  const seenPair = new Set<z.ZodType>();
  const pair = (before: z.ZodType, after: z.ZodType, path: string, depth: number): void => {
    if (depth > 60 || seenPair.has(before)) return;
    seenPair.add(before);
    if (before === after) return;

    const bd = defOf(before);
    const bm = metaOf(before) ?? {};
    const am = (isZod(after) ? metaOf(after) : undefined) ?? {};
    const carriedKeys = Object.keys(bm).filter((k) => CARRIED_REGISTRY_META_KEYS.includes(k));
    if (carriedKeys.length) {
      rebuiltWithMeta++;
      if (carriedKeys.every((k) => JSON.stringify(am[k]) === JSON.stringify(bm[k]))) rebuiltWithMetaKept++;
      else rebuiltWithMetaLost.push(`${path} [${bd.type}] ${JSON.stringify(bm)} -> ${JSON.stringify(am)}`);
    }

    if (bd.type === 'default') {
      const ad = isZod(after) ? defOf(after) : undefined;
      const inner = bd.innerType!;
      if (ad?.type === 'optional' && ad.innerType) pair(inner, ad.innerType, `${path}(default)`, depth + 1);
      else if (isZod(after)) pair(inner, after, `${path}(default)`, depth + 1);
      return;
    }

    const aMap = new Map(isZod(after) ? childrenOf(after) : []);
    for (const [label, child] of childrenOf(before)) {
      const twin = aMap.get(label);
      if (twin) pair(child, twin, `${path}${label}`, depth + 1);
    }
  };
  for (const [name, root] of roots) pair(root, stripImportedDefaults(root), name, 0);

  // ⛔ THE NON-MUTATION DIFFERENTIAL, taken AFTER both derivations have run over
  // every root. The snapshot above was taken before either did, so a carry that
  // wrote metadata in place — rather than onto a clone — moves a value here.
  // The previous spelling of this pin watched a SIDE EFFECT (does the source
  // still hold a default?) and stayed green under a mutating carry, because a
  // mutating carry does not remove defaults. This one reads the thing it names.
  for (const [, root] of roots) deriveStrictAuthoringSchema(root);
  const mutatedNodes: string[] = [];
  for (const [node, before] of snapshot) {
    if (stateOf(node) !== before) mutatedNodes.push(`${defOf(node).type} :: ${before}`);
  }

  return {
    subpathsDeclared: subpaths.length,
    subpathsLoaded,
    loadFailures,
    roots,
    keyPopulation,
    keyPopulationViaMap,
    nonDescriptionNodes,
    proxyNodes,
    proxiesWithMeta,
    proxyMetaMapAgrees,
    proxyMetaMapDisagrees,
    proxyNonDescriptionNodes,
    descriptionFallbackOccasions,
    mutatedNodes,
    snapshottedNodes: snapshot.size,
    rebuiltWithMeta,
    rebuiltWithMetaKept,
    rebuiltWithMetaLost,
    nodesVisited,
  };
};

const census: Census = await buildCensus();

/* ── 1. the zod facts the carry rests on ──────────────────────────────────── */

describe('the zod 4 facts the carry rests on (objectui#9102)', () => {
  it('registry metadata is NOT `def` state, so a def-copying rebuild carries none of it', () => {
    const node = z.object({ k: z.string() }).meta({ title: 'T', description: 'D', xRef: 'R' });
    expect(metaOf(node)).toMatchObject({ title: 'T', description: 'D', xRef: 'R' });
    expect(
      'title' in (defOf(node) as unknown as Record<string, unknown>),
      'zod now keeps registry metadata in `def` — the explicit carry may be redundant. Re-measure before deleting it.',
    ).toBe(false);

    const Ctor = (node as unknown as { constructor: new (d: WalkableDef) => z.ZodType }).constructor;
    const raw = new Ctor({ ...defOf(node) });
    expect(
      metaOf(raw),
      'a def-copying rebuild now carries registry metadata by itself — `carryRegistryMeta` may be redundant',
    ).toBeUndefined();
  });

  it('⭐ `.meta()` CLONES, so carrying metadata never mutates its target', () => {
    // The whole non-mutation argument rests on this. The derived node IS one of
    // the spec's own objects on the boundary's already-optional branch, so a
    // carry that wrote in place would relabel `@objectstack/spec` for every
    // other consumer in the workspace.
    const target = z.string().optional();
    const carried = carryRegistryMeta(z.string().meta({ title: 'T' }), target);
    expect(carried).not.toBe(target);
    expect(metaOf(target), 'the target was relabelled in place').toBeUndefined();
    expect(metaOf(carried)).toMatchObject({ title: 'T' });
  });

  it('⛔ `globalRegistry.add()` writes `_idmap` when — and only when — the metadata carries an `id`', () => {
    // This is the mechanism `id` is refused on. If zod stops writing `_idmap`
    // from `add()`, the refusal is no longer load-bearing and should be
    // re-argued rather than inherited.
    const marker = `objectui-9102-idmap-${Math.random().toString(36).slice(2)}`;
    expect(z.globalRegistry._idmap.has(marker)).toBe(false);
    z.string().meta({ title: 'no id here' });
    expect(z.globalRegistry._idmap.has(marker), 'the control is not measuring what it claims').toBe(false);
    const withId = z.string().meta({ id: marker });
    expect(
      z.globalRegistry._idmap.get(marker),
      'zod no longer indexes `id` in `_idmap` — re-argue REFUSED_REGISTRY_META_KEYS rather than inheriting it',
    ).toBe(withId);
  });

  it('`globalRegistry.get()` inherits down a parent chain and declines to inherit `id`', () => {
    const marker = `objectui-9102-inherit-${Math.random().toString(36).slice(2)}`;
    const base = z.string().meta({ id: marker, title: 'T' });
    const child = base.describe('D');
    expect(metaOf(child)).toMatchObject({ title: 'T', description: 'D' });
    expect(
      metaOf(child)?.id,
      'zod now inherits `id` down a parent chain — every derived node would claim its source\'s id',
    ).toBeUndefined();
  });

  it('⭐ nothing zod builds is callable — the callables on this surface are SPEC PROXIES', () => {
    // objectui#9102's first round blamed `$ZodObjectJIT` for the callables it
    // met, and a second round then said the trait was ABSENT here. Both clauses
    // are false, so the fact is RE-DERIVED here rather than asserted: it is the
    // sentence `../zod/node-derivation.ts` rests its guard's rationale on, and
    // a docblock that diagnoses the wrong mechanism is what this card exists to
    // stop. A `$ZodObjectJIT` instance is an ordinary object, every `z.object()`
    // carries the trait, and the "JIT" names eval-compiled parse code.
    //
    // The separator is the proxy invariant instead: `@objectstack/spec` wraps
    // schemas in `new Proxy(functionTarget, …)`, and that wrapper's `ownKeys`
    // trap cannot satisfy the proxy invariant over a function target, so
    // `Object.getOwnPropertyNames` THROWS. An ordinary node answers normally —
    // asserted here as the firing control, so `isSpecLazyProxy` cannot be
    // passing by answering `true` to everything.
    const plainObject = z.object({ k: z.string() });
    expect(
      typeof plainObject,
      'a `z.object()` is callable after all — every docblock here that calls the callables PROXIES is stale',
    ).toBe('object');
    expect(
      traitsOf(plainObject),
      'a plain `z.object()` no longer carries the `$ZodObjectJIT` trait — the claim that EVERY one does, ' +
        'and with it the reason the trait cannot separate proxies from ordinary nodes, no longer holds',
    ).toContain('$ZodObjectJIT');
    expect(Object.getOwnPropertyNames(plainObject), 'the control node is not inspectable').toBeInstanceOf(Array);
    expect(isSpecLazyProxy(plainObject), 'the probe answers `true` for an ordinary node').toBe(false);

    const proxies = census.roots.filter(([, r]) => isSpecLazyProxy(r));
    expect(
      proxies.length,
      'no spec root is a lazy proxy any more — either the spec stopped wrapping, or this probe broke. ' +
        'Everything below about the accessor route rests on this population.',
    ).toBeGreaterThan(0);
    expect(() => Object.getOwnPropertyNames(proxies[0]![1])).toThrow(/ownKeys/);
    expect(
      proxies.some(([, r]) => traitsOf(r).includes('$ZodObjectJIT')),
      'no spec proxy forwards the real\'s `$ZodObjectJIT` trait any more — the trait would then separate ' +
        'proxies from ordinary nodes after all, and both docblocks understate what the probe is for',
    ).toBe(true);
  });

  it('⭐ `.meta()` and a registry lookup DISAGREE through a spec proxy, and `.meta()` is the true one', () => {
    // Why `carryRegistryMeta` reads `source.meta()`. The proxy's `get` trap
    // resolves the real schema and BINDS the function it hands back, so
    // `proxy.meta()` runs `real.meta()`. A registry lookup keyed by the proxy
    // cannot reach that: nothing registered the proxy, and the map's
    // parent-chain walk arrives only at the real's ANCESTORS.
    expect(
      census.proxiesWithMeta,
      'no proxy on the published spec surface carries metadata — the accessor route is untested here',
    ).toBeGreaterThan(0);
    expect(
      census.proxyMetaMapDisagrees,
      'the registry-map route now agrees with the accessor on every proxy — the spec may have stopped ' +
        'wrapping, and `carryRegistryMeta` reading `.meta()` would no longer be load-bearing. Re-measure.',
    ).toBeGreaterThan(0);
    // The map route is not merely different, it is POORER: it sees strictly
    // fewer descriptions than the accessor over the same walk.
    expect(
      (census.keyPopulation.get('description') ?? 0) - (census.keyPopulationViaMap.get('description') ?? 0),
      'the two routes now see the same number of descriptions — the blind spot this file measures is gone',
    ).toBeGreaterThan(0);
  });

  it('the retired `.description` fallback would have no occasion to fire', () => {
    // The first round carried `source.description` when the registry view was
    // silent. Once the carry reads `.meta()`, that branch is dead — and dead
    // structurally, not by luck: zod's `description` getter IS
    // `globalRegistry.get(inst)?.description` for the instance it was installed
    // on, and through a proxy both routes resolve to the same real. Measured
    // rather than argued, so re-adding the branch has to answer this number.
    expect(census.descriptionFallbackOccasions.slice(0, 10)).toEqual([]);
  });
});

/* ── 2. the carry set is a real bound, and the protocol fits inside it ─────── */

describe('⭐ the carry set is bounded AND complete for the protocol (objectui#9102)', () => {
  it('positive control — the census loaded a real surface, with nothing swallowed', () => {
    expect(census.loadFailures, 'a subpath failed to load and was counted as clean').toEqual([]);
    expect(census.subpathsLoaded).toBe(census.subpathsDeclared);
    expect(census.subpathsDeclared, 'the spec publishes far fewer subpaths than it did').toBeGreaterThan(12);
    expect(census.roots.length, 'no schema-shaped exports found — every count below is vacuous').toBeGreaterThan(500);
    expect(census.nodesVisited, 'the walk barely moved — every count below is vacuous').toBeGreaterThan(5_000);
  });

  it('positive control — the surface really does carry keys beyond `description`', () => {
    expect(
      census.nonDescriptionNodes.length,
      'nothing on the published spec surface carries registry metadata other than `description` — ' +
        'the whole carry set below is untested and objectui#9102 would have nothing to fix',
    ).toBeGreaterThan(0);
    expect(
      [...census.keyPopulation.keys()].filter((k) => k !== 'description').length,
      'only one distinct key beyond `description` — the enumeration is barely exercised',
    ).toBeGreaterThan(1);
  });

  it('⭐ every registry key the protocol publishes is either CARRIED or REFUSED by name', () => {
    // The half that makes a bounded list safe. A bounded carry set drops a NEW
    // key silently, which is the same "narrower than the protocol" defect
    // objectui#9102 closes, one key later. This converts that silent drop into
    // a failing gate: the day `@objectstack/spec` carries a key on neither
    // list, someone decides deliberately whether it belongs in
    // CARRIED_REGISTRY_META_KEYS.
    //
    // ⚠️ Read through `.meta()` — the same route the carry reads. The first
    // round took this census on `z.globalRegistry.get(node)`, which cannot see
    // a spec proxy's own entry at all, so it reported a vocabulary it had never
    // looked at for most of the surface. The proxy population is asserted
    // non-empty above, which is what stops this from silently reverting to the
    // narrower reading.
    const classified = new Set([...CARRIED_REGISTRY_META_KEYS, ...REFUSED_REGISTRY_META_KEYS]);
    const unclassified = [...census.keyPopulation.keys()].filter((k) => !classified.has(k)).sort();
    expect(
      unclassified,
      'the protocol publishes a registry key this package neither carries nor refuses. Decide which it is ' +
        'and add it to CARRIED_REGISTRY_META_KEYS or REFUSED_REGISTRY_META_KEYS in `../zod/node-derivation.ts`.',
    ).toEqual([]);
    // The map route would have missed nodes outright, not just keys. Stated as
    // a differential so "the census looked at everything" is measured.
    expect(
      (census.keyPopulation.get('description') ?? 0),
      'the accessor census sees no more than the map census — the blind spot is unmeasured here',
    ).toBeGreaterThan(census.keyPopulationViaMap.get('description') ?? 0);
  });

  it('⛔ `id` is refused rather than merely absent, and every carried key is really used', () => {
    expect(REFUSED_REGISTRY_META_KEYS).toContain('id');
    expect(CARRIED_REGISTRY_META_KEYS).not.toContain('id');
    // Every key on the carry list is a key the protocol actually publishes here.
    // A list that outgrew its surface reads as measured and is not.
    const unused = CARRIED_REGISTRY_META_KEYS.filter((k) => !census.keyPopulation.has(k));
    expect(
      unused,
      'a key on CARRIED_REGISTRY_META_KEYS no longer occurs anywhere on the published spec surface — ' +
        'it is being carried on a claim nothing re-derives',
    ).toEqual([]);
  });

  it('⚠️ the accessor census REACHES the proxies — carriage itself is pinned by the control below', () => {
    // ⛔ This is NOT "zero such nodes, therefore safe" — that was the first
    // round's assertion and it could never be non-empty, because it asked the
    // registry map about an object the registry has never heard of. It now asks
    // the accessor route, which is the one that answers.
    //
    // ⚠️ What the two assertions below provide is that the census REACHES
    // proxies at all, and that the paths it produced for the non-`description`
    // population are well formed. They do ⛔ NOT provide carriage, and this
    // test's title used to claim they did: the population is empty TODAY (every
    // metadata-bearing proxy carries `description` only), so an assertion over
    // it would assert over nothing and stay green whatever the carry did.
    //
    // Carriage is pinned by the hand-built proxy control further down —
    // `⭐ a PROXIED node's metadata survives the carry — and the map route would
    // have dropped it` — which puts a `title` on a proxied node and measures
    // that the carry reproduces it, and would have failed on the map route.
    for (const path of census.proxyNonDescriptionNodes.slice(0, 10)) {
      expect(typeof path, 'the census produced a malformed path').toBe('string');
    }
    expect(
      census.proxyNodes,
      'no proxy was reached at all — this assertion and the one above it are both vacuous',
    ).toBeGreaterThan(0);
  });
});

/* ── 3. hand-built controls, both sites, known to fire ────────────────────── */

describe('hand-built controls — each fires on the region it tests', () => {
  it('site ① — a `ZodDefault` member keeps `title` and `externalVocabulary` across the strip', () => {
    const src = z.object({
      k: z.string().default('x').meta({ description: 'D', title: 'T', externalVocabulary: 'V' }),
    });
    expect(defOf(defOf(src).shape!.k).type, 'the control does not exercise the `default` arm').toBe('default');

    const out = stripImportedDefaults(src);
    expect(defOf(defOf(out).shape!.k).type, 'the default survived the strip').not.toBe('default');
    expect(metaOf(defOf(out).shape!.k)).toMatchObject({ description: 'D', title: 'T', externalVocabulary: 'V' });
  });

  it('site ① — a rebuilt CONTAINER keeps its own metadata', () => {
    const src = z.object({ k: z.string().default('x') }).meta({ title: 'CONTAINER-T', xRef: 'CONTAINER-R' });
    const out = stripImportedDefaults(src);
    expect(out, 'the control does not exercise `cloneWithDef` — nothing was rebuilt').not.toBe(src);
    expect(metaOf(out)).toMatchObject({ title: 'CONTAINER-T', xRef: 'CONTAINER-R' });
  });

  it('site ② — a rebuilt container keeps its description and its metadata', () => {
    const src = z.object({ k: z.string().describe('LEAF') }).meta({ description: 'CONTAINER', title: 'T' });
    const out = deriveStrictAuthoringSchema(src);
    expect(out, 'the control does not exercise the rebuild — nothing was derived').not.toBe(src);
    expect(out.description).toBe('CONTAINER');
    expect(metaOf(out)).toMatchObject({ title: 'T' });
    expect(defOf(out).shape!.k.description, 'the leaf lost its own description').toBe('LEAF');
  });

  it('site ② — the `z.lazy` arm carries metadata too', () => {
    // The live population of described `z.lazy` nodes on this face is empty, so
    // this is a hand-built control rather than a census that would assert
    // nothing.
    const src = z.lazy(() => z.object({ k: z.string() })).meta({ description: 'LAZY', title: 'LT' });
    const out = deriveStrictAuthoringSchema(src);
    expect(defOf(out).type, 'the control does not exercise the `lazy` arm').toBe('lazy');
    expect(metaOf(out)).toMatchObject({ description: 'LAZY', title: 'LT' });
  });

  it('⛔ neither site emits `id`, and neither repoints `_idmap`', () => {
    const marker = `objectui-9102-carry-${Math.random().toString(36).slice(2)}`;
    const src = z.object({ k: z.string().default('x') }).meta({ id: marker, title: 'T' });
    expect(z.globalRegistry._idmap.get(marker), 'the source did not register its own id').toBe(src);

    for (const derived of [stripImportedDefaults(src), deriveStrictAuthoringSchema(src)]) {
      expect(derived, 'the control does not exercise a rebuild').not.toBe(src);
      expect(metaOf(derived)).toMatchObject({ title: 'T' });
      expect(metaOf(derived)?.id, 'a derivation emitted an `id`').toBeUndefined();
      expect(
        z.globalRegistry._idmap.get(marker),
        'the registry\'s id map now points at this package\'s derivation instead of the source',
      ).toBe(src);
    }
  });

  it('the carry INVENTS nothing where the source carried nothing', () => {
    const bare = z.string().optional();
    expect(carryRegistryMeta(z.string(), bare), 'a metadata-free source still produced a clone').toBe(bare);
    const src = z.object({ k: z.string().default('x') });
    expect(metaOf(stripImportedDefaults(src))).toBeUndefined();
  });

  it('⭐ a subtree with NO default comes back REFERENCE-EQUAL, metadata intact', () => {
    const src = z.object({ k: z.string().describe('INNER') }).meta({ title: 'IDENTITY' });
    expect(stripImportedDefaults(src)).toBe(src);
    expect(metaOf(stripImportedDefaults(src))).toMatchObject({ title: 'IDENTITY' });
  });

  it('⭐ a PROXIED node\'s metadata survives the carry — and the map route would have dropped it', () => {
    // The control that makes the proxy half of this file real rather than
    // descriptive. `@objectstack/spec`'s wrapper shape, reduced to the two traps
    // that matter: `get` resolves the real and BINDS functions to it, `ownKeys`
    // reflects the real. Everything the carry relies on is in those two lines.
    const real = z.object({ k: z.string() }).meta({ description: 'REAL-D', title: 'REAL-T' });
    const proxied = new Proxy(function lazyZod() {} as unknown as object, {
      get: (_t, prop) => {
        const value = (real as unknown as Record<string | symbol, unknown>)[prop];
        return typeof value === 'function' ? value.bind(real) : value;
      },
      has: (_t, prop) => prop in (real as unknown as object),
      ownKeys: () => Reflect.ownKeys(real as unknown as object),
      getOwnPropertyDescriptor: (_t, prop) =>
        Reflect.getOwnPropertyDescriptor(real as unknown as object, prop),
      getPrototypeOf: () => Reflect.getPrototypeOf(real as unknown as object),
    }) as unknown as z.ZodType;

    // The control fires only if the two routes really do disagree here.
    expect(isSpecLazyProxy(proxied), 'the hand-built wrapper is not proxy-shaped').toBe(true);
    expect(metaOf(proxied), 'the accessor route did not reach the real').toMatchObject({ title: 'REAL-T' });
    expect(
      metaViaRegistryMap(proxied)?.title,
      'the registry map can now see a proxy\'s own entry — the whole reason the carry reads `.meta()` is gone',
    ).toBeUndefined();

    // ⭐ And the carry reproduces it. On the map route this assertion fails.
    const carried = carryRegistryMeta(proxied, z.object({ k: z.string() }));
    expect(carried.description).toBe('REAL-D');
    expect(metaOf(carried)).toMatchObject({ description: 'REAL-D', title: 'REAL-T' });
  });

  it('⛔ `cloneWithDef` still preserves `def.checks` — the rule it existed for first', () => {
    const src = z.object({ k: z.string() }).refine((v) => v.k !== 'no', { message: 'refused' });
    const cloned = cloneWithDef(src, {});
    expect(cloned.safeParse({ k: 'yes' }).success).toBe(true);
    expect(cloned.safeParse({ k: 'no' }).success, 'the clone dropped a `.refine()`').toBe(false);
  });
});

/* ── 4. site ①, re-derived over the published spec surface ────────────────── */

describe('site ① — the import boundary conveys the protocol\'s metadata', () => {
  it('positive control — rebuilt nodes carrying metadata is a non-empty population', () => {
    expect(
      census.rebuiltWithMeta,
      'the walk rebuilt no node that carried carried-set metadata — the assertion below cannot fail',
    ).toBeGreaterThan(0);
  });

  it('⭐ not one rebuilt node loses a carried key', () => {
    // ⚠️ Both sides of this differential are read through `.meta()`. On the
    // registry-map route it was blind to every proxied node, which is why the
    // first round's version of this assertion stayed green with the carry's
    // accessor handling removed — the nodes that would have gone red were not
    // in its population. They are now: the proxy count is asserted non-empty,
    // and the accessor/map description gap is asserted positive.
    expect(census.rebuiltWithMetaLost.slice(0, 10)).toEqual([]);
    expect(census.rebuiltWithMetaKept).toBe(census.rebuiltWithMeta);
  });

  it('⭐ the emitted surface matches the protocol on the node the card named', async () => {
    // The card's own reading, re-derived through the emitter on both sides.
    // `default` is absent on this side ON PURPOSE — that is decision batch #90,
    // and this assertion is what keeps a metadata carry from quietly undoing it.
    const { PostgresConfigSchema } = (await import('@objectstack/spec/data')) as {
      PostgresConfigSchema: z.ZodType;
    };
    const spec = z.toJSONSchema(PostgresConfigSchema, { io: 'input' }) as {
      properties: Record<string, Record<string, unknown>>;
    };
    const mirrored = z.toJSONSchema(stripImportedDefaults(PostgresConfigSchema), { io: 'input' }) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(spec.properties.host, 'the spec no longer carries a title here — re-measure objectui#9102')
      .toMatchObject({ title: expect.any(String), description: expect.any(String) });
    expect(mirrored.properties.host).toMatchObject({
      title: spec.properties.host!.title,
      description: spec.properties.host!.description,
      type: spec.properties.host!.type,
    });
    expect(spec.properties.host, 'the control does not fire — the spec emits no default here').toHaveProperty('default');
    expect(
      mirrored.properties.host,
      'the import boundary re-emitted a `default` — decision batch #90 says this surface substitutes nothing',
    ).not.toHaveProperty('default');
  });

  it('⭐ every export with nothing to strip still comes back REFERENCE-EQUAL', () => {
    // ⭐ There used to be a second exclusion here, `&& !hasRestlessTuple(s)`, a
    // carve-out for objectui#9088. That card has landed and the exclusion is
    // DELETED, not narrowed — so the exports it used to excuse are back inside
    // this assertion and have to satisfy it like everything else.
    //
    // ⛔ It mattered more here than in the sibling pin, because this carve-out
    // carried NO expiry assertion: nothing required the excluded set to be
    // non-empty, so it could only ever come back green. Measured while it stood:
    // restoring the defect in the `tuple` arm left this entire file at 34/34
    // passing, exit 0 — blind to the exact defect objectui#9088 closed.
    const clean = census.roots.filter(([, s]) => !reaches(s, 'default'));
    const plain = clean.filter(([, s]) => !reaches(s, 'lazy'));
    expect(plain.length, 'no clean export outside the `lazy` exception — this assertion is vacuous').toBeGreaterThan(50);
    const broken = plain.filter(([, s]) => stripImportedDefaults(s) !== s).map(([n]) => n);
    expect(
      broken.slice(0, 10),
      'a clean subtree was rebuilt. Carrying metadata must never rebuild a node the walk did not already rebuild.',
    ).toEqual([]);
  });

  it('⭐ the rest-less tuples this file used to excuse are reference-equal (objectui#9088)', () => {
    // ⭐ The replacement for the deleted carve-out, and deliberately stronger
    // than removing the exclusion alone. Dropping the filter would leave this
    // population silently untested the day the spec stops publishing a rest-less
    // tuple; this asserts the population is NON-EMPTY *and* that every member
    // satisfies the property the carve-out used to suppress. It matches what
    // `imported-defaults-describe-9034.test.ts` now asserts, so the two pins
    // fail together rather than one covering for the other.
    const clean = census.roots.filter(([, s]) => !reaches(s, 'default'));
    const restless = clean.filter(([, s]) => !reaches(s, 'lazy') && hasRestlessTuple(s));
    expect(
      restless.length,
      'no clean export holds a rest-less tuple — objectui#9088\'s population is empty on this spec version, ' +
        'so this assertion proves nothing and the corpus needs re-deriving',
    ).toBeGreaterThan(0);

    const stillRebuilt = restless.filter(([, s]) => stripImportedDefaults(s) !== s).map(([n]) => n);
    expect(
      stillRebuilt.slice(0, 10),
      'a clean export holding a rest-less tuple was REBUILT — objectui#9088 has regressed: the `tuple` arm is ' +
        'normalising `def.rest` to `undefined` again, so `null === undefined` is false for every rest-less tuple',
    ).toEqual([]);

    // ⭐ PROVING REMOVAL: restore `: undefined` at the `tuple` arm's `const rest`
    // in `../zod/imported-defaults.ts` and this assertion reddens. While the
    // carve-out stood, that same mutation left this file entirely green.
  });

  it('⛔ the spec\'s own graph is left exactly as it was found — every node, both derivations', () => {
    // ⭐ A WHOLE-SURFACE DIFFERENTIAL, and the first round's version was not.
    // That one watched a side effect — "does the source still hold a default?"
    // — which a MUTATING carry does not disturb, so it stayed green under the
    // exact hazard it was named for. This compares each node's registry entry
    // (both routes), its `_zod.parent` and its def shape, snapshotted before
    // either derivation ran and re-read after both have run over every root.
    expect(
      census.snapshottedNodes,
      'nothing was snapshotted — this assertion is vacuous',
    ).toBeGreaterThan(5_000);
    expect(
      census.mutatedNodes.slice(0, 10),
      'a node of `@objectstack/spec`\'s own graph changed across a derivation. Every other consumer in the ' +
        'workspace shares these objects; a carry must clone, never write in place.',
    ).toEqual([]);

    // The side-effect reading is kept as a SEPARATE, weaker statement rather
    // than deleted, because "the defaults are still there" is worth saying and
    // is not what the sentence above claims.
    const carriers = census.roots.filter(([, s]) => reaches(s, 'default'));
    expect(carriers.length, 'nothing to check — this control does not fire').toBeGreaterThan(50);
    for (const [name, schema] of carriers.slice(0, 200)) {
      stripImportedDefaults(schema);
      expect(reaches(schema, 'default'), `${name} was stripped IN PLACE — every other consumer sees it`).toBe(true);
    }
  });
});

/* ── 5. site ②, re-derived over the published node face ───────────────────── */

interface FaceCensus {
  visited: number;
  described: number;
  describedKept: number;
  describedLost: string[];
}

const faceCensus = ((): FaceCensus => {
  const strict = deriveStrictAuthoringSchema(SchemaNodeSchema);
  const seen = new Set<z.ZodType>();
  let visited = 0;
  let described = 0;
  let describedKept = 0;
  const describedLost: string[] = [];
  const pair = (b: z.ZodType, a: z.ZodType, path: string, depth: number): void => {
    if (depth > 40 || seen.has(b)) return;
    seen.add(b);
    visited++;
    if (b.description !== undefined) {
      described++;
      if (isZod(a) && a.description === b.description) describedKept++;
      else describedLost.push(`${path} [${defOf(b).type}] ${JSON.stringify(b.description)}`);
    }
    const aMap = new Map(isZod(a) ? childrenOf(a) : []);
    for (const [label, child] of childrenOf(b)) {
      const twin = aMap.get(label);
      if (twin) pair(child, twin, `${path}${label}`, depth + 1);
    }
  };
  pair(SchemaNodeSchema as unknown as z.ZodType, strict as unknown as z.ZodType, '#', 0);
  return { visited, described, describedKept, describedLost };
})();

describe('site ② — the strict authoring face conveys what it derives from', () => {
  it('positive control — the face is large and really does declare descriptions', () => {
    expect(faceCensus.visited, 'the walk barely moved — the assertion below is vacuous').toBeGreaterThan(1_000);
    expect(
      faceCensus.described,
      'no described node on the node face — site ② has nothing to lose and this file cannot fail',
    ).toBeGreaterThan(500);
  });

  it('⭐ not one described node loses its description across the derivation', () => {
    // Before objectui#9102 this face kept only the descriptions on the leaves it
    // returned untouched: every container it rebuilt — which is every container
    // it walks — arrived on the twin with none.
    expect(faceCensus.describedLost.slice(0, 10)).toEqual([]);
    expect(faceCensus.describedKept).toBe(faceCensus.described);
  });

  it('⛔ the node face itself is left exactly as it was found', () => {
    const before = SchemaNodeSchema.description;
    deriveStrictAuthoringSchema(SchemaNodeSchema);
    expect(SchemaNodeSchema.description).toBe(before);
  });
});

/* ── 6. one helper, not two ───────────────────────────────────────────────── */

describe('⭐ both sites derive through ONE helper (objectui#9102)', () => {
  const read = (rel: string): string => readFileSync(join(SRC_DIR, rel), 'utf8');
  const SITES: [string, string][] = [
    ['the import boundary', 'zod/imported-defaults.ts'],
    ['the strict authoring face', 'strict-authoring-face.ts'],
  ];

  it.each(SITES)('%s imports the shared derivation helper', (_label, rel) => {
    expect(read(rel)).toMatch(/from '\.{1,2}\/?(zod\/)?node-derivation\.js'/);
  });

  it.each(SITES)('⛔ %s declares no local `cloneWithDef` of its own', (_label, rel) => {
    // The acceptance item objectui#9102 was filed on: one site was widened,
    // the other kept its copy, and the copy is invisible at every call site.
    expect(
      read(rel).match(/^\s*(const|function)\s+cloneWithDef\b/m),
      'this site re-declared its own clone helper. The metadata carry is invisible at the call site, so a ' +
        'second copy loses it again with no symptom — which is exactly how these two drifted apart.',
    ).toBeNull();
  });

  it('⭐ the shared helper is the ONLY declaration of it in the package — scanned, not assumed', () => {
    // The first round read one file and asserted the declaration EXISTS, under
    // a name that promised absence everywhere else. Absence is a property of
    // the tree, so the tree is what gets walked.
    const DECL = /^\s*(?:export\s+)?(?:const|function)\s+cloneWithDef\b/m;
    const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
    const declarers: string[] = [];
    let scanned = 0;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) continue;
        scanned += 1;
        if (DECL.test(readFileSync(full, 'utf8'))) declarers.push(full.slice(SRC_DIR.length + 1));
      }
    };
    walk(SRC_DIR);

    expect(scanned, 'the scan found almost no source files — it is pointed at the wrong tree').toBeGreaterThan(100);
    expect(
      declarers.sort(),
      'there is more than one `cloneWithDef` declaration in this package, or the shared one has moved. ' +
        'A second copy is invisible at every call site and loses the metadata carry with no symptom.',
    ).toEqual(['zod/node-derivation.ts']);
  });
});
