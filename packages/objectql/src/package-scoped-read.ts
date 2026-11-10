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
 * and agent — then `api` (#32069), whose in-memory store `@objectstack/metadata`
 * keeps per `(package, name)`, so its qualified read serves the holder's own
 * body, the picklist (#32070), whose bare by-name read was the last of its
 * readers still on `getItem`, `mapping` (#32071, a reader the
 * picklist-family backstop #31700 needs) and `dataset` (#32072, a reader
 * #31700 needs before it narrows: `POST /analytics/dataset/query` reads its
 * `datasetName` through the protocol's by-name read, which is this resolver's
 * for the types listed here). A later child adds its own types to the list in
 * its own change; until then a type's by-name read stays
 * `SchemaRegistry.getItem`'s, exactly as before (`SchemaRegistry.resolveItem`).
 *
 * `mapping`'s two by-name readers outside `/meta` — the import door's
 * `mappingName` (`@objectstack/rest`) and a connector pull that names no
 * package (`@objectstack/service-automation`) — read through the protocol's
 * by-name read with no package, so they are callers with no package: one
 * holder is served as before, and a name two packages hold is refused naming
 * both (each door answers that refusal as the `409` it is). A pull that names
 * its package (`callerPackageId`, which the job binder sets to the package
 * declaring the job, #32071) reads through `resolvePackageScopedName` from
 * that package instead.
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

import { PackageScopedNameRefusedError } from '@objectstack/core';
import {
  resolvePackageScopedName,
  type PackageScopedQuery,
  type PackageScopedRegistry,
} from './package-scoped-resolver.js';

/**
 * The types whose by-name readers consult `(package, name)` today — child E8's
 * nine (#31680), as the registry spells them, then `api` (#32069), the
 * picklist (#32070), `mapping` (#32071) and `dataset` (#32072). Each later
 * child of epic #31527 appends its own.
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
  'api',
  // [#32070] the bare `/meta/picklist/NAME` read; a field's `picklist:` is
  // already resolved by its referrer's package (child E6), not through here.
  'picklist',
  // #32071: the import door's `mappingName` and the connector pull.
  'mapping',
  // #32072: the analytics dataset query door and the dataset AI tools.
  'dataset',
] as const);

/** A type whose by-name readers consult `(package, name)` ({@link PACKAGE_SCOPED_READ_TYPES}). */
export type PackageScopedReadType = (typeof PACKAGE_SCOPED_READ_TYPES)[number];

/** Do `type`'s by-name readers consult `(package, name)`? */
export function isPackageScopedReadType(type: unknown): type is PackageScopedReadType {
  return typeof type === 'string' && (PACKAGE_SCOPED_READ_TYPES as readonly string[]).includes(type);
}

/**
 * The refusal a by-name read throws: `@objectstack/core`'s one class (ADR-0150
 * D5, `409 RESOURCE_CONFLICT`), re-exported under its own name so every
 * existing import keeps resolving — the same binding plugin-sharing's doors
 * throw, so one `instanceof` matches both.
 */
export { PackageScopedNameRefusedError };

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
