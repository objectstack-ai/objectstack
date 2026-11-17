---
'@objectstack/plugin-auth': patch
'@object-ui/app-shell': patch
'@objectstack/runtime': patch
---

fix(plugin-auth,app-shell): an accept refused for an unverified address answers the vendor's own code, and the Console's accept page takes the person to verify

Clause-②: no
Metadata-protocol: none
Skills-docs: none — `git grep` of `skills/` finds no page that teaches accepting an invitation or `/organization/accept-invitation`; the rule is stated in the self-hosting docs.

The rule that refuses the accept is stated, with its BREAKING notice and its migration, in this release's entry "accepting, declining and listing an organization invitation need a verified email address on every deployment, and an invitation sign-up joins by accepting once verified". This entry carries only the parts of that change that ship beside it.

**What changes.**

- `POST /api/v1/auth/organization/accept-invitation` (`@objectstack/plugin-auth`) answers a session whose address is unverified with better-auth's own `403 EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION` and its sentence, the answer its accept route gives when its option is on, and writes nothing. The vendor's not-found, expiry and recipient refusals still come first, so a session that is not the invitee learns nothing new. The check runs on the vendor's `beforeAcceptInvitation` hook, on the session user the vendor itself resolved (cookie or bearer token alike).
- The Console's accept page (`@object-ui/app-shell`) answers that refusal with the verification-mail screen (`/verify-email-prompt`) for the account's address, whose link returns to the accept page, instead of a toast.

`@objectstack/runtime` carries only the dispatcher error-vocabulary row that classifies the vendor code above as foreign vocabulary; nothing it runs changes.
