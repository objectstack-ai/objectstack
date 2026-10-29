---
'@objectstack/skills': patch
---

docs(skills): objectstack-data teaches that a `secret` / `password` column is queried only for presence, with one eval

Clause-②: no
Metadata-protocol: none

- **Before.** The engine refuses a credential column (`type: 'secret'` / `type: 'password'`) as a filter key, a sort key, a group-by or min/max key and an import `matchFields` key with `400 INVALID_FIELD`, and its search scan never reads one. `objectstack-data`'s `rules/security.md` taught the credential types but said nothing about querying them, so an agent following it could still write a view filter, sort, report or import mapping that the runtime refuses.
- **Now.** `rules/security.md` states the rule next to the `secret` example: the only condition allowed on a credential column asks whether it has a value (`null`, `$null`, `$exists`, `$empty`); everything else is refused; search never scans it, so it does not belong in `searchableFields`. One eval asks for a list view filtered on a `secret` field and expects the redirect to a has-a-value filter.
- The new text in `rules/security.md` is paid for by folding sentences the package already holds elsewhere (the `secret` type's purpose and encryption in `rules/field-types.md`, the queue parking rule in `SKILL.md`); the file stays under its token ceiling. No schema, key or runtime behaviour changes.
