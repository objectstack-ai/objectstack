// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4/D5 — the artifact's `packages[]`, and one package's body read
 * back as the STACK it was assembled from.
 *
 * ## Why these two live in a module and not in the command that first needed
 * ## them
 *
 * D4/D5 register artifacts PER PACKAGE, so a rule that judges "one package"
 * has to be handed one package. `compile.ts` step 3b-ii has run the
 * author-time rule table that way since #16611, through exactly these two
 * functions. `os lint`'s intra-package duplicate advisory (#17821) is the
 * second entry that owes the same shape, and there are only two ways to reach
 * it from there: import one oclif command from another — pulling `compile.ts`'
 * whole module graph, the lowerer and the docs sweep included, into every
 * `os lint` invocation — or write a second copy.
 *
 * ⛔ A second copy is the one that must not happen. The id rule below
 * (`manifest.id`, falling back to `name`, then to the positional spelling) is
 * the string the runtime registers a package under, and the body-as-stack view
 * carries a ruled decision in each of its three keys (see
 * {@link packageBodyAsStack}). Two readers computing "which package is this"
 * slightly differently is how one entry comes to judge a different set of
 * packages than the other while both look right — so the functions moved here
 * unchanged and both entries call these.
 */

/**
 * The artifact's package entries, as `{ index, id, body }` (ADR-0130 D4).
 *
 * Reads the PARSED stack, so what is walked here is exactly what the artifact
 * will carry — `ArtifactPackageSchema` has already judged every entry by the
 * time this runs, which is why nothing here re-checks the shape.
 */
export function artifactPackages(parsed: Record<string, unknown>): Array<{
  index: number;
  id: string;
  body: Record<string, unknown>;
}> {
  const declared = parsed.packages;
  if (!Array.isArray(declared)) return [];
  return declared.map((entry, index) => {
    const body = (entry as { manifest?: Record<string, unknown> }).manifest ?? {};
    const id = typeof body.id === 'string' && body.id !== ''
      ? body.id
      : (typeof body.name === 'string' ? body.name : `packages[${index}]`);
    return { index, id, body };
  });
}

/**
 * One assembled package body, re-read as the STACK it was assembled from.
 *
 * The author-time rules read a stack: collections at the top level and the
 * package identity under `manifest`. An assembled body is that same content
 * with the manifest fields flattened over the top (`{ ...manifest, ...stack }`
 * — `AppPlugin`'s shape, declared by `AssembledPackageBodySchema`), so undoing
 * the flatten is one key: the body IS its own manifest.
 *
 * ⛔ No key list is transcribed here on purpose. Splitting the body back into
 * "manifest fields" and "collections" would need a second copy of the key set
 * `AssembledPackageBodySchema` derives, and the rules do not need the split —
 * they read collections off the top level (already there) and identity off
 * `manifest`.
 *
 * That `manifest` is a SUPERSET of a real manifest — it is the whole body — and
 * that is safe here for one reason only: nothing parses it. `runAuthoringRules`
 * reads fields off this object and never hands it to a schema. ⛔ Do not start
 * parsing it against `ManifestSchema`, and do not reach for a widened schema to
 * make that possible: `ManifestSchema` is `strictObject` since #14192, so it
 * would REFUSE, by name, every collection key this superset deliberately puts
 * under `manifest` — and re-opening it to stop the refusal would re-open the
 * real manifest surface with it.
 *
 * ## `packages` — the second key, and the only one (#16611)
 *
 * The body carries the collections this package OWNS. Judged with nothing else,
 * a rule that resolves an object NAME concludes that a name a SIBLING package in
 * the same artifact ships exists nowhere: `examples/app-multi-package`'s
 * `crm_order.account` → `crm_account` — a lookup that fixture's README
 * documents as the point of the fixture — is owned by its `core` package and
 * read from its `orders` one. ADR-0130 makes the release artifact the
 * co-ownership boundary, so a per-package pass that cannot see a sibling
 * package's objects is THIS RUN's defect and not the author's; the ruled fix
 * (director seat, decision batch #86) hands the per-package stack the
 * artifact's own `packages[]` as RESOLUTION CONTEXT.
 *
 * Two properties make that safe, and they are the whole design:
 *
 *   1. ⛔ It changes what a rule can RESOLVE, never what it JUDGES. The
 *      collections read off the top level are still this package's alone, so
 *      every per-package finding this leg exists to produce is still produced.
 *      ⛔ This is NOT "skip the site per package" — that would silence the gate
 *      on the one command that ships.
 *   2. A name no entry of `packages[]` provides resolves in neither run, so a
 *      genuinely dangling reference still errors here exactly as it does in the
 *      union run above.
 *
 * The array is passed through verbatim rather than reduced to a name list: the
 * consuming rule owns which of an entry's contents are resolution context, and a
 * set computed here would be a second copy of that decision, free to drift.
 */
export function packageBodyAsStack(
  body: Record<string, unknown>,
  artifactPackageEntries: unknown,
): Record<string, unknown> {
  return { ...body, manifest: body, packages: artifactPackageEntries };
}
