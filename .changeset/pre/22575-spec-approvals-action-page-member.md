---
"@objectstack/spec": minor
---

feat(spec): the approvals service contract declares an optional, transport-neutral action-page member (`IApprovalService.handleActionPage`)

Clause-②: yes (widening)

- **What is new.** `IApprovalService` in `@objectstack/spec/contracts` gains one optional member, `handleActionPage?(request: Request): Promise<Response>`. It serves the ADR-0043 action page, the session-less page an approver reaches from the approve or reject link in an e-mail or IM message. `GET` renders the confirm page from the `token` query parameter and never decides. `POST` redeems the `token` form field and answers the result page.
- **The token is the only credential.** The member takes no `ExecutionContext` and reads no session, cookie or `Authorization` header. The decision is audited as the approver the token binds.
- **Transport-neutral.** A web-standard `Request` in, a `Response` out: no Hono context, no raw app and no `http.server` type. A hosted tenant kernel has no raw app to mount pages on, and the runtime dispatcher's `/approvals/act` domain is the member's one caller.
- **Absence.** The member is optional, so an approvals implementation without action pages still satisfies the contract. Its caller answers a typed 404 or 501 when the `approvals` service or this member is absent, never `ROUTE_NOT_FOUND`.
- **Nothing changes for existing implementers.** No existing member moved. Nothing implements or calls the member yet: the plugin implementation and the dispatcher domain land separately, and the plugin's self-hosted pages stay as they are.
