// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/personal-view-doors-service
 *
 * Cross-package contract for the personal-view door's service slot. The
 * implementation lives in `@objectstack/plugin-auth`, which owns the
 * `sys_personal_view` object, and is registered as the `personal-views`
 * service.
 *
 * The door is `DELETE /api/v1/personal-views/:id`: a member removes a personal
 * view they saved, and only their own, with no object-level delete grant.
 *
 * A self-hosted kernel serves it from the plugin's own mount on the kernel's
 * `http.server`. A hosted tenant kernel owns no socket and so has no
 * `http.server` (and runs `AuthPlugin` with `registerRoutes: false`), so the
 * runtime dispatcher reaches it instead (#36506; the bridge the maintainer's
 * ruling A on #22438 directs for every member of this class, as
 * `ICommentDoorsService.handleCommentDoor` and `IWebhookService.handleRedeliver`
 * are bridged). This slot is what the dispatcher forwards to.
 */

/**
 * The personal-view door's service: the occupant of the `personal-views` slot.
 *
 * Every member is optional. A kernel without `@objectstack/plugin-auth` leaves
 * the slot empty, and a caller probes for the member it needs before calling
 * it.
 */
export interface IPersonalViewDoorsService {
  /**
   * **The personal-view delete door, served transport-neutrally.**
   *
   * What it serves, exactly as the plugin's self-hosted mount serves it (one
   * body, two faces):
   *  - It resolves the caller from the request's own credentials, through the
   *    kernel's `auth` service, the rule every own-row door applies. With no
   *    signed-in caller it answers `401`; a sign-in that still owes an
   *    authentication step answers `403`.
   *  - Every refusal and answer is the door's own, in the
   *    `{ success, data | error: { code, message } }` envelope; a removal
   *    answers `{ id, deleted: true }`.
   *  - A request whose method and path are not the door's answers
   *    `404 ENDPOINT_NOT_FOUND`; the dispatcher never forwards one.
   *
   * **Transport-neutral, deliberately.** A web-standard `Request` goes in and a
   * `Response` comes out: no Hono context, no raw app, no `http.server` type.
   * The request's URL path is the door's own wire path
   * (`/api/v1/personal-views/:id`). It takes no `ExecutionContext`: it
   * resolves the caller from the request, so both kernel shapes judge the same
   * caller by one rule, in one place.
   *
   * **Its one caller** is the runtime `HttpDispatcher`'s `/personal-views`
   * domain, which claims exactly the door's method and path shape and forwards
   * the request unread. The path is not on the ADR-0069 auth-gate allow-list
   * and the project-membership gate does not skip it, so on that shape the
   * dispatcher door is stricter than the self-hosted mount, never looser.
   *
   * **Optional, and its absence is loud.** An empty `personal-views` slot or
   * an absent member answers a typed `501`, ⛔ never the dispatcher's
   * `404 ROUTE_NOT_FOUND`: that answer would tell a member the URL is wrong,
   * when what is missing is the service behind it.
   *
   * @param request - The forwarded request: the caller's credentials are in its
   *   headers and the personal view's id in its path
   * @returns The door's JSON answer
   */
  handlePersonalViewDoor?(request: Request): Promise<Response>;
}
