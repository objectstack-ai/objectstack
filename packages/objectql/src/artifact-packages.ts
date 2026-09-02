// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 + D5 — reading a release artifact's package list, and ordering it.
 *
 * A release artifact MAY carry N package manifests (ADR-0130 D1: everything
 * inside one artifact is delivered atomically by one publisher, and that joint
 * delivery IS the co-ownership declaration). This module is the ONE place that
 * turns an artifact — either shape — into the ordered list of manifests the
 * load path registers.
 *
 * ## Both shapes are read (D4), and the fallback is the compatibility mechanism
 *
 * - `packages` present → iterate it.
 * - `packages` absent  → treat `manifest` (singular) as a **single-element list**.
 *
 * The second branch is not a convenience: it is the term ADR-0130's whole
 * compatibility claim rests on (D7 — an existing single-`manifest` artifact must
 * register bit-identically through this path). That is why this function returns
 * the caller's ORIGINAL object in that branch rather than a copy or a
 * re-validated clone: the bytes `registerApp` receives must not move.
 *
 * ## The wrapper shape is NOT re-derived here (ADR-0116's lesson)
 *
 * `ArtifactPackageEntrySchema` (`@objectstack/spec`, `stack.zod.ts`) is the sole
 * declaration of what one entry looks like — a wrapper object carrying the
 * manifest under `manifest:`, the structural position D4 reserves so a future
 * `{ ref, integrity }` external segment is an additive key rather than a
 * reshape. This module imports and applies that schema instead of duck-typing
 * the wrapper: a second declaration of one shape is exactly the drift ADR-0116
 * exists about.
 *
 * ⛔ The schema is consulted as a **gate on the WRAPPER, and only the wrapper**,
 * and the body handed to `registerApp` is the caller's original
 * `entry.manifest`, never a parsed clone. Two measured reasons, both load-bearing:
 *
 *  1. **A parsed clone is not the authored body.** `ManifestSchema` carries
 *     defaults (`defaultDatasource: 'default'`, `scope: 'project'`) and Zod
 *     strips undeclared keys, so registering `parsed.data.manifest` would put
 *     different bytes into the registry than the singular-`manifest` branch does
 *     for the same authored package. D7 pins that those two branches do not
 *     disagree.
 *  2. **`ManifestSchema` cannot express an assembled package body.** Its
 *     `objects` key is `z.array(z.string())` — GLOB PATTERNS (`manifest.zod.ts`)
 *     — while what reaches this load path is an assembled payload whose
 *     `objects` are object DEFINITIONS (`AppPlugin` flattens the artifact into
 *     `{ ...bundle.manifest, ...bundle }` before `manifest.register()`, and
 *     `ObjectQL.registerApp` iterates those bodies). Measured against the
 *     landed schema: `ArtifactPackageEntrySchema.safeParse` on such a payload
 *     fails with `manifest.objects.0: expected string, received object`.
 *     Refusing on that would refuse exactly the artifacts this path exists to
 *     register.
 *
 * So issues INSIDE the manifest body are not this seam's verdict to give — body
 * validation lives at the authoring/publish doors (`defineStack`, `os validate`,
 * `os compile`'s `ObjectStackDefinitionSchema.safeParse`), which is also where
 * the singular-`manifest` branch has always had it. What this seam does own is
 * the wrapper: an entry must be `{ manifest: … }`. ⚠️ That the entry schema's
 * body half cannot describe the payload the load path registers is a real
 * tension in the landed D4 surface, recorded on the card rather than papered
 * over here — widening it is a spec decision, not a loader's.
 *
 * ## Ordering reuses the ONE sorter (D5)
 *
 * Packages inside an artifact MUST register in dependency-topological order: a
 * package using `defineObjectExtension` to extend another package's object
 * registers after the package it extends. `resolvePluginOrder`
 * (`@objectstack/core`, `plugin-order.ts`) is the platform's single topological
 * sorter and ADR-0116 already established that ordering is a **declared**
 * contract resolved from `dependencies` — the failure mode that record exists
 * for being precisely "correctness rode on which array slot each caller put it
 * in". Sorting intra-artifact packages with a second, parallel implementation
 * would re-create that failure inside the artifact after ADR-0116 removed it
 * between packages. ⛔ Do not add a second sort here, in any form.
 *
 * ### Why declared dependencies enter as `optionalDependencies`
 *
 * `manifest.dependencies` is documented in `ManifestSchema` as a "Map of package
 * IDs to version requirements", and its own example is `@steedos/plugin-auth` —
 * an EXTERNAL package, resolved by the installer, definitionally not inside this
 * artifact. The artifact is not the resolution scope for those: the sort's node
 * set is the artifact's own package set, so a declared id that names a package
 * in this artifact is a real edge and one that does not is simply not an edge
 * here. That is `resolvePluginOrder`'s `optionalDependencies` semantics
 * verbatim — "hoisted ahead when composed, silently skipped when absent" — so
 * the classification is expressed by choosing the sorter's existing bucket
 * rather than by filtering the list first and re-implementing the same rule.
 *
 * Reading every declared id as a HARD edge instead would refuse, at load time,
 * every artifact whose manifest declares a dependency on any package outside it
 * — which is every real artifact, and which D7 forbids outright. The same
 * reading already exists one layer up and is written down there: the metadata
 * protocol's package-scope closure keeps an unresolvable declared dependency in
 * the closure and simply stops walking (`protocol.ts`,
 * `resolveWritePackageScope`) rather than treating it as a fault.
 *
 * Cycles keep the sorter's behaviour untouched: two packages in one artifact
 * that depend on each other throw, because an optional dependency is a real
 * edge whenever both sides are composed. ⛔ Neither the cycle throw nor the
 * missing-dependency semantics are re-adjudicated here.
 */

import { resolvePluginOrder, type OrderablePlugin } from '@objectstack/core';
import { ArtifactPackageEntrySchema } from '@objectstack/spec';

/**
 * Refusals raised by {@link resolveArtifactPackageOrder}, as ADR-0112 envelopes
 * (`code` + `status`) — the shape this repository's rejection tests assert
 * against, never a bare throw.
 */
export type ArtifactPackageError = Error & { code: string; status: number };

function refuse(code: string, message: string): ArtifactPackageError {
  const err = new Error(message) as ArtifactPackageError;
  err.code = code;
  err.status = 422;
  return err;
}

/** The ordering-relevant projection of one artifact package. */
interface ArtifactPackageNode extends OrderablePlugin {
  /** The caller's ORIGINAL manifest body — never a parsed clone. */
  manifest: unknown;
}

/**
 * Resolve an artifact into the manifests to register, in dependency-topological
 * order (ADR-0130 D4 + D5).
 *
 * @param artifact - A release artifact (`{ packages: [...] }`), or a bare
 *   manifest / single-`manifest` artifact — both shapes are read.
 * @returns The manifest bodies to register, in the order to register them.
 * @throws An ADR-0112 envelope (`code` + `status: 422`) for a malformed entry or
 *   a duplicate package id, and `resolvePluginOrder`'s own error for a cycle.
 */
export function resolveArtifactPackageOrder(artifact: unknown): unknown[] {
  const declared = (artifact as { packages?: unknown } | null | undefined)?.packages;

  // D4, second branch: no `packages` key → the artifact carries one package and
  // the caller's own object IS that package's manifest body. Returned by
  // reference, unvalidated and unrewritten — this is the path every artifact
  // built to date takes, and D7 pins that it did not move.
  if (declared === undefined || declared === null) return [artifact];

  if (!Array.isArray(declared)) {
    throw refuse(
      'INVALID_ARTIFACT_PACKAGES',
      'A release artifact\'s `packages` must be an array of package entries '
      + '(ADR-0130 D4, `ArtifactPackageEntrySchema`), but this artifact carries '
      + `\`packages\` of type ${typeof declared}. Omit the key entirely for a `
      + 'single-package artifact — `manifest` is retained, not replaced.',
    );
  }

  const nodes = new Map<string, ArtifactPackageNode>();

  declared.forEach((entry: unknown, index: number) => {
    // The wrapper contract, read off its ONE declaration rather than
    // duck-typed. The mistake this catches is the one the schema's own
    // `history` text exists for: a manifest body inlined straight onto the
    // array element instead of wrapped as `{ manifest: { … } }`.
    //
    // WRAPPER-LEVEL issues only — an issue at the entry root (`strictObject`'s
    // `unrecognized_keys` for an inlined body, or a non-object entry) or on
    // `manifest` itself (absent, or not an object). Issues DEEPER than that
    // describe the manifest body, which this seam deliberately does not judge;
    // see the module header for the measurement behind that line.
    const verdict = ArtifactPackageEntrySchema.safeParse(entry);
    const wrapperIssues = verdict.success
      ? []
      : verdict.error.issues.filter(
          (i) => i.path.length === 0 || (i.path.length === 1 && i.path[0] === 'manifest'),
        );
    if (wrapperIssues.length > 0) {
      throw refuse(
        'INVALID_ARTIFACT_PACKAGE_ENTRY',
        `Release artifact \`packages[${index}]\` is not a package entry (ADR-0130 D4): `
        + wrapperIssues.map((i) => `${i.path.join('.') || '<entry>'}: ${i.message}`).join('; ')
        + '. Each entry is a WRAPPER object carrying its package under `manifest:` — '
        + 'wrap an inlined body as `{ manifest: { … } }`. The key position is reserved '
        + 'so a future external-segment form is an additive key rather than a reshape.',
      );
    }

    // ⛔ The ORIGINAL body, never `verdict.data.manifest` — see the module
    // header: the schema is a gate here, and a parsed clone carries defaults
    // and drops undeclared keys the singular-`manifest` branch keeps.
    const manifest = (entry as { manifest?: unknown }).manifest;
    // `||`, not `??`, on purpose: `ObjectQL.registerApp` keys the installed
    // package on `manifest.id || manifest.name`, so an empty-string `id` falls
    // back to `name` there — this seam must agree on what the id IS, or the
    // sorter would order a package under a key the registry never stores it by.
    const id = (manifest as { id?: unknown; name?: unknown }).id
      || (manifest as { name?: unknown }).name;

    if (typeof id !== 'string' || id === '') {
      throw refuse(
        'INVALID_ARTIFACT_PACKAGE_ENTRY',
        `Release artifact \`packages[${index}]\` carries a manifest with no usable `
        + 'package id: `registerApp` keys the installed package on `id || name`, so '
        + 'an entry without either cannot be ordered against its siblings or '
        + 'addressed after install.',
      );
    }

    if (nodes.has(id)) {
      // Deduplicating silently is the failure this refusal exists to prevent:
      // one of the two bodies would simply never register, and nothing
      // downstream could tell that it had been dropped.
      throw refuse(
        'DUPLICATE_ARTIFACT_PACKAGE',
        `Release artifact declares package "${id}" more than once (\`packages[${index}]\` `
        + 'repeats an earlier entry). One artifact carries each package once — an '
        + 'artifact is one atomic delivery (ADR-0130 D1/D6), not a list with '
        + 'last-writer-wins.',
      );
    }

    nodes.set(id, {
      // `name` is what `resolvePluginOrder` puts in its diagnostics; the MAP KEY
      // is what its edges resolve against. Both are the package id, so an error
      // it raises names the same string the artifact author wrote.
      name: id,
      optionalDependencies: Object.keys(
        (manifest as { dependencies?: Record<string, unknown> }).dependencies ?? {},
      ),
      manifest,
    });
  });

  return resolvePluginOrder(nodes).map((node) => node.manifest);
}
