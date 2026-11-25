// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/print` domain — the print door, reached through the dispatcher on a kernel
 * with no `http.server` (#36840; ruling A on #22438, applied to this member of
 * the class). The bridge itself is `own-door-bridge.ts`; this file names what
 * it forwards.
 *
 * `POST /print/records` prints a record's print page to a PDF as the caller
 * and archives it on the record; a console `type: 'api'` action targets it. A
 * self-hosted kernel serves it already: service-print mounts it on the
 * kernel's `http.server` (`registerPrintRoutes`). A hosted tenant kernel owns
 * no `http.server`, so the host's `createHonoApp` catch-all — and the
 * `/actions` door's in-process forward of a `type: 'api'` action — handed it
 * to `dispatch()`, where no domain claimed it: every print answered
 * `404 ROUTE_NOT_FOUND`, which the console showed its user as the raw
 * `Route Not Found: /print/records`. This domain forwards the request to the
 * request kernel's `print` service, whose transport-neutral
 * `IPrintDoorService.handlePrintDoor` runs the door, and returns its
 * `Response` as it is. A kernel that composes no print service answers the
 * bridge's typed `501 NOT_IMPLEMENTED`. Only that one method and path shape is
 * claimed; every other one keeps the ordinary miss.
 */

import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import { createOwnDoorBridgeDomain, type OwnDoorBridge } from './own-door-bridge.js';

/** What the bridge forwards, and to whom. */
export const PRINT_BRIDGE: OwnDoorBridge = Object.freeze({
    prefix: '/print',
    doors: Object.freeze([
        { method: 'POST', pattern: '/print/records' },
    ] as const),
    slot: 'print',
    member: 'handlePrintDoor',
    producer: '@objectstack/service-print (PrintServicePlugin)',
    noun: 'the print door',
    // [#37273] The catalog key of `noun`: the bridge's `501` follows the request's language.
    nounKey: 'own_door_print',
    tag: 'print',
});

/** The `/print` registry entry. */
export function createPrintDomain(deps: DomainHandlerDeps): DomainRoute {
    return createOwnDoorBridgeDomain(deps, PRINT_BRIDGE);
}
