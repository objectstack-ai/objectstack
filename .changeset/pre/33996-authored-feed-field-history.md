---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
---

fix(record-page): an authored record page's feed panels show the record's field history, and offer Field Changes

Clause-②: no
Metadata-protocol: none

On an authored (assigned) record page, a `record:discussion`, `record:chatter` or `record:activity` panel never showed who changed which field from what to what, never offered the Field Changes filter, and an authored `filterMode: 'changes_only'` silently opened on All Activity. The record page read the audit log only for the page it synthesizes.

Now, on an object with `enable.trackHistory`, the record page reads the record's field history (the newest 50 audit entries, plus one user-name lookup) while one of those panels is on screen, at open or when its tab opens; a page with no such panel on screen, or an object without `trackHistory`, reads nothing more. The panel merges the field changes into its feed the way the default page's activity stream does: an update that wrote both an activity row and an audit entry is one row, now showing its before and after values; a change with no activity row is its own row; and an `updated` activity row with no audit entry steps aside, as on the stream. Field Changes is offered, and an authored `changes_only` holds those changes, exactly when the reader's audit read answered: a reader the server refuses the audit log to is offered no Field Changes, as before. A panel authored with `unifiedTimeline: false` shows no field changes and offers no Field Changes.

Visible change on existing authored pages: on a `trackHistory` object, a feed panel's All Activity now includes the field changes with their before and after values, and its filter gains Field Changes. The default record page is unchanged. `@object-ui/plugin-detail` adds `mergeFieldHistoryIntoFeed` to its `recordTimelineStream` module (not re-exported from the package entry); no locale keys, props or entry exports change.
