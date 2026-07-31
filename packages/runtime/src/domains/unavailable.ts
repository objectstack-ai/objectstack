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
 * There is deliberately no per-call message override. One briefly existed for
 * `ai`, whose provider ships outside this workspace, and it hid the real bug:
 * the shared table said "nothing ships" for a slot that Cloud/Enterprise does
 * provide. Teaching the table to say the accurate thing fixed the domain AND
 * discovery, which the override could only ever have fixed here. A slot whose
 * sentence is wrong needs the table corrected, not a local exception.
 *
 * @param slot the `CoreServiceName` key, NOT the route segment — `/notifications`
 *             is served by the `notification` slot, and the remedy is looked up
 *             by slot.
 */
export function capabilityUnavailable(deps: DomainHandlerDeps, slot: string): HttpDispatcherResult {
    return { handled: true, response: deps.error(serviceUnavailableMessage(slot), 501) };
}
