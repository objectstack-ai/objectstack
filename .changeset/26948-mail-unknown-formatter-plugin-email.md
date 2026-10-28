---
'@objectstack/plugin-email': minor
---

feat(plugin-email)!: a mail template hole whose formatter the whitelist does not name fails the render with `TEMPLATE_INVALID` instead of printing the raw value

Clause-②: no (narrowing) — `sendTemplate` and `renderTemplate` refuse a stored template whose `subject`, `body_text` or `body_html` writes a hole naming a formatter `TEMPLATE_FORMATTERS` does not hold (`{{ amount | curency:EUR }}`), which rendered the raw value before. No accept set is widened, and the package adds no export.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export changes: the renderer refuses a hole the authoring rule refuses, for a template that reached it without being judged. A conversion cannot know which formatter was meant, so there is nothing for a migration to rewrite. -->

**BREAKING** a render that printed a raw value where a formatted one was meant now fails.

- **Before.** `{{ amount | curency:EUR }}` with `amount = 1234.5` rendered `1234.5` in every face, and `{{ due | dat:long }}` rendered the stored timestamp as written: the renderer's fallback for a formatter it did not know was the raw value.
- **Now.** The render throws `TEMPLATE_INVALID: email template NAME (locale=LOCALE): the hole … names the formatter 'curency', which is not a template formatter …`, listing the known formatters; `sendTemplate` sends nothing, and the messaging channels grade the failure permanent as they grade every `TEMPLATE_INVALID`. The authoring doors refuse the same hole first (`email-template-hole-grammar`), so this is reached only by a template stored before that rule, until its next publish.
- **The raw fallback is gone.** `renderTemplate` and `renderPlainTextTemplate` throw `TEMPLATE_INVALID` for such a hole too, when handed a body directly.

**The remedy.** Republish the template with the formatter's name corrected to one the refusal lists.
