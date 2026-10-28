---
'@object-ui/plugin-detail': patch
---

fix(ui): the page designer canvas draws an authored `record:details` body's `select` and `location` values the way the record page does (#27177)

Clause-②: no
Metadata-protocol: none

On the page designer's Design canvas, a `full` record page whose `record:details` block names its fields drew a `select` value as its stored code (`amer` instead of `Americas`) and a `location` value as the literal `[Object]`. The record page itself was right.

`DetailView` learned field types only from its dataSource (`getObjectSchema`). The canvas mounts the record page's own `record:details` renderer under a record context that holds the bound object's schema but no dataSource, so a field named by bare name had no type and drew raw. Now, when the host supplies the record (`recordFromHost`, which `record:details` sets), `DetailView` takes field types from the record context's object schema until a dataSource answers. A dataSource answer still wins, nothing new is fetched, and a `DetailView` with no record context, or one that reads its own record, draws exactly as before.
