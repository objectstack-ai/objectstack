---
'@objectstack/spec': minor
---

docs(spec): scope the email-template locale-floor claims to a call that NAMES a locale (#18056)

Clause-②: yes — no accept set moves (no key is added, removed or revalidated),
but what a PUBLISHED package states about its own resolution contract is
corrected, which is a contract act in substance.

`packages/spec` stated two different rung counts for one resolution.
`EmailTemplateDefinitionSchema.locale`'s `describe` and the
`EMAIL_TEMPLATE_FLOOR_LOCALE` docblock published **one** retry rung and an
explicit "no fallback floor at all"; `SendTemplateInput.locale` in
`contracts/email-service.ts`, same package, documents a **three-rung** ladder
whose third rung is reachable exactly on the path the first says cannot exist.

Measured against the runtime rather than reconciled by preference —
`EmailService.resolveAndRenderTemplate` and `createSysEmailTemplateLoader` in
`@objectstack/plugin-email`, and the CI pins in
`template-locale-resolution.test.ts` — the three-rung text is the correct one:

1. the named locale, matched exactly (no language-subtag folding);
2. the literal `en-US`, which is also where a call naming no locale starts;
3. **only for a call that named no locale**, and only when the bundle carries
   no `en-US` row: the bundle's lowest locale tag.

So a bundle with no `en-US` row dead-letters (`TEMPLATE_NOT_FOUND`, permanent)
for every recipient whose locale was NAMED, and silently renders whichever
language sorts first for every call that named none. The shipped declaration
promised the loud permanent refusal on the path where the runtime performs the
silent fill; an author reading it was told a missing locale always
dead-letters. Both call shapes are now named wherever the floor is claimed, and
the ladder itself is stated in one place only.

Also corrected: `SendTemplateInput.template` said the service "picks the
best-matching locale row", which the resolver has never done — there is no
best match and no folding, only the ladder above.

`defineStack`'s `warnEmailTemplateLocaleFloor` gains a declaration of the two
shapes it deliberately does NOT examine (a stack whose `i18n.supportedLocales`
is absent or empty; a bundle whose tags all fall outside `supportedLocales`) —
both can still ship a floorless bundle. Its control flow is unchanged — the same
bundles warn, once each, and the warning stays advisory — but the emitted warning
TEXT did change, and now names BOTH call shapes: it says the bundle has no
fallback floor *for a send that names a locale*, and adds that a send naming NO
locale does not fail but drops to that bundle's lowest tag and renders it
silently. A test asserting on the old wording needs updating. Whether either
undeclared shape should warn is the ADR-0049 enforce-or-remove question and is
not answered here. Both shapes are now pinned against a warning discriminator so
neither can change without a test saying so.
