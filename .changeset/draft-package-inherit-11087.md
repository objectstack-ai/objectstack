---
'@objectstack/metadata-protocol': patch
---

A package-less `state='draft'` save inherits the overlaid active row's `package_id` (#11087) — so package-scoped consumers (`listDrafts({packageId})`, per-package publish, pending-changes surfaces) count the draft instead of orphaning it — with in-place adoption of pre-fix NULL-package orphan drafts (never forked into a second row). Explicit `packageId` is never overridden; a brand-new item drafted first keeps package-less semantics.
