---
'@objectstack/spec': patch
---

fix(spec): the `object-kanban` `quickAdd` retirement no longer sends authors to the `kanban-ui` block, which objectui does not register

Clause-②: no

- The refusal of `quickAdd` on `object-kanban` now ends "Delete the key; `object-kanban` offers no quick-add control." It used to say the control "is unchanged on the `kanban-ui` block". objectui retired that block (objectui#8257), so a node of that type saves clean and renders nothing. The refusal itself is unchanged: the same key is still refused, with the same code and path.
- The same sentence replaces the old one in the `os migrate meta --from 17` output (the `object-kanban-quick-add-retired` entry) and in the summary of the `object-kanban-quick-add-removed` conversion. That entry no longer offers "move the board to a host that renders the `kanban-ui` block" as a second way out.
- No author action beyond the existing one. `quickAdd: true` on an `object-kanban` is still a parse error. Delete the key.
