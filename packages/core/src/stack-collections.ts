// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 / option B — resolving a package-owned collection off a stack,
 * whatever shape that stack arrived in: the top-level list when the stack
 * carries one, otherwise each package body's, in package order.
 *
 * ## Why this lives in `@objectstack/core`
 *
 * It started life in `@objectstack/cli` (`src/utils/stack-collections.ts`,
 * which keeps every CLI-only predicate built on it and re-exports these), and
 * every `os` command reads through it. The `requires` reader then gained a
 * reader outside the CLI: `@objectstack/verify`'s `bootStack` mounts the
 * providers an app's `requires` names, and it has to read `requires` by the
 * SAME rule `os serve` does, or a multi-package app would boot one set of
 * providers under `serve` and another under its own tests. `@objectstack/cli`
 * depends on `@objectstack/verify`, so the handle cannot import the CLI; both
 * already depend on `@objectstack/core`, which owns the package ordering this
 * rule is built on (`resolveArtifactPackageOrder`). Hosting it here adds NO
 * package edge — ⛔ never a second copy of the rule beside a reader.
 *
 * ## The resolution rule, and why it is strictly additive
 *
 * `resolveStackCollection` answers with the top-level array FIRST and only then
 * consults `packages[]`. In the additive shape that array already IS the union
 * (`composeStacks` flattened it), so unioning again would double every item.
 * (The CLI module header carries the history of the four config-load boundaries
 * that made this the one reader.)
 */

import { resolveArtifactPackageOrder } from './artifact-packages.js';

type Bag = Record<string, unknown>;

const asBag = (value: unknown): Bag | undefined =>
  value && typeof value === 'object' ? (value as Bag) : undefined;

/**
 * A stack's `packages` value, judged ONCE for every reader in this package that
 * walks it: the entries, by position, or `[]` when the key is absent.
 *
 * ## A present non-array `packages` is refused, never read as "no packages"
 *
 * A `packages` that is present but is not an array (`{}`, `0`, `'x'`) is
 * MALFORMED, not absent (ruling A on #15293). The rule is stated once, beside
 * `AssembledPackageBodySchema` (`@objectstack/spec`, `stack.zod.ts`), and it is
 * enforced by `resolveArtifactPackageOrder` (`@objectstack/core`), which
 * refuses the value as `INVALID_ARTIFACT_PACKAGES` (ADR-0112, `status: 422`).
 * The runtime, `@objectstack/core` and the plugin readers already refuse it.
 * This package's readers used to answer "no packages" instead (#19925): `os
 * info` printed `0` objects for such a stack and `os lint` passed it. So this
 * function spells neither the rule nor the refusal. It hands a non-array value
 * to the resolver, and the refusal the author sees is the resolver's own.
 *
 * - The key ABSENT (`undefined`) answers `[]`. This is the only value the
 *   function answers on its own.
 * - An array is returned BY REFERENCE and unparsed. The docs readers need
 *   entries by POSITION (`packages[i]` is where collected docs attach), and the
 *   resolver answers bodies in LOAD order, so they cannot read its result.
 *   Parsing each entry is the resolver's job on the path that registers
 *   packages ({@link stackPackageBodies} reaches it). Adding that parse to the docs
 *   readers would widen what they refuse, and that is a separate change.
 * - Every other value goes to the resolver, `null` included. A non-array is
 *   refused there.
 *
 * ## `null` follows the resolver, and is never judged here
 *
 * Ruling A on #19926 (`5805260775`) settles `null`: it is malformed at every
 * reader, and `resolveArtifactPackageOrder` drops its `null` branch. That core
 * change lands separately (#19926), and until it does, the resolver still
 * answers `null` through its ABSENT branch. So this function does not answer
 * `null` itself. It asks the resolver and reads the answer:
 *
 * - The resolver's absent answer is `[artifact]`, holding the caller's own
 *   object BY REFERENCE (ADR-0130 D4, second branch). This function recognises
 *   that answer by IDENTITY against the object it passed in, and returns `[]`.
 *   That is today's answer for `null`, byte for byte.
 * - Once the resolver refuses `null`, its `INVALID_ARTIFACT_PACKAGES` reaches
 *   every reader here, with no edit to this package.
 *
 * ⛔ Never add a private `null` branch here, in either direction. Answering
 * `null` as absent here would keep the CLI reading it as absent after the
 * resolver starts refusing it. Refusing it here would be a second copy of a
 * rule the resolver owns.
 *
 * ⛔ Never put an `Array.isArray` in front of this function as a fall-through
 * to "no packages". That silent answer is exactly what this function removes.
 *
 * @throws Whatever the resolver raises for a present non-array `packages`:
 *   today `INVALID_ARTIFACT_PACKAGES` for every non-array except `null`.
 */
export function declaredPackageEntries(packages: unknown): readonly unknown[] {
  // The key is absent: there is nothing to judge.
  if (packages === undefined) return [];
  if (Array.isArray(packages)) return packages;
  // Present and not an array, `null` included: the resolver decides.
  const probe = { packages };
  const answer = resolveArtifactPackageOrder(probe);
  // The resolver's ABSENT answer holds the probe itself, by reference.
  if (answer.length === 1 && answer[0] === probe) return [];
  // Reached only if the resolver answers a non-array with anything but a
  // refusal or its absent answer. An empty answer here would bring back the
  // silent fall-through, so fail loudly.
  throw new Error(
    `resolveArtifactPackageOrder accepted a \`packages\` of type ${packages === null ? 'null' : typeof packages}; `
    + 'the stack collection readers cannot walk it by position.',
  );
}

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
 *
 * A `packages` that is present but is not an array goes through
 * {@link declaredPackageEntries}, which hands it to the resolver: it is refused,
 * or, for `null` while the resolver still reads it as absent, answered `[]`.
 */
export function stackPackageBodies(stack: unknown): Array<Record<string, unknown>> {
  if (declaredPackageEntries(asBag(stack)?.packages).length === 0) return [];
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
export function collectFromPackageBodies(bodies: readonly Record<string, unknown>[], key: string): unknown[] {
  const out: unknown[] = [];
  for (const body of bodies) {
    const value = body[key];
    if (Array.isArray(value)) out.push(...value);
  }
  return out;
}

/** {@link collectFromPackageBodies} for a caller that has a stack and asks about one key. */
function packageCollection(stack: unknown, key: string): unknown[] {
  return collectFromPackageBodies(stackPackageBodies(stack), key);
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
 * The capability tokens a stack DECLARES in `requires`, by
 * {@link resolveStackCollection}'s rule: the top-level list when the stack
 * carries one, otherwise every package body's, in package order. String
 * entries only, duplicates kept (each caller dedupes in its own order).
 *
 * A multi-package `composeStacks(…, { manifest: 'preserve' })` stack carries
 * `requires` only inside the body of the package that declared it (ADR-0130
 * D4, 2026-09-22 addendum). A reader of the top level alone read `[]` there:
 * `os serve` did not mount the provider a package declared, `os migrate plan`
 * could not order a plugin that hard-depends on it, and `os generate` told the
 * author to declare a token a package already declares (#22288). The build
 * doors attribute each token to its package instead
 * (`preflightDeclaredCapabilities`), on the same rule, and `@objectstack/verify`'s
 * `bootStack` mounts the providers it names (#22301).
 */
export function stackDeclaredCapabilities(stack: unknown): string[] {
  return resolveStackCollection(stack, 'requires').filter((token): token is string => typeof token === 'string');
}
