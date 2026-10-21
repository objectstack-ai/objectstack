---
'@objectstack/service-messaging': minor
---

fix(service-messaging)!: an html or mjml `sys_notification_template` body escapes every hole's value for markup

The email channel renders a notification template row whose `format` is `html` or `mjml` into the mail's html part. Its `{{ payload.x }}` holes placed each value into that markup as stored, so a text field carrying markup characters — a person's display name, a record title, a comment — was read as markup by the recipient's mail client. Each hole's value in an html or mjml body is now HTML-escaped, in element text and quoted attributes alike, and the template's own markup renders as written. Stored text is never stripped or refused: a display name may contain any character, and the mail client shows it as typed.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. An authored template body's own markup renders exactly as before; what changes is how the renderer encodes a hole's VALUE in the html and mjml faces. The remedy is an author's choice — put the markup in the template body instead of a payload value — never a rewrite of a stored row or a package source, and stored `sys_notification_template` rows are not touched. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (what an html or mjml notification template renders for a markup-bearing value narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** in an html or mjml `sys_notification_template` body, a `{{ payload.x }}` hole rendered its value verbatim, so a value carrying markup became markup in the sent html part.
- **TO:** the same hole renders the value HTML-escaped: an ampersand, an angle bracket or a quote arrives as the matching HTML entity, which a mail client displays as the original character.
- **Unchanged:** the subject and a `markdown` or `text` body are plain text and keep rendering values verbatim. A value without markup characters renders byte-identically. The email-template path (`sys_email_template`, named in a notify step's `template`) already escaped its html body by default and is unchanged, and no stored row is rewritten.
- **What to do:** a template that relied on a payload value rendering as markup moves that markup into the template body, or into an email template, whose triple-braced hole is the one unescaped form.
