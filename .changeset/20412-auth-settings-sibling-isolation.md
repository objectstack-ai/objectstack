---
'@objectstack/plugin-auth': patch
---

**plugin-auth: a refused auth setting no longer drops the other settings saved with it**

Clause-②: no

The `auth` settings pass used to go to `AuthManager.applyConfigPatch()` as ONE patch. When the
manager refused one key in it, the whole patch was dropped: password policy, MFA, rate limits,
session lifetime and social providers from that pass were not applied. The settings console
still showed every one of them as saved, and the only trace was a `warn`.

Reachable examples:

- posture `open` (declared in stack config, or opened earlier through the console) with
  `auth.require_email_verification: false` stored through the console;
- posture `email_domain` with `OS_AUTH_REQUIRE_EMAIL_VERIFICATION=false`;
- the SCIM/admin coherence refusal on the `plugins` block, once `OS_SCIM_ENABLED` appears after
  the manager was constructed with `plugins.admin: false`.

Now the pass is applied in pieces, split where the manager can refuse. Each key that lands in
the `emailAndPassword` or `plugins` block is applied on its own; every other key goes out in one
application the manager does not validate. `mfa_required` stays one piece with the `twoFactor`
plugin it turns on, so MFA is never enforced without its enrollment endpoints. The manager's
verdict on each piece is the verdict; no validation moved into the plugin.

A refusal is logged once, at `error`, naming the key:
`[auth] auth settings REFUSED (auth.require_email_verification) — the standing runtime value
keeps ruling …`, followed by the manager's own message, which carries the remedy. Every other
setting in the pass still applies. A pass that fails as a whole, such as a settings namespace
that cannot be read, is also logged at `error` (`[auth] auth settings NOT APPLIED — …`).

The old `Auth: failed to apply auth settings:` warning is gone. A log alert that matched it
should match `[auth] auth settings REFUSED` and `[auth] auth settings NOT APPLIED` instead.
