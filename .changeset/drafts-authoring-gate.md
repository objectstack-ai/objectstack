---
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

fix(meta): gate `GET /meta/_drafts` and `GET /metadata/_drafts` as authoring surfaces (ADR-0106 D5(4), #6599)

The two `_drafts` outlets were the one schema-serving endpoint the ADR-0106
implementation-time sweep (#3682) left uncovered. Both called
`protocol.listDrafts()` and returned the result verbatim, so an authenticated
caller with no read access to a field still learned that a **pending object
draft** carried it — the field's label, type, picklist options, formula and
`requiredPermissions` — exactly the disclosure ADR-0106 closes on every other
`/meta` outlet.

Per the #6599 ruling, `_drafts` is treated as an **authoring surface** rather
than a general read (its only consumers are the console's pending-changes and
Studio/Setup design surfaces). It now gates per caller on the SAME `systemPermissions`
judgement ADR-0106 D4 uses for its mask exemption (`isObjectSchemaMaskExempt`:
`studio.access` / `setup.access` / `manage_metadata`, or `isSystem`) and answers
**403** to everyone else — rather than projecting the draft field-by-field. The
gate runs before the protocol is resolved, so the 501-vs-200 answer cannot be
used to probe kernel support, and it is independent of the D8 per-field-mask
escape hatch. Authors' access is unchanged; non-authors, who have no pending
drafts to publish, receive a refusal instead of the disclosure.

The refusal envelope follows each transport's existing precedent: REST answers
`FORBIDDEN`, the runtime dispatcher answers `PERMISSION_DENIED` (derived from the
403 status). Both faces are pinned in the shared ADR-0106 case table
(`meta-object-fls.test.ts` in `@objectstack/rest` and `@objectstack/runtime`),
driven by the same case list so the two transports cannot diverge silently.
