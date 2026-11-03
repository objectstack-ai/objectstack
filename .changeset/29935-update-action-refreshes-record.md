---
'@object-ui/core': patch
---

fix(core): a successful `operation: 'update'` action now refreshes the record it wrote, with no `refreshAfter: true` (#29935)

Clause-②: no
Metadata-protocol: none

The spec fills in `refreshAfter: false` on an action authored without it, and that parsed shape is what the Console is served. The server-action dispatch (`createServerActionHandler`) refreshed only when `refreshAfter !== false`, so a declared update never refreshed: the route wrote the record and answered 200, the toast reported success, and the record page kept the old values and the action button whose `visible` predicate had turned false. The list the record came from kept it under a filter it no longer matched.

A declared `operation: 'update'` writes the record it addresses by definition, so its success is now treated as a record change whatever `refreshAfter` says, the same way a client-side `dataSource.update` already reaches every reader. The record-scoped invalidation re-reads the record page (drawer and full page) and refetches every list of that object. `refreshAfter` keeps governing every other server action: a non-update action served with the default `refreshAfter: false` still sends no re-read. The spec default is unchanged.
