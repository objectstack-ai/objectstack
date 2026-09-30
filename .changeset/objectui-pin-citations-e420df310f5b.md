---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `e420df310f5b`.

Clause-②: no

Several records were corrected rather than moved, because objectui changed what they describe on this hop: the four `action:*` registrations now publish the keys their rows declare, `endpoint` and `undoable` aside (objectui#11168), `action:group` and `action:menu` now apply a host-evaluated `disabled` that their rows do not declare (objectui#11182, recorded, not declared), the `object-kanban` default row cap is named `DEFAULT_KANBAN_FETCH_BATCH_SIZE` (objectui#9853), the board no longer forwards `quickAdd` (objectui#8285, objectui#11234), the `object-tree` ladder now judges `data` on the `view-data` arm its row declares (objectui#8348), and `object-map` / `object-gantt` / `object-timeline` now publish `filter` and `sort` inputs (objectui#8220). Two older statements that were already stale are also corrected: an authored `data` array on `object-map` no longer reaches the renderer through the React props channel (objectui#9571), and the `quickAdd` retirement record now notes that the schema-only `kanban-ui` block it points to is retired in objectui (objectui#8257). No key, default, enum member or export moves.
