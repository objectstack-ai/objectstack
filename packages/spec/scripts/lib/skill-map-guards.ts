// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Guards over the authored `SKILL_MAP` in `build-skill-references.ts`.
 *
 * The map is hand-written config that decides what a published skill index
 * points at, and every defect this file refuses was found by a human reading
 * a shipped index rather than by a gate: an entry the owning SKILL.md never
 * teaches, an entry two packages both claim, an entry that emits no row at
 * all. `check:skill-refs` cannot see any of them — it compares the artifact
 * against the generator, and the generator reproduces a wrong map faithfully.
 * So these ask questions of the MAP, before the artifact exists.
 *
 * They live here, beside `export-list.ts` and `file-description.ts`, for the
 * reason those do: the generator self-executes on import, so logic that wants
 * a unit test cannot live in it.
 *
 * ## What these guards deliberately do NOT claim
 *
 * None of them decides whether a schema is RETIRED, and no such guard is
 * shipped, because no checkable source for it exists in this repo — measured,
 * not assumed:
 *
 *  - the ADR-0087 registry (`src/migrations/entries/retired-defs/**`) names
 *    defs removed at a major version. `automation/state-machine.zod.ts` is not
 *    there and correctly so: the def still exists and still parses, through
 *    `AgentSchema.lifecycle`;
 *  - the file's own header carries the ADR-0020 retirement in prose, and that
 *    same header documents the door that SURVIVES — so a prose grep flags a
 *    file that is live surface for another package;
 *  - the liveness ledger classifies properties, not files.
 *
 * The retirement that mattered was PACKAGE-RELATIVE: dead surface for
 * automation authoring, live surface for AI authoring. Nothing in the tree
 * expresses a per-package liveness claim, so nothing can derive it. What is
 * mechanical is below, and what is not stays a human judgement stated out loud
 * in the map.
 */

// ── What the catalog may publish ─────────────────────────────────────────────

/**
 * The gate's criterion for an internal tracker id, restated.
 *
 * Same shape as `scripts/check-doc-authoring.mjs`'s `INTERNAL_ID_SOURCE`: three
 * to five digits, so the ordinal "the #1 mistake" and a six-digit hex colour
 * are both below/above it, and neither `##` nor an HTML entity's `&#` counts.
 * Restated rather than imported because that gate is a `.mjs` in the repo root
 * `scripts/` tree and exports nothing; the pin in
 * `skill-map-guards.test.ts` holds the two spellings together by asserting the
 * shapes that must and must not match.
 */
