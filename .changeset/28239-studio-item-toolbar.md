---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): Studio's item header offers Setup's item tools — layers, references, history with rollback, audit and source — on every Data, Interfaces and Automations item

Clause-②: no
Metadata-protocol: none

- **Before.** An item's layers (code / overlay / effective), what references it, its version history with rollback, its audit trail and its JSON source opened only from Setup's item page. A Studio author who wanted to undo a change went to Setup to do it.
- **Now.** The open item's header in Studio's Data, Interfaces and Automations pillars carries the five as an icon group, each opening the same panel Setup's sheet holds. History and Audit are offered only to a caller the authoring-trail doors admit, as on Setup. Rollback asks the same in-app confirm, writes through the same rollback door, and the pillar re-reads the item; a read-only package shows its history without rollback. Source edits the pillar's own draft buffer, saved by its autosave, and is read-only where the item is.
- **Moved.** `LayeredDiff`, `ResourceHistoryPage` (`HistoryPanel`), `AuditPanel`, `JsonSourceEditor` and the references panel now live in `views/item-tools/`, which Setup's item page imports. `@object-ui/app-shell`'s `LayeredDiff` and `MetadataResourceHistoryPage` exports are unchanged. Setup's page behaves as before.
- **Not carried over.** Setup's autosave toggle and draft review panel: Studio keeps its own draft → publish and pending-changes review.
