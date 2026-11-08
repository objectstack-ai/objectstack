---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
---

fix(plugin-auth): an auth request is judged and executed as one account

Clause-②: yes
Metadata-protocol: none

A request whose session cookie and bearer token name two different signed-in accounts is refused before anything runs, with `401 CREDENTIALS_NAME_DIFFERENT_ACCOUNTS`, and nothing is read or written for either account. It applies to every better-auth endpoint (over HTTP and to the in-process session read every data door makes) and to the raw ObjectStack routes on the identity mount. One credential alone, two credentials that name the same account (two sessions of one user included), and a credential that names no signed-in account are unaffected. An API key is not a session credential for this rule; each door keeps its existing one-principal rule for keys. A session read that cannot answer refuses too, as an outage (`503 SERVICE_UNAVAILABLE`), and so does the identity mount when the judgment cannot be reached at all.

`CREDENTIALS_NAME_DIFFERENT_ACCOUNTS` is registered in the `@objectstack/spec` error-code ledger under `@objectstack/plugin-auth`.

A successful `/change-password` stamps `password_changed_at`, clears an administrator's forced change and appends the history entry on the account the change acted on, and only when the password checks before it ran for that account; otherwise none of them lands, and the operator is told.

`/admin/revoke-user-session` refuses a token that identifies no session (`404 RESOURCE_NOT_FOUND`) for a caller signed in by bearer alone, as it already did on the cookie lane.

The Console needs no change: its session read already treats any refused read as a stale token, retrying with the cookie alone and dropping the token.
