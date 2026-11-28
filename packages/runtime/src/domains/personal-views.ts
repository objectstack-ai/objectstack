// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/personal-views` domain — the personal-view delete door, reached through
 * the dispatcher on a kernel with no `http.server` (#36506; ruling A on #22438,
 * applied to this member of the class). The bridge itself is
 * `own-door-bridge.ts`; this file names what it forwards.
 *
 * `DELETE /personal-views/:id` removes one `sys_personal_view` row, and only
 * the caller's own. A self-hosted kernel serves it already: plugin-auth mounts
 * it on the kernel's `http.server` (`mountPersonalViewDoor`). A hosted tenant
 * kernel owns no `http.server` and runs `AuthPlugin` with
 * `registerRoutes: false`, so there no route answered it, and the host's
 * `createHonoApp` catch-all handed it to `dispatch()`, where no domain claimed
 * it: every personal-view delete answered `404 ROUTE_NOT_FOUND`. This domain
 * forwards the request to the request kernel's `personal-views` slot, the
 * transport-neutral `IPersonalViewDoorsService.handlePersonalViewDoor`, and
 * returns its `Response` as it is. Only `DELETE /personal-views/:id` is
 * claimed; every other method and path keeps the ordinary miss.
 */

import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import { createOwnDoorBridgeDomain, type OwnDoorBridge } from './own-door-bridge.js';

/** What the bridge forwards, and to whom. */
export const PERSONAL_VIEWS_BRIDGE: OwnDoorBridge = Object.freeze({
    prefix: '/personal-views',
    doors: Object.freeze([{ method: 'DELETE', pattern: '/personal-views/:id' }] as const),
    slot: 'personal-views',
    member: 'handlePersonalViewDoor',
    producer: '@objectstack/plugin-auth (AuthPlugin)',
    noun: 'the personal view delete door',
    // [#37352] The catalog key of `noun`: the bridge's `501` follows the request's language.
    nounKey: 'own_door_personal_view_delete',
    tag: 'personal-views',
});

export function createPersonalViewsDomain(deps: DomainHandlerDeps): DomainRoute {
    return createOwnDoorBridgeDomain(deps, PERSONAL_VIEWS_BRIDGE);
}
