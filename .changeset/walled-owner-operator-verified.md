---
"@objectstack/plugin-auth": minor
"@objectstack/types": minor
"@objectstack/plugin-security": patch
---

feat(auth): walled deployment's declared owner is email-verified at operator-provisioned creation (#12751)

On a **walled** deployment (`OS_TENANCY_POSTURE` in the wall-enforcing
family), the account whose email equals the declared platform owner
(`OS_PLATFORM_OWNER_EMAIL`) is stamped `emailVerified` **at creation** when
it comes into existence through an **operator provisioning path** — extending
the #11343 dev-boot seeded-admin precedent to production walled boots
(maintainer ruling 2026-08-28, cloud#1677: 「运营方创建即视为已验证」; the
trust anchor is the operator's env-var declaration plus the
operator-executed creation, not a mailbox round-trip; SMTP stays required
only for inviting others).

**Which creation paths qualify** (the [#11739] audience taxonomy, not a
second classification):

- the **bootstrap carve-out** — the very first account on a fresh install
  (zero human users), the one self-serve creation a walled boot admits;
- **admin create-user / bulk import** (`method: 'admin'`) — an act only an
  authenticated admin session can perform;
- **SCIM** (`method: 'scim'`) — provisioning executed by the
  operator-registered directory.

**Never**: non-bootstrap self-registration (including an
invitation-admitted registration typing the owner address), provider-class
JIT (the IdP asserts its own `emailVerified` at insert), any non-owner
address, any unwalled posture, and a later email **update** to the owner
address (the stamp is staged at the admission gate and consumed once by the
`user.create` before-hook — a seam an update cannot traverse). Dev-boot
behaviour (#11343) is unchanged.

The `WALLED_OWNER_NO_VERIFICATION_PATH` boot warning now probes the owner
account's state: a fresh walled boot with no transport and no federated
sign-in is **silent** (the operator's own first-account creation arrives
verified — the case this closes), while an owner account that already
exists **unverified**, a populated store whose bootstrap window is spent,
and an unanswerable probe keep warning. A settled deployment whose owner is
verified stops re-warning on every boot.

`@objectstack/types` gains `isEmailVerifiedUserRow` — the [#11343]
fail-closed verified-representation allow-list, moved from
`plugin-security`'s private copy so the elevation gate and the boot
diagnostic read ONE resolution (`plugin-security` now consumes it; no
behaviour change there).
