---
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-ragflow': patch
---

fix(service-knowledge): knowledge search asks the object's API exposure and the caller's field-level read rules before it searches a source

Clause-②: no
Metadata-protocol: none

A knowledge passage is built at index time, under a system context, from every `contentFields` member of its source, the record `title` and the source's `metadataFields`. Knowledge search re-checked only that the caller may read each hit's row, so a caller who could read a row but not one of those fields was served that field's text, and an object the API does not serve was served as passages. `KnowledgeService.search` now decides, for a non-system caller and once per object per search, whether each `object` source may be searched at all:

- the object's owning package is not disabled;
- the spec's exposure decision serves the object for the `search` operation (`enable.apiEnabled: false`, or an `enable.apiMethods` whitelist that does not grant `search`, refuses);
- a `sys_*` object declares `enable.aiReadable: true`;
- every field the source serves (each `contentFields` member, `'*'` meaning every declared field; each `metadataFields` member; `title`), less the credential-class and `internal` fields an index never carries, is one the caller may query, per the `security` service's `getQueryableFields` (absent it, `getReadableFields` less every field declaring a `maskingRule`; with no `security` service, every field except those declaring a `maskingRule`).

A source that fails any gate is not searched for that caller. Every gate fails closed: a lookup that throws, or a `security` service that answers neither field question, keeps the source out. `KnowledgeServicePlugin` wires the `security` service, resolved per search: only the kernel's not-registered answer reads as "no security service"; any other throw from that lookup (a registration that cannot be used) refuses the sources, reported once at `error`. A host constructing `KnowledgeService` directly passes it as the new optional `resolveSecurity` option. The system context bypasses the gates, as it bypasses the row re-check.

Three adjacent holes close with it. A caller with no execution context, or a service with no data engine bound, is now searched no `object` source at all, where before an object-source hit carrying no `sourceRecordId` was served to it. An admitted object source's hit with no `sourceRecordId` cannot be re-checked and is dropped. A hit is served only as the source it was searched for: `KnowledgeService.search` drops a hit naming another source, and `@objectstack/knowledge-ragflow` drops a retrieved chunk stamped with another source's id (two sources configured with one `datasetId`), keeping unstamped chunks RAGFlow ingested itself.

**Narrowing for restricted callers.** A caller who may read a source's rows but not one of the fields the source serves now gets no hits from that source, where before it got passages carrying that field's text. A caller of an `apiEnabled: false` object, of an object whose `apiMethods` do not grant `search`, of a disabled package's object, or of a `sys_*` object without `enable.aiReadable: true` now gets no hits from its sources. No metadata key changes. To keep a source searchable for restricted callers, declare its `contentFields` / `metadataFields` from fields every intended reader may query and move sensitive fields into a separate source.
