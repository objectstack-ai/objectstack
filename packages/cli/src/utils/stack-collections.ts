// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 / option B — the ONE place `@objectstack/cli` resolves a
 * package-owned collection off a stack, whatever shape that stack arrived in.
 *
 * ## The failure this module exists to remove
 *
 * A multi-package artifact today serializes every definition TWICE: flattened
 * to the top level, and again inside `packages[i].manifest`. Option B (ruled on
 * #14512 comment 5528589044, maintainer 2026-09-03) removes the flattened copy,
 * so `packages[]` carries each definition exactly once. The ruled order is
 * READERS FIRST, emitter last: every reader learns to resolve `packages[]`
 * while the artifact stays additive.
 *
 * This package holds FOUR independent config-load boundaries (#14512 comment
 * 5523741937) — `os serve`/`os dev`'s `bundleRequire` (B2), `os build`'s
 * `loadConfig` (B3), `os migrate`'s own second `loadConfig` (B4), and the
 * artifact `dev.ts` re-opens for its recompile diff. Each of them then drives
 * reads that were, until this module, INLINE EXPRESSIONS inside oclif command
 * bodies. Two of those are the sharpest silent failures in the whole program:
 *
 * ```ts
 * if (config.objects && !hasObjectQL) { … }   // serve.ts — ObjectQL engine
 * if (!hasDriver && config.objects)  { … }    // serve.ts — storage driver
 * ```
 *
 * With the flattened top level gone, `config.objects` is `undefined`, both
 * gates are simply false, and the app boots **with no query engine and no
 * storage driver, having thrown nothing**. `createStandaloneStack`
 * (`standalone-stack.ts`) OMITS the `objects` key entirely when the array is
 * absent — not `[]` — and `mergeBootConfig` is a plain spread, so nothing
 * between the artifact and the gate can notice.
 *
 * ## Why a module, and not six one-line fixes
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * 1. One resolution rule, declared once. Six inline reads are six chances to
 *    write a seventh spelling of it.
 * 2. **A pin can only attach to a callable.** The acceptance probe
 *    (`test/option-b-reader-acceptance.pin.test.ts`, #15004) measures readers
 *    by CALLING them; an expression inside a 6,000-line command body is
 *    reachable only by running the command, which is why those four reads sat
 *    outside the probe's 24-row ledger while every runtime and plugin-security
 *    reader sat inside it (#15006 comment 5530257178). The exports below are
 *    that seam. ⛔ Note what the probe may NOT do instead: assert
 *    `config.objects` is non-empty on an option-B config. A row shaped like the
 *    read it watches stays red after that read is fixed, and a gate that cannot
 *    go green gets deleted. The rows call THESE functions.
 *
 * ## The resolution rule, and why it is strictly additive
 *
 * Every predicate here answers with the CALLER'S ORIGINAL EXPRESSION FIRST and
 * only then consults `packages[]`:
 *
 * ```ts
 * if (stack.objects) return true;                       // byte-identical to the old gate
 * return packageCollection(stack, 'objects').length > 0; // the option-B leg, new
 * ```
 *
 * That ordering is not stylistic. `config.objects` is truthy for an EMPTY array
 * too, so a stack that declares `objects: []` registers an engine and a driver
 * today. Re-expressing the gate as `resolveStackCollection(...).length > 0`
 * would have quietly stopped doing that — reintroducing "boots with no query
 * engine" in a different case, which is the exact defect this module removes.
 * The old truthiness is therefore PRESERVED rather than endorsed, and no config
 * that boots today can take a different branch because of this module.
 *
 * Package ORDER comes from `resolveArtifactPackageOrder` (`@objectstack/core`,
 * #14643) — the same dependency-topological order the manifest service
 * registers in — never re-derived here. Its ADR-0112 refusals for a malformed
 * `packages` are deliberately NOT swallowed: they are reachable only once the
 * caller's own expression has already come back falsy, i.e. only on the shape
 * that boots silently broken today, and a named 422 is strictly better than
 * that silence.
 */

import { resolveArtifactPackageOrder } from '@objectstack/core';
import { AssembledPackageBodySchema, ObjectStackDefinitionSchema } from '@objectstack/spec';

type Bag = Record<string, unknown>;

const asBag = (value: unknown): Bag | undefined =>
  value && typeof value === 'object' ? (value as Bag) : undefined;

/**
 * The assembled package bodies this stack carries, in dependency-topological
 * order — or `[]` when it carries no `packages` list of its own.
 *
 * `resolveArtifactPackageOrder` answers `[artifact]` for a stack with no
 * `packages` key (ADR-0130 D4, second branch: the caller's own object IS the
 * one package's body). That answer is correct there and useless here — folding
 * a stack's own top level back onto itself resolves nothing — so this returns
 * an empty list for that case, and every caller below reads the top level
 * first anyway.
 */
function packageBodies(stack: unknown): Bag[] {
  const declared = asBag(stack)?.packages;
  if (!Array.isArray(declared) || declared.length === 0) return [];
  return (resolveArtifactPackageOrder(stack) as unknown[])
    .map(asBag)
    .filter((b): b is Bag => b !== undefined);
}

/**
 * One collection, concatenated across already-resolved bodies.
 *
 * ⚠️ The TOP LEVEL IS NOT CONSULTED — this is the option-B leg only. Callers
 * that must preserve today's answer read their own expression first; see
 * {@link resolveStackCollection} for the combined form.
 *
 * Takes the BODIES rather than the stack so a caller asking about several keys
 * resolves the package list once. `resolveArtifactPackageOrder` parses every
 * entry whole, and `authoringRuleUnionStack` asks about all 37 collections —
 * re-resolving per key would run that parse 37 times on every `os build`.
 */
function collectFrom(bodies: readonly Bag[], key: string): unknown[] {
  const out: unknown[] = [];
  for (const body of bodies) {
    const value = body[key];
    if (Array.isArray(value)) out.push(...value);
  }
  return out;
}

/** {@link collectFrom} for a caller that has a stack and asks about one key. */
function packageCollection(stack: unknown, key: string): unknown[] {
  return collectFrom(packageBodies(stack), key);
}

/**
 * The effective value of one package-owned collection.
 *
 * The top-level array WINS whenever the key is present — in today's additive
 * shape that array already IS the union (`composeStacks` flattened it), so
 * unioning again would double every item. `packages[]` is consulted only when
 * the top level does not carry the key at all, which is precisely the option-B
 * shape.
 */
export function resolveStackCollection(stack: unknown, key: string): unknown[] {
  const top = asBag(stack)?.[key];
  if (Array.isArray(top)) return top;
  return packageCollection(stack, key);
}

/**
 * Does this stack declare any objects?
 *
 * The predicate behind BOTH `os serve` auto-registration gates. See the module
 * header for why the caller's original truthiness is preserved verbatim as the
 * first clause.
 */
function declaresObjects(stack: unknown): boolean {
  if (asBag(stack)?.objects) return true;
  return packageCollection(stack, 'objects').length > 0;
}

/** Does `plugins[]` already carry an ObjectQL engine? (`serve.ts` step 1.) */
function hasObjectQLPlugin(plugins: readonly unknown[]): boolean {
  return plugins.some((p) => {
    const plugin = asBag(p);
    const name = plugin?.name;
    const ctor = (plugin?.constructor as { name?: string } | undefined)?.name;
    return (typeof name === 'string' && name.includes('objectql'))
      || (typeof ctor === 'string' && ctor.includes('ObjectQL'));
  });
}

/**
 * Does `plugins[]` already provide a storage driver? (`serve.ts` step 2.)
 *
 * A `DefaultDatasourcePlugin` counts (#3826): the standalone stack DECLARES its
 * `default` datasource and connects it at boot through the datasource
 * connection service, so building a storage driver beside it would construct a
 * duplicate pool the engine then discards as already-registered.
 */
function hasStorageDriverPlugin(plugins: readonly unknown[]): boolean {
  return plugins.some((p) => {
    const plugin = asBag(p);
    const name = plugin?.name;
    const ctor = (plugin?.constructor as { name?: string } | undefined)?.name;
    return (typeof name === 'string' && (name.includes('driver') || name === 'com.objectstack.runtime.default-datasource'))
      || (typeof ctor === 'string' && (ctor.includes('Driver') || ctor === 'DefaultDatasourcePlugin'));
  });
}

/**
 * `os serve` step 1 — should this boot auto-register the ObjectQL engine?
 *
 * ⚠️ The answer is the WHOLE gate, not just the collection read: a probe that
 * measured `config.objects` would report a number while the boot still ended up
 * with no engine. What silently fails is the DECISION, so the decision is what
 * this seam publishes.
 */
export function shouldAutoRegisterObjectQL(stack: unknown, plugins: readonly unknown[]): boolean {
  return declaresObjects(stack) && !hasObjectQLPlugin(plugins);
}

/** `os serve` step 2 — should this boot auto-register a storage driver? */
export function shouldAutoRegisterStorageDriver(stack: unknown, plugins: readonly unknown[]): boolean {
  return declaresObjects(stack) && !hasStorageDriverPlugin(plugins);
}

/**
 * Does this config carry app metadata that needs an `AppPlugin` wrap?
 *
 * `serve.ts` step 3 and `schema-migration-plugins.ts`' own second `loadConfig`
 * (B4) ran two copies of this expression; the comment on the second one already
 * said "`serve` step 3, same predicate", so the two are folded here rather than
 * left to drift.
 *
 * ⚠️ Measured, on the acceptance probe's option-B fixture: this predicate does
 * NOT lose today. `manifest` is an artifact-ENVELOPE key, so it survives the
 * flattening removal and keeps the gate true. It is folded in anyway because it
 * is the master gate for every collection `AppPlugin` then reads — if it ever
 * went false the whole B2 family would go silent at once — and because the
 * probe cannot watch an expression that is not callable.
 */
export function stackDeclaresMetadata(stack: unknown): boolean {
  const bag = asBag(stack);
  if (bag?.objects || bag?.manifest || bag?.apps || bag?.flows || bag?.apis) return true;
  const bodies = packageBodies(stack);
  return ['objects', 'apps', 'flows', 'apis']
    .some((key) => collectFrom(bodies, key).length > 0);
}

/**
 * Does this bundle carry translations, so `os serve` auto-registers the i18n
 * service plugin?
 *
 * Reads the top-level config AND any nested `AppPlugin` bundle — a host or
 * aggregator config may define no translations of its own and instead compose
 * several `new AppPlugin(...)` entries, each carrying its own. Keyed on that
 * SHAPE, never on a named app.
 *
 * ⚠️ Measured: this one DOES lose. `translations` is package-owned, `i18n` is an
 * envelope key that a translations-only stack never sets, so an option-B
 * artifact reaches the gate with neither and the REST i18n routes silently do
 * not exist.
 */
export function bundleDeclaresTranslations(bundle: unknown): boolean {
  const bag = asBag(bundle);
  if (!bag) return false;
  if (Array.isArray(bag.translations) && bag.translations.length > 0) return true;
  if (bag.i18n) return true;
  const manifest = asBag(bag.manifest);
  if (manifest && ((Array.isArray(manifest.translations) && manifest.translations.length > 0) || manifest.i18n)) {
    return true;
  }
  const bodies = packageBodies(bundle);
  if (collectFrom(bodies, 'translations').length > 0) return true;
  return bodies.some((body) => !!body.i18n);
}

/**
 * The object-name inventory of a compiled artifact, as `os dev` diffs it across
 * recompiles.
 *
 * @param raw - The artifact exactly as `JSON.parse(readFileSync(...))` returns
 *   it. The envelope unwrap stays here, in the seam, because `dev.ts` opens the
 *   artifact with its OWN `readFileSync` + `JSON.parse` rather than going
 *   through `loadArtifactBundle` — that copy is itself one of the enumerated
 *   boundaries (#14512 comment 5523741937) and is not folded by this card.
 *
 * Non-fatal at the call site: losing this inventory does not break a boot, it
 * makes `os dev` stop telling the author that a new `*.object.ts` appeared —
 * the exact silence the 15.1 third-party eval flagged, where "recompiled" read
 * as all-green while the new object's table and seed sync were invisible.
 */
export function artifactObjectNames(raw: unknown): string[] {
  const bag = asBag(raw);
  const meta = asBag(bag?.metadata) ?? asBag(asBag(bag?.data)?.metadata) ?? bag;
  return resolveStackCollection(meta, 'objects')
    .map((o) => asBag(o)?.name)
    .filter((n): n is string => typeof n === 'string');
}

/**
 * Every top-level key that is a PACKAGE-OWNED collection, derived from the two
 * schemas rather than transcribed.
 *
 * `ObjectStackDefinitionSchema` ∩ `AssembledPackageBodySchema` is precisely
 * "the collections a package owns" — the complement is the seven artifact
 * envelope keys (`manifest`, `packages`, `api`, `server`, `i18n`,
 * `runtimeModule`, `onEnable`) that an option-B artifact still carries at its
 * top level. `packages/spec/src/assembled-package-body.test.ts` classifies the
 * same two sets the same way.
 *
 * ⛔ Not hand-listed, in either direction. A transcription would fail SILENTLY
 * and in the worst direction — a metadata family added to the stack schema next
 * month would sit outside the fold, so `os build` would judge an option-B stack
 * that is missing exactly that family and report zero findings about it.
 * (#14877 is to publish this key set as an export; when it lands, this function
 * should read it instead of deriving it, and nothing else here changes.)
 *
 * Computed on first use, never at module load: both schemas are lazy proxies
 * and touching `.shape` forces the whole graph, which the CLI pays for on every
 * invocation if it happens at import time.
 */
let cachedCollectionKeys: readonly string[] | undefined;
function packageOwnedCollectionKeys(): readonly string[] {
  if (cachedCollectionKeys) return cachedCollectionKeys;
  const bodyKeys = new Set(shapeKeys(AssembledPackageBodySchema, 'AssembledPackageBodySchema'));
  cachedCollectionKeys = shapeKeys(ObjectStackDefinitionSchema, 'ObjectStackDefinitionSchema')
    .filter((key) => bodyKeys.has(key));
  return cachedCollectionKeys;
}

/**
 * The declared keys of a Zod object schema.
 *
 * Loud rather than empty when the shape cannot be read: an empty key set here
 * would make {@link authoringRuleUnionStack} a no-op that still returns a
 * plausible stack, i.e. `os build` would go back to judging an empty option-B
 * stack and reporting a clean bill of health for it.
 */
function shapeKeys(schema: unknown, name: string): string[] {
  const shape = (schema as { shape?: unknown } | undefined)?.shape;
  if (!shape || typeof shape !== 'object') {
    throw new Error(
      `${name} exposes no \`shape\`, so the package-owned collection key set cannot be derived. `
      + 'This is a @objectstack/spec contract change, not a caller mistake — `os build` refuses '
      + 'rather than silently judging a multi-package stack as if it declared nothing.',
    );
  }
  return Object.keys(shape as Bag);
}

/**
 * The stack `os build`'s UNION author-time rule run judges (`compile.ts` step
 * 3b), with every collection the top level no longer carries folded back in
 * from `packages[]`.
 *
 * ## Why the union run needs this and the per-package run does not
 *
 * `compile.ts` runs the rule table twice: once over the union (step 3b) and
 * once per package (step 3b-ii, which already reads `packages[]` and is
 * therefore already option-B correct). The two answer different questions —
 * the per-package run is STRICTER, and the union run is the only one that can
 * see a finding which spans packages. Under option B the union run's input is
 * an empty stack, so every cross-package rule reports nothing and `os build`
 * publishes green. That is the weakest-gate failure #4409 was filed for,
 * arriving a second time through a different door.
 *
 * ⛔ This changes what the rules JUDGE, never what the command EMITS. The
 * artifact is written from `lowering.lowered` / `result.data`; the folded stack
 * is a rule INPUT and reaches no writer. The card that introduced it
 * (#15006) is explicit that the artifact stays additive through the reader
 * half of the program.
 *
 * A stack whose top level still carries its collections — every stack the
 * platform emits today — is returned UNCHANGED, by identity: the fold only ever
 * fills keys that are absent.
 */
export function authoringRuleUnionStack<T extends Bag>(stack: T): T {
  const bodies = packageBodies(stack);
  if (bodies.length === 0) return stack;

  let folded: Bag | undefined;
  for (const key of packageOwnedCollectionKeys()) {
    if (stack[key] !== undefined && stack[key] !== null) continue;
    const items = collectFrom(bodies, key);
    if (items.length > 0) {
      folded ??= { ...stack };
      folded[key] = items;
      continue;
    }
    // `functions` is the one package-owned collection carried as a RECORD
    // rather than an array — merged in package order, so a later package's
    // entry wins the same way a concatenated array's later element does.
    const records = bodies
      .map((body) => body[key])
      .filter((value): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value));
    if (records.length > 0) {
      folded ??= { ...stack };
      folded[key] = Object.assign({}, ...records) as Bag;
    }
  }
  return (folded ?? stack) as T;
}
