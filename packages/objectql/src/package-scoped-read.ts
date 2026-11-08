// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The by-name readers that consult `(package, name)` (ADR-0150 D3/D4)
 *
 * Child R (#31575) built ONE resolver for a bare name and wired no reader to
 * it. Each child E of epic #31527 wires the readers of its types; this module
 * holds what those readers share beside the resolver itself: which types are
 * wired, and the refusal a reader raises.
 *
 * ## The types wired so far
 *
 * {@link PACKAGE_SCOPED_READ_TYPES}: the presentation and AI types of child E8
 * (#31680) — app, page, dashboard, report, book, analytics cube, tool, skill
 * and agent. A later child adds its own types to the list in its own change.
 *
 * ## What a reader answers
 *
 *  - **resolved** → the item, from the step that reached it;
 *  - **not-found** → `undefined`, as before: zero holders is never a refusal;
 *  - **refused** → {@link PackageScopedNameRefusedError}, thrown: the
 *    resolver's refusal, its sentence unchanged, naming every candidate.
 *    ⛔ Never `undefined`: a refusal read as a miss would tell the caller the
 *    name means nothing, when it means more than one thing (red line 2).
 *
 * Lean on purpose: it imports nothing, so the registry, the engine and
 * `MetadataFacade` — all inside the `./core` entry's closure (ADR-0076 D2) —
 * may read it.
 */

/**
 * The types whose by-name readers consult `(package, name)` today — child E8's
 * nine (#31680), as the registry spells them. Each later child of epic #31527
 * appends its own.
 */
export const PACKAGE_SCOPED_READ_TYPES = Object.freeze([
  'app',
  'page',
  'dashboard',
  'report',
  'book',
  'analytics_cube',
  'tool',
  'skill',
  'agent',
] as const);

/** A type whose by-name readers consult `(package, name)` ({@link PACKAGE_SCOPED_READ_TYPES}). */
export type PackageScopedReadType = (typeof PACKAGE_SCOPED_READ_TYPES)[number];

/** Do `type`'s by-name readers consult `(package, name)`? */
export function isPackageScopedReadType(type: unknown): type is PackageScopedReadType {
  return typeof type === 'string' && (PACKAGE_SCOPED_READ_TYPES as readonly string[]).includes(type);
}

/**
 * The resolver's refusal as a reader carries it: the reason, the item, the
 * caller's package, every candidate, and the resolver's one sentence
 * (`PackageScopedRefusal`, described here by shape so this module stays lean).
 */
export interface PackageScopedReadRefusal {
  readonly status: 'refused';
  readonly reason: string;
  readonly type: string;
  readonly name: string;
  readonly callerPackageId: string | null;
  readonly candidates: readonly unknown[];
  readonly message: string;
}

/**
 * A by-name read the package-scoped resolver refused (ADR-0150 D3): the name
 * means more than one item here, or only items the caller may not reach. The
 * message is the resolver's own sentence, which names every candidate.
 *
 * The ADR-0112 envelope a wire door answers: `409 RESOURCE_CONFLICT`, the
 * standard catalog's member for a name in conflict, which ADR-0150 D5 gives a
 * by-name door's ambiguity. ⛔ Never the `500` fallback, and never `404`.
 */
export class PackageScopedNameRefusedError extends Error {
  readonly code = 'RESOURCE_CONFLICT';
  readonly status = 409;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. */
  readonly httpStatus = 409;
  /** The resolver's refusal: the reason, the caller's package and every candidate. */
  readonly refusal: PackageScopedReadRefusal;

  constructor(refusal: PackageScopedReadRefusal) {
    super(refusal.message);
    this.name = 'PackageScopedNameRefusedError';
    this.refusal = refusal;
  }
}
