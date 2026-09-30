---
'@objectstack/spec': patch
---

The ADR-0087 migration entries cite the commit that decided each retirement instead of a tracker number that no longer resolves

Clause-②: no

The source comments of the migration registry's retired-key, retired-def and semantic
entries named GitHub issues that no longer exist, so a reader could not tell a rule kept
on purpose from one nobody could explain. Each of those comments now names the commit
that made the decision and, where the number alone carried the meaning, says what was
decided. The compiled `@objectstack/spec/migrations` entry carries these comments, which
is why this is a release note at all. Comment text only: no entry id, retired key or def,
prescription, projected upgrade-guide text, schema, export or runtime behaviour changes.
