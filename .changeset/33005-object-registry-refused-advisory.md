---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a publish whose object the runtime registry refused says so on its answer, under the stable advisory rule `object-registry-refused`, and logs it at error once

Clause-②: no
Metadata-protocol: none

The registry write-through runs after the metadata commit (ADR-0067 D2) and used to keep a refused `registerObject` to a `warn` line: `publishPackageDrafts` answered `published` with nothing naming the object, while every data read, write and seed load against it answered `OBJECT_NOT_FOUND` until something registered it.

- `publishPackageDrafts`: the refused object's `published[]` element carries one `warning` advisory, rule `object-registry-refused`, `where: object "NAME"`, in the `RuntimeAuthoringIssue` shape the other advisories use. The outcome and `success` are unchanged; a clean publish's answer is byte-unchanged.
- `publishMetaItem` and a publish-mode `saveMetaItem` put the same advisory on their own `advisories`.
- The server logs one `error` line per refused object of a publish, naming the consequence and the fix (resolve the refusal, then publish the object again, or restart), with the registry's reason as a separate argument. An undeclared failure's text stays out of the 2xx body, as on the `object-storage-sync-refused` advisory.

The rule id is stable across releases: a client can key on it now.
