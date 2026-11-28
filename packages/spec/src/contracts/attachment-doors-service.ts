// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/attachment-doors-service
 *
 * Cross-package contract for the attachment's own doors, served off the
 * `file-attachments` slot (`FILE_ATTACHMENT_SERVICE`). The
 * implementation lives in `@objectstack/service-storage`, which owns
 * `sys_attachment`: its `file-attachments` service implements this contract
 * beside `IFileAttachmentService`, so the doors need no slot of their
 * own.
 *
 * The doors, both at one route:
 *
 *  - `DELETE /api/v1/attachments/:id` — the uploader removes an attachment
 *    they uploaded, and only their own, with no object-level delete grant;
 *  - `PATCH /api/v1/attachments/:id` — rename an attachment from the record's
 *    Attachments panel.
 *
 * A self-hosted kernel serves them from the storage plugin's own mount on the
 * kernel's `http.server`. A hosted tenant kernel owns no socket and so has no
 * `http.server`, and its host's storage bridge covers only the storage
 * family's own prefix (`/api/v1/storage`), so the runtime dispatcher reaches
 * these doors instead (#36506; the bridge the maintainer's ruling A on #22438
 * directs for every member of this class, as
 * `ICommentDoorsService.handleCommentDoor` is bridged).
 */

/**
 * The attachment's own doors, as the `file-attachments` service serves them.
 *
 * Every member is optional. A kernel without `@objectstack/service-storage`
 * leaves the slot empty, and a caller probes for the member it needs before
 * calling it.
 */
export interface IAttachmentDoorsService {
  /**
   * **The attachment's two doors, served transport-neutrally.** One member for
   * the two methods, because they are one route with one caller rule: the
   * member matches the request's method and path and runs the door that owns
   * it.
   *
   * What it serves, exactly as the plugin's self-hosted mount serves it (one
   * body, two faces):
   *  - It resolves the caller from the request's own credentials, through the
   *    kernel's `auth` service, the rule every own-row door applies. With no
   *    signed-in caller it answers `401`; a sign-in that still owes an
   *    authentication step answers `403`.
   *  - Every refusal and answer is the door's own, in the
   *    `{ success, data | error: { code, message } }` envelope.
   *  - A request whose method and path match neither door answers
   *    `404 ENDPOINT_NOT_FOUND`; the dispatcher never forwards one.
   *
   * **Transport-neutral, deliberately.** A web-standard `Request` goes in and a
   * `Response` comes out: no Hono context, no raw app, no `http.server` type.
   * The request's URL path is the door's own wire path
   * (`/api/v1/attachments/:id`). It takes no `ExecutionContext`: it resolves
   * the caller from the request, so both kernel shapes judge the same caller
   * by one rule, in one place.
   *
   * **Its one caller** is the runtime `HttpDispatcher`'s `/attachments`
   * domain, which claims exactly the two method and path shapes and forwards
   * the request with its body unread. The path is not on the ADR-0069
   * auth-gate allow-list and the project-membership gate does not skip it, so
   * on that shape the dispatcher door is stricter than the self-hosted mount,
   * never looser.
   *
   * **Optional, and its absence is loud.** An empty slot or an absent member
   * answers a typed `501`, ⛔ never the dispatcher's `404 ROUTE_NOT_FOUND`.
   *
   * @param request - The forwarded request: the caller's credentials are in its
   *   headers, the attachment's id in its path, and the rename door's JSON body
   *   in its body
   * @returns The door's JSON answer
   */
  handleAttachmentDoor?(request: Request): Promise<Response>;
}
