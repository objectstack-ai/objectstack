---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): Change Owner's queue picker searches the server, so a queue past the first 200 can be found and picked; a non-grid list says bulk Change Owner is in the grid

Clause-②: no
Metadata-protocol: none

The Change Owner dialog's queue target used to read `sys_queue` once, capped at 200 rows, into a plain dropdown with no search, so an organization with more queues could not pick the rest. It now picks the queue the way the person tab picks a person: with the shared lookup picker over `sys_queue`, which reads one page at a time when it is opened and sends the typed term to the server as its search. The picker shows the queue's label and sends its `name`, which is what the Change Owner endpoint's `queue` takes. Nothing the endpoint accepts changes.

Bulk Change Owner lives in the grid's selection bar, and kanban, calendar, gallery, timeline, gantt, map and tree layouts select no rows. On those layouts, a reader the grid would offer bulk Change Owner to (the object offers the action and the object-level transfer verdict allows it) now sees one muted line above the list: "To change the owner of several records at once, switch to a grid view." The list view's `onBulkChangeOwner` documentation says the same.

`@object-ui/i18n`: adds `console.changeOwner.gridOnly` to every locale pack and removes the four keys the old queue dropdown read and nothing reads any more: `console.changeOwner.noClient`, `console.changeOwner.queuesLoading`, `console.changeOwner.queuesFailed` and `console.changeOwner.noQueues`.
