// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/metadata/errors` — the shared driver-error discriminators for
 * the metadata storage seams (#4728 / #4825 / #4867 family).
 *
 * ## Why this subpath exists
 *
 * The "which driver failures may be silenced?" question is not local to one
 * package. It was answered first for DDL in `@objectstack/metadata`
 * (`ensureSchema`, #4728), then for reads on the legacy `DatabaseLoader` path
 * (`nextEventSeq`, #4825) — and the *canonical* transactional producer of the
 * very same numbers, `SysMetadataRepository`, lives in a different package
 * (`@objectstack/metadata-protocol`, #4867) and carried the identical defect.
 *
 * Three ways to serve that second package were considered; the third is the
 * one taken, and the first is the one this module exists to prevent:
 *
 *  1. **Copy the predicate.** Rejected. Two hand-rolled vocabularies of
 *     "benign driver error" is precisely the dual-source debt #4825 killed:
 *     a driver quirk taught to one copy and not the other produces two
 *     packages that disagree about whether data may be silently invented.
 *  2. **Sink it into a common dependency** (`@objectstack/types`,
 *     `@objectstack/spec/shared`). Architecturally attractive and explicitly
 *     *not* precluded by this module — but out of scope on the round that
 *     needed it (spec was frozen; types was under concurrent change).
 *  3. **Export it deliberately from its current home** — this file. One
 *     declaration, one implementation, one place a new driver quirk is taught.
 *
 * ## Why a subpath and not the package entry
 *
 * `@objectstack/metadata`'s root entry pulls the manager, every loader and the
 * YAML/filesystem machinery behind them. A consumer that wants a 40-line
 * predicate should not have to load any of that, and the weight is exactly
 * what would tempt the next author back to option 1. This entry re-exports
 * one leaf module and nothing else, so the cross-package edge stays a leaf
 * edge — and stays a single, greppable seam to delete if the maintainer later
 * takes option 2.
 *
 * ## Scope of the promise
 *
 * Only {@link isMissingTableError} is exported: it has a cross-package
 * consumer today. Its sibling `isSchemaAlreadyExistsError` deliberately stays
 * internal to this package — it has no consumer outside it, and an exported
 * symbol nobody imports is a promise made for nothing (Prime Directive #10,
 * pointed at our own API surface). Add it here the day something outside
 * `@objectstack/metadata` needs it, not before.
 */

export { isMissingTableError } from './utils/schema-sync-errors.js';
