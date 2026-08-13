---
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
---

fix(meta): `/meta/object/:name` reports the `__search` companion column, agreeing with `GET /meta/object` (#8038)

The two `/meta` reads of an object answered the "does this object have a
`__search` column?" question two different ways, split cleanly by PROVENANCE.
Measured end-to-end on the showcase, booted from a compiled artifact with
`OS_SEARCH_PINYIN_ENABLED=true` (69 objects served):

- **22 package objects** carried the companion on `GET /meta/object` and were
  served **without** it by `GET /meta/object/:name` — all 22 of them, and by
  `?layers=true`'s `effective` layer too.
- **45 platform objects** carried it on both routes and always had.

(The two objects with no title-eligible field — `showcase_project_membership`
and `sys_session` — have no companion on either route, correctly.)

Nothing about an object caused this; where its by-name read was ANSWERED FROM
did. The companion is provisioned at the SchemaRegistry's
object-materialization seam, so `GET /meta/object` — composed from
`listItems('object')` — serves a materialized body. The by-name read consults
the `metadata` SERVICE first, and on a deployment booted from a compiled
artifact (`artifactSource`: every sealed/served runtime, and `objectstack
serve`) that service holds the author's DECLARATION, captured before
materialization. Platform objects are registered straight into the registry, so
their by-name read never meets that copy and agreed all along. Which side a
caller lands on is invisible in the response.

This is the third thing to arrive through this exact gap, and it is fixed the
way the second one was ruled: #7556 folded the missing `objectExtensions`, and
#6562 ruled (maintainer, 2026-08-08, Option B) that a `/meta` object read serves
the **effective runtime schema** and the minority path converges on the
registry-backed majority — that is what `governServedItem` already does for the
injected system columns (`created_at`, `owner_id`, `organization_id`). The
companion is the same kind of thing coming through the same door, so it
converges at the same read exits, from the same authority: the registry that
made the provisioning decision. It is deployment-gated
(`OS_SEARCH_PINYIN_ENABLED`, or an explicit `searchCompanion` option), and the
gate is read off that registry rather than re-derived from the environment, so
the pass and the decision cannot disagree.

**This is a payload change for every consumer of these routes.** Objects served
by the by-name read on an artifact-booted deployment now carry one additional
hidden field declaration — `__search` (`hidden`, `system`, `readonly`,
`searchable: false`) — where they previously did not, matching what the list
read has always served for the same object. Nothing is removed, and the
`?layers=true` `code` and `overlay` layers stay byte-verbatim: they are what the
package shipped and what the tenant customised, and the convergence deliberately
lands only on read exits and on `effective` (#6562 ruling constraint 1).

Unrelated to #7642, which strips `__search` from RECORD bodies on the data path.
That is row values; this is the schema description, where the companion's
presence is the documented shape — #7561 exists precisely because `/meta`
re-parses the served object body and the stamp had to be spec-valid there.

**Write path.** The read adds a real field declaration, so the write path takes
it back off again, exactly as #6562's `stripInjectedSystemColumns` does for the
injected columns: without it the ordinary GET → edit → PUT stored the platform's
own column as a tenant customisation. Measured on the runtime-created object
path — the write door type `object` has open by default — the stored row went
from `fields: [name]` to `fields: [__search, name]` on a single round-trip. The
strip is exact: only an entry byte-identical to what the provisioning seam would
stamp is removed, recomputed from that function rather than transcribed, so a
body carrying anything else under that name keeps it.
