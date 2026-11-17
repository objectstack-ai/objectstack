---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(metadata-protocol)!: the read naming no bundle member addresses the canonical member alone, as `?member=en-US` and `/published` do

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no page under `skills/**` or `content/docs/**` teaches the read naming no member of a bundle that has no canonical member; `content/docs/references` prints the selector sentence this change now follows, and the ADR-0146 paragraph of `skills/objectstack-platform/SKILL.md` names members only at a base or a package address. No taught sentence moves.

<!-- adr-0087: registered bundle-without-canonical-member-bare-read-absent -->

**BREAKING**: for a bundled name with no canonical member, the read naming no member (`GET /meta/TYPE/NAME`, with or without `?package=`), `/layers` naming none and the execution read naming none move from serving another member (200) to `404 RESOURCE_NOT_FOUND` (the execution read: `null`). Name the member (`?member=fr-FR`) to read it, as before.

The by-name doors' member selector reads a request naming no member as the canonical one (`en-US` for `email_template`), and naming the canonical value is the same request. That is the selector's declared contract (`GetMetaItemRequest.member`). For a bundle with no canonical member, the two requests got different answers:

- The plain read `GET /api/v1/meta/email_template/NAME` and `/layers` served the bundle's other member (for example `fr-FR`, status 200). The execution read (`getMetaItemForExecution`) returned that member too.
- `?member=en-US` and `/published` answered 404.

For a bundle that only stores a non-canonical row (a package-less `fr-FR` row with no `en-US` row), the plain read also changed across a restart. It answered 404 before the restart. After the restart it served the row (200), because the restart had moved the row into the registry's bare slot.

The plain read, `/layers` and the execution read now ask every layer for the canonical member when no member is named. They take the registry's bare-name answer only when it is that member. So each of these bundles answers 404 on every door naming no member, the same as `?member=en-US` and `/published`, before and after a restart.

A bundle that ships or stores its canonical member is served exactly as before. So is any named member, and so is every type with no members. A non-canonical member is still read with its own selector, for example `?member=fr-FR`, which the Studio list already links to for each member.

Migration: a caller that read a bundle with no canonical member without naming a member must name the member it wants (`?member=fr-FR`). The email template loader reads the list (`getMetaItemsForExecution`) and does not use this read, so it is not affected.
