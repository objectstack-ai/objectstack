---
"@objectstack/plugin-approvals": minor
---

feat(plugin-approvals): `ApprovalService.handleActionPage` serves the ADR-0043 action page from a web-standard `Request` (#22578)

Clause-②: yes

- **What is new.** `ApprovalService` implements the optional `IApprovalService.handleActionPage(request)` member: the session-less page an approver reaches from the approve or reject link in an e-mail or IM message, from a `Request` to a `Response`, with no raw app, no Hono context and no `http.server`. `GET` renders the confirm page from the `token` query parameter and never decides. `POST` redeems the `token` field of the form body as the approver the token binds, and answers the result page. A dead link (unknown, expired, consumed, decided or reassigned) is told on the page with `200`. Any other method answers `405` with `Allow: GET, POST`.
- **The same pages, the same checks.** The member answers what the plugin's self-hosted pages answer for the same token and method: the same status, `Content-Type: text/html; charset=utf-8` and bytes. It goes through the same `peekActionToken` / `redeemActionToken` and the same page renderers, and both doors share one token store, so a link used at one is dead at the other. The token is the only credential: no session, cookie or `Authorization` header is read.
- **Its one caller** is the runtime HTTP dispatcher's `/approvals/act` domain (#22576), which reaches a hosted tenant kernel that owns no socket.
- **The self-hosted mount is unchanged.** Where `http.server` exposes a raw app, the plugin mounts `GET` and `POST /api/v1/approvals/act` exactly as before, and the path is never mounted twice. Where there is none, the plugin now logs one `info` line at boot saying the pages are served through the dispatcher's `/approvals/act` domain; it was silent.
