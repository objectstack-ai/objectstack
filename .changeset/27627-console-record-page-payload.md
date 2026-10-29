---
'@object-ui/types': patch
'@object-ui/data-objectstack': patch
'@object-ui/components': patch
'@object-ui/plugin-detail': patch
---

feat(console): a record page opens from one request, and a stepper's neighbours are asked ahead (#27627)

Clause-②: yes (widening: optional `DataSource.getRecordPage` / `prefetchRecordPage`, new exports; no existing contract changes)
Metadata-protocol: none

The record page (full page, split pane and drawer) asks `DataSource.getRecordPage` once when it opens, before any of its readers runs, and hands each part of the answer to the reader that used to ask for it:

- the record, with the lookups the page resolves;
- each related list's total and first rows: the tab badges, collapsed and compact related cards and reference rail cards take them, so no `top=1` count probe and no separate first-rows read goes out;
- the header's `update` / `delete` verdicts and Claim's `transfer` decision, the in-place edit blocks' field projection, and the approval rows and lock.

Readers still read for themselves after the open (a refresh, a write, a change on the data-invalidation bus), and a page on an adapter without `getRecordPage` reads as before. Lists the page cannot name in the request stay their own read: a list declared through a list view, a list whose filter carries a context token, and lists past the fiftieth. In the drawer and split pane, the stepper's previous and next record are asked ahead (`DataSource.prefetchRecordPage`), so stepping opens from an answer already on its way.

- `@object-ui/types`: `DataSource.getRecordPage?` / `prefetchRecordPage?` and the `RecordPageRequest` / `RecordPagePayload` shapes.
- `@object-ui/data-objectstack`: both methods; concurrent identical reads share one request, a prefetched answer is taken once, and a write drops them all.
- `@object-ui/components`: `RelatedCountStore.seed` / `takeRows`.
- `@object-ui/plugin-detail`: `seedRecordVerdict`, `seedRecordFieldAccess`, `seedQueueClaimDecision`, `normalizeRelatedListSort`, `COMPACT_RELATED_ROWS`; a compact related card takes its first rows from the record page's answer.
