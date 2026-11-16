---
'@objectstack/spec': patch
'@objectstack/plugin-email': patch
'@objectstack/plugin-auth': patch
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(auth): an invitation is accepted in one step with the proof its mail carries

Clause-②: yes (widening)
Metadata-protocol: none

- **The invitation mail carries a mailbox proof.** The accept link in the mail ends with `#proof=…`. The server keeps only a hash of the proof, bound to the invitation's address and expiry. A resend retires the earlier proof. The stored mail row never holds the proof, and the console's copy-link action answers the link without it.
- **One door redeems it.** `POST /api/v1/auth/organization/accept-invitation-with-proof` takes the invitation id, the proof, a name and a password. In one request it creates the account (or sets the password of an account whose address is not verified, ending every session that account had), verifies the address, accepts the invitation and signs in. A proof is single-use. A proof that does not admit is refused with one `INVALID_TOKEN` answer and leaves the real proof usable. The door is rate-limited per client address and per invitation, and runs the sign-up gates: who may sign up, password length, complexity and breach checks, SSO-only mode.
- **An address with an account signs in as today.** When the address belongs to a verified account, an account with a linked provider, a second factor or a directory-managed account, the door answers `sign_in` and the proof stays unspent.
- **Without the proof, a session must hold the verified invited address.** Called with a session and no proof, the door accepts only when the session's address is the invited one and verified, and otherwise answers `verify_email`. A copied link still owes the verification mail.
- **`SendTemplateInput.deliverOnly`** (`@objectstack/spec`): render values delivered with the message and never written to the stored mail row. A send carrying them is delivered inline, never through the durable queue. Only the server-side template send declares the key; `POST /email/send` and a script's `ctx.email.send` take a `SendEmailInput`, which has none.
- **The accept page offers one form.** A signed-out visitor whose link carries the proof sees a name and password form, or a provider sign-in, in place of the sign-in redirect. The proof is cleared from the address bar once read. A provider sign-in returns to the page, which redeems the invitation for the new session. A link without the proof keeps today's path. The `@object-ui/auth` client gains `acceptInvitationWithProof`.
