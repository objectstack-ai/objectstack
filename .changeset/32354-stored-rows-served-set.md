---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a name a disabled package holds through a stored row is judged over the served set, never by save order (ADR-0150 D3, #32354)

Clause-②: yes (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill or doc teaches the by-name answer for a name a disabled package holds through a stored row; `content/docs/deployment/marketplace-handbook.mdx` already says a disabled module is hidden.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are reads of stored rows under a reversible package state, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** answer narrowing at the `/meta` bare reads: a name held by the stored rows of two or more enabled packages beside a disabled one is refused `409 RESOURCE_CONFLICT` naming only the enabled holders, where the plain read and `/published` answered by save order; and an address naming a disabled customization pair whose base is enabled answers 404, where it served the base's item.

A read naming no package of a name a disabled package holds now judges the name's holders over the stored rows as well as the registry. The registry keeps one bare slot per name, so it holds at most one of two packages' stored rows of a name nobody ships, and the answer followed save order. The holders are the registry's served holders and the packages the active stored rows are bound to, less every disabled package. A row the reads decline (a shipped flow name's undeclared row, a sealed managed name's row) and a row bound to a holder's customization pair (bound over every holder it is a pair of, #32408) hold nothing of their own. This applies only while some installed package is disabled, to a type the registry reads by package, when no enabled package ships the name in code, and when no package-less row or environment item of the name is stored. The in-process layered read (`getMetaItemLayered`) is re-addressed to the one served holder but never refuses: its resolution readers (the security catalog echo, the packaged-permission-set lock gate) keep the answer they had, and the `/layers` door refuses.

**Every moved answer, before → after** (before = 18.4.0). Both transports (`RestServer` and the runtime `HttpDispatcher`), both registration orders, both save orders, before and after a reboot, except where a line names one transport. First-party count 0 for each: no first-party app disables a package at boot.

Widening:

- Stored rows only (no package ships the name), a row bound to an enabled package E and one bound to a disabled package D. Bare `GET /meta/:type/:name`, `/layers` and `/published`, D's row saved first: 404 → 200 with E's row. E's row saved first: the plain read and `/published` unchanged (E's row); `/layers` 409 naming E and D → 200 with E's layers.
- D ships the name in code and E holds it only as a stored row, D disabled: the bare plain read, `/layers` and `/published` 404 → 200 with E's row. The same when D's customization pair also holds D's declared override row of the name (`RestServer`).

Narrowing:

- Stored rows of two or more enabled packages and of a disabled one, no shipper, the bare plain read and `/published`: 404 (D's row read first and withheld) or 200 with the first-saved enabled row → 409 `RESOURCE_CONFLICT` naming only the enabled holders, with `details.candidates` on the plain read.
- `GET /meta/:type/:name?package=PAIR`, PAIR a disabled customization pair whose base is enabled and ships the name, with or without PAIR's declared override row: 200 with the base's item (the override's body when there is one) → 404, PAIR's withheld item (`RestServer`).

Same status, the disabled package no longer named:

- Two or more enabled packages' rows and a disabled one's, bare `/layers`: 409 naming every row's package, D included → 409 naming only the enabled holders.

**Not moved.** `GET /meta/:type/:name?package=D`, D disabled and holding the name only as a stored row while an enabled package ships it: 404 since 18.4.0 (the strict envelope of #32501 leaves D's row its own stamp, which the item face withholds); this change adds a second guard for the same answer. With no disabled package, nothing moves (two enabled packages' stored rows of a name nobody ships keep their answers; #32607 carries that case). A name an enabled package ships in code is judged as before (#32183's registry read). A shipped flow name whose shipper is disabled, with rows of two other packages, answers the missing name as before. Re-enabling the package restores every answer above. The save door is unchanged (#32605 carries it). The environment's own item beside an enabled and a disabled shipper keeps the enabled holder's code layer on `/layers`: the registry answers the environment's item only when no package ships the name, so that shape cannot arise.
