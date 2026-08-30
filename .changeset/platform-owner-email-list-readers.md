---
"@objectstack/core": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-security": patch
---

fix(core,plugin-auth,plugin-security): every `OS_PLATFORM_OWNER_EMAIL` reader asks the ONE list-aware parser (#13147)

`OS_PLATFORM_OWNER_EMAIL` accepts one address **or a comma-separated list** of
them (#11663 Choice 2B). The list parse landed in a single home
(`@objectstack/core`'s `platform-admin.ts`) and the authorization derivation
consumed it — but every other reader kept calling `resolvePlatformOwnerEmail()`,
which returns the operator's value trimmed and otherwise verbatim, and kept
treating that whole string as ONE address.

An operator who configured a list therefore entered a self-contradictory state:
authorization recognised them as a platform administrator, while four separate
capabilities silently did nothing. Every direction failed **closed** — no
privilege escalation existed at any point — but a declared capability vanished
with no error anywhere:

- `bootstrap-platform-admin` promoted **nobody**, logging "will be promoted when
  that account registers" on every boot forever;
- the walled operator stamp (`plugin-auth`) stamped **no** list member verified,
  so the account it should have provisioned was then refused elevation as
  `walled_owner_not_verified`;
- `isVerifiedPlatformOwnerSession` / `platform-owner-wall-bypass` let **nobody**
  across the Layer 0 organization wall — the largest of the affected surfaces;
- the walled boot diagnostic printed the raw list in the slot where an operator
  reads one address, and its dev-seed silence clause never matched.

All six readers now ask the same parser. `@objectstack/core` gains
`isConfiguredPlatformAdminEmail(email, config)` — the membership half of
`matchesConfiguredPlatformAdmin`, spelled once and shared, for the readers that
hold a bare address rather than a `sys_user` row (the elevation gate keeps its
two halves apart so `walled_owner_not_registered` and `walled_owner_not_verified`
stay distinct answers; the stamp is handed an email before any row exists; the
wall takes a fast negative before spending a row read). `PlatformAdminEmailConfig`
gains `declaredSpellings`, the entries as the operator typed them, so the by-email
`sys_user` lookup and the boot diagnostic get the as-typed form **from the one
parse** instead of splitting the raw value a second time.

Behaviour for a single declared address is unchanged, including the
case-insensitive match and the verbatim-spelling store lookup. A **refused**
list (Choice 2B fails the whole variable closed on one unparseable entry) now
reaches these readers as "zero administrators", which is the same answer they
already gave for an unset variable — never a silently narrower set.

Two readers deliberately keep reading the raw value: the walled-boot refusal and
the verification-path probe guard in `auth-plugin.ts` both use it as a pure
truthiness test ("did the operator declare anything at all?"), which is
grammar-independent. A census pin now enumerates the raw readers across both
plugin packages and fails on a seventh.
