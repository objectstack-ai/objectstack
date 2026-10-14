---
'@objectstack/spec': patch
---

fix(spec): the two step-18 flow-binding D3 entries name only the reads a renamed variable has on protocol 18, a text-slot hole and a CEL expression

Clause-②: no

The `replacement` text of two ADR-0087 D3 semantic entries, `flow-binding-name-dollar-refused` and `flow-binding-variable-dollar-name-refused`, listed three ways a flow reads the old variable name, for the author to rename. Protocol 18 has only the first two. The protocol upgrade guide and `spec-changes.json` are generated from these entries, so they now say what the two entries' release notes already say.

| FROM | TO |
|:--|:--|
| Rename every read of the old name with it — a text-slot hole, a CEL expression, a single-brace token in a value position | Rename every read of the old name with it — a text-slot hole, a CEL expression |

No protocol-18 value position reads a flow variable through a single-brace `{…}` token. A value slot takes a CEL value envelope or a literal, and a `{…}` token there is refused. The one `{…}` string a value slot hands on is a CRUD `filter` operand's whole-string query placeholder (`{current_user_id}`, `{today}`): the query engine reads it, and it names no flow variable. A text slot reads `{{ }}` holes.

Text only. No schema, door, conversion or entry id changes, and each entry keeps its `fromVersion`, `toVersion` and every other field.
