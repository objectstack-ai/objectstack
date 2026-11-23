// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36506] The attachment's own doors, served transport-neutrally:
 * `IAttachmentDoorsService.handleAttachmentDoor` (`@objectstack/spec/contracts`),
 * a member of the `file-attachments` service.
 *
 * `StorageServicePlugin` mounts the uploader's removal door and the rename door
 * on the kernel's `http.server` (`mountAttachmentRemovalDoor`). A hosted tenant
 * kernel owns no socket and registers no `http.server`, and its host's storage
 * bridge covers only `/api/v1/storage`, so on that shape the doors were never
 * mounted, and the host's `createHonoApp` catch-all handed every `DELETE` and
 * `PATCH /api/v1/attachments/:id` to the runtime dispatcher, where no domain
 * claimed it: `404 ROUTE_NOT_FOUND`. The dispatcher's `/attachments` domain now
 * forwards the request to this member on the request kernel (ruling A on
 * #22438, applied to this member of the class).
 *
 * The member runs the SAME mount the self-hosted kernel runs, over the same
 * kernel, on a private route table that never listens
 * (`createDoorTableMember`), so every answer is the mount's own.
 */

import type { IHttpServer } from '@objectstack/spec/contracts';
import { createDoorTableMember, type DoorTableRoute } from '@objectstack/plugin-hono-server';

import { ATTACHMENT_REMOVE_ROUTE, ATTACHMENT_RENAME_ROUTE } from './attachment-removal-routes.js';

/** The two doors, in the self-hosted mount's registration order. */
export const ATTACHMENT_DOOR_ROUTES: readonly DoorTableRoute[] = Object.freeze([
  { method: 'DELETE', route: ATTACHMENT_REMOVE_ROUTE },
  { method: 'PATCH', route: ATTACHMENT_RENAME_ROUTE },
] as const);

/** `handleAttachmentDoor` over `mount`, the function the self-hosted mount calls too. */
export function createAttachmentDoorMember(mount: (http: IHttpServer) => void): (request: Request) => Promise<Response> {
  return createDoorTableMember(ATTACHMENT_DOOR_ROUTES, mount);
}
