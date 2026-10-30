---
'@objectstack/driver-odata': minor
'@objectstack/spec': minor
---

feat(driver-odata): an OData v2 service is served by the same driver with `version: '2.0'` — the verbose JSON envelope, `$inlinecount`, typed literals, `MERGE`, and `$metadata` Associations read into the lookups an import drafts

Clause-②: yes (widening)
Metadata-protocol: added

`createODataDriverPlugin({ …, version: '2.0' })` (and `parseODataDriverConfig`) now accepts `'2.0'` beside `'4.0'`, which stays the default. Before, any value but `'4.0'` refused the boot. The v2 dialect (`odataV2Dialect`, `parseCsdlV2`, exported beside the v4 ones) plugs into the existing dialect seam; the driver and the `$filter` translator are unchanged, so the never-narrower rule, paging, keys, ETags and the error mapping hold as on v4. Only the public v2 protocol ships: SAP Gateway's CSRF token handshake, `sap-client` and the `sap:*` annotations stay out of this repository, for a vendor plugin.

- **Requests and the envelope.** Requests carry `DataServiceVersion: 2.0` and ask for `application/json`. A collection is read out of `d.results` (or a 1.0 service's bare `d` array), with `__next` followed as `@odata.nextLink` is and the string `__count` read as the count. An entity is read out of `d`; its ETag comes from `__metadata.etag`; `__metadata` and each navigation's `{ __deferred }` stub are dropped from the row.
- **Count.** `count` sends `$inlinecount=allpages&$top=0`.
- **`$filter`.** `$contains` is `substringof('x',P)`; `startswith` / `endswith` / `tolower` as on v4. Literals are typed: `datetime'…'`, `datetimeoffset'…'`, `time'PT…'`, `guid'…'`, `7L`, `1.5M` (no exponent), `1.5d`, `1.5f`. An `Edm.DateTime` comparand is pushed down only when it names its instant (a zone, an offset or a `Date`), as that instant's UTC wall clock; a bare date or a zone-less date-time is left to the engine.
- **Keys.** Key predicates take the same typed literals (`Shipments(guid'…')`, `Items(7L)`), and a composite key's `id` (`TrackingId=guid'…',Leg=2L`) is read back into the same predicate.
- **Values.** `Edm.DateTime` (`/Date(ms)/`) is read as the UTC instant, or as its date under a field the object declares `date` (v2 has no `Edm.Date`); `Edm.Int64` and `Edm.Decimal` text is read as a number (an `Edm.Int64` beyond the safe range stays text); `Edm.Time` (`PT13H20M`) is read as the time of day. Writes go out in the same forms.
- **Writes.** `create` is `POST`; a partial update is `MERGE`, sent as a `POST` tunnelled with `X-HTTP-Method: MERGE`; `delete` is `DELETE`. `If-Match` carries the `__metadata.etag` of the row's last read.
- **`$metadata`.** EDMX 1.0 is read: a navigation's target and cardinality come from its `Association` ends, its foreign key from the Association's `ReferentialConstraint` when this type is the dependent end, and its target entity set from the `AssociationSet`s. `introspectSchema()` reports dialect `odata-2.0` and the same navigation shape v4 yields, so `generateObjectDraft` / `importObject` draft the same lookups over either version. A v2 document under `version: '4.0'`, or a v4 one under `'2.0'`, is refused with the version that reads it named.
- **The dialect seam** gains four optional members (`readValue`, `writeValue`, `keyValue`, `updateRequest`); a dialect that leaves one out keeps the v4 behaviour, so an out-of-repo dialect still compiles. `readValue` is given the declared type of the field a property backs, which the driver now records from the object's `fields` in `registerExternalObject`.
- **`@objectstack/spec`:** the type matrix's `odata` arm reads the two primitives only v2's CSDL declares, `Edm.DateTime` → `datetime` and `Edm.Time` → `time`. Both were `unknown`: a draft typed them `text` and flagged them for review, and a `datetime` or `time` field declared over one failed Gate 2 as a `type_mismatch`. Nothing that passed before fails now.
