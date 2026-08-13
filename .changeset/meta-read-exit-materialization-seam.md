---
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
---

`/meta` object reads now materialize a served base the way the registry materializes its own

`GET /meta/object/:name` served `nameField: undefined` for an object whose by-name read is
answered from the `metadata` service (an artifact-booted deployment), while `GET /meta/object`
and the registry's own resolved schema served the ADR-0079 designation for the same object at
the same moment. Every title-rendering decision derived from the by-name answer — forms, record
headers, lookup labels — was made against a document the platform itself did not agree with.

The cause was structural rather than specific to `nameField`. A `/meta` object read resolves
`sys_metadata` overlay to MetadataService to SchemaRegistry, and only the last of those three has
been through the registry's object-materialization seam; each convergence installed at the read
exits so far reached for ONE named stamp, so each further stamp arrived as a further bug report
(injected system columns, then the `__search` companion, then this).

`SchemaRegistry.registerObject`'s materialization block is now a single method, and
`materializeServedObjectOnto` replays that same code onto a body that never came through
`registerObject`. The `/meta` read exits ask for the whole seam instead of naming one stamp, so a
stamp added to the block converges on served documents the day it is added. The convergence
withholds a title designation the registry itself declined, so it can only move a served copy onto
the registry's answer and never manufacture one.
