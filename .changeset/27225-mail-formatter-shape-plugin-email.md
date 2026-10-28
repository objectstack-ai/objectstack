---
'@objectstack/plugin-email': minor
---

feat(plugin-email)!: a mail template hole whose text after the `|` is not a formatter name fails the render with `TEMPLATE_INVALID` instead of being printed as written

Clause-②: no (narrowing) — `sendTemplate` and `renderTemplate` refuse a stored template whose `subject`, `body_text` or `body_html` writes a path followed by `|` and text that is not a formatter name (`{{ due | date-long }}`, `{{ x | two words }}`), which they printed to the recipient as written before. The package adds no export.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export changes: the renderer refuses a hole the authoring rule refuses, for a template that reached it without being judged. A conversion cannot know which formatter was meant, so there is nothing for a migration to rewrite. -->

**BREAKING** a render that printed a hole as written now fails.

- **Before.** `{{ due | date-long }}` rendered the text `{{ due | date-long }}` in every face. So did `{{ amount | currency :EUR }}` and `{{ note | default:it's }}`, though the in-app dialect formats both.
- **Now.** A formatter part that is not a formatter name makes the render throw `TEMPLATE_INVALID: email template NAME (locale=LOCALE): the hole … writes 'date-long' where the formatter name goes …`, stating the shape and listing the known formatters; `sendTemplate` sends nothing. The authoring doors refuse the same hole first (`email-template-hole-grammar`), so this is reached only by a template stored before that rule, until its next publish. `renderTemplate` and `renderPlainTextTemplate` throw it too when handed a body directly.
- **Read as in-app.** `{{ amount | currency :EUR }}` now renders `€1,234.50`, `{{ note | default:it's }}` renders `it's` for an empty value, and `default:"n/a"` supplies `n/a` without its quotes.
- **Still verbatim.** Brace text whose part before any `|` is not a path (`{{ not a path }}`, `{{}}`, `{{ | upper }}`) is the template's own text and renders as written.

**The remedy.** Republish the template with the formatter written as one of the names the refusal lists, optionally followed by `:` and its argument.
