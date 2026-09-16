// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18024] `os build` / `os validate`'s compile-time half of the #17516
 * ruling — a `permissions[]` entry whose set name another package in the SAME
 * artifact already owns, reported where an AI author sees it first.
 *
 * ## The defect this closes, one layer up from #17516
 *
 * `bootstrapDeclaredPermissions` refuses to write into a `sys_permission_set`
 * row another package owns (ADR-0086 D4). That refusal is CORRECT and nothing
 * here changes it — ⛔ this module reports, it does not alter what is skipped.
 * #17516 gave that refusal a RUNTIME door. Until this module there was no
 * compile-time door at all: `os build` and `os validate` walked an artifact in
 * which two packages declared the same set name and said nothing, so the first
 * an author heard of an entire declared permission set never materializing was
 * a boot-time warning on a deployed environment.
 *
 * ## ⛔ Why nothing here derives anything
 *
 * The precedent is #14553's `navigationContributions` fix: ONE predicate behind
 * two doors, so the two cannot drift. `@objectstack/plugin-security` publishes
 * that derivation from its package entry for exactly this consumer, and its own
 * source says so — the compile door "must consume these rather than re-deriving
 * either the predicate or the wording". So:
 *
 *  - the owner comparison is `permissionSetNameIsForeign`, imported. ⛔ Never a
 *    local `!==`: a nullish owner is FOREIGN by that function's ruling, and a
 *    door that spelled the comparison itself would be one `??` away from
 *    calling a collision fine that the runtime drops;
 *  - the sentence is `permissionSetNameCollisionDiagnostic` +
 *    {@link formatPermissionSetNameCollisions}, imported. ⛔ Never retyped: two
 *    doors phrasing one refusal differently IS the defect this card is about.
 *
 * What is NOT consumed is `reportPermissionSetNameCollisions`, and that is a
 * deliberate bound rather than an omission. It is a SINK-printing pass reporter
 * whose sentence is past-tense about a boot pass ("N declared permission sets
 * were NOT materialized") and whose second half is a structured `meta` record
 * the CLI's text face has no channel for. The count line a command prints is
 * the command's own framing — exactly as `nav-contribution-groups.ts`' half
 * leaves its heading to `compile.ts`/`validate.ts` and takes only the finding's
 * wording from the shared derivation.
 *
 * ## Why the check lives in the command and not in `@objectstack/lint`
 *
 * `runAuthoringRules` hands a rule ONE stack, and every member of that table
 * reads one. This question is cross-package by construction: the name is
 * declared by package A and declared AGAIN by package B, so the per-package
 * walk sees one half at a time and only the composed artifact carries both.
 * That is the identical reasoning `nav-contribution-groups.ts` records, and it
 * lands in the same place — `compile.ts` already owns the artifact layer.
 *
 * ## Reports, never refuses
 *
 * `PermissionSetNameCollisionDiagnostic.severity` is `'warning'`, declared at
 * the producer, and the runtime's failure direction is CLOSED — the set is not
 * installed, so nothing is over-granted. #14553 made the same call for nav on
 * the maintainer's option-B ruling, and the findings ride the `warnings` key
 * both commands already declare. ⛔ Making either command exit non-zero here
 * would narrow what `os build` accepts, which neither this card nor that ruling
 * asked for.
 *
 * ## The provenance rule, mirrored from the seeder rather than invented
 *
 * `bootstrapDeclaredPermissions` owns a set under
 * `ps._packageId ?? ps.packageId` — registry provenance (ADR-0010) first, the
 * author-declared `packageId` (ADR-0086 D3) as fallback. At compile time the
 * artifact's package id IS that registry provenance: `artifactPackages`' id is
 * "the string the runtime registers a package under", so a set inside package
 * P's assembled body is declared by P, and `packageId` on the set is read only
 * where no package ships it. ⛔ The id rule itself is imported, not re-spelled:
 * `artifact-packages.ts` exists because two readers computing "which package is
 * this" slightly differently is how one door comes to judge a different set of
 * packages than the other while both look right.
 *
 * ⚠️ Two bounds, stated because they are where a reading could be wrong rather
 * than merely narrow:
 *
 *  - **Only the composed case can be judged.** A set colliding with a row some
 *    OTHER artifact installed is invisible here and must stay invisible — the
 *    build has no database, and guessing would report a package's own re-seed
 *    as a collision. That is the same bound the nav half keeps for a
 *    contribution aimed at an app no package here ships.
 *  - **A declaration with no resolvable owner is not a collision.** The seeder
 *    returns at `if (!packageId)` with a different warning and never reaches
 *    the collision branch, so a compile door that reported one would be
 *    announcing a refusal the runtime does not make.
 */

import { artifactPackages } from './artifact-packages.js';
import type { PermissionSetNameCollisionDiagnostic } from '@objectstack/plugin-security';

type AnyRec = Record<string, unknown>;

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRec = (v: unknown): AnyRec | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRec) : undefined;

const asId = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined;

