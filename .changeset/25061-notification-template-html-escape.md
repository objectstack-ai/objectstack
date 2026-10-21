---
'@objectstack/service-messaging': patch
---

fix(service-messaging): an html or mjml `sys_notification_template` body escapes every hole's value for markup

The email channel renders a notification template row whose `format` is `html` or `mjml` into the mail's html part. Its `{{ payload.x }}` holes placed each value into that markup as stored, so a text field carrying markup characters — a person's display name, a record title, a comment — was read as markup by the recipient's mail client. Each hole's value in an html or mjml body is now HTML-escaped, in element text and quoted attributes alike, and the template's own markup renders as written. Stored text is never stripped or refused: a display name may contain any character, and the mail client shows it as typed.

The subject and a `markdown` or `text` body are plain text and keep rendering values verbatim. The email-template path (`sys_email_template`, named in a notify step's `template`) already escaped its html body by default and is unchanged.

Clause-②: no — no key, value or write that was accepted is refused; only how the html face encodes a hole's value changes.

- **What changes.** In an html or mjml body, a value containing an ampersand, an angle bracket or a quote now arrives as the matching HTML entity, which a mail client displays as the original character.
- **What to do.** A template that relied on a payload value rendering as markup moves that markup into the template body, or into an email template, whose triple-braced hole is the one unescaped form.
