---
"@objectstack/cli": patch
---

fix(cli): `OS_APP_NAME` overrides `config.email.defaultTemplateContext.appName` again (#5448)

`resolveEmailCapabilityArg` computed the email template context's `appName`
first and then spread the whole `config.email.defaultTemplateContext` over it.
A config that spelled `defaultTemplateContext: { appName: 'Acme Dev' }`
therefore made `OS_APP_NAME` inert — silently, with nothing logged — even
though this resolver's stated contract ("`OS_EMAIL_*` environment variables
override per setting", the header of `EmailServiceConfigSchema` and of the
generated `references/system/email-config` page) holds for every other key it
reads: `apiKey`, `defaultFrom`, `retries`, `queueDelivery`, `persist`, SMTP.

One `objectstack.config.ts` deployed to several environments has exactly one
per-environment lever, and it did nothing: production kept sending mail branded
with the repo-pinned name, and because the fallback sender is slugged from the
same value, the envelope said `no-reply@acme-dev.local` too.

`appName` is now resolved after the spread, in the order
`OS_APP_NAME` > `config.email.appName` >
`config.email.defaultTemplateContext.appName` > top-level `config.appName` >
`'ObjectStack'`. Every other key of `defaultTemplateContext` is unchanged — it
has no env or dedicated-config carrier, so the author's context is still spread
through wholesale.

**Behaviour change, accepted deliberately.** A deployment that relied on
`defaultTemplateContext.appName` beating `OS_APP_NAME` will now see the env
value in mail subjects, bodies and the derived fallback sender. Unset
`OS_APP_NAME` in that environment, or move the intended name into
`config.email.appName`, to keep the old result. Note that
`defaultTemplateContext.appName` stays in the chain rather than losing to the
two dedicated sources outright: a config that spells only the context form is
still honoured and is not demoted to `'ObjectStack'`.
