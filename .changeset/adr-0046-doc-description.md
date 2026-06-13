---
"@objectstack/spec": minor
"@objectstack/cli": minor
---

feat(ADR-0046): add optional `description` to package docs

A doc can now carry a one-line `description` (frontmatter `description:`),
giving the natural minimal model: title / summary / body. `DocSchema` gains an
optional `description`; `os build` reads it from frontmatter. It travels in the
`GET /meta/doc` list response (unlike `content`, which the list omits), so a
docs portal can show summaries without fetching each body. Example docs
(app-showcase, app-todo) updated.

Also records the deferred-to-P3 design for doc **tags** in ADR-0046: tags are
keys (i18n-resolved, never display strings), with a small protocol core
vocabulary plus namespace-prefixed package tags — not a field to bolt on early.
