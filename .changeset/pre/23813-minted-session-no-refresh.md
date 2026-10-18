---
'@objectstack/plugin-auth': patch
---

Clause-②: no

A session minted by `IAuthService.mintPrincipalSession` is no longer refreshed by a read. Before,
`get-session` (and every endpoint that reads the session) still renewed it on each request: #23772's
guard held its expiry, but the row's `updatedAt` was rewritten, the session cookie was re-set with a
7-day `Max-Age`, and `bearer()` answered `set-auth-token`. The console reads that header as a token
rotation, so a browser carrying a minted cookie stayed on "Opening your console…" and the print
service could not render under the requesting user. A request that carries a minted session now
sets better-auth's own per-request skip-refresh switch, on the cookie lane, the bearer lane and
in-process. The mint's contract, TTL, refusals and revoke are unchanged.
