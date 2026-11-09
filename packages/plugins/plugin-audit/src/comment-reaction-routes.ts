// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  ownRowDeleteCallerResolver,
  registerOwnRowDeleteRoute,
  removeOwnRow,
  type OwnRowDeleteCallerSources,
  type OwnRowDeleteDoor,
  type OwnRowDeleteEngine,
  type OwnRowDeleteRoutesDeps,
} from '@objectstack/core';
import type { IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { COMMENT_REACTION_OBJECT } from './comment-access-hooks.js';

/**
 * The unreact door: `DELETE /api/v1/comments/reactions/:id` removes ONE
 * `sys_comment_reaction` row, and only the caller's own (maintainer ruling
 * 6422861164, letter A).
 *
 * The door is `@objectstack/core`'s own-row delete door
 * (`own-row-delete-routes.ts`), which holds the order of its refusals, the
 * system removal attributed to the caller, and every answer. What this file
 * supplies is the object's part:
 *
 *  - **Why a reaction needs it.** A reaction is its reactor's own record, made
 *    and removed, never edited (`objects/sys-comment-reaction.object.ts`), and
 *    no every-member set may carry the `delete` grant the data door's removal
 *    needs. So a member whose only grants are the every-member ones could add
 *    a reaction and never take it back.
 *  - **What the read as the caller runs** (the door's step 5): the object
 *    grant, the organization wall, and the reaction read gate (a reaction is
 *    readable exactly when its comment is, `comment-access-hooks.ts`). A
 *    reaction on a comment the caller cannot see answers as an unknown id.
 *  - **The owner column** (the door's step 6): `created_by`, the column the
 *    platform's own-record floor keys on (`owner_only_deletes`), stamped by
 *    the engine with the user who reacted.
 *  - **The route and its ledger row** (`comment-reaction-route-ledger.ts`).
 */

/** The route pattern the door is mounted at. */
export const COMMENT_REACTION_REMOVE_ROUTE = '/api/v1/comments/reactions/:id';

/** The unreact door's part of the shared own-row delete door. */
export const COMMENT_REACTION_DOOR: OwnRowDeleteDoor = {
  route: COMMENT_REACTION_REMOVE_ROUTE,
  object: COMMENT_REACTION_OBJECT,
  ownerField: 'created_by',
  words: { noun: 'reaction', shortNoun: 'reaction', owner: 'member' },
};

/** The slice of the data engine the door reads and writes through. */
export type CommentReactionEngine = OwnRowDeleteEngine;

/** What the door is composed over — every service read when a request arrives. */
export type CommentReactionRoutesDeps = OwnRowDeleteRoutesDeps;

/** Mount the unreact door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerCommentReactionRoutes(http: IHttpServer, deps: CommentReactionRoutesDeps): void {
  registerOwnRowDeleteRoute(http, COMMENT_REACTION_DOOR, deps);
}

/** The services the platform's caller resolution reads, per request. */
export type PlatformCallerSources = OwnRowDeleteCallerSources;

/**
 * The platform's caller resolution for this door: the shared door's one
 * composition ({@link ownRowDeleteCallerResolver}). A request that names
 * nobody resolves to `undefined`, which the door refuses.
 */
export function platformCallerResolver(sources: PlatformCallerSources): CommentReactionRoutesDeps['resolveCaller'] {
  return ownRowDeleteCallerResolver(sources);
}

/**
 * Remove the caller's own reaction `id` — the door's steps 5 and 6, and the
 * removal. Throws `RECORD_NOT_FOUND` / `404` for a row the caller cannot read
 * or that does not exist, and `PERMISSION_DENIED` / `403` for a row whose
 * reactor is someone else. `context` must name a user.
 */
export function removeOwnCommentReaction(
  engine: CommentReactionEngine,
  id: string,
  context: ExecutionContext,
): Promise<void> {
  return removeOwnRow(engine, COMMENT_REACTION_DOOR, id, context);
}
