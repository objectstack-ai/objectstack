---
"@objectstack/plugin-audit": patch
---

Published README documents the record-view audit surface that actually shipped

The README was corrected against the shipped surface before record-view auditing landed,
so it still told readers that "reads and views are not on the ledger" and that the plugin
takes no configuration. Both became false when the `read` action, its writer and the
`record_views` list view merged. This is a docs-only change; it needs a version bump
because the README is in the package's published `files` array, and a correction with no
release never reaches the npm package page at all.

What the page now documents, each point verified against the source rather than against a
description of it:

- the `read` action and its writer, in the action table and in the shipped list views;
- the per-object opt-in as what it is — an **install-time list** passed to the plugin
  constructor (`new AuditPlugin({ readAudit: { objects: [...] } })`), explicitly **not** an
  `enable.auditReads` object-metadata key. A declarable key can be set on an object in a
  deployment that never installs the plugin, producing metadata that reads as audited and
  writes nothing, which is the exact class of claim this page was corrected to remove;
- the three settings the plugin forwards, and the one writer knob (`maxBufferedEvents`) it
  does not, which is reachable only by calling `installReadAuditWriter` directly;
- the record-detail discriminator that keeps list and search reads out of scope, including
  the `$or` / `$not` refusal and the AND-composed predicate the security middleware leaves
  behind;
- batched writes off the request path, the view-instant `created_at`, and the two loud
  once-only failure postures (buffer overflow, failed ledger write);
- the two declared boundaries — a system-elevated read and a read with no principal both
  write no row;
- that no field values are recorded, and therefore that the ledger cannot answer what a
  viewer actually saw;
- that the shipped `record_views` view carries an `ip_address` column which is always empty
  on a `read` row, because no read-path writer stamps it.

Record-view auditing adds no enterprise dependency: this package's declared edition is
`open`, and the opt-in is ordinary plugin configuration. The two enterprise-dependent
behaviours already annotated on the page — the hierarchy resolver and the archive
datasource — are unchanged.
