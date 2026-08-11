---
"@objectstack/plugin-email": patch
---

fix(plugin-email): a `sendTemplate` with no locale renders the documented en-US default, not an arbitrary row (#7731)

With an i18n bundle in `sys_email_template` — `en-US` and `zh-CN` rows under one
name — a `sendTemplate` call that named no `locale` rendered **zh-CN**, on two
consecutive fresh boots. Three declarations say en-US is the answer there
(`SendTemplateInput.locale`, `EmailTemplateDefinitionSchema.locale`, and
`sys_email_template`'s own object doc); the code asked the driver instead.

Two seams, both now answering from the contract:

- The `sys_email_template` loader moved out of `EmailServicePlugin` into
  `createSysEmailTemplateLoader`. Its no-locale branch queries
  `(name, 'en-US')` by name rather than `{ name }` unordered with `limit: 1`,
  so no driver's row order can change the answer. Every query it issues carries
  an `orderBy`, so duplicate rows for one locale resolve the same way on every
  boot too.
- `EmailService.sendTemplate`'s ladder asks for `DEFAULT_TEMPLATE_LOCALE` when
  the caller named no locale — the en-US fallback used to run only when a
  locale *had* been named, so the no-locale path never reached it.

A bundle with no en-US row at all (a single-locale tenant) keeps rendering:
the lowest locale tag in the bundle is used, ordered rather than arbitrary.
Explicit locales are unchanged — exact match, then en-US. Language-only prefix
matching (`zh` → `zh-CN`) is still not performed; no contract declares it.
