// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `findOne` predicate's objectql-side path — a **re-export of its home** in
 * `@objectstack/metadata-core`, the same shape the two write-side twins use
 * (`engine-delete-dispatch.ts`, `engine-update-dispatch.ts`).
 *
 * ## Why the predicate lives one package down, and this file exists at all
 *
 * `@objectstack/objectql` **depends on** `@objectstack/metadata-protocol`, so
 * the fake engines there cannot import from objectql without closing a cycle
 * turbo refuses outright. Sinking the predicate into `@objectstack/metadata-core`
 * — a package both sides already depend on, and which depends on neither — is
 * the only route that pins those doubles without inventing a dependency edge.
 * The full reasoning, with the measured cycle, is in the module header at the
 * implementation (objectstack#5619 established it for the delete twin).
 *
 * This file exists so the predicate has objectql's public spelling too: the
 * engine's own pinned test doubles and the real-engine conformance test import
 * `./engine-findone-predicate.js`, and `index.ts` re-exports the public API
 * from here.
 *
 * @see @objectstack/metadata-core `src/engine-findone-predicate.ts` — the implementation.
 * @see engine-findone-predicate.test.ts — the case-set driven against the REAL engine,
 *      which stays in this package because it needs `ObjectQL`.
 * @see ObjectQL.findOne → `requireFindOnePredicate` in `engine.ts` — the producer (#4419).
 */

export {
  engineFindOnePredicateRefusalMessage,
  resolveEngineFindOnePredicate,
  assertEngineFindOnePredicate,
  ENGINE_FINDONE_PREDICATE_CASES,
} from '@objectstack/metadata-core';

export type {
  EngineFindOnePredicate,
  EngineFindOneQueryInput,
  EngineFindOnePredicateCase,
} from '@objectstack/metadata-core';
