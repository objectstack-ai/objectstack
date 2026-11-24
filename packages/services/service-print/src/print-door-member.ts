// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36840] The print door, served transport-neutrally:
 * `IPrintDoorService.handlePrintDoor` (`@objectstack/spec/contracts`), a
 * member of the `print` service.
 *
 * `PrintServicePlugin` mounts `POST /api/v1/print/records` on the kernel's
 * `http.server` (`registerPrintRoutes`). A hosted tenant kernel owns no socket
 * and registers no `http.server`, so on that shape the door was never mounted,
 * and the host's `createHonoApp` catch-all handed every print request to the
 * runtime dispatcher, where no domain claimed it: `404 ROUTE_NOT_FOUND`, which
 * a console action showed its user as the raw text
 * `Route Not Found: /print/records`. The dispatcher's `/print` domain now
 * forwards the request to this member on the request kernel (ruling A on
 * #22438, applied to this member of the class).
 *
 * The member runs the SAME registration the self-hosted kernel runs, over the
 * same kernel, on a private route table that never listens
 * (`createDoorTableMember`), so every answer is the mount's own.
 */

import type { IHttpServer } from '@objectstack/spec/contracts';
import { createDoorTableMember, type DoorTableRoute } from '@objectstack/plugin-hono-server';

import { PRINT_RECORDS_ROUTE } from './print-routes.js';

/** The door, as the self-hosted mount registers it. */
export const PRINT_DOOR_ROUTES: readonly DoorTableRoute[] = Object.freeze([
  { method: 'POST', route: PRINT_RECORDS_ROUTE },
] as const);

/** `handlePrintDoor` over `mount`, the function the self-hosted mount calls too. */
export function createPrintDoorMember(mount: (http: IHttpServer) => void): (request: Request) => Promise<Response> {
  return createDoorTableMember(PRINT_DOOR_ROUTES, mount);
}
