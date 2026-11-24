// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36506] The personal-view delete door, served transport-neutrally:
 * `IPersonalViewDoorsService.handlePersonalViewDoor`
 * (`@objectstack/spec/contracts`), the occupant of the `personal-views` slot.
 *
 * `AuthPlugin` mounts the door on the kernel's `http.server`
 * (`mountPersonalViewDoor`), and only under `registerRoutes`. A hosted tenant
 * kernel owns no socket, registers no `http.server` and runs the plugin with
 * `registerRoutes: false`, so on that shape the door was never mounted, and its
 * host's `createHonoApp` catch-all handed every `DELETE
 * /api/v1/personal-views/:id` to the runtime dispatcher, where no domain
 * claimed it: `404 ROUTE_NOT_FOUND`. The dispatcher's `/personal-views` domain
 * now forwards the request to this member on the request kernel (ruling A on
 * #22438, applied to this member of the class).
 *
 * The member runs the SAME registrar the self-hosted mount runs
 * (`registerPersonalViewRoutes`) over the SAME deps, on a private route table
 * that never listens (`createDoorTableMember`), so every answer is the
 * mount's own.
 */

import type { IHttpServer, IPersonalViewDoorsService } from '@objectstack/spec/contracts';
import { createDoorTableMember, type DoorTableRoute } from '@objectstack/plugin-hono-server';

import { PERSONAL_VIEW_REMOVE_ROUTE, registerPersonalViewRoutes, type PersonalViewRoutesDeps } from './personal-view-routes.js';

/** The one door, as the self-hosted mount registers it. */
export const PERSONAL_VIEW_DOOR_ROUTES: readonly DoorTableRoute[] = Object.freeze([
  { method: 'DELETE', route: PERSONAL_VIEW_REMOVE_ROUTE },
] as const);

/** The `personal-views` service over `deps`, the deps the self-hosted mount is composed over. */
export function createPersonalViewDoorsService(deps: () => PersonalViewRoutesDeps): Required<IPersonalViewDoorsService> {
  const member = createDoorTableMember(PERSONAL_VIEW_DOOR_ROUTES, (http: IHttpServer) =>
    registerPersonalViewRoutes(http, deps()),
  );
  return { handlePersonalViewDoor: member };
}
