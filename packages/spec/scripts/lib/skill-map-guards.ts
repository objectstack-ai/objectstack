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

/** A `SKILL_MAP`-shaped value: skill name → its core schema paths. */
export type SkillCoreMap = Record<string, readonly string[]>;

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
