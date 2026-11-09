---
'@objectstack/plugin-auth': patch
'@objectstack/spec': minor
'@objectstack/client': patch
'@objectstack/cli': patch
'@objectstack/verify': patch
'@object-ui/auth': patch
'@object-ui/console': patch
---

fix(plugin-auth)!: under invite_only, a self-serve sign-up is admitted only by the invitation it presents

Clause-②: yes (narrowing) — under the `invite_only` audience posture an email-and-password sign-up for an invited address is admitted only when it presents that invitation's id as `invitationId`, and the address alone is refused `SELF_REGISTRATION_CLOSED`; a social OAuth creation is admitted by an invitation only when its identity provider verified the address. The sign-up request widens: `RegisterRequestSchema` and `RegisterRequest` gain `invitationId`, `SignUpData`, `RegisterForm` and the auth context's `signUp` gain it, and `os register` gains `--invitation`.
Metadata-protocol: added — RegisterRequest gains the optional invitationId key (packages/spec/authorable-surface/api.json)

<!-- adr-0087: not-required (no-migration-prescription) No key is removed, renamed or re-shaped and no stored row is rewritten: RegisterRequest gains an optional key, and a sign-up under invite_only that does not present its invitation is refused with the posture's existing code and message. -->

**BREAKING** accept-set narrowing at the email-and-password sign-up door (`@objectstack/plugin-auth`), under the `invite_only` audience posture, the default.

A sign-up under `invite_only` presents the invitation it is admitted by: the invitation's id, the last segment of the `/accept-invitation/` link the invitation mail carries, sent in the `/sign-up/email` body as `invitationId` beside `email`, `password` and `name`. The invitation must be pending, unexpired and addressed to that email. Anything else is refused `403 SELF_REGISTRATION_CLOSED` with the same message an uninvited sign-up gets, and nothing is written.

**Upgrading.** A client that signs an invitee up sends `invitationId` beside the `email`, `password` and `name` it already sends. The one-line fix: send the id the invitation link carries as `invitationId`.

**Who moves.** Nothing in this repository: the Console, the SDK, the CLI, the `@objectstack/verify` harness and the test fixtures all present the id; a client outside it that signs invitees up under `invite_only`, such as a custom front-end or a script, sends the accept link's last path segment as `invitationId`.

**Operators.** Deploy the Console bundle together with the server; on a deployment with no mail transport, hand the invitee the link with the invitation's **Copy Invite Link** action; give an out-of-band recovery invitation row an `id` of your own, which the sign-up sends; and review accounts created before the upgrade that are unverified and hold or accepted an invitation.

- **Unchanged:** the first account of a new deployment, and the operator's own provisioning (admin create, SCIM, the boot command's seed), need no invitation. The `open` and `email_domain` postures match an invitation by address as before. A magic-link or email-OTP creation, whose own flow answers from the mailbox, matches by address; an SSO provider's creation is unchanged.
- **Social OAuth under `invite_only`:** a creation through a social provider is admitted by an invitation only when the provider verified the address; otherwise it is refused with the same code as an uninvited sign-up.
- **No mail transport:** hand the invitee the link with the invitation's **Copy Invite Link** action; it carries the id.
- `@objectstack/spec`: `RegisterRequestSchema` declares the optional `invitationId`.
- `@objectstack/client`: `auth.register()` sends it through, typed by the widened `RegisterRequest`.
- `@objectstack/cli`: `os register --invitation ID`.
- `@objectstack/verify`: the harness's `signUp` presents the invitation it seeds.
- `@object-ui/auth`: `SignUpData.invitationId`, `RegisterForm`'s `invitationId` prop and the sixth argument of the context's `signUp` send it.
- `@object-ui/console`: `/register` opened from an invitation link sends that link's id with the sign-up; so does `@object-ui/app-shell`'s `DefaultRegisterPage`, whose package now also exports `invitationIdOf`.
