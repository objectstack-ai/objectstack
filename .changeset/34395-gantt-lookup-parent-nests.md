---
'@object-ui/plugin-gantt': patch
---

fix(plugin-gantt): a Gantt whose `parentField` is a lookup nests its tasks again

Clause-②: no
Metadata-protocol: none

The Gantt reads each record with its lookups expanded, so the value under a lookup `parentField` (a self-lookup such as a task's `parent_task`) is the related row, not its id. The task tree matches a child to its parent by id, so every task drew flat: summary tasks did not nest their subtasks, on both the object-gantt block and the gantt list view. The Gantt now reads the parent's `id` (or `_id`) off an expanded row, the way it already reads predecessor links. A `parentField` that holds a plain id behaves as before, and a record with no parent stays at the top level.
