---
'@objectstack/plugin-auth': patch
---

Report the zero-account boot dead end at `kernel:ready` (#14353)

A deployment holding human `sys_user` rows and zero `sys_account` rows cannot
be recovered from inside, and until now it booted silently. Nobody can sign in;
the first-account bootstrap carve-out counts humans, and humans exist, so it
does not open; the default `invite_only` audience posture refuses
self-registration; and no administrator exists who could send an invitation.
The only symptom was a 401 on credentials nobody holds.

That state is now reported at `kernel:ready` at `error` level, under the name
`no_sign_in_account_at_boot`, naming both the consequence (the deployment will
keep looking healthy and cannot be recovered from inside) and the remedy
(provision an account out of band, or open the audience posture).

⛔ No admission semantics change. Whether the carve-out should count humans or
logins was ruled on 2026-09-02 (option A — the door does not move); this only
reports.

The check extends the existing `kernel:ready` walled-owner reporter rather than
opening a parallel one: it shares that hook, and the bounded human-population
page is read ONCE per boot and handed to `probeWalledOwnerAccountState`, so no
deployment pages `sys_user` twice. At most one report is emitted per boot — a
deployment matching both shapes gets this error, and the walled-owner warning
is suppressed rather than stacked on top of it.
