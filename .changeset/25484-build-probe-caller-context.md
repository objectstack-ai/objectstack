---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

fix: `POST /api/v1/packages/:id/publish-drafts` probes dashboard widgets as the publishing caller, so a correct dataset over a permission-gated object is no longer reported as an error-tier `widget_query_failed`

Clause-②: no
Metadata-protocol: none

The build probes that run after a package publish called the analytics service's `queryDataset` with no execution context. Read admission refuses a read with no context, so every dashboard widget bound to a dataset over a permission-gated object came back as `widget_query_failed` ("Access denied: reading … is not permitted for this user"), with a fix telling the author to change a dataset that renders correctly.

- **`@objectstack/runtime`:** the publish-drafts route now passes the caller's execution context to `publishPackageDrafts` on every request. Before, it passed one only when the request named a `backfill`.
- **`@objectstack/metadata-protocol`:** `publishPackageDrafts` passes that context to `runBuildProbes`, which takes a new optional `context`. The widget probe runs `queryDataset` as that caller, the same path the dashboard renderer takes. "Empty although the object has rows" is now judged over the rows that caller can see.

The probe never falls back to a system context. A publisher who cannot read the dataset still gets the error-tier `widget_query_failed`, because that widget will not render for them either.