/** One package carried by the artifact, in the shape `artifactPackages` returns. */
export interface CompiledPackage {
  readonly id: string;
  readonly body: AnyRec;
}

/** One declared permission set, reduced to the two facts the predicate needs. */
export interface DeclaredPermissionSet {
  /** The declared `sys_permission_set.name`. */
  readonly name: string;
  /** The package that would own the row — the seeder's `_packageId ?? packageId`. */
  readonly declaredBy: string;
}

/**
 * Every permission set declared in ONE compilation unit, with its owner.
 *
 * ⚠️ The top-level `permissions` is read only when the stack carries no
 * `packages[]`. `permissions` composes by `'concat'`
 * (`COMPOSE_KEY_DISPOSITIONS`), so on an artifact the top-level collection is
 * the union of every package's sets with their per-package provenance already
 * flattened away — walking both would report each package's declaration twice,
 * the second time attributed to whichever manifest `composeStacks` picked.
 */
export function collectPermissionSetDeclarations(
  parsed: AnyRec,
  packages: readonly CompiledPackage[] = artifactPackages(parsed),
): DeclaredPermissionSet[] {
  const out: DeclaredPermissionSet[] = [];
  const add = (list: unknown, ownerOf: (ps: AnyRec) => string | undefined) => {
    for (const entry of asArray(list)) {
      const ps = asRec(entry);
      if (!ps) continue;
      const name = asId(ps.name);
      // The seeder's own first line: `if (!ps?.name) return out;`.
      if (name === undefined) continue;
      const declaredBy = ownerOf(ps);
      // The seeder's `if (!packageId)` arm — warned about, never a collision.
      if (declaredBy === undefined) continue;
      out.push({ name, declaredBy });
    }
  };

  if (packages.length > 0) {
    // An assembled package body IS its own manifest (`packageBodyAsStack`), so
    // the collection reads off the top of it and the owner is the package.
    for (const pkg of packages) add(pkg.body.permissions, () => asId(pkg.id));
    return out;
  }

  // A single-package stack. Its manifest id is the registry provenance the
  // seeder prefers; `packageId` on the set answers only when there is none.
  const manifestId = asId(asRec(parsed.manifest)?.id) ?? asId(asRec(parsed.manifest)?.name);
  add(parsed.permissions, (ps) => manifestId ?? asId(ps.packageId));
  return out;
}

/**
 * Every declared set in this compilation unit that a DIFFERENT package in it
 * already owns — the same finding, in the same words, the runtime seeder raises
 * when it drops one.
 *
 * The owner of a name is the first declaration of it in artifact order, which
 * is the order the registry hands the seeder and therefore the order in which
 * the row is actually created; every later declaration of that name by another
 * package is the one the runtime refuses, and the one reported here.
 *
 * Returns `[]` without loading `@objectstack/plugin-security` unless some name
 * is declared more than once — a necessary condition for a collision, and false
 * on the overwhelming majority of builds. ⛔ That pre-filter is a name count,
 * never an owner comparison: the owner question has exactly one implementation
 * and it is imported below.
 */
export async function findPermissionSetNameCollisions(
  parsed: AnyRec,
  packages: readonly CompiledPackage[] = artifactPackages(parsed),
): Promise<PermissionSetNameCollisionDiagnostic[]> {
  const declarations = collectPermissionSetDeclarations(parsed, packages);
  if (declarations.length < 2) return [];
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const d of declarations) {
    if (seen.has(d.name)) repeated.add(d.name);
    else seen.add(d.name);
  }
  if (repeated.size === 0) return [];

  const { permissionSetNameCollisionDiagnostic, permissionSetNameIsForeign } =
    await import('@objectstack/plugin-security');

  const ownerByName = new Map<string, string>();
  const found: PermissionSetNameCollisionDiagnostic[] = [];
  for (const d of declarations) {
    const owner = ownerByName.get(d.name);
    if (owner === undefined) {
      ownerByName.set(d.name, d.declaredBy);
      continue;
    }
    // Same package declaring its own name twice is a re-seed at runtime, not a
    // refusal — `permissionSetNameIsForeign` is what says so.
    if (!permissionSetNameIsForeign(owner, d.declaredBy)) continue;
    found.push(permissionSetNameCollisionDiagnostic({
      name: d.name,
      declaredBy: d.declaredBy,
      ownedBy: owner,
    }));
  }
  return found;
}

/**
 * The findings as the lines an author reads — `[security] [<event>] <message>
 * Fix: <fix>`, the shipped sentence, through the shipped formatter.
 *
 * ⛔ Not a template. Both doors say this in the same words because there is one
 * function that says it.
 */
export async function formatPermissionSetNameCollisions(
  diagnostics: readonly PermissionSetNameCollisionDiagnostic[],
): Promise<string[]> {
  if (diagnostics.length === 0) return [];
  const { formatPermissionSetNameCollisionDiagnostic } = await import('@objectstack/plugin-security');
  return diagnostics.map((d) => formatPermissionSetNameCollisionDiagnostic(d));
}
