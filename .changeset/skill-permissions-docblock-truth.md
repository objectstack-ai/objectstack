---
"@objectstack/spec": patch
---

docs(spec): state that a `permissions` key on a skill is REJECTED, not stripped (#7567)

`SkillSchema`'s docblock carried a `NOTE` paragraph saying an authored
`permissions` key "is unknown to this schema and silently stripped at parse
time." That was true once, but the behaviour changed: `SkillSchema` is a
`strictObject` whose `guidance.permissions` entry now REFUSES an authored
`permissions` key outright, with a located message telling the author to gate
at the agent level instead (`agent.access` / `agent.permissions`, enforced
since #1884). The docblock's stale present tense was the only thing still
saying "stripped" — a reader could conclude the authoring surface was still
lax exactly where it is now strict.

Only the `NOTE` paragraph's wording changes: it now says the key is rejected
at parse time and points at the located refusal message
(`guidance.permissions`) below it in the same file. The refusal message
itself is untouched — its own "this was stripped in silence" phrase narrates
the historical reason for the refusal, not current behaviour, and stays
correct as written. Every input parses byte-identically before and after this
change (`git diff` touches only comment lines); `pnpm --filter @objectstack/spec
typecheck` and the full spec test suite (9840 tests) are green, and
`check:docs` reports all 231 generated files still in sync — this paragraph
is an inner/property-level TSDoc comment, not the module-level blurb
`build-docs.ts` renders, so no generated doc changes.

Adds a patch changeset for `@objectstack/spec`, following the #7444 / #7473 /
#7565 precedent for describe/TSDoc-only spec docs fixes.
