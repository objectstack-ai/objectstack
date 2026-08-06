// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The delete-dispatch predicate's original path, kept as a **re-export of its
 * new home** — `@objectstack/metadata-core` (objectstack#5619).
 *
 * ## Why the module moved, and why this file did not
 *
 * The predicate was born here (objectstack#4550) next to its only production
 * caller, `ObjectQL.delete` in `engine.ts`. That location made it unreachable
 * for one whole package of test doubles: `@objectstack/objectql` **depends on**
 * `@objectstack/metadata-protocol`, so the thirteen fake engines there could not
 * import it without closing a cycle turbo refuses outright. Sinking it into
 * `@objectstack/metadata-core` — a package both sides already depend on, and
 * which depends on neither — is the only route that pins those doubles without
 * inventing a dependency edge. The reasoning, with the measured cycle, is in the
 * module header at the new location.
 *
 * This file stays because the move must be invisible to every caller. `engine.ts`
 * and this package's own pinned test doubles import `./engine-delete-dispatch.js`;
 * `index.ts` re-exports the public API from it. One re-export keeps all of that
 * byte-identical, so the sink changes no import in the repo that did not have to
 * change.
 *
 * @see @objectstack/metadata-core `src/engine-delete-dispatch.ts` — the implementation.
 * @see engine-delete-dispatch.test.ts — the case-set driven against the REAL engine,
 *      which stays in this package because it needs `ObjectQL`.
 * @see scripts/check-engine-double-contract.mjs — the gate; its `delete` slice accepts
 *      `@objectstack/objectql` (this path's public spelling), `@objectstack/metadata-core`
 *      (the new home) and the relative path, so a double may pin through any of them.
 */

export {
  ENGINE_DELETE_REJECT_MESSAGE,
  scalarDeleteId,
  resolveEngineDeleteDispatch,
  assertEngineDeleteDispatch,
  ENGINE_DELETE_DISPATCH_CASES,
} from '@objectstack/metadata-core';

export type {
  EngineDeleteDispatch,
  EngineDeleteDispatchInput,
  EngineDeleteDispatchCase,
} from '@objectstack/metadata-core';
