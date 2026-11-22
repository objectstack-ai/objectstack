// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/comment-doors-service
 *
 * Cross-package contract for the comment doors' service slot. The
 * implementation lives in `@objectstack/plugin-audit`, which owns the comment
 * objects (`sys_comment`, `sys_comment_reaction`), and is registered as the
 * `comments` service.
 *
 * The comment doors are the three server doors a member reaches without an
 * object-level grant for the write they make:
 *
 *  - `DELETE /api/v1/comments/reactions/:id` — remove your own reaction;
 *  - `PUT /api/v1/comments/:id/resolution` — resolve or reopen a thread you
 *    can read;
 *  - `DELETE /api/v1/comments/:id` — remove a comment you wrote.
 *
 * A self-hosted kernel serves them from the plugin's own mount on the
 * kernel's `http.server`. A hosted tenant kernel owns no socket and so has no
 * `http.server`, and the runtime dispatcher reaches it instead (#36469; the
 * bridge the maintainer's ruling A on #22438 directs for every member of this
 * class, as `IWebhookService.handleRedeliver` and
 * `IApprovalService.handleActionPage` are bridged). This slot is what the
 * dispatcher forwards to.
 */

/**
 * The comment doors' service: the occupant of the `comments` slot.
 *
 * Every member is optional. A kernel without `@objectstack/plugin-audit`
 * leaves the slot empty, and a caller probes for the member it needs before
 * calling it.
 */
export interface ICommentDoorsService {
  /**
   * **The three comment doors, served transport-neutrally.** One member for
   * the three routes, because they are one family with one caller rule: the
   * member matches the request's method and path against the three routes
   * and runs the door that owns it.
   *
   * What it serves, exactly as the plugin's self-hosted mount serves it (one
   * body, two faces):
   *  - It resolves the caller from the request's own credentials, through the
   *    kernel's `auth` service, the rule every own-row door applies. With no
   *    signed-in caller it answers `401`; a sign-in that still owes an
   *    authentication step answers `403`.
   *  - Every refusal and answer is the door's own, in the
   *    `{ success, data | error: { code, message } }` envelope: the unreact
   *    door and the own-comment delete door answer `{ id, deleted: true }`,
   *    the resolution door `{ id, is_resolved, resolved_by, resolved_at }`.
   *  - A request whose method and path match none of the three routes answers
   *    `404 ENDPOINT_NOT_FOUND`; the dispatcher never forwards one.
   *
   * **Transport-neutral, deliberately.** A web-standard `Request` goes in and
   * a `Response` comes out: no Hono context, no raw app, no `http.server`
   * type. The request's URL path is the door's own wire path
   * (`/api/v1/comments/…`).
   *
   * **It takes no `ExecutionContext`.** It resolves the caller from the
   * request, so both kernel shapes judge the same caller by one rule, in one
   * place.
   *
   * **Its one caller** is the runtime `HttpDispatcher`'s `/comments` domain,
   * which claims exactly the three method and path shapes and forwards the
   * request with its body unread. The paths are not on the ADR-0069
   * auth-gate allow-list and the project-membership gate does not skip them,
   * so on that shape the dispatcher door is stricter than the self-hosted
   * mount, never looser. The self-hosted mount is not a caller, and no path is
   * mounted twice.
   *
   * **Optional, and its absence is loud.** An empty `comments` slot or an
   * absent member answers a typed `501`, ⛔ never `ENDPOINT_NOT_FOUND`: that
   * answer would tell a member the URL is wrong, when what is missing is the
   * service behind it.
   *
   * @param request - The forwarded request: the caller's credentials are in
   *   its headers, the comment or reaction id in its path, and the
   *   resolution door's `{ "resolved": boolean }` in its JSON body
   * @returns The door's JSON answer
   */
  handleCommentDoor?(request: Request): Promise<Response>;
}
