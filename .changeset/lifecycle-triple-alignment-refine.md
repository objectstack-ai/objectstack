---
"@objectstack/spec": patch
---

`LifecycleSchema` now refuses the `retention` + `ttl` + `archive` triple at
parse time unless the ttl restates the age bound exactly — `ttl.field:
'created_at'` with `ttl.expireAfter` equal to `retention.maxAge` (#10527).

Since #10347 the Archiver selects the rows it moves by the declared ttl cutoff
(`ttl.field` older than `ttl.expireAfter`) whenever `ttl` is declared, and by
`created_at`/`archive.after` only when it is not. On a diverging triple that
leaves `retention.maxAge` (pinned equal to `archive.after` by the existing
alignment refine) declared but enforced by nothing — a row whose `ttl.field`
sits in the future stays hot past `retention.maxAge`, silently. A declared
bound nothing enforces is the class this block already refuses loudly, so the
divergence is now rejected at authoring time with a named message instead of
being resolved by whichever column the sweep happens to read.

No shipped or example object declares the triple (censused in #10527:
`sys_audit_log` and `sys_metadata_audit` are the only archive-declaring
objects, both `retention` + `archive` pairs) — so no bundled object changes
behaviour, and the ruled-legal shapes are unchanged: `retention` + `archive`
aligned pairs and `ttl` + `archive` pairs parse exactly as before.
