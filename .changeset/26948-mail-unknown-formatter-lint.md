---
'@objectstack/lint': minor
---

feat(lint)!: `email-template-hole-grammar` refuses an email template hole whose formatter the whitelist does not name, naming the hole and listing the known formatters

Clause-②: no (narrowing) — `os validate`, `os build`, `os lint` and the metadata publish door (`422 INVALID_METADATA`) refuse an `email_template` whose `subject`, `bodyText` or `bodyHtml` writes a hole naming a formatter `TEMPLATE_FORMATTERS` does not hold (`{{ amount | curency:EUR }}`, `{{ due | dat:long }}`), which they accepted before. No accept set is widened, and no export or rule id is added or removed.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: a hole whose formatter never formatted anything (the renderer printed the raw value) is now refused where it is authored. A conversion cannot know which formatter was meant, and the refusal names the hole and lists the known formatters, so there is no key for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at every authoring door for `email_template`.

- **Before.** `{{ amount | curency:EUR }}` passed every gate, and the email went out with `1234.5` where money was meant. The in-app template dialect already refused such a hole; mail did not.
- **Now.** The rule refuses it at `error`, naming the hole, the face and the template, and listing the known formatters. The judgement is `@objectstack/formula`'s `judgeMailHoleGrammar`, the grammar the mail renderer parses with.
- **Who sees it.** A template whose hole misspells a formatter or names one that does not exist. No template shipped in this repository does.

**The remedy.** Correct the formatter's name to one the finding lists, or format the value in the caller that supplies the data and pass the finished text as its own variable.
