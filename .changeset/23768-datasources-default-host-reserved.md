---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-data` datasources rule states that `default` is host-reserved — the host connects it from `OS_DATABASE_URL`, and a stack that declares a datasource named `default` is refused (#23768)

Clause-②: no

`skills/objectstack-data/rules/datasources.md`'s opening paragraph read "Most apps need only the `default` datasource; declare more to read/write a separate or external database." "Declare more" implied that `default` is declared too, and a stack whose `datasources` collection carries an entry named `default` is refused at `defineStack`, `os validate`, publish and boot: the host declares and connects `default` itself. The sentence is replaced by the rule the spec and runtime hold: `default` is host-reserved, the host connects it from `OS_DATABASE_URL`, a stack that declares a datasource named `default` is refused, and a datasource is declared under its own name only to read/write a separate or external database. The added words are paid for inside the same file by deleting two restatements of the field reference: "`external` settings are required when `schemaMode !== 'managed'`" (the schema refuses the omission itself) and "Set `autoConnect: true` to force a live connection" (the auto-connect list two lines above already names it). No behaviour changes; nothing an author writes changes.
