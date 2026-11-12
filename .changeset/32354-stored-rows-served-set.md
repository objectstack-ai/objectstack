---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a name a disabled package holds through a stored row is judged over the served set, never by save order (ADR-0150 D3, #32354)

Clause-②: yes (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill or doc teaches the by-name answer for a name a disabled package holds through a stored row; `content/docs/deployment/marketplace-handbook.mdx` already says a disabled module is hidden.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are reads of stored rows under a reversible package state, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** answer narrowing at the `/meta` exact read: an address naming a disabled package that holds the name only as a stored row answers 404, where it served that row's body under the envelope of the package that ships the name.

A read naming no package of a name a disabled package holds now judges the name's holders over the stored rows as well as the registry. The registry keeps one bare slot per name, so it holds at most one of two packages' stored rows of a name nobody ships, and the answer followed save order. The holders are the registry's served holders and the packages the active stored rows are bound to, less every disabled package. This applies only while some installed package is disabled, to a type the registry reads by package, when no enabled package ships the name in code, and when no package-less row or environment item of the name is stored.

**Every moved answer, before → after.** Both transports (`RestServer` and the runtime `HttpDispatcher`), both registration orders, both save orders, before and after a reboot. First-party count 0 for each: no first-party app disables a package at boot.

Widening:

- Stored rows only (no package ships the name), a row bound to an enabled package E and one bound to a disabled package D. Bare `GET /meta/:type/:name`, `/layers` and `/published`, D's row saved first: 404 → 200 with E's row. E's row saved first: the plain read and `/published` unchanged (E's row); `/layers` 409 naming E and D → 200 with E's layers.
- D ships the name in code and E holds it only as a stored row, D disabled: the bare plain read, `/layers` and `/published` 404 → 200 with E's row.

Narrowing:

- `GET /meta/:type/:name?package=D`, D disabled, where an enabled package ships the name in code and D holds it only as a stored row: 200 with D's row body under the shipping package's `packageId` → 404, D's withheld item.
- Stored rows of two or more enabled packages and of a disabled one, no shipper, the bare plain read: 404 (D's row read first and withheld) or 200 with the first-saved enabled row → 409 `RESOURCE_CONFLICT` naming only the enabled holders, with `details.candidates`.

Same status, the disabled package no longer named:

- The same name, bare `/layers`: 409 naming every row's package, D included → 409 naming only the enabled holders.

**Not moved.** With no disabled package, nothing moves (two enabled packages' stored rows of a name nobody ships keep their answers; #32607 carries that case). A name an enabled package ships in code is judged as before (#32183's registry read). Re-enabling the package restores every answer above. The save door is unchanged (#32605 carries it). The environment's own item beside an enabled and a disabled shipper keeps the enabled holder's code layer on `/layers`: the registry answers the environment's item only when no package ships the name, so that shape cannot arise.
