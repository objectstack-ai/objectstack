---
'@objectstack/service-knowledge': patch
---

feat(service-knowledge): `search_knowledge` takes `scope`, `granularity` and `groupBy`

Clause-②: yes
Metadata-protocol: none

ADR-0161 K9, rule 2 (#37311): the one `search_knowledge` definition gains the three arguments its knowledge service already reads, so an MCP client (HTTP and stdio) and the in-product agent are offered them alike. No transport adds or edits an argument.

- `granularity: "record"` answers one hit per record, its best passage; `groupBy` answers one hit per value of a field the source lists in `metadataFields`, the value carried as the hit's `groupValue`; `scope` searches only inside the named records, or the records linking to the named parents. Each is handed to `IKnowledgeService.search` as its option of the same name.
- A hit also carries `headingPath` where its passage has headings. The hit stays a whitelist: no `chunkId`, `docHash` or `metadata`.
- Each malformed argument is refused `VALIDATION_ERROR` (400) naming it. The tool is stricter than the service: an empty `scope` or an entry with no ids is refused (as an empty `sourceIds` is), and an object name, record id or field name over 255 characters or holding a NUL character is refused. A refusal quotes a caller's string and cuts it to 64 characters, and lists at most five.
- The executor searches only `aiExposed` sources, so a `scope` entry or `groupBy` field only a withheld source would answer gets the same empty answer as one no source answers. The answer carries no count of hits the permission re-check or the scope removed.
