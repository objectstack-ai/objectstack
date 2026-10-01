---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: a caller-supplied analytics member that is not a plain column reference is refused at the door

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a query-time member the caller supplies — an inline dataset dimension/measure `field` or own filter, or a member the authored cube does not declare — that is not a plain column reference (a field, a relationship path ending in one, or `*`) is refused `INVALID_FIELD` / 400 at the analytics door, before any strategy runs, for every caller and whether or not a security provider is wired. No authorable key, spelling, export or stored shape moves, and no stored row is read differently by any metadata consumer; the published surface gains and loses nothing. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a caller-supplied analytics member (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). A caller names a column instead of writing an expression, which is ADR-0021's author surface already ("zero raw expressions"), so there is no FROM → TO mapping to carry. -->

**BREAKING**: this narrows what the analytics doors accept. A query-time member whose text is not a plain column reference is now refused with `400 INVALID_FIELD` instead of being evaluated — the posture ADR-0021 ("zero raw expressions") states for the author surface and that decision card #20943 adopted at the contract for authored cube members, applied here to content the caller supplies at query time. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What changes.**

- **Inline dataset (`POST /analytics/dataset/query`).** A dimension's or measure's `field`, the dataset's own `filter`, and the selection's presentation filter are the caller's text. A value that is not a plain column reference (a field, a `relationship[.relationship].field` path, or — for a count — an omitted field) is refused `400 INVALID_FIELD`, naming the member, before the dataset is compiled to a cube, so no caller expression reaches a strategy.
- **Cube query (`POST /analytics/query`, `POST /analytics/sql`).** A member the authored cube does not declare is compiled from the caller's own spelling. A spelling that is not a plain column reference is refused the same way, at the door. A member the cube DOES declare resolves to the cube's own definition and is unaffected (its own read admission is unchanged).

The refusal is unconditional — it does not depend on a security service being wired — because a caller value that names no attributable field is an invalid request for every caller, not a permission verdict. A member of an authored cube whose own definition is an expression stays the field-level gate's `PERMISSION_DENIED` / 403 (#20965); it is not caller content.

**What stays answerable.** Every inline dataset and cube query that names columns, relationship paths and declared members — the entire legitimate author and query surface — is unchanged. Only a member whose text is a raw expression is refused.
