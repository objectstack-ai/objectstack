---
"@objectstack/plugin-email": patch
"@objectstack/plugin-auth": patch
---

fix(auth): auth emails follow the deployment locale — all five remaining templates localized, and every send names a locale (#8195)

<!-- adr-0087: not-required (no-migration-prescription) No authorable property is
added, renamed, retired or tombstoned. This adds locale ROWS to templates that
already exist (the `sys_email_template` shape is unchanged — `(name, locale)` was
always its key), plus one new public method on `AuthManager` and one new
plugin-layer read. Nothing existing changes spelling, so there is no conversion
to register. -->

Outbound auth mail was English-only on a platform that supports four locales and
whose UI already switches between them. Two facts made every non-`en-US` template
row unreachable through the platform's own send path:

- **no auth send named a locale** — all five `sendTemplate` calls in
  `auth-manager.ts` omitted it, so `EmailService`'s ladder resolved
  `DEFAULT_TEMPLATE_LOCALE` (`en-US`) every time;
- **only one auth template had non-`en-US` rows at all** —
  `auth.email_change_notice` shipped four locales with #8019; the other five were
  `en-US`-only.

Both halves land together, and that is the substance of the fix rather than its
packaging. Shipping the resolution alone was measured to be **worse than the
English status quo**: the ladder falls back to the **en-US row body** on a miss
while `const locale = preferred || row.locale` still hands the caller's locale to
the render filters — so a zh-CN deployment would have received English prose
carrying zh-CN-formatted dates and numbers *inside a single message*, which is
precisely the artefact the row-locale authority (#7801) exists to prevent.

**Templates.** `auth.password_reset`, `auth.verify_email`, `auth.magic_link`,
`auth.invitation` and `auth.two_factor_otp` each gain `zh-CN`, `ja-JP` and
`es-ES` rows — 15 new rows, seeded through `BUILTIN_AUTH_TEMPLATES` so they are
selectable rather than merely exported. Each localized row also carries a
localized **footer**: `wrap()` supplies an English one by default, so a row that
forgets it renders fluently translated prose under an English sign-off.

**Resolution.** Per the maintainer ruling of 2026-08-13, the recipient locale is
the **deployment default**, read from `II18nService.getDefaultLocale()` and
resolved at the plugin layer — `AuthPlugin` pushes it into
`AuthManager.setDefaultEmailLocale()` on `kernel:ready`, exactly as it already
pushes the auth **SMS** locale (#2815). `Accept-Language` is rejected: auth mail
is routinely sent outside the triggering request (invitations, admin-initiated
resets), so a per-device header is the wrong authority. A per-user
`sys_user.locale` column is deferred until there is measured pull for one; when
it arrives it layers on top of this as an override.

**One spelling gap had to be bridged**, and it is measured rather than assumed:
`getDefaultLocale()` carries the message-**catalog** language, whose English
spelling is the bare `en` (`FileI18nAdapter`: `options.defaultLocale ?? 'en'`),
while template rows are keyed `en-US` and `SendTemplateInput.locale` is
documented as matched exactly, with "no language-only prefix matching". Passed
through raw, the commonest deployment of all would miss every row and lean on the
en-US fallback while telling the render filters `en`. `normalizeAuthEmailLocale`
therefore promotes a **bare language subtag** to the regional row the platform
ships (`en` ⇒ `en-US`, `zh` ⇒ `zh-CN`, …) and passes everything else through
untouched — an unshipped regional tag such as `en-GB` or `fr-FR` may well be a
tenant's own overlay row, and swallowing it would re-create this very bug for the
fifth locale onward.

**Nothing changes for an unconfigured deployment.** With no i18n service
registered, or none declaring `getDefaultLocale`, no `locale` key is passed at
all and the ladder resolves its documented `en-US` default exactly as before.
