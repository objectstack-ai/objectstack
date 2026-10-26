---
'@object-ui/app-shell': patch
---

feat(ui): the Studio permission-set form offers the field permission `when` (row condition on the edit vote)

Clause-②: yes (widening)
Metadata-protocol: none

Part of #25866 — the Studio clause of ruling 6408558941 (part ①, item 4), after #25980 landed the key itself.

- **Before.** The permission matrix's field rows carried two checkboxes, `readable` and `editable`: no way to offer or see a `when`. The Read-off cascade could leave `readable: false` beside an authored `when` (the shape the spec refuses at publish), and the Read all / Write all shortcuts dropped the condition.
- **Now.** Each field row carries **When (edit)**: an authored condition shows as a chip, and the row opens the same CEL editor the row-level-security clauses use, linted the same way; a finding the publish gate would refuse holds the save. Read off clears the condition, Read all / Write all keep it, Clear drops the entry, blank text removes the key. `FieldPerm` gains `when`, carried verbatim by the package-door slice merge.
