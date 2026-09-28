---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

fix(platform-objects,spec): the delete actions and the flow builder's Delete Record node name the `trash` icon, which still renders after the console's lucide 1.43 upgrade

Clause-②: no

The console build at the new objectui pin ships `lucide-react` 1.43, whose runtime `icons` record dropped one key, `Trash2`. The console resolves an authored icon name through that record, so `icon: 'trash-2'` now resolves to nothing and the button draws no glyph. `trash` draws the identical glyph, which objectui measured node for node when it made the same repair in its own tree.

Four delete actions in `@objectstack/platform-objects` (OAuth application, organization, SSO provider, team) and the `delete_record` entry of the flow builder's default node palette in `@objectstack/spec` now say `trash`. The `BulkAction.icon` description's example names `trash` too. No key, default shape or export moves. An author's own `icon: 'trash-2'` keeps validating as before, but draws no glyph in the console; write `icon: 'trash'` to get the same glyph back.
