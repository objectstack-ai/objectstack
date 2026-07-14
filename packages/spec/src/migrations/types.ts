// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Types for the replayable **migration chain** (ADR-0087 D3).
 *
 * Where the conversion layer (D2) breaks *invisibly* — accepting the old shape
 * at load for one major — the migration chain is the L2 rung: *break
 * executably*. For the breaks D2 cannot hide (semantic changes with no lossless
 * mapping) and for the graduated conversions retired from the load path, the
 * spec ships a **permanent, ordered chain of per-major steps**. A consumer that
 * slept through four majors runs `objectstack migrate meta --from N` and replays
 * every step in one command — it never needed to be present, warned, or reading
 * anything while those majors shipped. This is the database-migration model
 * applied to metadata source files; **timeliness is never load-bearing**.
 *
 * Two feeders compose each major's step (ADR-0087 D3):
 *  - **graduated conversions** — the D2 entries with `toMajor === N`, retired
 *    from the load path in N+1 and preserved here as that major's *mechanical*
 *    transforms (reusing the very same declarative transform + fixture pair);
 *  - **semantic changes** — breaks with no lossless mapping, which cannot be
 *    auto-applied and instead emit a structured TODO (surface, reason,
 *    acceptance criteria) so the consumer agent knows exactly what judgment is
 *    delegated to it, rather than silence.
 */

/**
 * A non-lossless change that cannot be auto-applied — surfaced as a structured
 * TODO the consumer agent must resolve by hand (ADR-0087 D3: "never silence").
 */
export interface SemanticMigration {
  /** Stable, kebab-case id. */
  id: string;
  /** Dotted surface the change governs, e.g. `object.titleFormat`. */
  surface: string;
  /** The canonical replacement the author should move to. */
  replacement: string;
  /** Why this is not losslessly convertible (the one load-bearing prose field). */
  reason: string;
  /** How the consumer proves the hand-migration correct (their own verify loop). */
  acceptanceCriteria: string;
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
  /** Non-lossless changes authored for this major, as structured TODOs. */
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
