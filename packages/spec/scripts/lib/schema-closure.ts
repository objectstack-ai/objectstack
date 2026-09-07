// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `packages/spec/src/` module directories DECLARED to publish no JSON
 * Schema — and the coverage check that stops the declaration from outliving
 * the condition it declares (#15870).
 *
 * ## The condition
 *
 * `build-docs.ts` walks every module directory under `packages/spec/src/`
 * (`CATEGORY_TITLES` holds that list total in both directions) and looks for
 * `json-schema/<category>/`. That tree is written by `gen:schema`, which
 * iterates the hard-coded `Protocol` namespace map in `build-schemas.ts` and
 * `ensureDir`s one directory per entry. Measured on this tree: 18 module
 * directories, 15 `Protocol` entries, so three categories have no directory at
 * all and `groupSchemasByPage` warned about each of them on EVERY run.
 *
 * `contracts` is the shape that does not warn and is worth stating, because it
 * is the one people reach for as the counter-example: it IS on the `Protocol`
 * map, so it gets `json-schema/contracts/` — empty, because its service
 * interfaces are plain TypeScript rather than Zod. Present-and-empty and
 * absent-entirely are different states and only the second one warns.
 *
 * ## Why an unconditional warning is worth removing
 *
 * A warning that fires for an intended condition on every run is a warning
 * readers learn to skim, which is how a real one later gets skimmed too. The
 * channel is only worth having if a line in it means something happened.
 *
 * ## Why a DECLARED list and not "absent from the Protocol map"
 *
 * Reading the exemption off `build-schemas.ts`'s map would make the warning
 * unfalsifiable: a category dropped from that map by accident would be
 * self-exempting, which is precisely the case the warning exists to catch. So
 * the exemption is declared here, by hand, one entry at a time, each carrying
 * the citation that declares it — the same idiom `CATEGORY_TITLES`,
 * `FOREIGN_JSON_SCHEMA_ARTIFACTS` and `browser-reachable-entries.json` already
 * use one datum over: a promotion into this map is a judgement someone makes
 * and signs, never something a generator can grant itself.
 *
 * A category that is genuinely, unintentionally missing is not in this map, so
 * it still warns — pinned by `schema-closure.test.ts`, both directions.
 */

/**
 * Category directory -> the citation in this repo that declares it ships no
 * schema closure.
 *
 * ⛔ An entry here is a claim about DESIGN, so it is added only when the tree
 * already says so somewhere a reader can check. Do not add one because a
 * directory happens to be missing today — that is the state the warning
 * reports, and silencing it without a citation converts a report into a guess.
 *
 * ⛔ And never satisfy the warning by creating an empty `json-schema/<cat>/`:
 * an empty directory claims a closure it does not have, which is worse than
 * the noise it removes.
 *
 * ## What is deliberately NOT here (measured on this tree, #15870)
 *
 * `conversions` and `migrations` are the other two categories with no schema
 * directory, and **neither carries an equivalent declaration**. A repo-wide
 * search for the declaration phrasings (`schema closure`, `schema-free`,
 * `no JSON Schema`, `without the schema machinery`) returns the `meta-spelling`
 * citations below and nothing for either of them; the only text that mentions
 * their missing directory at all is a comment in `build-docs.ts` §2 recording
 * it as an asymmetry that comment's guard deliberately does NOT act on. Both
 * are titled `... Protocol` in `CATEGORY_TITLES` — the same word every
 * category WITH a schema closure is titled with — where `meta-spelling` is
 * titled `Meta-Spelling Vocabulary` for exactly this reason.
 *
 * `migrations` is the further one from an exemption, not the nearer: its
 * `spec-changes.ts` exports five real Zod schemas, so "no schema closure" is
 * not even factually true of it. What is true is that it is not on the
 * `Protocol` map — which is a fact about a generator's input list, not a
 * declaration about the module.
 *
 * So their warnings still fire, and that is the deliberate outcome: whether
 * either is intentional is an open question this fix does not answer, and a
 * silenced warning would close it by default in the wrong direction.
 */
export const CATEGORIES_WITHOUT_SCHEMA_CLOSURE: Readonly<Record<string, string>> = {
  'meta-spelling':
    'scripts/build-meta-url-spelling.ts — "`/meta-spelling` entry ships vocabulary with no schema closure." ' +
    'Also src/meta-spelling/manifest-collection-spelling.ts ("no schema closure on the vocabulary path"), ' +
    'scripts/lib/category-title.ts (titled "Vocabulary", not "Protocol", because the entry "folds without ' +
    'the schema machinery every Protocol category links"), and browser-reachable-entries.json, which ' +
    'declares `./meta-spelling` browser-reachable under the standing schema-free principle.',
};

/**
 * Is this category's missing `json-schema/<category>/` a DECLARED state?
 *
 * The one predicate `build-docs.ts` branches its warning on, exported so both
 * of its answers can be pinned directly. A unit test over it is not sufficient
 * on its own — the caller could stop asking — so `build-docs.ts` calling it is
 * pinned end-to-end as well; neither half replaces the other.
 */
export function schemaClosureAbsenceIsDeclared(
  category: string,
  exempt: Readonly<Record<string, string>> = CATEGORIES_WITHOUT_SCHEMA_CLOSURE,
): boolean {
  return Object.hasOwn(exempt, category);
}

/** Directories whose exemption no longer describes the tree. */
export interface SchemaClosureExemptionCoverage {
  /**
   * Declared exempt, and `json-schema/<category>/` is now there. The
   * declaration outlived the condition: either the category grew a schema
   * closure, or the citation was never true.
   */
  stale: string[];
  /**
   * Declared exempt, and no such module directory exists. The declaration
   * outlived the module — the `src/hub` failure `categoryTitleCoverage`
   * guards against, one datum over.
   */
  orphaned: string[];
}

/**
 * Place the declared exemptions against the tree, in BOTH directions.
 *
 * Pure over its inputs so the self-test drives every branch offline. The
 * direction that is NOT reported here is the interesting one: a category that
 * is absent and undeclared is not an error, it is the warning's whole job, and
 * `build-docs.ts` prints it rather than failing.
 */
export function schemaClosureExemptionCoverage(
  allCategories: readonly string[],
  categoriesWithSchemaDir: readonly string[],
  exempt: Readonly<Record<string, string>> = CATEGORIES_WITHOUT_SCHEMA_CLOSURE,
): SchemaClosureExemptionCoverage {
  const onDisk = new Set(allCategories);
  const withSchemaDir = new Set(categoriesWithSchemaDir);
  const declared = Object.keys(exempt).sort();

  return {
    stale: declared.filter((c) => withSchemaDir.has(c)),
    orphaned: declared.filter((c) => !onDisk.has(c)),
  };
}

/** True when {@link schemaClosureExemptionCoverage} found nothing to report. */
export function schemaClosureExemptionsAreClean(coverage: SchemaClosureExemptionCoverage): boolean {
  return coverage.stale.length === 0 && coverage.orphaned.length === 0;
}

/**
 * The build-stopping message for {@link schemaClosureExemptionCoverage}.
 *
 * Names the entry, the file holding it, and what to do — a message that only
 * said "exemption mismatch" would leave the reader to work out which of the
 * two directions fired and which way to edit.
 */
export function formatSchemaClosureExemptionCoverage(coverage: SchemaClosureExemptionCoverage): string {
  return (
    `CATEGORIES_WITHOUT_SCHEMA_CLOSURE in scripts/lib/schema-closure.ts no longer describes this tree:\n\n` +
    [
      ...coverage.stale.map(
        (c) =>
          `    - ${c} (declared to ship no schema closure, but json-schema/${c}/ now exists — ` +
          `delete the entry so the category is checked like every other one)`,
      ),
      ...coverage.orphaned.map(
        (c) => `    - ${c} (declared, but packages/spec/src/${c}/ is gone — delete the entry)`,
      ),
    ].join('\n') +
    `\n\nThe map exists so that a category with no json-schema/ directory stops warning ONLY when the\n` +
    `tree says its absence is intended. An entry that no longer matches the tree silences a reading\n` +
    `nobody decided to silence, which is the failure this map was added to remove rather than move.\n`
  );
}
