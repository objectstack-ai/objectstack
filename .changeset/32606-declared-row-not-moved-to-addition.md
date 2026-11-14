---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a row of an App's `.custom` pair declared for a package that still ships the name is never served at a bundle addition's address as its own item (ADR-0150 D4, #32606)

Clause-②: no
Metadata-protocol: semantic
Skills-docs: none — `skills/**` and `content/docs/**` teach a declared override served at the package it declares and a tenant's edit following an item that moved between an App's packages (#31593); neither teaches a row declared for one package served at another that still ships nothing of the row's member, so no taught sentence moves.

<!-- adr-0087: registered declared-row-not-moved-to-addition -->

**BREAKING** for a reader of a bundle addition's member: an App `A` with module packages X and Z, Z depending on A and X; X ships `welcome` in `en-US`, Z ships only `fr-FR` (a bundle addition to X's template), and `A.custom` stores a `fr-FR` row declaring `overrides: { package: X }`.

The moved-edit rule (#31593, `isMovedOverrideRowOf` / `isMovedBaseRowOf`) serves a row that declares, or is bound to, a former owner of an item at the package that ships the item now. It asked whether the former owner still ships the item at the MEMBER's grain, so X (which ships `en-US`, not `fr-FR`) read as a package that no longer ships it, and Z took the row as its own moved edit. The rule now asks the former owner at the NAME's grain, as its own header states ("the old owner must not ship the name"): X still holds `welcome`, so the row stays X's alone.

**Every moved answer, before → after.** Both registration orders (Z installed first, the row stored first). First-party count 0: no first-party App stores a pair row declaring one module at a locale another module adds.

- `GET /meta/email_template/welcome?package=Z&member=fr-FR`: the row declared for X, stamped Z, `_diagnostics.valid: false` → Z's own `fr-FR`, which is what the registry answers at Z (`getPackageScopedItem`).
- `GET /meta/email_template?package=Z` (Z's list) and the execution list a send resolved to Z reads (`getMetaItemsForExecution`): the row declared for X → Z's own `fr-FR`. A send resolved to Z sent X's customization of a member Z ships.
- `listServedOverrides({ packageId: Z })` (the customizations read): the same row is no longer listed under Z.

**Not moved.** X's address, X's list and X's execution list serve the row declared for X, as before. `?package=A.custom` serves it. The read naming no package keeps its 409 naming both holders. A former owner that ships nothing of the name any more still hands its edit to the package that ships it now (#31593's flat → composed and composed → flat moves, and a member that moved together with its whole bundle), pinned as a CONTROL in both orders.

The fix for a reader: read the row at the package it declares (`?package=X`). To customize Z's own member, save a row declaring Z.
