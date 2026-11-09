---
'@object-ui/app-shell': patch
---

perf(app-shell): Home's navigation roster gate asks the objects it requires in one `GET /meta/object?names=a,b,c` request, instead of one by-name read per object

Clause-②: no
Metadata-protocol: none

Outside an app (Home, whose activity feeds gate every app's navigation), the runtime-capability gate for `requiresObject` entries read each required object by name, one `GET /meta/object/NAME` per name (eight on app-crm). It now asks the names it has not asked yet in one `?names=` request (`meta.getItems('object', { names })`). A name the answer leaves out is treated as not registered, exactly as a by-name `404` was, so its entry stays hidden. A request that gets no answer leaves every name unanswered, so each entry shows, as when a by-name read failed. A refresh asks the same names again in one request. Inside an app nothing changes: the gate still reads the union by name, so the record form keeps sharing those reads with the data adapter's cache. Under the draft preview the gate also keeps the by-name reads.
