// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/print-door-service
 *
 * Cross-package contract for the print door, served off the `print` slot. The
 * implementation lives in `@objectstack/service-print`: its `print` service
 * implements this contract beside its own package-local print verb, so the
 * door needs no slot of its own.
 *
 * The door, `POST /api/v1/print/records`, prints a record's print page to a
 * PDF as the signed-in caller and archives it on the record. A console action
 * reaches it as a same-origin `type: 'api'` action whose `target` is that path.
 *
 * A self-hosted kernel serves it from the print plugin's own mount on the
 * kernel's `http.server`. A hosted tenant kernel owns no socket and so has no
 * `http.server`, so the runtime dispatcher reaches the door instead (#36840;
 * the bridge the maintainer's ruling A on #22438 directs for every member of
 * this class, as `IAttachmentDoorsService.handleAttachmentDoor` is bridged).
 */

/**
 * The print door, as the `print` service serves it.
 *
 * The member is optional. A kernel without `@objectstack/service-print`
 * leaves the slot empty, and a caller probes for the member before calling it.
 */
export interface IPrintDoorService {
  /**
   * **The print door, served transport-neutrally.**
   *
   * What it serves, exactly as the plugin's self-hosted mount serves it (one
   * body, two faces):
   *  - It resolves the caller from the request's own credentials, the rule the
   *    self-hosted mount applies. With no signed-in caller it answers `401`; a
   *    sign-in that still owes an authentication step answers `403`.
   *  - Every refusal and answer is the door's own, in the
   *    `{ success, data | error: { code, message } }` envelope: a print engine
   *    this deployment has not configured is the door's
   *    `503 SERVICE_UNAVAILABLE`, as on the self-hosted mount.
   *  - A request whose method and path do not match the door answers
   *    `404 ENDPOINT_NOT_FOUND`; the dispatcher never forwards one.
   *
   * **Transport-neutral, deliberately.** A web-standard `Request` goes in and a
   * `Response` comes out: no Hono context, no raw app, no `http.server` type.
   * The request's URL path is the door's own wire path
   * (`/api/v1/print/records`). It takes no `ExecutionContext`: it resolves the
   * caller from the request, so both kernel shapes judge the same caller by
   * one rule, in one place.
   *
   * **Its one caller** is the runtime `HttpDispatcher`'s `/print` domain, which
   * claims exactly the door's method and path and forwards the request with
   * its body unread. The path is not on the ADR-0069 auth-gate allow-list and
   * the project-membership gate does not skip it, so on that shape the
   * dispatcher door is stricter than the self-hosted mount, never looser.
   *
   * **Optional, and its absence is loud.** An empty slot or an absent member
   * answers a typed `501`, ⛔ never the dispatcher's `404 ROUTE_NOT_FOUND`.
   *
   * @param request - The forwarded request: the caller's credentials are in its
   *   headers and the print request in its JSON body
   * @returns The door's JSON answer
   */
  handlePrintDoor?(request: Request): Promise<Response>;
}