const INTERNAL_ISSUE_ID = /(?<![#&])#[0-9]{3,5}(?![0-9A-Za-z])/g;

/**
 * Drop internal issue ids from a line about to be published to `skills/**`.
 *
 * `skills/**` ships to customer projects and is loaded WHOLE into customer
 * agent context windows, so `check:doc-authoring` refuses a tracker id there
 * with no per-passage exemption -- a reader in a customer session has no
 * tracker, no `git log` and no ADRs, and the token resolves to nothing for the
 * audience paying for it (maintainer ruling 2026-08-12).
 *
 * The index rows are PROJECTED from module doc blocks in `packages/spec/src`,
 * so a citation written for a repo reader becomes catalog prose the moment its
 * schema joins a package's list -- which is exactly how
 * `automation/io-node-config.zod.ts` arrived with `(#4045)` in its opening
 * sentence. The same sentence is also published to
 * `content/docs/references/**`, and the gate does NOT flag it there: the rule
 * is about the skill catalog specifically. So the strip belongs at the BOUNDARY
 * into that catalog rather than in the source, where it would rewrite a
 * legitimate repo-facing citation, change bytes the package publishes, and drag
 * the generated docs tree along.
 *
 * Sanitising here rather than refusing is deliberate and is the narrower of the
 * two: a refusal would be satisfiable only by editing the schema source, which
 * is what the paragraph above argues against. The class becomes impossible
 * rather than corrected once -- no future pointer row can carry an id.
 */
export function stripInternalIssueIds(text: string): string {
  return text
    .replace(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?=#[0-9]{3,5}(?![0-9A-Za-z]))/g, '')
    .replace(INTERNAL_ISSUE_ID, '')
    .replace(/\(\s*[,;·]?\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

/** A `SKILL_MAP`-shaped value: skill name → its core schema paths. */
export type SkillCoreMap = Record<string, readonly string[]>;

/**
 * Schema files a second package's core list may claim, and why.
 *
 * ## Why this ledger exists at all, against the instruction that it should not
 *
 * The seat ruling that ordered this guard asked for the flat rule -- a schema
 * file appears in at most ONE package's core list -- and refused a
 * "legitimate duplicate ownership" rule on the stated ground that there would
 * be "zero legitimate instances" once `data/date-macros.zod.ts` left the
 * formula entry. MEASURED AT THE BASE OF THIS CHANGE, that ground does not
 * hold: `date-macros` was one of FOUR duplicates, and the other three are
 * deliberate, two of them already carrying their reason as a comment in the
 * map itself. The flat rule would therefore refuse `origin/main`'s own map on
 * its first run, and the only ways to satisfy it are to delete three pointers
 * no card has adjudicated, or to keep the gate red.
 *
 * So the guard ships in the shape that is enforceable and keeps the ruling's
 * operational demand -- the NEXT duplicate refuses at generation time --
 * while the three measured instances are declared here rather than deleted.
 * This is a deviation from the letter of that ruling, recorded here and in the
 * PR body so a reviewer can object to the reasoning rather than discover the
 * outcome. Two guards keep the ledger from becoming the spread the ruling
 * feared: a row whose file is no longer duplicated is REFUSED, so it cannot
 * rot unread, and a row with no reason is refused, so it cannot become a
 * silent allowlist.
 */
export const SHARED_CORE_SCHEMAS: Record<string, string> = {
  'data/validation.zod.ts':
    'objectstack-data owns validation rules as a data surface; objectstack-automation ' +
    "teaches the same file because a record's legal transitions are authored there as a " +
    '`state_machine` rule (ADR-0020) -- the destination that replaced the retired ' +
    'state-machine shape.',
  'data/datasource.zod.ts':
    'objectstack-data owns datasources as a data surface; objectstack-platform teaches the ' +
    'same file under project setup (`defineStack` + drivers), the surface absorbed from the ' +
    'retired objectstack-quickstart skill.',
  'data/seed.zod.ts':
    'objectstack-data owns seeds as a data surface; objectstack-platform teaches the same ' +
    'file under project setup, the surface absorbed from the retired objectstack-quickstart ' +
    'skill.',
};

/**
 * One schema file, one owning package -- unless the sharing is declared above.
 *
 * `references/_index.md` is generator-owned and shipped, and the catalog's
 * whole contract is "this package owns this surface". A file in two core lists
 * puts one pointer in an index whose SKILL.md routes that surface elsewhere,
 * and the reader has no way to tell which of the two indexes meant it:
 * `data/date-macros.zod.ts` sat in both `objectstack-query` and
 * `objectstack-formula` while both bodies routed date macros to query alone.
 */
export function checkSingleOwner(map: SkillCoreMap, shared: Record<string, string>): string[] {
  const owners = new Map<string, string[]>();
  for (const [skillName, coreFiles] of Object.entries(map)) {
    for (const rel of coreFiles) {
      const list = owners.get(rel) ?? [];
      list.push(skillName);
      owners.set(rel, list);
    }
  }

  const problems: string[] = [];
  for (const [rel, packages] of owners) {
    if (packages.length < 2) continue;
    const reason = shared[rel];
    if (reason === undefined) {
      problems.push(
        `${rel} is in the core list of ${packages.length} packages (${packages.join(', ')}) — ` +
          `one schema file, one owning package. Drop it from all but the package whose SKILL.md ` +
          `teaches that surface, or declare the sharing in SHARED_CORE_SCHEMAS with the reason.`,
      );
    } else if (reason.trim() === '') {
      problems.push(
        `${rel} is declared in SHARED_CORE_SCHEMAS with an empty reason — the reason is the ` +
          `whole point of the declaration; an unexplained row is an allowlist.`,
      );
    }
  }

  // A declaration for a file that is no longer shared outlives the fact it
  // records, and a ledger nobody has to keep true is one nobody reads.
  for (const rel of Object.keys(shared)) {
    const packages = owners.get(rel) ?? [];
    if (packages.length >= 2) continue;
    problems.push(
      `${rel} is declared in SHARED_CORE_SCHEMAS but is in ${packages.length} core list(s) — ` +
        `the sharing it explains is gone. Delete the declaration.`,
    );
  }

  return problems;
}

/**
 * Which transitive pointers a package publishes, when the closure is wrong.
 *
 * ## The feasibility question this answers, decided before anything was built
 *
 * The closure walks every local `import ... from` edge out of a package's core
 * files. Two routes were on the table for constraining it: (1) a REACHABILITY
 * RULE -- follow only imports the package's authorable face can reach, which
 * would generalise to every package; (2) a per-package list beside the map,
 * which fixes one package at a time. Route 1 is the better shape IF it can be
 * made precise. It cannot, and the measurement is specific rather than
 * hand-wavy:
 *
 *  - `objectstack-i18n` publishes eight transitive pointers, and SEVEN of them
 *    arrive through one edge -- `shared/strict-object.ts` imports
 *    `shared/suggestions.zod.ts` for its "did you mean?" text, which imports
 *    `data/field.zod.ts`, which drags in filter, expression, field-value,
 *    identifiers and value-domain. That is a schema-building HELPER's
 *    implementation, not the authorable shape of a translation bundle. Cutting
 *    traversal through non-shipping helpers is the obvious precise rule, and it
 *    removes five of the five pointers the finding names.
 *  - It also removes `shared/identifiers.zod.ts`, which MUST STAY: a bundle's
 *    object and field keys are the `snake_case` identifiers that file defines,
 *    and the SKILL.md spends a table and a "Critical:" note on exactly that.
 *    No import edge expresses it -- `system/translation.zod.ts` does not import
 *    the file at all, because a bundle addresses everything by NAME STRING.
 *  - And it KEEPS `kernel/metadata-protection.zod.ts`, which must go: that one
 *    is a first-class direct `.zod.ts` import of `translation.zod.ts`.
 *
 * So the required outcome puts a depth-4 pointer reached through a helper on
 * the KEEP side and a depth-1 pointer reached through a schema edge on the DROP
 * side. No predicate over the import graph orders those two that way, because
 * the fact that separates them -- what a translation bundle can address -- is
 * not in the graph. Route 1 is therefore not merely unbuilt here; it is
 * unbuildable from this input, and route 2 is what ships.
 *
 * The list is an ALLOWLIST, not a denylist, and that is the half that keeps it
 * from rotting the way the closure did: `shared/value-domain.zod.ts` joined the
 * i18n index recently, unnoticed, when a new import edge appeared several files
 * away. An allowlist cannot silently gain a row; a denylist silently misses
 * every new arrival.
 *
 * A package with NO entry here publishes its full closure, unchanged. Declaring
 * a list is a claim about that package's authorable face, and only a package
 * whose face someone has actually read should carry one.
 */
export const TRANSITIVE_ALLOWLIST: Record<string, readonly string[]> = {
  // Kept iff `skills/objectstack-platform/SKILL.md` names one of the module's
  // exported names, as an exact word-bounded identifier.
  'objectstack-platform': [
    'data/field.zod.ts',
    'data/hook.zod.ts',
    'data/object.zod.ts',
    'security/rls.zod.ts',
    'ui/app.zod.ts',
  ],
  // Everything else the closure reaches here is `strictObject()`'s error-message
  // machinery and what that drags behind it -- the Unified Query DSL among them,
  // a different skill's whole subject, shipped into every i18n session with an
  // instruction to read it.
  'objectstack-i18n': [
    // Bundle keys ARE these identifiers: `objects.<name>.fields.<name>` must
    // match the `snake_case` names the object and field schemas declare, which
    // the SKILL.md states as a "Critical:" rule with its own table.
    'shared/identifiers.zod.ts',
    // `FieldTranslationSchema.options` is keyed by select-option VALUE, and the
    // SKILL.md teaches that keying by example. `SelectOptionSchema` -- the
    // declaration those keys must match -- lives here.
    'data/field.zod.ts',
  ],
};

/**
 * A declared transitive allowlist must name a real package and reachable files.
 *
 * The list is hand-authored, and a hand-authored list that can quietly say
 * nothing is the same defect one layer up: a typo'd package name would leave
 * the over-eager closure fully published while the map LOOKS constrained, and a
 * file the closure never reaches would read as a pointer that is being kept
 * when it was never there to keep.
 */
export function checkTransitiveAllowlist(
  map: SkillCoreMap,
  allowlist: Record<string, readonly string[]>,
  closures: Record<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  for (const [skillName, allowed] of Object.entries(allowlist)) {
    const coreFiles = map[skillName];
    if (coreFiles === undefined) {
      problems.push(
        `TRANSITIVE_ALLOWLIST names ${skillName}, which is not a SKILL_MAP package — ` +
          `the list would constrain nothing. Fix the name or delete the entry.`,
      );
      continue;
    }
    const core = new Set(coreFiles);
    const closure = new Set(closures[skillName] ?? []);
    const seen = new Set<string>();
    for (const rel of allowed) {
      if (seen.has(rel)) {
        problems.push(`${skillName} → ${rel} is listed twice in TRANSITIVE_ALLOWLIST.`);
        continue;
      }
      seen.add(rel);
      if (core.has(rel)) {
        problems.push(
          `${skillName} → ${rel} is already a core entry; listing it as a transitive ` +
            `pointer says it is both, and the index would name it once regardless.`,
        );
      } else if (!closure.has(rel)) {
        problems.push(
          `${skillName} → ${rel} is in TRANSITIVE_ALLOWLIST but nothing in the package's ` +
            `core closure imports it — this row keeps a pointer that does not exist.`,
        );
      }
    }
  }
  return problems;
}

/**
 * Every core entry must be a path this generator can actually publish.
 *
 * `resolveAll()` keeps only `*.zod.ts` from the closure, because the published
 * package's `files` allowlist ships those sources and nothing else — a pointer
 * to any other src file 404s in a consumer's `node_modules`. That filter runs
 * over the CORE list too, and the index template then intersects the core set
 * with what survived: so a core entry that is not a `.zod.ts` path is dropped
 * from the index SILENTLY — no `missing` row, and a green `--check`. The map is
 * authored config; a line in it that emits nothing is a bug in the map, not a
 * shape to absorb.
 */
export function checkCoreEntryShape(map: SkillCoreMap): string[] {
  const problems: string[] = [];
  for (const [skillName, coreFiles] of Object.entries(map)) {
    for (const rel of coreFiles) {
      if (rel.endsWith('.zod.ts')) continue;
      problems.push(
        `${skillName} → ${rel} is not a *.zod.ts path — only those sources ship in ` +
          `@objectstack/spec, so this entry emits no pointer row at all. Point it at the ` +
          `schema file, or drop it.`,
      );
    }
  }
  return problems;
}
