// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The normalisation an alias table's keys are indexed under (#5481).
 *
 * This lives in its own leaf module for one reason: **two readers must agree.**
 * `strictUnknownKeyError` folds every alias key through it to build the lookup
 * a rejected key is answered from, and `alias-integrity.test.ts` folds the same
 * keys through it to prove no two of them collide. A hand-copied regex in the
 * gate would be a second copy of the truth — the exact shape #5013 and #5481
 * were both filed against — and it would fail silently: widen the probe here
 * (strip `.`, fold plurals) and a gate carrying the old expression keeps
 * passing over collisions that now exist.
 *
 * It is deliberately **not** re-exported from `shared/index.ts`. Like
 * `strict-object.ts`'s `strictObjectDeclarations`, it is an internal seam the
 * gate reaches by relative path, not part of the `@objectstack/spec` contract.
 */

/** `reference_to` / `referenceTo` / `Reference-To` all collapse onto one probe. */
export const aliasProbe = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, '');
