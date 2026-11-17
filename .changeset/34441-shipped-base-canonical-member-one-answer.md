---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(metadata-protocol)!: a dependent's row of a bundle member moves no read naming no package across a restart, and a row-held base's own member is served beside a dependent's copy of it (#28802 R2, ADR-0150 red line 2)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/objectstack-platform/SKILL.md` (the ADR-0146 paragraph) and `content/docs/concepts/metadata-lifecycle.mdx` teach that a locale a dependent adds under a base's name is served only under its own `?package=`. This change makes `/published` and `/layers` hold to that for the canonical member of a base that ships only another member, before and after a restart, and makes a row-held base's own member the base's. No taught sentence moves.

<!-- adr-0087: registered shipped-base-dependent-canonical-row-not-published -->

**BREAKING**: one answer of `GET /meta/TYPE/NAME/published` naming no package moves from served to 404. Name the package (`?package=DEPENDENT&member=CANONICAL`) to read the row, as before.

**Every moved answer, before → after.** On the runtime dispatcher, in both registration orders, before and after a restart.

- **A dependent's canonical member over a base that ships only another one** (base A ships `email_template` `welcome` in `fr-FR` only; dependent D, which declares A, stores `en-US`). `GET /meta/email_template/welcome/published` moves FROM D's row (200, before a restart only) TO `404 RESOURCE_NOT_FOUND`, its answer with no D row stored. `GET /meta/email_template/welcome/layers` (no member) moves FROM `404` after a restart TO A's `fr-FR` (200), its answer with no D row stored and before a restart; before a restart its `overlay` layer moves FROM D's row TO `null`, as with no D row stored. The layered read had reported D's row as an orphan of A's name although A ships no `en-US`, and after a restart the hydrated row took the registry's bare slot the code layer read A's `fr-FR` from.
- **A member a row-held base and its dependent both store** (A stores `en-US`, D stores `en-US` and `fr-FR`, no package ships the name). Each door below moves FROM `409 RESOURCE_CONFLICT` naming A and D (the execution read threw `PackageScopedNameRefusedError`) TO A's row (200), as when A ships `en-US`. D's row of it is a bundle addition, never a second holder. Bundled types only (a type with no members has no additions). Naming the member: `GET /meta/email_template/welcome?member=en-US`, `/layers?member=en-US` and the execution read at `en-US`. Naming no member, which addresses the canonical member `en-US`: the plain read (`packageId` A), `/layers` (effective and overlay A's row), `/published` (A's row) and the execution read. The writes naming no package do not move: the save, delete, publish, draft and history doors still refuse these rows naming A and D, so `/layers` loads A's stack where the save it then sends is refused; a follow-up card judges whether the writes follow the base.

**Not moved.** The plain read, `?member=CANONICAL` and the execution read of the first shape (A's `fr-FR` naming no member, 404 at `en-US`). Each exact address (`?package=D&member=en-US` serves D's row). A package-less row beside two holders is still refused (#33210). A dependent's canonical row over a base that holds only another member as a row is still served (the `S1` pin of #33210). Two dependents storing the same member over a base that holds none of it are still refused naming both. A name of a type with no members (`dashboard`, `permission`, `tool`, …) that a base and its dependent both store as rows, no package shipping it, is still refused naming both on every door naming no package (#32607). The shipped CONTROL of the second shape (A ships `en-US`): the plain read and the execution read serve A's `en-US`, and `/layers` naming no member and `/published` report D's row as the overlay A's code shadows (#28409), as before.
