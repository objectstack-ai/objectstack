---
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
---

docs(metadata-protocol,objectql): stop teaching the retired `environment_id` column stamp/filter (#13434)

Prose only — no behaviour changes, and the `environmentId` option is untouched
and still very much alive. What changes is what the docstrings on the two
plugin options interfaces teach, and those docstrings ship: they are emitted
into both packages' published `.d.ts` on the exported `ObjectQLPluginOptions`
and `MetadataProtocolPluginOptions`, so this is the tooltip a consumer
configuring per-environment scoping actually reads.

Seven passages still described `saveMetaItem` stamping an `environment_id`
column on new `sys_metadata` rows and `loadMetaFromDb` filtering by it. That
job was retired by ADR-0005 (revised 2026-05) / ADR-0006 v4 when each
environment got its own physical database: `organization_id` is the isolation
key that survived. The three files carry **zero** non-comment occurrences of
`environment_id` (positive control in the same files under the same filter:
`organization_id` answers 44 in `protocol.ts`), `loadMetaFromDb`'s actual
where-clause is `{ state: 'active', organization_id: null }`, and
`SysMetadataObject.environment_id`, `DatabaseLoaderOptions.environmentId` and
`DatabaseLoader`'s pin test already say so.

The danger was not staleness but subject: the prose described an **isolation
barrier**, so an author reading it would believe an environment-level boundary
existed inside `sys_metadata`. The replacements say what is true now and say
that the column job was retired, rather than deleting the sentence — a bare
deletion loses the signal for the next reader who wonders whether environment
scoping was ever there.

`environmentId` keeps every job it actually has, and the corrected prose now
names them from measurement: the ADR-0005 overlay-whitelist gate, the ADR-0010
metadata-lock evaluation, the SchemaRegistry hydration/listing posture, the
metadata-service bridge skip, and the local metadata-storage provisioning
decision.
