// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os build`'s compile-time half of the #14553 ruling — the group id a
 * `navigationContributions[]` entry names, checked where an AI author sees it
 * first.
 *
 * ## Why the check lives here and not in `composeStacks`
 *
 * Maintainer ruling, 2026-09-02 (verbatim: 「同意」): "when the contributing
 * package and the target app are composed into one artifact (`composeStacks`),
 * `os build` checks the group id at compile time and reports the same
 * diagnostic loudly there". The ruled location is the build STEP, and it is
 * also the only one that can be right: `composeStacks` is a spec-level
 * composition used by `os dev`, `os validate` and every embedder, whereas the
 * question "did this author aim a contribution at a group that exists?" is a
 * report, not a composition rule. Nothing here refuses — the runtime still
 * relocates, deliberately (option A was weighed and not taken) — so a
 * composition function is the wrong place to raise it.
 *
 * ## Why not an `@objectstack/lint` authoring rule
 *
 * `runAuthoringRules` hands a rule ONE stack (`run(stack, ctx)`), and every
 * member of that table reads one. This question is cross-package by
 * construction: the group id is declared by package A's app and named by
 * package B's manifest, so the per-package walk in `compile.ts` sees neither
 * half on its own and only the artifact does. Adding an artifact-aware member
 * to a single-stack rule table is a larger platform change than the ruling
 * asked for, and `compile.ts` already owns the artifact layer (`artifactPackages`,
 * the capability preflight, the docs sweep).
 *
 * ## Why the predicate is imported and not written here
 *
 * {@link checkNavContributionGroups} is `@objectstack/objectql`'s, the same
 * function `SchemaRegistry.applyNavContributions` folds through. A second copy
 * of "does this group resolve?" would let the build call an aim fine that the
 * runtime relocates — the exact silent divergence the card is about, one layer
 * up. Loaded LAZILY, and only for a stack that actually declares a
 * contribution: `os build`'s cold path should not pull the data engine in to
 * judge two empty arrays.
 *
 * ## Why the findings ride the declared `warnings` key, and why BOTH commands
 * ## compute them
 *
 * The first cut gave `os build --json` a new top-level
 * `navigationGroupDiagnostics` key. Two standing pins caught it —
 * `build-json-advisory-parity.e2e.test.ts` and
 * `build-json-undeclared-key-parity.e2e.test.ts`, both titled "adds NO new
 * top-level key to the payload — this fills a declared key, it is not a new
 * surface". #11643 and #11727 each faced the same choice and filled
 * `warnings`; that payload's shape is MIRRORED from `os validate --json` so a
 * consumer reads one shape per class from either command rather than learning
 * two.
 *
 * A third pin in the same file settles the other half: the ONLY permitted
 * residue between the two payloads is the structural advisory set, and
 * "nothing rides in build that validate does not also report". Folding these
 * into build's `warnings` alone would therefore have turned THAT pin red. So
 * both commands compute them — which is the better answer on its own terms
 * too: an author running `os validate` sees the mis-aim exactly as one running
 * `os build` does.
 */

import type { NavContributionGroupDiagnostic } from '@objectstack/objectql';

type AnyRec = Record<string, unknown>;

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRec = (v: unknown): AnyRec | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRec) : undefined;

/** One artifact package, in the `{ id, body }` shape the commands walk. */
export interface CompiledPackage {
  readonly id: string;
  readonly body: AnyRec;
}

/**
 * The artifact's package entries, derived from the PARSED stack.
 *
 * Mirrors `compile.ts`' `artifactPackages` id rule — `manifest.id`, falling
 * back to `name`, then to the positional spelling — because that is the string
 * the runtime registers a contribution under, so a command names a package the
 * same way the fold does. Derived here rather than passed in, so both commands
 * reach the check through ONE call that needs only the parsed stack.
 */
export function artifactPackagesOf(parsed: AnyRec): CompiledPackage[] {
  return asArray(parsed.packages).map((entry, index) => {
    const body = asRec((entry as { manifest?: unknown })?.manifest) ?? {};
    const id = typeof body.id === 'string' && body.id !== ''
      ? body.id
      : (typeof body.name === 'string' && body.name !== '' ? body.name : `packages[${index}]`);
    return { id, body };
  });
}

/**
 * The apps and the contributions visible in ONE compilation unit.
 *
 * ⚠️ The top-level manifest is read only when the stack carries no `packages[]`.
 * `composeStacks(…, { manifest: 'preserve' })` is additive: it flattens every
 * collection to the top level AND still picks a singular `manifest` by the
 * default `'last'` rule, so on an artifact the top-level
 * `manifest.navigationContributions` is a COPY of one package's — reading both
 * would report that package's mis-aim twice, once without a package id.
 */
export function collectNavGroupInputs(
  parsed: AnyRec,
  packages: readonly CompiledPackage[],
): {
  apps: Array<{ name?: unknown; navigation?: unknown }>;
  contributions: Array<{ app?: unknown; group?: unknown; items?: unknown; packageId?: string }>;
} {
  const apps: Array<{ name?: unknown; navigation?: unknown }> = [];
  const seenApps = new Set<string>();
  const addApps = (list: unknown) => {
    for (const entry of asArray(list)) {
      const app = asRec(entry);
      if (!app || typeof app.name !== 'string' || seenApps.has(app.name)) continue;
      seenApps.add(app.name);
      apps.push({ name: app.name, navigation: app.navigation });
    }
  };

  const contributions: Array<{ app?: unknown; group?: unknown; items?: unknown; packageId?: string }> = [];
  const addContributions = (list: unknown, packageId?: string) => {
    for (const entry of asArray(list)) {
      const c = asRec(entry);
      if (!c) continue;
      contributions.push({
        app: c.app,
        group: c.group,
        items: c.items,
        ...(packageId === undefined ? {} : { packageId }),
      });
    }
  };

  // The flattened top level — present on every stack, artifact or not.
  addApps(parsed.apps);

  if (packages.length > 0) {
    for (const pkg of packages) {
      // An assembled package body IS its own manifest (`compile.ts`'
      // `packageBodyAsStack`), so both collections read off the top of it.
      addApps(pkg.body.apps);
      // `id` is the artifact's own package key (`manifest.id`, falling back to
      // `name`), which is the string the runtime registers the contribution
      // under — so the build names the package the same way the fold does.
      addContributions(pkg.body.navigationContributions, pkg.id);
    }
  } else {
    const manifest = asRec(parsed.manifest);
    const packageId = typeof manifest?.id === 'string'
      ? manifest.id
      : (typeof manifest?.name === 'string' ? manifest.name : undefined);
    addContributions(manifest?.navigationContributions, packageId);
  }

  return { apps, contributions };
}

/**
 * Every contribution in this compilation unit whose `group` names no group in
 * the target app — the same finding, in the same words, the runtime fold
 * raises when it relocates one.
 *
 * Returns `[]` without loading `@objectstack/objectql` when the stack declares
 * no contributions at all, which is the overwhelming majority of builds.
 */
export async function findNavGroupDiagnostics(
  parsed: AnyRec,
  packages: readonly CompiledPackage[] = artifactPackagesOf(parsed),
): Promise<NavContributionGroupDiagnostic[]> {
  const { apps, contributions } = collectNavGroupInputs(parsed, packages);
  if (contributions.length === 0 || apps.length === 0) return [];
  const { checkNavContributionGroups } = await import('@objectstack/objectql/core');
  return checkNavContributionGroups(apps, contributions);
}
