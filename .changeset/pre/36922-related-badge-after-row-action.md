---
'@object-ui/components': patch
---

fix(components): a related-list tab badge keeps following its list after a row action

Clause-②: no
Metadata-protocol: none

On a record page, after a row action ran in a related list (for example an `update` action such as "Mark done"), every later delete or create in that list left the tab's count badge on its old number until a reload, while the list showed the new one.

A row action reaches the data-change bus twice, a beat apart: the write's own mutation event, then the related list's refresh. The first change sent a re-count; the second overtook it while it was out. `RelatedCountStore.fetch` then resolved with the overtaken read's number without caching it, and the record page's count reader took "resolved, nothing cached" as a failed read and stopped asking for that count for the rest of the record open.

`RelatedCountStore.fetch` now settles on a count the store holds: when a change overtakes the read it joined (an invalidation, a newer seeded read, or a rail card's unmount), it takes the count a newer read installed, joins the read now in flight, or reads again. A read that fails without being overtaken still answers `0` with nothing cached, as before.
