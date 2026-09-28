---
"@objectstack/plugin-email": patch
---

A template's plain-text faces — the subject and `body_text` — now render their `{{x}}` values verbatim instead of HTML-escaping them, so a link in the text part keeps its literal `&` (#20374).

Clause-②: no

- **What was wrong.** `EmailService` rendered every face of a `sys_email_template` row through the HTML escaper. In the text/plain part of the built-in verification, password-reset, invitation and magic-link mails the link read `…?token=…&amp;callbackURL=%2F`: a plain-text client, or a user copying the link, got a parameter named `amp;callbackURL`, and the post-verification redirect fell back to `/`. The same escaping put `&amp;` / `&#39;` into subjects built from names such as `R&D` or `O'Brien`.
- **What changes.** Escaping now follows the face. `body_html` is markup and is rendered exactly as before: `{{x}}` HTML-escaped, `{{{x}}}` not. The subject and `body_text` are plain text: every hole renders its value as-is, and triple braces mean the same as double there. The switch is in the renderer, so it covers every row that reaches `sendTemplate` / `renderTemplate` — the built-in auth templates, declared `emailTemplates` and rows authored in Studio — with no template edit.
- **Who sees it.** The persisted `sys_email.body_text` and `subject`, the delivered text part and Subject header, and `IEmailService.renderTemplate()`'s `text` / `subject` (which the messaging inbox channel stores as a notification's body and title). A row with no `body_text` is unchanged: its text part was already derived from the HTML with the entities decoded.
- **Unchanged.** The exported `renderTemplate()` helper is still the HTML renderer. Nothing an author writes needs to change.
