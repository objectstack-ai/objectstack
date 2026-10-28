---
'@objectstack/skills': patch
---

docs(skills): objectstack-i18n teaches the `books` translation group, with an eval for a two-language doc book

Clause-②: no
Metadata-protocol: none

- **Before.** The top-level group list in `skills/objectstack-i18n/SKILL.md` named fourteen of the bundle's fifteen groups and left out `books`, the group the spec added so a doc book's title and section titles follow the reader's locale. An agent writing a zh-CN bundle from the skill left the docs sidebar in one language or invented a key under `pages`.
- **Now.** The list names `books` with its three keys — `books.{book}.label` / `.description` by `Book.name` and `books.{book}.groups.{group_key}.label` by each group's stable `key` — says the pages themselves localize through `doc.translations` and that a book's inline `translations` map stays retired; `os i18n extract --no-objects-only` seeds the group like every other. Eval 9 in `evals/bundles-locales-coverage.json` checks that an answer for a two-language manual spells the book label and a group label by key and never a `pages.*` key. Five eval sentences that restated a rule the skill already teaches were cut to pay for it.
- No schema, key or behaviour changes.
