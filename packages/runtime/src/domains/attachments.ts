// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/attachments` domain — the attachment's removal and rename doors, reached
 * through the dispatcher on a kernel with no `http.server` (#36506; ruling A
 * on #22438, applied to this member of the class). The bridge itself is
 * `own-door-bridge.ts`; this file names what it forwards.
 *
 * `DELETE /attachments/:id` removes one `sys_attachment` row the caller
 * uploaded; `PATCH /attachments/:id` renames one. A self-hosted kernel serves
 * both already: service-storage mounts them on the kernel's `http.server`
 * (`mountAttachmentRemovalDoor`). A hosted tenant kernel owns no
 * `http.server`, and its host's storage bridge covers only the storage
 * family's own prefix (`/api/v1/storage`), so the host's `createHonoApp`
 * catch-all handed both to `dispatch()`, where no domain claimed them: every
 * attachment removal and rename answered `404 ROUTE_NOT_FOUND`. This domain
 * forwards the request to the request kernel's `file-attachments` service,
 * whose transport-neutral `IAttachmentDoorsService.handleAttachmentDoor` runs
 * the doors, and returns its `Response` as it is. Only those two method and
 * path shapes are claimed; every other one keeps the ordinary miss.
 */

import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import { createOwnDoorBridgeDomain, type OwnDoorBridge } from './own-door-bridge.js';

/** What the bridge forwards, and to whom. */
export const ATTACHMENTS_BRIDGE: OwnDoorBridge = Object.freeze({
    prefix: '/attachments',
    doors: Object.freeze([
        { method: 'DELETE', pattern: '/attachments/:id' },
        { method: 'PATCH', pattern: '/attachments/:id' },
    ] as const),
    slot: 'file-attachments',
    member: 'handleAttachmentDoor',
    producer: '@objectstack/service-storage (StorageServicePlugin)',
    noun: 'the attachment removal and rename doors',
    // [#37352] The catalog key of `noun`: the bridge's `501` follows the request's language.
    nounKey: 'own_door_attachment_mutate',
    tag: 'attachments',
});

export function createAttachmentsDomain(deps: DomainHandlerDeps): DomainRoute {
    return createOwnDoorBridgeDomain(deps, ATTACHMENTS_BRIDGE);
}
