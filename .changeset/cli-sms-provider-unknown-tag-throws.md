---
"@objectstack/service-sms": minor
"@objectstack/cli": major
---

fix(cli,service-sms)!: `OS_SMS_PROVIDER=twilo` now fails the boot instead of silently becoming the log transport (#5713)

**BREAKING for one configuration: a provider tag no SMS transport can build.**
`os serve` used to hand `OS_SMS_PROVIDER` (or `config.sms.provider`) straight to
`SmsServicePlugin` with nothing to compare it against. The plugin then caught the
`makeSmsTransport: unknown provider 'twilo'` throw, substituted `LogSmsTransport`,
and booted normally — measured, not inferred:

```
new SmsServicePlugin({ provider: 'twilo' }).init(ctx)
  booted_without_throw: true            transport_class: 'LogSmsTransport'
  isConfigured():       false           logger.warn × 1, logger.error × 0
  service.send(…)    →  { status: 'sent', messageId: 'dev-sms-…' }
```

So a phone-OTP sign-in answered "code sent", the user waited for an SMS that was
never dispatched, and the one `warn` line scrolled past in the boot log. That is
the declared-but-not-delivered shape of Prime Directive #10, and the same one
#5132 closed for **mail** in the neighbouring arm of the very same capability
loop.

Three gates already guard the `sms` provider value and none of them could see
this path: the `sms` settings namespace declares `provider` as a `select` with an
options table, #5131 enforces that table on the write path, and #5204 closed the
`SettingsService` env-override branch. All three live behind `SettingsService` —
this read happens while the kernel is being assembled, *before* a settings
service exists.

**`resolveSmsCapabilityArg` now refuses a provider tag outside
`log` / `aliyun` / `twilio`**, the way its neighbouring `resolveEmailCapabilityArg`
already did, and the capability loop turns that into the loud failure it should
be — a hard boot error when the app declared `requires: ['sms']`, otherwise a
`console.error` and no SMS service.

**What it deliberately does NOT do:** demand credentials. Unlike mail, SMS
provider credentials are not a boot-time input — the `sms` settings namespace
binds them at `kernel:ready`, and that is their documented home. A bare
`OS_SMS_PROVIDER=twilio` on a host whose Twilio keys live in Settings is a
complete configuration and passes through untouched. `SmsServicePlugin`'s own
fallback is likewise untouched: for a *known* provider with incomplete
constructor credentials it is correct (the settings bind can still swap in a
working transport), and it remains the last line of defence for hosts that
construct the plugin themselves. `os serve` simply stops feeding it input it can
never use.

**Who is affected:** deployments that set `OS_SMS_PROVIDER` (or
`config.sms.provider`) to a value outside the supported three — in practice a
typo, or a provider that was never implemented — and relied on the fallback to
boot. An unset `OS_SMS_PROVIDER` still defaults to `log`; every supported tag
still boots with or without credentials.

**Migration — one line, either direction:**

- the environment is *not* meant to send SMS → `OS_SMS_PROVIDER=log` (that
  explicit value is the supported way to say so, and why refusing the others is
  fair);
- the environment *is* meant to send SMS → fix the tag to `aliyun` or `twilio`
  and put the credentials in Settings → SMS Delivery (or
  `config.sms.providerOptions`).

The error names the consequence and both fixes, per AGENTS.md's
degradation-log-level rule.

`@objectstack/service-sms` gains the vocabulary the CLI reads instead of
restating: `SMS_TRANSPORT_PROVIDERS` and `isSmsTransportProvider()`, with
`SmsProviderTag` now derived from the array rather than declared beside it. One
vocabulary, two consumers — a second literal list in the CLI is how the mail
settings dropdown and the mail transports drifted apart in the first place
(#5094).
