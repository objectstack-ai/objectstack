---
"@objectstack/plugin-auth": patch
---

`GET /organization/list-user-invitations` now honours the declared `requireEmailVerificationOnInvitation` — the per-user invitation inbox works for the unverified sessions it was declared open to

`AuthManager` constructs better-auth's organization plugin with `requireEmailVerificationOnInvitation: false` on purpose: without a mailer wired in, nothing can ever verify an invitee, so requiring verification would dead-end every invite flow. The pinned better-auth 1.7.2 reads that option on `accept-invitation`, `reject-invitation` and `get-invitation`, but its `listUserInvitations` handler refuses every unverified session unconditionally. Measured on the real pipeline: the same unverified invitee got `200` from all three id-addressed routes and `403 EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION` from the listing, so on exactly the deployment shape the declaration exists for, an invitee could accept an invitation they were handed but never list it, and the SDK's `organizations.invitations.listMine()` inbox page was empty-by-403 for every user.

The endpoint is now rebuilt in place on the organization plugin's own `endpoints` record, from the vendor endpoint's own options object (same path, method, query schema and OpenAPI entry), with one predicate changed: the verification refusal is asked against the declared option instead of assumed. The listing itself is still the vendor's own `getOrgAdapter(...).listUserInvitations(sessionEmail)` — invitations addressed to the session's email, pending only — so nothing widens beyond what the same session can already accept one by one. A client-side `?email=` is still refused with the vendor's `400`, and a request with no session keeps the vendor's `400`.

Declared `true` keeps today's refusal byte-for-byte; an undeclared option keeps the vendor's list-route posture (refuse) rather than re-deriving the vendor-internal default the sibling routes use. No new public error code, no new export from the package entry.
