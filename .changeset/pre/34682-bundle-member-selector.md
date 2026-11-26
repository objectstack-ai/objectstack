---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(metadata-protocol)!: the read naming no bundle member addresses the canonical member alone, as `?member=en-US` and `/published` do

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no page under `skills/**` or `content/docs/**` teaches the read naming no member of a bundle that has no canonical member; `content/docs/references` prints the selector sentence this change now follows, and the ADR-0146 paragraph of `skills/objectstack-platform/SKILL.md` names members only at a base or a package address. No taught sentence moves.

<!-- adr-0087: registered bundle-without-canonical-member-bare-read-absent -->

**BREAKING**: where the address holds no canonical member of a bundled name, the read naming no member (`GET /meta/TYPE/NAME`, with or without `?package=`), `/layers` naming none and the execution read naming none move from serving another member (200) to `404 RESOURCE_NOT_FOUND` (the execution read: `null`). Name the member (`?member=fr-FR`) to read it, as before.

The by-name doors' member selector reads a request naming no member as the canonical one (`en-US` for `email_template`), and naming the canonical value is the same request. That is the selector's declared contract (`GetMetaItemRequest.member`). For a bundle with no canonical member, the two requests got different answers:

- The plain read `GET /api/v1/meta/email_template/NAME` and `/layers` served the bundle's other member (for example `fr-FR`, status 200). The execution read (`getMetaItemForExecution`) returned that member too.
- `?member=en-US` and `/published` answered 404.

The same split held in two more arrangements:

- A base ships only `fr-FR` and a dependent that declares it stores `en-US`. The read naming no package and no member served the base's `fr-FR`.
- `?package=X` where X ships no `en-US` while another package does (a dependent, or a disabled holder that the read naming no package re-addresses past to X). The read naming no member served X's `fr-FR`. `?package=X&member=en-US` answered nothing.

For a bundle that only stores a non-canonical row (a package-less `fr-FR` row with no `en-US` row), the plain read also changed across a restart. It answered 404 before the restart. After the restart it served the row (200), because the restart had moved the row into the registry's bare slot.

The plain read, `/layers` and the execution read now ask every layer for the canonical member when no member is named. They take the registry's bare-name answer only when it is that member. The base-address fallback serves only the base's canonical member, and an exact address (`?package=`) replaces another package's item only with the holder's item at the addressed member. So each of these arrangements answers 404 on every door naming no member, the same as `?member=en-US` and `/published`, before and after a restart.

A bundle that ships or stores its canonical member keeps its status and served body, and so does any named member. Three more answers move:

- `/layers` naming no member, where the canonical member is stored over a package that ships only another member: `code` goes from that member's body to `null`, as `/layers?member=en-US` already answered. Status and `effective` do not move.
- For a type with no members, `/layers?package=X`, where X holds nothing of the name and the only holder is disabled: `code` goes from the disabled holder's artifact to `null`. A disabled package holds no name.
- `?package=X` naming no member, where X does not hold the name and the environment stores it only in a non-canonical member: the read was refused `409 RESOURCE_CONFLICT` (`not-held-by-qualifier`, naming the environment) once a restart had hydrated the row. It now answers the `404` that `?member=en-US` already answered, on the plain read and `/layers`. A non-canonical member is still read with its own selector, for example `?member=fr-FR`, which the Studio list already links to for each member.

**Reverses two statements of the 18.6.0 note** for the arrangement where base A ships `email_template` `welcome` in `fr-FR` only and dependent D, which declares A, stores `en-US`:

- 18.6.0 said "`GET /meta/email_template/welcome/layers` (no member) moves FROM `404` after a restart TO A's `fr-FR` (200)". Now `/layers` naming no member answers `404 RESOURCE_NOT_FOUND` on both sides of a restart, as `/layers?member=en-US` does.
- 18.6.0 said "**Not moved.** The plain read, `?member=CANONICAL` and the execution read of the first shape (A's `fr-FR` naming no member, 404 at `en-US`)." Now only `?member=CANONICAL` is unmoved. The plain read naming no member answers 404 and the execution read naming no member answers `null`, where both served A's `fr-FR`.

Migration: a caller that read a bundle with no canonical member without naming a member must name the member it wants (`?member=fr-FR`). The email template loader reads the list (`getMetaItemsForExecution`) and does not use this read, so it is not affected.
