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
 *
 * Since #18677 the module also carries the PASS those two seams exist to feed —
 * {@link runPerPackageAuthoringRules} — for the same reason one layer out: the
 * `os build` door ran it and the `os validate` door did not, and a second copy
 * of the loop is how that asymmetry would come back.
 */

import {
  runAuthoringRules,
  splitBySeverity,
  type AuthoringCommand,
  type AuthoringFinding,
} from '@objectstack/lint';

/**
 * Identity of one finding, for the per-package de-duplication below.
 *
 * Moved here from `compile.ts` unchanged (#18677): the two doors must
 * de-duplicate identically, or "the set the union could not see" means two
 * different things depending on which command the author happened to run.
 */
const findingKey = (f: { rule: string; where: string; path: string; message: string }): string =>
  [f.rule, f.where, f.path, f.message].join('\u0000');

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

/**
 * The author-time rule table, run ONCE PER PACKAGE and de-duplicated against a
 * union run — the pass `os build` has run since #16611 and `os validate` did
 * not (#18677).
 *
 * ## Why it lives here and not in one of the two commands
 *
 * It is the THIRD entry to owe the shape the module header describes, and the
 * header's fence binds it: the only ways to reach `compile.ts`' loop from
 * `validate.ts` are to import one oclif command from another — pulling the
 * lowerer and the docs sweep into every `os validate` invocation — or to write
 * a second copy. ⛔ The second copy is what must not happen, and here it would
 * not be the `{index,id,body}` reading that drifted but the VERDICT: two loops
 * choosing their own de-duplication key, their own severity split or their own
 * `where` prefix is how one door comes to report a different set from the other
 * while both look right. That is the defect #18677 is, one layer down.
 *
 * ## What the asymmetry was, measured
 *
 * `os build` ran this pass; `os validate` ran the union fold and stopped,
 * importing neither seam above. `compile.ts`' own comment says what survives
 * the de-duplication is "exactly the set the union could not see" ⇒ that whole
 * set was findings `os build` reported and `os validate` structurally could
 * not. The direction is FALSE-CLEAN, and on the command an author runs BEFORE
 * shipping — the same direction and the same door #17069 fixed one layer up,
 * which is why `authoringRuleUnionStack` being in both commands did not settle
 * it. `packages/cli/test/build-json-advisory-parity.e2e.test.ts` already
 * asserted "nothing rides in build's `warnings` that validate does not also
 * report"; it stayed green because its fixture declares no `packages[]` at all,
 * so the pass it would have caught never ran there.
 *
 * ## The de-duplication key is the caller's, and it is not perfect
 *
 * `findingKey` below is `compile.ts`' key, moved unchanged: `rule`, `where`,
 * `path`, `message`. ⚠️ `path` is POSITIONAL, and a collection index in one
 * package's own body is not the index the flattened top level gives the same
 * item — so a finding on any package whose local index differs from its
 * flattened one survives the filter as an ECHO of a union finding rather than
 * as something the union could not see. Measured on `examples/app-multi-package`
 * (2 packages, `crm_account.industry`): 1 survivor, 0 of them new. ⛔ Not fixed
 * here — changing the key changes what `os build` reports, which is a separate
 * decision from making the two doors agree, and agreeing IMPERFECTLY at one
 * seam is strictly better than disagreeing at two. When it is fixed it is
 * fixed once, for both commands, which is the property this module buys.
 */
export function runPerPackageAuthoringRules(run: {
  /** Which door is asking — the same string its union run passed. */
  command: AuthoringCommand;
  /** The PARSED stack, as `artifactPackages` reads it. */
  parsed: Record<string, unknown>;
  /** The union run's findings, whose keys this pass de-duplicates against. */
  unionFindings: readonly AuthoringFinding[];
  sduiManifest?: unknown;
  loweredHookRefs?: ReadonlySet<string>;
}): {
  /** How many package entries were walked — 0 means the pass did not run. */
  packageCount: number;
  errors: Array<{ package: string } & AuthoringFinding>;
  advisories: AuthoringFinding[];
} {
  const artifactPackageEntries = run.parsed.packages;
  const packageEntries = artifactPackages(run.parsed);
  const errors: Array<{ package: string } & AuthoringFinding> = [];
  const advisories: AuthoringFinding[] = [];
  if (packageEntries.length === 0) return { packageCount: 0, errors, advisories };

  const alreadyReported = new Set(run.unionFindings.map(findingKey));
  for (const pkg of packageEntries) {
    const asStack = packageBodyAsStack(pkg.body, artifactPackageEntries);
    const pkgFindings = runAuthoringRules(run.command, {
      normalized: asStack,
      parsed: asStack,
      sduiManifest: run.sduiManifest,
      loweredHookRefs: run.loweredHookRefs,
    }).filter((f) => !alreadyReported.has(findingKey(f)));
    for (const f of pkgFindings) alreadyReported.add(findingKey(f));
    const split = splitBySeverity(pkgFindings);
    advisories.push(
      ...split.advisories.map((a) => ({ ...a, where: `package '${pkg.id}' — ${a.where}` })),
    );
    errors.push(
      ...split.errors.map((e) => ({ ...e, package: pkg.id, where: `package '${pkg.id}' — ${e.where}` })),
    );
  }
  return { packageCount: packageEntries.length, errors, advisories };
}
