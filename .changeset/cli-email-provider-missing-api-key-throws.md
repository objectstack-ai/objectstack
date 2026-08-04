---
"@objectstack/plugin-email": minor
"@objectstack/cli": major
---

fix(cli,plugin-email)!: `OS_EMAIL_PROVIDER=resend/postmark` without an API key now fails the boot instead of silently becoming the log transport (#5132)

**BREAKING for one configuration: a delivery provider selected without the
credential it needs.** `os serve` used to answer that by rewriting `provider` to
`log`, printing a warning, and booting normally. The result was a server that
accepted every send, recorded each one in `sys_email` as sent, and delivered
nothing — the warning scrolled past in CI logs and the truth surfaced when a
user reported never receiving a verification code. #5087 closed exactly this gap
inside `@objectstack/plugin-email` (`makeTransport` throws rather than
substituting a transport); the CLI's own capability assembly kept doing it one
layer up, for `resend` / `postmark`.

`resolveEmailCapabilityArg` now refuses every mail configuration it cannot
deliver through, the way its neighbouring `smtp` arm already did:

- `resend` / `postmark` with no `OS_EMAIL_API_KEY` (or `config.email.apiKey`);
- a `provider` tag outside `log` / `smtp` / `resend` / `postmark` — including
  the retired `sendgrid` / `ses`, which get their SMTP migration in the message.

**Who is affected:** deployments (typically CI or preview environments) that set
`OS_EMAIL_PROVIDER=resend` or `=postmark` without a key and relied on the
fallback to boot. Nothing else changes — a complete configuration is passed
through untouched, and an unset `OS_EMAIL_PROVIDER` still defaults to `log`.

**Migration — one line, either direction:**

- the environment is *not* meant to send mail → `OS_EMAIL_PROVIDER=log`
  (that explicit value is the supported way to say so, and why refusing the
  others is fair);
- the environment *is* meant to send mail → set `OS_EMAIL_API_KEY` (or
  `config.email.apiKey`).

Both errors name the consequence and both fixes, per AGENTS.md's
degradation-log-level rule.

`@objectstack/plugin-email` gains the vocabulary the CLI reads instead of
restating: `API_KEY_EMAIL_PROVIDERS`, `emailProviderRequiresApiKey()` and the
`ApiKeyEmailProvider` type, alongside `EMAIL_TRANSPORT_PROVIDERS` /
`isEmailTransportProvider` / `unsupportedProviderFix` from #5094. One vocabulary,
two consumers, pinned by a contract test — a second literal list in the CLI is
how the settings dropdown and the transports drifted apart in the first place.
