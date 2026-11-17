---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a sign-up the email_domain posture admits by an invitation is not bound before its address is verified

Clause-②: no (narrowing) — narrowed: under the `email_domain` audience posture with `membershipPolicy: 'auto'`, a self-serve sign-up whose address is off the allowlist, admitted by a pending invitation addressed to it, is not bound to the Default Organization while its address is unverified; it joins by accepting the invitation.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the `email_domain` posture's invitation sign-up; `content/docs/deployment/self-hosting.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answer is a membership the sign-up seam does not write for an unverified invitation-admitted sign-up, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for an `email_domain` deployment with `membershipPolicy: 'auto'` that relies on an invited address outside its allowlist joining the Default Organization when it signs up.

- Under `email_domain` with `membershipPolicy: 'auto'`, an account that a sign-up off the allowlist created, admitted by a pending invitation addressed to it, is not bound to the Default Organization while its address is unverified. Its membership comes from accepting the invitation once the address is verified, with the role the invitation carries, or from a platform administrator. Verifying the address binds nothing by itself.
- This is the rule that already holds under `invite_only` for a sign-up admitted by the invitation it presents; both postures now read one decision, `isAdmittedByInvitationAlone` (`audience-posture.ts`).

Unchanged: an address on the allowlist, invited or not, which the domain rule admits and the membership policy binds at creation; a sign-up the invitation mail's own link verifies as it accepts; the first account of a deployment, accounts an administrator creates and accounts a boot command provisions, which are bound as before; the `invite_only` and `open` postures.

What to do: an invitee outside the allowlist completes the verification mail the sign-up sends, signs in and accepts the invitation, or opens the invitation mail's own link, which verifies the address and accepts in one step. A platform administrator can instead attach the account with the member list's **Add Member** action.
