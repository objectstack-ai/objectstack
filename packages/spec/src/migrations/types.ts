// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Types for the replayable **migration chain** (ADR-0087 D3).
 *
 * Where the conversion layer (D2) breaks *invisibly* — accepting the old shape
 * at load for one major — the migration chain is the L2 rung: *break
 * executably*. For every retirement family's semantic changes (one D3 entry
 * per family, even when a lossless D2 conversion also exists for it) and for
 * the graduated conversions retired from the load path, the spec ships a
 * **permanent, ordered chain of per-major steps**, back to the
 * chain's support floor (`MIGRATION_SUPPORT_FLOOR`, `registry.ts`). A consumer
 * at or above the floor runs `objectstack migrate meta --from N` and replays
 * every remaining step in one command, however many majors that spans — it
 * never needed to be present, warned, or reading anything while those majors
 * shipped; from the floor forward this is the database-migration model applied
 * to metadata source files, and **timeliness is never load-bearing**. Below
 * the floor the command refuses (`MigrationFloorError`) rather than
 * half-migrating — reaching the floor is the one prerequisite this model does
 * not remove.
 *
 * Two feeders compose each major's step (ADR-0087 D3):
 *  - **graduated conversions** — the D2 entries with `toMajor === N`, retired
 *    from the load path in N+1 and preserved here as that major's *mechanical*
 *    transforms (reusing the very same declarative transform + fixture pair);
 *  - **semantic changes** — one entry per retirement family, even when a
 *    lossless D2 conversion also exists for it (D2 carries the mechanical
 *    data repair only): a structured TODO (surface, reason, acceptance
 *    criteria) so the consumer agent knows exactly what judgment is
 *    delegated to it, rather than silence.
 */

/**
 * One retirement family's D3 entry — owed even when a lossless D2 conversion
 * carries the data repair — surfaced as a structured TODO the consumer agent
 * must resolve by hand (ADR-0087 D3: "never silence").
 */
export interface SemanticMigration {
  /** Stable, kebab-case id. */
  id: string;
  /** Dotted surface the change governs, e.g. `object.titleFormat`. */
  surface: string;
  /** The canonical replacement the author should move to. */
  replacement: string;
  /**
   * Why the consumer still owes a judgment here, even when D2 already
   * repaired the data (the one load-bearing prose field).
   */
  reason: string;
  /** How the consumer proves the hand-migration correct (their own verify loop). */
  acceptanceCriteria: string;
  /**
   * Ids of the D2 conversions whose APPLIED edits this entry judges: the
   * mechanical rewrites the chain replay makes, for which this entry states the
   * judgment the consumer still owes (keep the written value, delete it, or
   * narrow the source instead). Each id names a conversion that this entry's
   * step or an earlier one replays (`MigrationStep.conversionIds`), and
   * `migrations.test.ts` refuses one that does not.
   *
   * The join key is the same name on both sides: an id here is the
   * `conversionId` of every {@link MigrationApplication} that conversion
   * produces, and the chain copies this field onto the entry's
   * {@link MigrationTodo} like every other field. So a printer of a chain
   * result can show the entry beside each applied edit it judges, for review.
   * The link moves nothing out of the chain result: the entry is reported as a
   * TODO of its hop whether or not any edit it names was applied.
   *
   * Omit it when the entry judges no mechanical edit. Add an id only after
   * reading the entry and confirming that it judges that conversion's output;
   * ⛔ never derive one from the entry's prose naming the id, since prose also
   * names incidental analogues.
   */
  conversionIds?: readonly string[];
}

/**
 * One major's step in the chain: the mechanical transforms (graduated D2
 * conversions, referenced by id) plus any semantic TODOs, with a single prose
 * `rationale`.
 */
export interface MigrationStep {
  /** The protocol major this step migrates *into* (N; migrates N−1 sources to N). */
  toMajor: number;
  /** One-paragraph human rationale — the one place prose is load-bearing (D3). */
  rationale: string;
  /**
   * Ids of the D2 conversions that graduated into this step. Their declarative
   * transforms are replayed against the consumer's source (not just at load).
   */
  conversionIds: readonly string[];
  /**
   * One entry per retirement family authored for this major, as structured
   * TODOs — owed even when a lossless D2 conversion also exists for it.
   */
  semantic: readonly SemanticMigration[];
}

/** A single mechanical rewrite the chain applied to a source, for the review diff. */
export interface MigrationApplication {
  /** The major whose step produced this rewrite. */
  toMajor: number;
  /** The graduated conversion id that performed it. */
  conversionId: string;
  surface: string;
  from: string;
  to: string;
  /** Where in the stack it applied, e.g. `flows[0].nodes[2].type`. */
  path: string;
}

/** A semantic TODO emitted for a hop, carrying the major it belongs to. */
export interface MigrationTodo extends SemanticMigration {
  toMajor: number;
}

/** The result of replaying one hop (one major) — enables `--step` per-hop verify. */
export interface MigrationHopResult {
  toMajor: number;
  rationale: string;
  stack: Record<string, unknown>;
  applied: MigrationApplication[];
  todos: MigrationTodo[];
}

/** The full result of composing + applying a chain from `fromMajor` to `toMajor`. */
export interface MigrationChainResult {
  fromMajor: number;
  toMajor: number;
  /** The migrated stack (mechanical transforms applied; semantic TODOs left for the agent). */
  stack: Record<string, unknown>;
  /** Every mechanical rewrite across all hops, in application order. */
  applied: MigrationApplication[];
  /** Every semantic TODO across all hops — the judgment delegated to the consumer. */
  todos: MigrationTodo[];
  /** Per-hop checkpoints, in order (for `--step` bisection). */
  hops: MigrationHopResult[];
}
