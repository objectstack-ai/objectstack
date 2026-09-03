---
"@objectstack/plugin-auth": minor
---

fix(plugin-auth): bind the dev-admin seed's operator-provisioning ticket to more than the seed address, so a concurrent stranger posting that address cannot ride the window (#14373)

`AuthManager.stageOperatorProvisioning` staged its ticket keyed on
`email.trim().toLowerCase()` alone. The address is **not a secret** —
`admin@objectos.ai` is the documented default and the boot banner prints it
(with the password) once the seed completes — so "the address is the
operator's own" did not narrow the attacker set the way it would for an
unguessable value. A stranger's own concurrent `POST /sign-up/email` for that
same address, arriving while the ticket was staged, would satisfy an
email-only peek at both admission seams (the `disableSignUp` before-hook and
`validateAudienceAdmission`'s `creationClass` computation) and be admitted as
the `operator` class too — and since a unique-email constraint lets only one
of the two concurrent `signUpEmail` calls actually land, a stranger who won
that race would not merely read as the operator, their row would BECOME the
account at that address. The safety this rested on — "milliseconds, and
`NODE_ENV==='development'` only" — was true today, but both are properties of
the *caller*, not of what the ticket asserted.

`stageOperatorProvisioning(email)` now also generates a random, unguessable
ticket value (128 bits from WebCrypto's `getRandomValues`, matching the
existing `resolvePasswordHasher` salt convention) and returns it.
`AuthPlugin.maybeSeedDevAdmin` threads that value into the SAME `signUpEmail`
call's body, under the new `AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD`
key — an unrecognized key that better-auth's `signUpEmailBodySchema` (`.and(
z.record(z.string(), z.any()))`) lets ride through untouched, so it never
becomes a declared `sys_user` field. `isOperatorProvisioning(email, ticket)`
now requires an exact match on both; a missing, wrong-typed, or mismatched
ticket reads as "not provisioning" — the same as no ticket staged at all,
with no email-only fallback. This converts what was a timing argument
("the window is short and dev-only") into a structural one: admission now
asks "did THIS process's own boot command make THIS exact call", and a
stranger's request carries no value that was ever transmitted anywhere for
them to replay, however precisely they time the window.

**Public surface**: `stageOperatorProvisioning`'s return type widens from
`void` to `string` (additive — any existing caller ignoring the return value
is unaffected), `isOperatorProvisioning` gains an optional second parameter
(omitting it now always reads as "not provisioning", which is the safe
default), and the class gains one new static member,
`AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD`. `AuthManager` is
barrel-public (`@objectstack/plugin-auth`'s `index.ts` re-exports it in
full), so this is graded `minor` rather than `patch`.

**Not touched**: the JSDoc documenting the in-process trust assumption on
`stageOperatorProvisioning` (already accurate on landed `main`), and the
method's barrel-public location (a published-surface removal is a decision
card, not a dev-agent edit) — both dispositions triage already closed out on
this card. Whether the bootstrap window should count humans or logins is
`#14349`'s question, not touched here.
