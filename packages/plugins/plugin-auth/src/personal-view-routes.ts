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

import { PERSONAL_VIEW_OBJECT } from './personal-view-hooks.js';

/**
 * The owner's delete door for a personal view:
 * `DELETE /api/v1/personal-views/:id` removes ONE `sys_personal_view` row, and
 * only the caller's own (seat ruling 6583289013 on #29443, following the shape
 * maintainer ruling 6422861164, letter A, set for the unreact door on #26161).
 *
 * The door is `@objectstack/core`'s own-row delete door
 * (`own-row-delete-routes.ts`), which holds the order of its refusals, the
 * system removal attributed to the caller, and every answer. What this file
 * supplies is the object's part:
 *
 *  - **Why a personal view needs it.** A personal view is its owner's own
 *    record (`sys-personal-view.object.ts`), and `member_default`, the only
 *    set that names this object for a member, carries no delete bit; no
 *    every-member set may carry one. So a member could save a view and never
 *    remove it.
 *  - **What the read as the caller runs** (the door's step 5): the object
 *    grant, the organization wall, and the owner-only row scope. Another
 *    member and an organization administrator (whose wildcard bypass is closed
 *    for this object) answer as an unknown id there.
 *  - **The owner column** (the door's step 6): `user_id`. A row the caller can
 *    read whose `user_id` is anyone else (today only a platform
 *    administrator's bare wildcard reads one) is refused loudly.
 *  - **The route and its ledger row** (`personal-view-route-ledger.ts`).
 */

/** The route pattern the door is mounted at. */
export const PERSONAL_VIEW_REMOVE_ROUTE = '/api/v1/personal-views/:id';

/** The personal view's part of the shared own-row delete door. */
export const PERSONAL_VIEW_DOOR: OwnRowDeleteDoor = {
  route: PERSONAL_VIEW_REMOVE_ROUTE,
  object: PERSONAL_VIEW_OBJECT,
  ownerField: 'user_id',
  words: { noun: 'personal view', shortNoun: 'view', owner: 'user' },
};

/** The slice of the data engine the door reads and writes through. */
export type PersonalViewEngine = OwnRowDeleteEngine;

/** What the door is composed over — every service read when a request arrives. */
export type PersonalViewRoutesDeps = OwnRowDeleteRoutesDeps;

/** Mount the owner's delete door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerPersonalViewRoutes(http: IHttpServer, deps: PersonalViewRoutesDeps): void {
  registerOwnRowDeleteRoute(http, PERSONAL_VIEW_DOOR, deps);
}

/** The services the platform's caller resolution reads, per request. */
export type PersonalViewCallerSources = OwnRowDeleteCallerSources;

/**
 * The platform's caller resolution for this door: the shared door's one
 * composition ({@link ownRowDeleteCallerResolver}). A request that names
 * nobody resolves to `undefined`, which the door refuses.
 */
export function personalViewCallerResolver(sources: PersonalViewCallerSources): PersonalViewRoutesDeps['resolveCaller'] {
  return ownRowDeleteCallerResolver(sources);
}

/**
 * Remove the caller's own personal view `id` — the door's steps 5 and 6, and
 * the removal. Throws `RECORD_NOT_FOUND` / `404` for a row the caller cannot
 * read or that does not exist, and `PERMISSION_DENIED` / `403` for a row whose
 * owner is someone else. `context` must name a user.
 */
export function removeOwnPersonalView(
  engine: PersonalViewEngine,
  id: string,
  context: ExecutionContext,
): Promise<void> {
  return removeOwnRow(engine, PERSONAL_VIEW_DOOR, id, context);
}
