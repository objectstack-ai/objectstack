// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { serviceUnavailableMessage } from '@objectstack/spec/system';
import type { HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

/**
 * The one answer a dispatcher domain gives when its route is mounted but
 * nothing implements the capability behind it — **501**, carrying the same
 * remedy sentence discovery reports for that slot.
 *
 * ## The distinction this encodes
 *
 * Two different facts were being answered with whatever each domain happened
 * to reach for. They are not the same fact, and `mcp` is the one domain that
 * already told them apart:
 *
 * - **The route is not there.** `/mcp` when the server is disabled for this
 *   environment; `/analytics` when the service is unserveable, because
 *   `dispatcher-plugin` gates the *mount* and never registers those paths
 *   (#4000). Asking for a path the server does not expose is a **404**, and
 *   the host's own router says so. Nothing here overrides that.
 *
 * - **The route is there; the implementation is not.** Every domain mounted
 *   unconditionally. The request reached a handler — it simply has nothing to
 *   delegate to. That is **501 Not Implemented**, and it is what this helper
 *   is for.
 *
 * ## What it replaces
 *
 * `return { handled: false }` looked like a neutral "not mine", but the
 * dispatcher plugin's single exit turns it into `404 ROUTE_NOT_FOUND` with the
 * hint *"No handler matched this request. Check the API discovery endpoint for
 * available routes."* Both halves are false: a handler did match, and
 * discovery — correctly — does not list the route, so the hint sends the
 * caller to a page that will not mention it. An operator reads that as a
 * routing bug and goes looking for one that does not exist.
 *
 * `/ui` said **503**, which claims the condition is temporary. An uninstalled
 * MetadataPlugin does not become installed by retrying.
 *
 * ## Why the message comes from `spec`
 *
 * `serviceUnavailableMessage` is the same sentence `services.<slot>.message`
 * carries in discovery (#4093 follow-up), so the 501 body and the discovery
 * entry cannot drift into naming different remedies — and a caller who hits
 * the wall gets the fix without a second round trip.
 *
 * @param slot the `CoreServiceName` key, NOT the route segment — `/notifications`
 *             is served by the `notification` slot, and the remedy is looked up
 *             by slot.
 */
export function capabilityUnavailable(
    deps: DomainHandlerDeps,
    slot: string,
    /**
     * Overrides the shared sentence. Only for slots whose provider cannot be
     * named by `CORE_SERVICE_PROVIDER` — it is verified against workspace
     * packages, so a real provider that ships outside this repo (`ai`) has no
     * entry there and would otherwise be described as "nothing ships".
     */
    message?: string,
): HttpDispatcherResult {
    return { handled: true, response: deps.error(message ?? serviceUnavailableMessage(slot), 501) };
}
