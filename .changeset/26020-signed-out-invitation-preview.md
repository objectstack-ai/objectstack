---
'@objectstack/plugin-auth': patch
'@objectstack/rest': patch
---

feat(plugin-auth): a signed-out invitation preview read, so the invitation landing page can name the inviting organization and the inviter

Clause-②: no
Metadata-protocol: none

- **New route.** `GET /api/v1/auth/organization/invitation-preview?id=INVITATION_ID` answers a caller with no session. For a `pending` invitation that has not expired it returns exactly `{ success: true, data: { organizationName, inviterName, email } }`. `email` is the invited address masked to its first character and its domain (`alice@acme.com` becomes `a***@acme.com`), and `inviterName` is `null` when the inviter's account no longer exists.
- **One not-found.** An unknown, expired, accepted, rejected or cancelled id answers the same `404` with code `RESOURCE_NOT_FOUND` and the same body, so the answer does not tell those states apart.
- **The same answer for everyone.** The route never reads the session: a signed-in caller gets the identical three keys.
- **Rate-limited.** At most 10 previews per client address per 60 seconds, counted before the request is parsed; the 11th answers `429` `RATE_LIMIT_EXCEEDED` with `Retry-After`. The window counts in the kernel `cache` service when one is registered and per process otherwise, with a one-time warning naming the budget.
- **Closed query set.** `id`, once. Any other parameter, a repeated `id` and a missing `id` each answer a located `400` `VALIDATION_ERROR`.
- **Unchanged.** better-auth's own `GET /organization/get-invitation` still answers `401` without a session, and an invitation-link sign-up still owes the verification mail.
- **Governance.** ADR-0138 D2 admits the route as a class-2-shaped door (the invitation id is the capability token) by a dated note, and `auth-route-ledger.ts` books it `public`.
- **`@objectstack/rest`** now exports `unknownQueryParamRefusalMessage`, the pure half of the closed query-parameter rule, for a door outside the package that writes its own envelope.
