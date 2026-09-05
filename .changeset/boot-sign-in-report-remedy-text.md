---
"@objectstack/plugin-auth": patch
---

The `no_sign_in_account_at_boot` report now names a remedy that works — and warns off the one that silences the report itself.

That boot line fires on the deployment nobody can sign in to: human `sys_user` rows, zero `sys_account` rows. It ended with two remedies, and measured on the exact population it fires on, neither did what its sentence said:

- **"Open the audience posture so an existing person can register their own login"** produced no login. Every posture other than `invite_only` forces `requireEmailVerification` on, so a login registered that way is refused `EMAIL_NOT_VERIFIED` at its first sign-in — and a locked-out self-hosted install is usually the shape with no mail transport wired.
- **"Write a `sys_account` credential row directly against the store"** was worse than useless. The `password` column carries a secret in the platform's own hash format, so a plaintext one authenticates nothing — and the probe behind this report asks only whether *any* `sys_account` row exists, so writing one turns the report off. The operator's first attempt at the named remedy turned the loud dead end back into the silent one the report was written to end.

The line now names the path that was measured to work: write one pending `sys_invitation` row directly against the store — an address the directory does not already hold, `status` `pending`, a future `expires_at`, `inviter_id` of any existing `sys_user` — then register through the ordinary sign-up endpoint. The invitation carve-out admits that one creation under every posture, so no door is widened and no mail transport is needed; on the `single` tenancy posture the next boot promotes that account holder. The other two are still named, as the two things that look like remedies and are not, because an operator who is going to hand-write a credential row anyway needs to know it blinds the probe.

**Message text only — no admission semantics move.** Nothing widens, nothing narrows, no accept set changes, and the probe is untouched: this changes what an operator *reads*, not what the platform *admits*. The long form of the same three facts is on the self-hosting deployment page.
