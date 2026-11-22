---
'@objectstack/skills': patch
---

docs(skills): the data skill teaches that a predicate update or delete of a `controlled_by_parent` detail writes the rows its by-id writes do

Clause-②: no
Metadata-protocol: none

objectstack-data's `rules/relationships.md`, the `writeRequiresMasterRead: true` bullet under "Writes under `controlled_by_parent`": it no longer says the ownership floor (rows you created) binds a predicate update or delete. It now says a predicate (`multi: true`) update or delete writes the rows a by-id write of each would, all matched rows or none, which is what the runtime does since the change noted as "a predicate update or delete of a `controlled_by_parent` detail now writes every row its caller may write by id". The on-behalf-of half is unchanged: the floor still binds an on-behalf-of update or delete, for both users. `evals/objects-fields-relationships.json`, eval 17: its `expected_output` states the same rule; its assertions are unchanged.
