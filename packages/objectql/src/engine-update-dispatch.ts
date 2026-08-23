// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The update-dispatch predicate's original path, kept as a **re-export of its
 * new home** — `@objectstack/metadata-core` (objectstack#5619).
 *
 * Same move, same reason, same day as its twin: see
 * `engine-delete-dispatch.ts` beside this file for the short version and the
 * module header at the new location for the measured turbo cycle that forced
 * it. The predicate itself is unchanged — this is a move, not a rewrite.
 *
 * @see @objectstack/metadata-core `src/engine-update-dispatch.ts` — the implementation.
 * @see engine-update-dispatch.test.ts — the case-set driven against the REAL engine,
 *      which stays in this package because it needs `ObjectQL`.
 * @see scripts/check-engine-double-contract.mjs — the gate that keeps doubles on it.
 */

export {
  ENGINE_UPDATE_REJECT_MESSAGE,
  scalarUpdateId,
  resolveEngineUpdateDispatch,
  assertEngineUpdateDispatch,
  ENGINE_UPDATE_DISPATCH_CASES,
  // [#11009] The unhonoured-by-id-predicate refusal, shared by BOTH write
  // dispatches (the delete twin imports the same two symbols); re-exported
  // once, here, so `objectql` callers can quote the refusal verbatim.
  engineByIdUnhonouredPredicateMessage,
  unhonouredByIdPredicateKeys,
  // [#11142] The conflicting-id refusal (a truthy scalar `where.id` naming a
  // DIFFERENT row than the bound payload id): its message composer, its
  // declared ADR-0112 code/status, and the one reject thrower the real engine
  // and every pinned fake share.
  ENGINE_UPDATE_ID_CONFLICT_CODE,
  ENGINE_UPDATE_ID_CONFLICT_STATUS,
  engineUpdateIdConflictMessage,
  engineUpdateDispatchRejectError,
} from '@objectstack/metadata-core';

export type {
  EngineUpdateDispatch,
  EngineUpdateDispatchInput,
  EngineUpdateDispatchData,
  EngineUpdateDispatchCase,
} from '@objectstack/metadata-core';
