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

import type { StackDefinitionKey } from '../stack.zod.js';

/**
 * A top-level stack key a {@link SemanticRelevance} question may name: any key
 * `ObjectStackDefinitionSchema` declares, except the five the evaluation reads
 * as CARRIERS of other definitions rather than as a family of its own —
 * `manifest` (always present), `packages` (whose bodies are searched for the
 * named keys), and `plugins` / `devPlugins` / `tiers` (whose entries, or the
 * platform plugins a tier preset loads, can contribute metadata no reader of
 * the stack can see, so their presence makes every answer unknown).
 */
export type SemanticRelevanceKey = Exclude<
  StackDefinitionKey,
  'manifest' | 'packages' | 'plugins' | 'devPlugins' | 'tiers'
>;

/**
 * "Does the stack declare anything under one of these top-level keys?" — the
 * one relevance question protocol 18 ships.
 *
 * Answered over the stack as loaded, map form included: a key whose value is a
 * non-empty array or map is PRESENT, an absent key or an empty array or map is
 * ABSENT, and any other value (a function, a promise, a scalar) is UNKNOWN. The
 * same key inside each `packages[].manifest` body counts too, since an
 * assembled multi-package stack carries its collections there and not at the
 * top level.
 */
export interface StackDeclaresRelevance {
  /** The discriminant: a question about which top-level keys the stack declares. */
  readonly kind: 'stack-declares';
  /**
   * Every top-level key under which the entry's surface can be authored in a
   * source written against the step's PREVIOUS major. The surface is absent
   * only when every one of them is: list a second key wherever the governed
   * shape can also be written (a report a page component carries inline, a
   * predicate a sharing rule carries as well as a permission set).
   */
  readonly keys: readonly [SemanticRelevanceKey, ...SemanticRelevanceKey[]];
}

/**
 * A structured, stack-derived relevance question for a {@link SemanticMigration}
 * — the one exit ADR-0087 D3 ("never silence") leaves a notice: an entry
 * leaves `os migrate meta`'s default list only when this question, evaluated
 * over the stack being migrated, PROVES the entry's surface absent. ⛔ Never
 * free text, and never a match against the prose of `surface`.
 *
 * A closed union of named questions rather than a callback: a callback could do
 * arbitrary work and could not be enumerated, reviewed or pinned. A new kind of
 * question is a new member here, evaluated in `chain.ts`.
 *
 * The answer is three-valued, and only one value takes an entry off a
 * printer's default list. `absent` (the stack provably carries no such
 * surface) names the entry in {@link MigrationChainResult.absentTodos} — it
 * stays in `todos` too; `present` and `unknown` (a value the question cannot
 * read, a stack that is not a plain object, or a `plugins` / `devPlugins` /
 * `tiers` entry that can contribute metadata the stack does not show) do not. The proof is about the definition the chain reads: metadata
 * a deployment stores at runtime (Studio, the metadata API) is not part of it.
 */
export type SemanticRelevance = StackDeclaresRelevance;

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
  /**
   * The structured question that can prove this entry irrelevant to a stack:
   * when the chain evaluates it as `absent` over the stack it migrates, the
   * entry — still reported in `todos` — is also named in
   * {@link MigrationChainResult.absentTodos}, and `os migrate meta` counts it
   * rather than listing it (`--all` lists it). See {@link SemanticRelevance}
   * for the evaluation.
   *
   * Omit it — the entry is then always listed — unless the surface lives ONLY
   * under top-level stack keys the question names. Two cases keep it listed by
   * construction: an unreadable stack answers `unknown`, and an entry whose
   * `conversionIds` names a conversion that applied an edit in the same run is
   * listed whatever the question answers, since the edit is itself a proof the
   * surface is there. Every entry carrying this field is enumerated by
   * `semantic-relevance.test.ts`, so adding one is a reviewed edit.
   */
  relevantWhen?: SemanticRelevance;
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
  /** Every semantic TODO of this hop, whatever the stack holds. */
  todos: MigrationTodo[];
  /**
   * The subset of this hop's `todos` — the same objects, in the same order —
   * whose surface the stack provably lacks (see
   * {@link MigrationChainResult.absentTodos}).
   */
  absentTodos: MigrationTodo[];
}

/** The full result of composing + applying a chain from `fromMajor` to `toMajor`. */
export interface MigrationChainResult {
  fromMajor: number;
  toMajor: number;
  /** The migrated stack (mechanical transforms applied; semantic TODOs left for the agent). */
  stack: Record<string, unknown>;
  /** Every mechanical rewrite across all hops, in application order. */
  applied: MigrationApplication[];
  /**
   * Every semantic TODO across all hops — the judgment delegated to the
   * consumer: every entry of every hop crossed, in chain order, whatever the
   * stack holds. {@link absentTodos} never removes anything from it.
   */
  todos: MigrationTodo[];
  /**
   * The subset of {@link todos} — the same objects, in the same order — whose
   * {@link SemanticMigration.relevantWhen} question PROVED their surface absent
   * from the stack: absent from the stack the chain was handed and from every
   * hop's checkpoint after it. A printer may leave these off its default list
   * only because they are named here (ADR-0087 D3, "never silence"): it counts
   * them, and lists them on request. Empty when no entry carries a question
   * the stack answers `absent`.
   */
  absentTodos: MigrationTodo[];
  /** Per-hop checkpoints, in order (for `--step` bisection). */
  hops: MigrationHopResult[];
}
