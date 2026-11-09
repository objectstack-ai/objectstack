// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The by-name readers that consult `(package, name)` (ADR-0150 D3/D4)
 *
 * Child R (#31575, made a lean core by R2 #31716) built ONE resolver for a
 * bare name, {@link resolvePackageScopedName}, and wired no reader to it.
 * Each child E of epic #31527 wires the readers of its types, and every one of
 * them goes through {@link readPackageScopedItem} here — the resolver's answer
 * turned into what a by-name reader returns — so no reader re-states the rule.
 *
 * ## The types wired so far
 *
 * {@link PACKAGE_SCOPED_READ_TYPES}: the presentation and AI types of child E8
 * (#31680) — app, page, dashboard, report, book, analytics cube, tool, skill
 * and agent. A later child adds its own types to the list in its own change;
 * until then a type's by-name read stays `SchemaRegistry.getItem`'s, exactly
 * as before (`SchemaRegistry.resolveItem`).
 *
 * ## What a reader answers
 *
 *  - **resolved** → the item, from the step that reached it (the caller
 *    package's own, the unique holder in its declared closure, or for a
 *    caller with no package the environment's own item, else the unique
 *    package holder);
 *  - **not-found** → `undefined`, as before: zero holders is never a refusal;
 *  - **refused** → {@link PackageScopedNameRefusedError}, thrown: the
 *    resolver's refusal, its sentence unchanged, naming every candidate.
 *    ⛔ Never `undefined`: a refusal read as a miss would tell the caller the
 *    name means nothing, when it means more than one thing (red line 2).
 *
 * ## What this changes against `getItem` (declared on #31680)
 *
 * `getItem` answers the bare slot, then the caller's composite slot, then the
 * FIRST composite slot of any package. Through the resolver:
 *
 *  1. a bare name two packages hold, read by a caller with no package, is
 *     refused naming both (it served the first registered);
 *  2. a package caller's bare name whose only holder is the environment's own
 *     item is refused, naming the environment (ADR-0150 D3 (a));
 *  3. a package caller's bare name whose one package holder is outside its
 *     declared dependency closure (plus `sys`) is refused, naming the holder
 *     (D3 step 3).
 *
 * Every other answer is unchanged: one holder is served to every caller that
 * may reach it, and an overlay of the one holder is still served first.
 *
 * Inside the lean `./core` entry's closure (ADR-0076 D2): it reads the
 * resolver, which since R2 reads only `@objectstack/core` and
 * `@objectstack/metadata-core`.
 */

import type { PackageScopedRefusal } from '@objectstack/core';
import {
  resolvePackageScopedName,
  type PackageScopedQuery,
  type PackageScopedRegistry,
} from './package-scoped-resolver.js';

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
  readonly refusal: PackageScopedRefusal;

  constructor(refusal: PackageScopedRefusal) {
    super(refusal.message);
    this.name = 'PackageScopedNameRefusedError';
    this.refusal = refusal;
  }
}

/**
 * Read `(type, name)` for a caller through {@link resolvePackageScopedName}:
 * the item, `undefined` when nothing holds the name, or a thrown
 * {@link PackageScopedNameRefusedError} naming every candidate.
 *
 * @throws {PackageScopedNameRefusedError} when the resolver refuses.
 */
export function readPackageScopedItem<T>(registry: PackageScopedRegistry, query: PackageScopedQuery): T | undefined {
  const resolution = resolvePackageScopedName<T>(registry, query);
  if (resolution.status === 'resolved') return resolution.item;
  if (resolution.status === 'refused') throw new PackageScopedNameRefusedError(resolution);
  return undefined;
}
