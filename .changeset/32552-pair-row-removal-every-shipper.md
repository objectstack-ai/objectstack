---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a customization pair's row of a name two namespaces hold is judged against its own base, whichever package registered first — its removal, its commit revert and the boot census (ADR-0150 D4)

Clause-②: yes (widening) — answers that refused or misreported the second-registered holder's declared override now admit or leave it, as they already did for the first. For a name two packages of two namespaces ship, each with its paired `.custom` holding a declared override (ADR-0146 D2), three answers depended on which package registered first, because each judged the pair's row against the one package the bare-name artifact lookup answers. Each is now judged against every package that ships the name. First-party callers in any of these positions: 0.
Metadata-protocol: none

Every row below is the `widening` arm, is pinned in both registration orders in `@objectstack/objectql`'s `protocol-flow-custom-override.test.ts`, and keeps its one-holder answer (the one-holder CONTROL there):

| Door | Second-registered holder B, before | Now | One holder (CONTROL) |
|:--|:--|:--|:--|
| `DELETE /meta/TYPE/NAME?package=<B>.custom` (`deleteMetaItem`); pinned for a flow, and for an action in the list probe below | `403 NOT_OVERRIDABLE` "sealed against removal"; B's override stays | `200`: B's override row removed (runtime-only), A's untouched; afterwards every listed and execution-view entry of the name is its own package's | unchanged: `200`, removed |
| `revertCommit` of a commit into `<B>.custom` (the restore limb; the per-item rollback shares the derivation); pinned for a flow | the item in `failed[]`, `NOT_OVERRIDABLE` "sealed against in-place edits"; nothing restored | restored, judged by the override write gate as the pair's declared override | unchanged: restored |
| boot census `[metadata_sealed_overlay_unserved]` (`loadMetaFromDb`), a flow or an action only | named B's live declared override as an unserved row to delete | not named | unchanged: the override not named |

With one of the two holders disabled (ADR-0150 D3), the bare-name answer is still the first-registered holder, disabled or not, so the same three answers moved the same way whichever holder is disabled: each holder's pair removal and commit revert are admitted now, the disabled holder's pair included, and the census names neither override. A binding never moves with a reversible disable. Pinned in both registration orders with each holder disabled in turn, beside a one-holder disabled CONTROL (its removal and revert admitted, as before).

Unchanged in both: a row of a package that is no shipper's pair keeps its removal `403` and is still named by the census.

The census judges a row as the reads serve it (`declinesStoredRow`). The reads serve a second holder's declared override per shipper for a flow and an action only (#32613), so only those two types move here. A page, app, dataset, doc, book or mapping keeps the name's first-registered shipper in the census, as in the reads, until #33131 moves them: the second holder's override of such a name is still named, pinned for a mapping in both registration orders.

No shipper is picked: the row judged is always the one its own `package_id` names, and the judgement asks only whether that package is a pair of SOME package that ships the name. A name one package ships answers exactly as before (the bare-name answer is read first and alone while it holds).
