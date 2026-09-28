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
 * Stable code for a **conversion TODO** — a site a conversion recognised as a
 * pre-protocol shape and deliberately LEFT AS STORED, because no lossless
 * rewrite exists for it.
 *
 * ADR-0087 D3's model, applied to one site: convert where lossless, a
 * structured TODO otherwise — never silence. A conversion that declines part
 * of its own surface (a filter carrying a combinator the canonical shape
 * cannot spell, say) returns that site unchanged, so no
 * {@link ConversionNotice} fires for it; without this channel the pass that
 * reads the notices would count the site as already canonical. The TODO is
 * what lets an operator answer "did it convert my row" from the pass's own
 * output.
 */
export const CONVERSION_TODO_CODE = 'OS_METADATA_CONVERSION_TODO' as const;

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
 * The per-site detail a conversion reports when it recognises a pre-protocol
 * shape on its surface and leaves it as stored, because no lossless rewrite
 * exists (see {@link CONVERSION_TODO_CODE}).
 */
export interface ConversionTodoDetail {
  /** Where the site is, e.g. `pages[0].regions[0].components[1].properties.filter`. */
  path: string;
  /** The pre-protocol shape left in place, as seen in the source (serialized). */
  from: string;
  /**
   * Why no lossless rewrite exists — naming the part that blocks it (the
   * combinator, the operator, the key) and the node it sits on — and what the
   * hand rewrite has to decide. Actionable, like a conflict's `reason`.
   */
  reason: string;
}

/**
 * A structured TODO notice: a site left as stored because no lossless rewrite
 * exists. Same machine-first shape as {@link ConversionNotice}; different code,
 * and no `to` — nothing was converted.
 */
export interface ConversionTodoNotice {
  code: typeof CONVERSION_TODO_CODE;
  /** The {@link MetadataConversion.id} whose surface the site is on. */
  conversionId: string;
  /** Dotted surface the conversion governs. */
  surface: string;
  /** The pre-protocol shape left in place. */
  from: string;
  /** Where in the stack the site is. */
  path: string;
  /** Why no lossless rewrite exists (see {@link ConversionTodoDetail.reason}). */
  reason: string;
  /** Derived, human-facing one-liner. */
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
  /**
   * Sink for a site left as stored because no lossless rewrite exists (see
   * {@link ConversionTodoDetail}). Absent unless the caller asked for TODOs; a
   * conversion calls it optionally and leaves the site unchanged either way.
   */
  reportTodo?: (detail: ConversionTodoDetail) => void;
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
 * The members every conversion carries, whatever its retirement state. Not
 * exported: {@link MetadataConversion} is the one public name; this body and
 * the two retirement states below are how it is spelled.
 */
interface MetadataConversionBody {
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
   * conversion over a closed surface ignores `context`. A conversion that
   * recognises a pre-protocol shape on its surface but has no lossless rewrite
   * for it leaves the site unchanged and reports it via `context.reportTodo`.
   */
  apply(
    stack: Record<string, unknown>,
    emit: (detail: ConversionApplication) => void,
    context?: ConversionContext,
  ): Record<string, unknown>;
  /** Old→new fixture pair driving the CI check. */
  fixture: ConversionFixture;
}

/** A conversion the authoring funnel still replays: no retirement, so no retirement version. */
interface LiveConversionState {
  /** Absent (or `false`): the authoring funnel replays this entry. See the retired state. */
  retiredFromLoadPath?: false;
  /** Absent: a live entry has no retirement version. Set it together with `retiredFromLoadPath`. */
  retiredAfter?: undefined;
}

/** A conversion retired from the authoring surface, stamped with the version it retired after. */
interface RetiredConversionState {
  /**
   * When `true`, this conversion is **retired from the AUTHORING surface**: the
   * authoring funnel (`normalizeStackInput` — `defineStack`, `validate`,
   * `lint`, `compile`, `info`, `doctor`) no longer replays it, so an author
   * writing the old shape meets the schema's rejection or its tombstone and is
   * taught the canonical spelling. This is the ADR-0087 D2 window's second half
   * ("retired in N+1 — but never deleted"), and it is also how a pre-launch
   * one-step rename (which never had a load window at all) is preserved in the
   * chain.
   *
   * ⚠️ The flag's name says "load path", but its reach is the authoring surface
   * only — **data-at-rest load paths replay retired entries on purpose**:
   * stored-row rehydration (`applyConversionsToStoredItem`, which pins
   * `includeRetired: true` rather than offering it), flow rehydration in the
   * automation engine, and the artifact-ingestion door
   * (`applyArtifactForwardConversions`, inside its declared-floor window, which
   * it decides per entry with {@link RetiredConversionState.retiredAfter}). A
   * row, a stored flow or a built artifact has no author for a tombstone to
   * teach, and refusing a shape that once worked would only break data — see
   * ADR-0087's `## Addendum (2026-07-31)` and the #12772 ruling. `objectstack
   * migrate meta` replays it too, against *source* metadata, but by id through
   * `applyMetaMigrations` rather than through this flag.
   *
   * ⇒ Setting this does NOT confine a rewrite to history. For a conversion
   * whose old and new shapes are both legal and mean different things (a
   * default flip, not a rename), the data-at-rest seams will still apply it.
   */
  retiredFromLoadPath: true;
  /**
   * The last published `@objectstack/spec` version whose authoring surface
   * still accepted the old shape, as a stable `x.y.z`. REQUIRED on every
   * retired entry, so tsc refuses a retirement that omits it.
   *
   * It is a FACT when the entry is written, never a guess at the next release
   * number: it is the package's version label at the moment the retirement
   * lands — `main` carries the last release's label until the next release is
   * cut, and that release is the first one to refuse the old shape. For an
   * entry already published, it is the stable release just before the first
   * published tarball that carries the entry retired.
   *
   * Read by the artifact-ingestion door (`applyArtifactForwardConversions`,
   * `@objectstack/metadata-core`): an artifact whose declared `engines.protocol`
   * floor is at or below this version predates the retirement, so the door
   * replays this entry even when that floor is not below the runtime's own
   * version label — the gap a `main` that enforces a retirement the label has
   * not caught up with would otherwise leave. A floor above it still meets the
   * strict parse and its tombstone.
   *
   * Pinned against the published tarballs by `retired-after.census.test.ts`
   * (the committed census beside it, re-derived from npm by
   * `scripts/build-retired-after-census.ts`).
   */
  retiredAfter: `${number}.${number}.${number}`;
}

/**
 * A single declarative, lossless metadata conversion.
 *
 * `apply` is a **pure, immutable** transform: it returns a stack with the old
 * shape rewritten to the canonical one (copy-on-write — untouched branches are
 * shared, so `plugins` and other non-clonable values are never touched), and
 * reports each rewrite via `emit`. Registry glue turns each
 * {@link ConversionApplication} into a full {@link ConversionNotice}.
 *
 * Either live or retired: a retired entry (`retiredFromLoadPath: true`) must
 * also carry `retiredAfter`, the version it retired after; a live entry carries
 * neither.
 */
export type MetadataConversion = MetadataConversionBody & (LiveConversionState | RetiredConversionState);
