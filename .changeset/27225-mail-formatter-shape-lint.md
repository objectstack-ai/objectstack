---
'@objectstack/lint': minor
---

feat(lint)!: `email-template-hole-grammar` refuses an email template hole whose text after the `|` is not a formatter name, stating the formatter shape

Clause-②: no (narrowing) — `os validate`, `os build`, `os lint` and the metadata publish door (`422 INVALID_METADATA`) refuse an `email_template` whose `subject`, `bodyText` or `bodyHtml` writes a path followed by `|` and text that is not a formatter name (`{{ due | date-long }}`, `{{ x | two words }}`, `{{ x | }}`), which they accepted before. No accept set is widened, and no export or rule id is added or removed.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: a hole whose formatter part never formatted anything (the renderer printed it as written) is now refused where it is authored. A conversion cannot know which formatter was meant, and the refusal names the hole and states the shape, so there is no key for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at every authoring door for `email_template`.

- **Before.** `{{ due | date-long }}` passed every gate, and the email went out with that text in its body. The in-app template dialect already refused such a hole; mail did not.
- **Now.** The rule refuses it at `error`, naming the hole, the face and the template, stating the shape (one word, optionally followed by `:` and its argument) and listing the known formatters. The judgement is `@objectstack/formula`'s `judgeMailHoleGrammar`, which reads formatter parts with the in-app dialect's own tokenizer, so `{{ amount | currency :EUR }}` is accepted here as it is in-app.
- **Who sees it.** A template whose hole writes a formatter that is not one word. No template shipped in this repository does.

**The remedy.** Write the formatter as one of the names the finding lists, optionally followed by `:` and its argument, or format the value in the caller that supplies the data and pass the finished text as its own variable.
