---
"@objectstack/plugin-auth": minor
---

The two SSO domain-verification admin routes now answer a registered ADR-0112
error code. `POST /admin/sso/request-domain-verification` and
`POST /admin/sso/verify-domain` shape their failure as
`code: parsed?.code || <our default>`, and the default half — the code
ObjectStack itself authors when @better-auth/sso returns none — was lowercase
(#10716, found by #10658):

| route | wrote | writes instead |
| --- | --- | --- |
| `POST /admin/sso/request-domain-verification` | `request_domain_verification_failed` | `DOMAIN_VERIFICATION_FAILED` |
| `POST /admin/sso/verify-domain` | `verify_domain_failed` | `DOMAIN_VERIFICATION_FAILED` |

If you match on either lowercase spelling, match on `DOMAIN_VERIFICATION_FAILED`
instead — the two routes are distinguished by their path, as they already were
for every other failure they can answer.

`DOMAIN_VERIFICATION_FAILED` is reused, not invented: it is already registered
for `@objectstack/plugin-auth` in the error-code ledger, so this PR adds nothing
to `packages/spec` and the emitted vocabulary gets no new member. A new spelling
(`VERIFY_DOMAIN_FAILED`) would have needed a ledger registration to be a legal
`error.code` at all, and — measured while fixing this — an unregistered code in
an `||` fallback slot is currently invisible to BOTH error-code gates, so it
would have shipped as exactly the silent fourth state ADR-0112 D3 exists to
prevent.

**The vendor pass-through arm is unchanged.** `parsed?.code` still reaches the
caller verbatim, so @better-auth/sso's own diagnosis (`NO_PENDING_VERIFICATION`,
`DOMAIN_VERIFICATION_FAILED`) is never overwritten by ours — the half that would
be silently lost by a handler that stamped our code unconditionally, and it is
pinned in both directions by
`packages/plugins/plugin-auth/src/sso-domain-verification-error-codes.test.ts`.
Statuses and messages are untouched on every path.

ADR-0087 disposition, in prose because the marker vocabulary has no slot for
this shape: nothing is registered and nothing needs to be. The declared wire
contract is `error.code ∈ StandardErrorCode ∪ ERROR_CODE_LEDGER`, and neither
lowercase spelling was ever a member of it — they were undeclared values a
blind gate let through, so this brings the implementation onto the published
contract rather than changing that contract. There is no metadata surface for
`objectstack migrate meta` to rewrite: error codes live in responses, not in
stored metadata. The table above is here for anyone who matched the undeclared
spelling anyway, which is why this ships as `minor` rather than `patch`.
