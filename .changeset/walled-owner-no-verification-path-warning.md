---
"@objectstack/plugin-auth": patch
---

feat(plugin-auth): warn at boot when a walled deployment declares an owner it can never verify (#11640)

A walled deployment (`OS_TENANCY_POSTURE=group|isolated`) that declares
`OS_PLATFORM_OWNER_EMAIL` but wires **no verification path** — no email
transport and no trusted federated sign-in — now emits a loud, named boot
warning (`walled_owner_no_verification_path`) on `kernel:ready`.

Since #11343, walled platform-admin elevation requires the declared owner's
address to be **verified**, and verification can only arrive by an emailed
link or by a federated sign-in that inserts the account already verified. With
neither wired, the declared owner registers, is refused
(`walled_owner_not_verified`), and has no in-product way to satisfy the
condition — a dead end that previously surfaced only weeks later, at the
owner's rejected registration. The warning names both missing inputs and the
concrete wiring for either remedy (an email service, or SSO / a social
provider), since either one alone clears it.

⛔ **Boot proceeds — this is not a refusal**, and no accept/reject behaviour
changes anywhere: the walled + undeclared-owner boot refusal (#11184) and the
fail-closed elevation refusal (#11343) are untouched. Deployments already
wiring either verification path see no new output, and neither does a
dev/harness boot whose declared owner is the dev-admin the seed provisions and
stamps verified.
