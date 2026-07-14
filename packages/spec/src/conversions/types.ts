// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Types for the metadata **conversion layer** (ADR-0087 D2).
 *
 * The conversion layer is the L1 rung of ADR-0087's preference ladder: *break
 * invisibly*. For every lossless protocol break — a rename, a field move, an
 * enum re-spelling, an alias removal — the spec ships a declarative transform
 * from the **N−1 shape** to the **N shape**, applied **centrally at load** (the
 * same `normalizeStackInput` seam `objectstack validate` uses). A consumer that
 * still authors the old shape keeps loading with **zero action**; the runtime
 * only ever sees the canonical shape.
 *
 * This is the Kubernetes storage-version / conversion model applied to
 * metadata, and it is deliberately the opposite of a Prime-Directive-#12
 * consumer-side dialect fallback on every axis (ADR-0087 §"Why the conversion
 * layer does not violate PD #12"):
 *
 * - **one** central, versioned table — not N scattered `cfg.a ?? cfg.b`s;
 * - **declared in the spec** — the contract owns its own history;
 * - **loud** — every application emits a structured {@link ConversionNotice};
 * - **tested** — each entry ships an old→new {@link ConversionFixture} pair;
 * - **expiring** — applied by the loader for exactly one major, then retired
 *   from the load path (graduating into the P2 migration chain, never deleted).
 */

/** Stable code stamped on every conversion notice — greppable, MCP-serializable. */
export const CONVERSION_NOTICE_CODE = 'OS_METADATA_CONVERTED' as const;

/**
 * Stable code for a **conversion conflict** — a rename whose old token is, in
 * this environment, a *live* name owned by something else (e.g. a third-party
 * flow-node executor registered under a since-retired official node type). The
 * conversion refuses to rewrite it (which would silently break that owner) and
 * instead surfaces this loud, actionable diagnostic (ADR-0078: never silent).
 */
export const CONVERSION_CONFLICT_CODE = 'OS_METADATA_CONVERSION_CONFLICT' as const;

/**
 * A structured deprecation notice emitted once per applied conversion.
 *
 * Machine-readable first (ADR-0087 D4): the loader, `validate`, and the future
 * MCP `spec_deprecations` tool all consume this shape, not prose. `message` is
 * the derived human line; every other field is data.
 */
export interface ConversionNotice {
  code: typeof CONVERSION_NOTICE_CODE;
  /** The {@link MetadataConversion.id} that fired. */
  conversionId: string;
  /** Dotted surface the conversion governs, e.g. `flow.node.type`. */
  surface: string;
  /** The protocol major that introduced the canonical shape (accepts N−1 at load). */
  toMajor: number;
  /** The protocol major in which this conversion retires from the load path (`toMajor + 1`). */
  retiresIn: number;
  /** The off-spec token/shape actually seen in the source. */
  from: string;
  /** The canonical token/shape it was converted to. */
  to: string;
  /** Where in the stack it applied, e.g. `flows[0].nodes[2].type`. */
  path: string;
  /** Derived, human-facing one-liner (prose is derived, never the source of truth). */
  message: string;
}

/** The per-application detail a conversion reports; the registry derives the full notice. */
export interface ConversionApplication {
  from: string;
  to: string;
  path: string;
}

/** The per-conflict detail a conversion reports when it refuses to rewrite a live name. */
export interface ConversionConflictDetail {
  /** The reserved/retired token that is currently a live name owned by something else. */
  token: string;
  /** Where the conflicting site is, e.g. `flows[0].nodes[2].type`. */
  path: string;
  /** Why the rewrite was refused (actionable — tells the owner what to do). */
  reason: string;
}

/**
 * A structured conflict notice: a rename was **refused** because its old token
 * is a live name in this environment. Same machine-first shape as
 * {@link ConversionNotice}; different code.
 */
export interface ConversionConflictNotice {
  code: typeof CONVERSION_CONFLICT_CODE;
  conversionId: string;
  surface: string;
  token: string;
  path: string;
  message: string;
}

/**
 * Environment-supplied context for a conversion pass. Empty on the pure
 * build/validate seam (no runtime registry to consult); populated on the
 * runtime load seam (`engine.registerFlow`) so a rename over an *open*
 * namespace (flow node types) can detect a collision with a live owner instead
 * of silently clobbering it.
 */
export interface ConversionContext {
  /**
   * Node types that are *live* in this environment (registered executors +
   * action descriptors + structural types). A node-type rename whose old token
   * is in this set is a conflict, not a conversion.
   */
  reservedNodeTypes?: ReadonlySet<string>;
  /** Sink for a refused rewrite (see {@link ConversionConflictDetail}). */
  reportConflict?: (detail: ConversionConflictDetail) => void;
}

/**
 * An old-shape → new-shape fixture pair. Every conversion entry ships one; a CI
 * check drives `before` through the load path and asserts it equals `after` and
 * emits exactly `expectedNotices` notices (ADR-0087 D2: "each entry carries an
 * old-shape → new-shape fixture pair").
 */
export interface ConversionFixture {
  /** A minimal stack authored in the old (N−1) shape. */
  before: Record<string, unknown>;
  /** The same stack after the conversion runs. */
  after: Record<string, unknown>;
  /** How many notices `before` is expected to emit (usually the count of old-shape sites). */
  expectedNotices: number;
}

/**
 * A single declarative, lossless metadata conversion.
 *
 * `apply` is a **pure, immutable** transform: it returns a stack with the old
 * shape rewritten to the canonical one (copy-on-write — untouched branches are
 * shared, so `plugins` and other non-clonable values are never touched), and
 * reports each rewrite via `emit`. Registry glue turns each
 * {@link ConversionApplication} into a full {@link ConversionNotice}.
 */
export interface MetadataConversion {
  /** Stable, kebab-case id; also the migration-chain step id when this graduates (P2). */
  id: string;
  /** The protocol major that introduced the canonical shape. */
  toMajor: number;
  /** Dotted surface, e.g. `flow.node.type`, `page.kind`, `flow.node.config`. */
  surface: string;
  /** One-line human summary of the rename/move (the load-bearing prose, kept to one field). */
  summary: string;
  /**
   * Apply the conversion to a normalized stack, immutably. Returns the (possibly
   * new) stack and calls `emit` once per rewritten site. A conversion over an
   * open namespace consults `context` (when supplied) to refuse — and report via
   * `context.reportConflict` — a rewrite whose old token is a live name; a
   * conversion over a closed surface ignores `context`.
   */
  apply(
    stack: Record<string, unknown>,
    emit: (detail: ConversionApplication) => void,
    context?: ConversionContext,
  ): Record<string, unknown>;
  /** Old→new fixture pair driving the CI check. */
  fixture: ConversionFixture;
}
