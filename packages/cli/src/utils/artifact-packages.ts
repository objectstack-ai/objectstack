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
 *
 * ⚠️ #18778 measured that the asymmetry was 2 of 3 doors, not 1 of 2: `os lint`
 * ran the union fold and stopped as well, and the reading that hid it is the
 * one this module's own header invites — `lint.ts` DOES import both seams
 * above, for its intra-package duplicate-name advisory (#17821), so a sweep
 * that scores a door by symbol presence scores it as covered. ⛔ A count is not
 * a reading: what matters is which loop the symbols feed. All three doors call
 * the pass now.
 */

import {
  runAuthoringRules,
  splitBySeverity,
  type AuthoringCommand,
  type AuthoringFinding,
} from '@objectstack/lint';

/**
 * The leading `collection[N]` of a finding path — the ONE coordinate that
 * differs between the two views of a single finding. `objects[3].fields.x`
 * matches `objects[3]`; `manifest.namespace` matches nothing.
 */
const TOP_LEVEL_COLLECTION_INDEX = /^([A-Za-z_][A-Za-z0-9_]*)\[\d+\]/;

/**
 * Identity of one finding, for the per-package de-duplication below.
 *
 * Moved here from `compile.ts` unchanged (#18677); its POSITIONAL half was
 * corrected here (#18779). All three doors must de-duplicate identically, or
 * what survives the filter means a different thing depending on which command
 * the author happened to run.
 *
 * ## Why the top-level collection index is neutralised (#18779)
 *
 * `rule`, `where` and `message` say WHICH finding this is; `path` says where
 * it sits. The inherited key used `path` raw — and `path` is positional, so
 * one finding judged twice got two keys and the `Set` below never matched
 * them. A package body re-bases every collection from 0, while the flattened
 * union numbers that same entry wherever `authoringRuleUnionStack` placed it:
 * `objects[0].fields.industry` (package-local) and `objects[1].fields.industry`
 * (union) are ONE finding under two spellings. Measured on
 * `examples/app-multi-package` before this landed — 1 survivor, 1 echo, 0
 * genuinely new, and `os build` printed "4 author-time warning(s)" for 3
 * distinct ones. The de-duplication exists precisely so that "the author
 * cannot tell a real per-package finding from an echo" would stop being true,
 * and the positional key is why it stayed true.
 *
 * ⛔ The rewrite touches the KEY only — a finding's own `path` is never
 * modified, so every door still prints the positional location it always
 * printed. And only the TOP-LEVEL index: nested positions (`.indexes[1]`,
 * `.columns[0]`) address the author's own document and read identically in
 * both views, so they stay in the key and keep discriminating.
 *
 * ⛔ Not `nameKeyFindingPath` (`@objectstack/lint`'s runtime-gate rewrite of
 * this same coordinate), for the reason that function's own docblock records:
 * it is "Applied AFTER the differential, not before it … two stored items that
 * (illegitimately) share a name must not have their distinct findings merged
 * or cancelled by the rewrite". A de-duplication key IS that differential, so
 * name-keying is the one place it rules itself out. Two further readings from
 * the same docblock: its key set is DERIVED and holds `objects`, `permissions`
 * and `books` today, so it would leave every other collection's echo standing,
 * and it is "Exported for the pin, not for callers" — it sits on neither of
 * that package's entries.
 *
 * ⚠️ What this does NOT buy, written down so the next reader does not
 * re-inflate it: the key becomes position-insensitive, ⛔ not collision-proof.
 * Two entries that render the same `where` — an illegitimate duplicate name —
 * still share a key, exactly as they already did whenever their indices
 * matched too. The claim the pass below is entitled to make is stated there,
 * and it is narrower than "exactly the set the union could not see".
 */
const findingKey = (f: { rule: string; where: string; path: string; message: string }): string =>
  [f.rule, f.where, f.path.replace(TOP_LEVEL_COLLECTION_INDEX, '$1[]'), f.message].join('\u0000');

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
 * union run — the pass `os build` has run since #16611, `os validate` did not
 * (#18677) and `os lint` did not (#18778).
 *
 * ## Why it lives here and not in one of the commands
 *
 * It is the THIRD entry to owe the shape the module header describes, and the
 * header's fence binds it: the only ways to reach `compile.ts`' loop from
 * another command are to import one oclif command from another — pulling the
 * lowerer and the docs sweep into every `os validate` / `os lint` invocation —
 * or to write a second copy. ⛔ The second copy is what must not happen, and
 * here it would not be the `{index,id,body}` reading that drifted but the
 * VERDICT: two loops choosing their own de-duplication key, their own severity
 * split or their own `where` prefix is how one door comes to report a
 * different set from another while both look right. That is the defect #18677
 * is, one layer down — and #18778 is the measurement that the fence held: the
 * third door reached the SAME pass, and nothing about the pass moved but the
 * shape it hands back.
 *
 * ## What the asymmetry was, measured
 *
 * `os build` ran this pass; `os validate` ran the union fold and stopped,
 * importing neither seam above. Every finding this pass yields was therefore
 * one `os build` reported and `os validate` structurally could not — the
 * direction is FALSE-CLEAN, and on the command an author runs BEFORE shipping.
 * Same direction and same door #17069 fixed one layer up, which is why
 * `authoringRuleUnionStack` being in both commands did not settle it.
 * `packages/cli/test/build-json-advisory-parity.e2e.test.ts` already asserted
 * "nothing rides in build's `warnings` that validate does not also report"; it
 * stayed green because its fixture declares no `packages[]` at all, so the pass
 * it would have caught never ran there.
 *
 * ⚠️ #18779 corrected the SIZE that sentence used to be given, ⛔ not its
 * direction. #18677 and #18778 both sized this blind spot by quoting
 * `compile.ts`' claim that the survivors are "exactly the set the union could
 * not see" — but the key was positional, so part of every survivor set was
 * ECHO: findings the union run ALSO reported, which means `os validate` was
 * reporting them all along through its own union run. On
 * `examples/app-multi-package` the whole of it was — 1 survivor, 1 echo, 0
 * genuinely new — so `os validate`'s true blind spot on that fixture was ZERO
 * findings, not one. ⛔ Neither card measured that; both quoted it. The
 * asymmetry was real and worth closing on every door; its magnitude was
 * inherited from a sentence nobody had read the definition behind.
 *
 * ## What the de-duplication key can and cannot promise
 *
 * `findingKey` above neutralises the top-level collection index (#18779), so
 * the two views of one finding now produce one key and an echo is filtered.
 * What reaches the lists below is therefore the set of per-package findings
 * whose `rule`, `where`, `message` and NON-top-level position no union finding
 * already carried.
 *
 * ⚠️ That is the whole claim, and it is deliberately narrower than "exactly the
 * set the union could not see" — ⛔ do not restate it as that sentence. Two
 * entries rendering the same `where` still collapse (see `findingKey`), and a
 * rule that reports the same `rule`/`where`/`message` for genuinely different
 * items distinguished ONLY by their top-level index would collapse with them.
 *
 * ⛔ And do not size that residue by quoting the pin next door — that move is
 * exactly what this card exists to correct. `packages/lint/src/
 * data-model-rule-where-slot.test.ts` holds something NARROWER than "every
 * rule names its entity in `where`": it runs the whole registry and fails any
 * rule that puts a BARE CONFIG PATH in `where`. That forbids the one spelling
 * which would make the collapse systematic; it does ⛔ not promise that two
 * entries always render different `where` strings. So the residue is MEASURED
 * instead — over every example stack in this repo that parses today
 * (`app-multi-package`'s built artifact, `app-crm`, `app-showcase`,
 * `app-todo`), 45 registry rules produced 103 findings and 103 distinct
 * neutralised keys: ZERO groups held two different raw paths. ⛔ Re-measure
 * rather than re-quote that number — a corpus reading is a count plus the tree
 * it was taken against, and this one was taken on a43b9d0654.
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
  /**
   * Every surviving finding, `where`-prefixed, in walk order — the SAME set as
   * `errors` ∪ `advisories`, not a second computation of it (#18778).
   *
   * The two doors that hold an ARTIFACT to the bar need the severity SPLIT:
   * an `error` refuses the run and an advisory rides the warnings list, so
   * `compile.ts` and `validate.ts` read the two arrays below. `os lint` has no
   * such split — it maps every finding of every severity onto ONE `issues`
   * list through its own `info` → `suggestion` face and lets `--strict` decide
   * what fails — so re-joining the halves at that door would put all errors
   * before all advisories and silently re-order a list the union run above it
   * produces in rule order. This member is that door's shape, produced by the
   * one loop rather than by a caller stitching the halves back together.
   */
  findings: AuthoringFinding[];
  errors: Array<{ package: string } & AuthoringFinding>;
  advisories: AuthoringFinding[];
} {
  const artifactPackageEntries = run.parsed.packages;
  const packageEntries = artifactPackages(run.parsed);
  const findings: AuthoringFinding[] = [];
  const errors: Array<{ package: string } & AuthoringFinding> = [];
  const advisories: AuthoringFinding[] = [];
  if (packageEntries.length === 0) return { packageCount: 0, findings, errors, advisories };

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
    // ⛔ ONE prefixer, applied to every member of all three lists. The `where`
    // prefix is the only thing that identifies a finding as per-package on any
    // door's face, and a second spelling of it is the drift this module exists
    // to foreclose — one layer smaller than the second copy of the loop its
    // header forbids, and invisible in exactly the same way.
    const prefixed = (f: AuthoringFinding): AuthoringFinding => ({
      ...f,
      where: `package '${pkg.id}' — ${f.where}`,
    });
    findings.push(...pkgFindings.map(prefixed));
    const split = splitBySeverity(pkgFindings);
    advisories.push(...split.advisories.map(prefixed));
    errors.push(...split.errors.map((e) => ({ ...prefixed(e), package: pkg.id })));
  }
  return { packageCount: packageEntries.length, findings, errors, advisories };
}
