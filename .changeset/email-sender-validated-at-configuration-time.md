---
"@objectstack/plugin-email": patch
---

fix(plugin-email): judge the default sender where it is configured, and record a send rejected before delivery (#14318)

Measured on a local rig with `OS_EMAIL_FROM="ObjectOS Local <noreply@localhost>"`,
`OS_EMAIL_PROVIDER=log` and `OS_AUTH_REQUIRE_EMAIL_VERIFICATION=true`: the server
booted clean, the first sign-up answered `200`, the UI said a verification email
had been sent, and nothing had been. `EMAIL_REGEX` requires a dotted domain and
correctly refuses `noreply@localhost` — but it refused it inside
`normalizeMessage`, on the **first send**, which for a fresh deployment is the
first user's sign-up. better-auth runs `sendVerificationEmail` through
`runInBackgroundOrAwait`, which logs `Failed to run background task` and returns
normally, so the account was created and the user was parked on a verify screen
whose Resend repeated the whole sequence. `sys_email` held no row for any of it:
the throw happened *before* the row insert, and every other failure shape in the
service is a row at `status:'failed'`.

Two changes, one per half.

**The address is judged where it is configured.** `EmailServicePlugin.init()`
now refuses a declared `defaultFrom` that no message could ever be sent from, so
a deployment that names an unsendable sender fails its boot instead of failing
every send — the same trade `resolveTransport` already makes for an SMTP
provider with no host, and the error names the consequence and the fix
(`OS_EMAIL_FROM` / `config.email.defaultFrom`). An **absent** sender is still
accepted: callers that always pass `input.from` are a complete configuration,
and `normalizeMessage` already refuses a send that has neither.

The `mail` settings channel takes that method's opposite, stated trade — a save
must not kill a running server — so an unsendable saved From address is
**refused, the previous sender kept**, and the consequence stated at `error`.
`error` and not `warn` because nothing looks broken afterwards: the save
succeeds and the settings page shows the address the operator typed.

**A send rejected before delivery now leaves a `sys_email` row.** The
`normalizeMessage` window was the one path on which a send produced no record at
all. It now writes `status:'failed'` with the reason, prefixed
`rejected before delivery:` so the column distinguishes a message that never
reached a transport from one an SMTP host refused. The envelope columns carry
what the caller actually passed (never re-canonicalised — canonicalisation is
what threw), `(none)` where the input named nothing, since `from_address` /
`to_addresses` / `subject` are required. The row is safe by construction: both
re-delivery paths — the `afterInsert` outbox drain hook and the boot outbox
sweep — gate on `status === 'queued'`, so a rejection record can never be
mistaken for an outbox entry. Persisting it is best-effort and never replaces
the caller's error.

Unchanged: `formatAddress`, `EMAIL_REGEX` and `normalizeMessage` keep their
exact verdicts (the new `isSendableAddress` predicate shares the one regex, so a
boot cannot pass a check the send path then fails), `send()` still throws on
validation failure rather than answering `failed`, and the auth layer's
propagation is as it was — `sendVerificationEmail` already rejects on both a
throw and a returned `status:'failed'`, which is now pinned by a test.
