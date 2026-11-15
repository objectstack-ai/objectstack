---
'@objectstack/skills': patch
---

skills(objectstack-ui, query, automation): examples name the injected `owner_id` as the record owner, not an `assigned_to` / `assignee` field

objectstack-data teaches that a request's owner, assignee, 负责人 or 处理人 is the platform's injected `owner_id`. The other skills still taught a separate `assigned_to` / `assignee` field as the owner, so an agent loading both got conflicting teaching. Now the objectstack-ui list-view columns, the "mine" filter, the kanban and gantt columns, the reassign action's param and the dashboard metric filter use `owner_id`. The column that relabelled `assigned_to` as "Owner" is gone. The "mine" filter links to objectstack-data § Relationship Patterns. The objectstack-query `expand` example and the objectstack-automation `notify` recipients do the same. Evals: objectstack-ui views evals 1 and 12 and objectstack-query eval 4 now expect `owner_id`. Views eval 2's reference answer no longer spells the `requiresObject` literal its own assertion forbids.

Clause-②: no
Metadata-protocol: none
