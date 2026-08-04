---
"@objectstack/plugin-email": minor
"@objectstack/service-settings": patch
"@objectstack/cli": patch
---

feat(plugin-email): real SMTP delivery — `SmtpTransport`, settings hot-swap, and a `mail/test` that actually sends (#5087)

The **Mail Delivery** settings page has always defaulted to SMTP and offered a
full host / port / TLS / username / password form. Nothing behind it delivered:
`applyMailSettings` treated `provider: 'smtp'` as a no-op ("transport
unchanged"), `mail/test` answered `ok: true, "Configuration looks valid … Wire
@objectstack/plugin-mail for actual delivery"` — a success toast for a message
nobody sent, naming a package that has never existed — and the code pointed
operators at `@objectstack/plugin-mail-smtp`, which is not in this repo or on
npm. A workspace that selected SMTP got a green form, a green test button, and
mail that only ever reached the log and the `sys_email` table. For deployments
in China this left **no** working channel at all: Resend and Postmark are
overseas HTTPS SaaS with unreliable reach and deliverability to QQ / 163 /
enterprise mailboxes, where SMTP is the normal path (Aliyun DirectMail, Tencent
SES, corporate mail servers).

**`SmtpTransport` now ships in `@objectstack/plugin-email`** (ADR-0012: SMTP in
core, implemented with `nodemailer`). `nodemailer` is a real dependency but is
imported **lazily on the first send**, so deployments that never select SMTP —
and non-Node runtimes — never load `node:net` / `node:tls`.

Three doors reach it, all sharing one options reader so they cannot drift:

- **Settings → Mail** (`smtp_host` / `smtp_port` / `smtp_secure` / `smtp_user` /
  `smtp_password`) hot-swaps the live transport on save, no restart.
- **`os serve`** via `OS_EMAIL_PROVIDER=smtp` plus the new `OS_EMAIL_SMTP_HOST` /
  `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` (or `config.email.options`).
- **Constructor**: `new EmailServicePlugin({ provider: 'smtp', providerOptions:
  { host, port, secure, user, password } })`.

TLS is one toggle with the wire behaviour derived from the port, as providers
document it: on `465` implicit TLS (SMTPS); on any other port a **required**
STARTTLS upgrade, so a server that refuses to upgrade fails the send instead of
leaking credentials over a cleartext socket; `secure: false` connects in the
clear and upgrades only when STARTTLS is offered.

**Failure is loud everywhere, because a silent fallback is the bug this fixes.**
On the construction path (CLI / plugin options) a `smtp` provider with no host
**throws** and the boot fails — it no longer degrades into a LogTransport that
reports every send as successful. On the settings hot-swap path a save can never
kill a running server, so the previous transport is kept — but the failure is
logged at `error` naming the consequence and the fix, and **`mail/test` now
performs a real delivery** through the settings on screen and reports the SMTP
server's own words (`535 … authentication failed`) instead of a green toast. The
built-in fallback `mail/test` handler (used only when no email plugin is
mounted) answers `ok: false` and says plainly that nothing was sent.

Nothing to migrate: `log`, `resend` and `postmark` behave exactly as before, and
a deployment that never selects `smtp` is unaffected.
