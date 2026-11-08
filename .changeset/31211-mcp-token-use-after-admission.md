---
'@objectstack/spec': patch
'@objectstack/plugin-auth': patch
'@objectstack/runtime': patch
---

fix(auth): an MCP access token is recorded as used only once the MCP door admits the call, so a banned person's refused calls no longer show their AI assistant as used

Clause-②: yes (widening)
Metadata-protocol: none

`IAuthService` gains one optional member, `recordMcpAccessTokenUse(principal)`. Verifying a token is not admitting the call: the MCP door (`@objectstack/runtime`) refuses a banned subject after `verifyMcpAccessToken` answers, and a call whose authorization store cannot be read is a 503. Before this change `AuthManager.verifyMcpAccessToken` itself scheduled the coarse last-use stamp (`sys_oauth_consent.last_used_at`), so an administrator reading `GET /admin/authorized-clients?userId=` for a banned person saw the assistant as used in an hour when every call was refused.

Now `verifyMcpAccessToken` records nothing. The door calls `recordMcpAccessTokenUse` once, after its ban read and after the request context resolves, with the very object the verifier returned; `AuthManager` stamps only a principal object its own verifier returned, once, so a hand-built principal or a copy records nothing. The member returns nothing and never throws. The stamp's bound is unchanged: at most one write per consent per hour in each process.

A custom `IAuthService` needs nothing: the member is optional, and a door whose auth service lacks it admits the call exactly as before. A host that calls `AuthManager.verifyMcpAccessToken` itself and wants the call shown as used calls `recordMcpAccessTokenUse(principal)` with the verifier's result once it has admitted the call.
