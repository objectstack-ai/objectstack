---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(metadata-protocol)!: the bare item read refuses a package-less row beside two packages' rows, and reads a row-held base at its dependent's added member (ADR-0150 D3, red line 2)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/objectstack-platform/SKILL.md` (the ADR-0146 paragraph) and `content/docs/concepts/metadata-lifecycle.mdx` teach that a locale a dependent adds under a base's name is served only under its own `?package=`, and that the read naming no package answers `404` for it. Both sentences were true only for a base that ships the name, and are now true for a row-held base too. Nothing in `skills/**` or `content/docs/**` teaches what the read naming no package answers for a package-less row beside two packages' rows. No taught sentence moves.

<!-- adr-0087: registered row-held-base-addition-bare-read-at-base, two-row-holders-bare-read-refused -->

**BREAKING**: two answers of the `/meta` item read that names no package move from served to refused. Name the package (`?package=`) to read the row, as before.

**Every moved answer, before → after.** Both transports (`RestServer` and the runtime `HttpDispatcher`), every save order, both registration orders, and on the runtime dispatcher before and after a reboot. First-party count 0: no first-party app stores either shape.

- **A package-less row beside two packages' rows of a name no package ships** (packages E and F each store a row of `dash`, and a package-less row of `dash` is stored too). The plain read `GET /meta/dashboard/dash`, `GET /meta/dashboard/dash/published` and the execution read move FROM the row stored first (E's, F's or the package-less one) TO `409 RESOURCE_CONFLICT` naming E and F in `details.candidates`. `GET /meta/dashboard/dash/layers` already refused it, and still does with the package-less writes' sentence. The package-less row is never served in their place: it is a customization of a name it cannot say whose (red line 2). After a reboot, the registry's environment item of such a name is the bare slot's entry, the row hydrated last. With rows bound to two or more packages beside it, that entry no longer counts as the environment's own item.
- **A member that only a dependent's addition holds, over a base that holds the name only as stored rows** (base A stores `welcome` in `en-US`, dependent D, which declares A, stores `fr-FR`, and no package ships `welcome`). `GET /meta/email_template/welcome?member=fr-FR`, `GET /meta/email_template/welcome/layers?member=fr-FR` and the execution read at `fr-FR` move FROM D's row (200) TO `404 RESOURCE_NOT_FOUND`. That is the answer the same reads already gave when A ships `welcome`: a bundle addition holds no name, so the read takes the base's address, which holds no `fr-FR`.

**Not moved.** One package's row beside a package-less row is that package's, served on every bare door in both save orders, before and after a reboot. Each exact address (`?package=E`, `?package=F`, `?package=D&member=fr-FR`) serves its own row. The base's own member (`?member=en-US`) is the base's. A name with a disabled holder keeps its own judgment (#32354), and a package-less row beside a disabled holder leaves the read as it was. The writes do not move.

The ADR-0087 entry `row-held-base-addition-bare-read-at-base` registers the second move. The first is the narrowing `two-row-holders-bare-read-refused` already registers: two or more enabled packages hold the name only as stored rows. That entry's `reason` now says how the holders are judged: by the packages the rows are bound to at the member read, with the registry's holders only helping recognise a customization pair.
