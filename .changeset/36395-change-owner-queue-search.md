---
'@object-ui/app-shell': patch
---

feat(console): Change Owner's queue picker searches the server, so a queue past the first 200 can be found and picked

Clause-②: no
Metadata-protocol: none

The Change Owner dialog's queue target used to read `sys_queue` once, capped at 200 rows, into a plain dropdown with no search, so an organization with more queues could not pick the rest. It now picks the queue the way the person tab picks a person: with the shared lookup picker over `sys_queue`, which reads one page at a time when it is opened and sends the typed term to the server as its search. The picker shows the queue's label and sends its `name`, which is what the Change Owner endpoint's `queue` takes. Nothing the endpoint accepts changes.

The list view's `onBulkChangeOwner` documentation now says plainly that bulk Change Owner is grid-only: a kanban, calendar, gallery or other non-grid view holds no multi-row selection and offers no bulk entry.
