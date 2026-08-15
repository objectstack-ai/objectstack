---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): global search titles a hit from the canonical `nameField`, not only the deprecated `displayNameField` alias (#8786)

`searchAll` — the global-search (⌘K) palette — resolved a hit's title from a
candidate list that opened with `obj.displayNameField` **alone**. Under
ADR-0079 `nameField` is the canonical primary-title pointer and
`displayNameField` is the deprecated alias, so this was the one consumer a
canonical designation could not reach.

It is reachable rather than theoretical because `provisionPrimary` — the
ADR-0079 designation seat the SchemaRegistry runs on every object at
registration — stamps `nameField` **only** and never the alias. An object that
declares its primary title canonically, without also carrying the deprecated
alias, produced `undefined` for that entry, the entry was filtered out of the
candidate list, and the title fell through to `String(row.id)`: the palette
showed a raw record id where the object's own declared, populated title
existed.

Impact was bounded to objects whose primary title is **outside**
`name` / `full_name` / `title` / `subject` / `label` / `company` — anything in
that conventional list already resolved through the later entries, which is why
this stayed invisible. An object declaring `nameField: 'company_name'` now
titles its hits `Acme Industrial` instead of `acc_1`.

The fix reads the precedence the rest of the platform already spells —
`obj.nameField ?? obj.displayNameField` — matching `resolveDisplayField`
(`@objectstack/spec`), the #4254 ingress gate, and this same function's
search-field resolution 44 lines below. The deprecated alias is still honored
on its own; only objects that carry **both** pointers naming **different**
fields see a precedence change, and no such object exists in this repo (every
one that carries both spells them identically).

Presentation only: which rows come back is untouched.
