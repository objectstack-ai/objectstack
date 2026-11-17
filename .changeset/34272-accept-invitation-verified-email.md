---
'@objectstack/plugin-auth': patch
'@object-ui/app-shell': patch
'@objectstack/runtime': patch
---

fix(plugin-auth,app-shell)!: while mail is live, accepting an invitation needs a verified address

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `git grep` of `skills/` finds no page that teaches accepting an invitation or `/organization/accept-invitation`; the rule is stated here and in the self-hosting docs.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, metadata type or stored row is added, removed, renamed or rewritten: the moved answer is whether one auth route accepts a request from a session whose address is unverified, while the deployment's mail transport is live. Nothing exists for a migration to rewrite; the one-line fix for a refused person is in the body: verify the address, then accept. -->

**BREAKING** for a person who accepts an invitation from an account whose address was never verified, on a deployment whose mail transport is live. The rule: while mail is live, accepting an invitation needs a verified address, because an unverified address is not proof of the invited mailbox.

**What changes.**

- `POST /api/v1/auth/organization/accept-invitation` (`@objectstack/plugin-auth`), from a session whose address is unverified, while the email service answers `isConfigured() === true`, now answers `403 EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION` (better-auth's own code and sentence, the ones its accept route answers when its option is on) and writes nothing; the invitation stays pending. It used to answer `200` and write the membership. The vendor's not-found, expiry and recipient refusals still come first, so a session that is not the invitee learns nothing new. The check runs on the vendor's `beforeAcceptInvitation` hook, on the session user the vendor itself resolved (cookie or bearer token alike), and asks whether mail is live on every request.
- The Console's accept page (`@object-ui/app-shell`) answers that refusal with the verification-mail screen (`/verify-email-prompt`) for the account's address, whose link returns to the accept page, instead of a toast.

**Who moves.** A person in that state verifies their address (the Console's accept page takes them to the screen that sends the mail), then accepts; an API client that accepts for its user does the same, through `POST /api/v1/auth/send-verification-email`. A visitor who is not signed in and opens the invitation mail's own link is not affected: the accept page offers the one-step form, which verifies the address as it accepts. A visitor already signed in to an account whose address is unverified who opens the same link accepts through `/organization/accept-invitation`, so is refused as above and sent to verify.

**Unchanged.** Every deployment without a live mail transport (no email service, or the log transport), where nothing could verify an address, so acceptance stays open to an unverified address; `get-invitation`, `list-user-invitations` and `reject-invitation`, which write no membership; the one-step door `POST /api/v1/auth/organization/accept-invitation-one-step`; and a verified session everywhere. better-auth's `requireEmailVerificationOnInvitation` stays declared `false`: it governs reading and declining too, and is read once at boot.

`@objectstack/runtime` carries only the dispatcher error-vocabulary row that classifies the vendor code above as foreign vocabulary; nothing it runs changes.
