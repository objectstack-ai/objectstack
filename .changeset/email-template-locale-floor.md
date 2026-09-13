---
'@objectstack/spec': minor
---

Email templates: say where the `en-US` fallback floor is, and report a bundle that has none.

`IEmailService.sendTemplate` matches `(name, locale)` exactly and retries exactly one rung —
the literal `en-US`. There is no language-subtag folding, so a bundle whose English row is
tagged `en` is unreachable from `en-US` and from every other tag it does not itself carry;
each such delivery raises `TEMPLATE_NOT_FOUND`, which classifies permanent, so it dead-letters
with no retry. An app declaring `i18n.defaultLocale: 'en'` and authoring `locale: 'en'` has
done the consistent thing throughout and still shipped a bundle with no floor — and it
validated, built and installed clean.

- `EmailTemplateDefinitionSchema.locale`'s `describe` and TSDoc now state the exact match, the
  single literal `en-US` rung, the absence of folding, and that the stack's own declared default
  locale is the wrong tag whenever it is not spelled `en-US`.
- New exported `EMAIL_TEMPLATE_FLOOR_LOCALE` names that tag once: it is both the schema default
  and the resolver's sole retry rung.
- `defineStack` now reports (advisory `console.warn`, warn-once per bundle) an `emailTemplates`
  bundle that carries rows for the stack's own `i18n.supportedLocales` but none tagged `en-US`.

Advisory only — no accept set moves. The stack still parses and is returned unchanged; the
resolver's ladder is unchanged.
