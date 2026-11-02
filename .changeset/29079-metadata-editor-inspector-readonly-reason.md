---
'@object-ui/app-shell': patch
---

fix(app-shell): the metadata editor page tells its scoped inspector why it is read-only, so a flow's node inspector explains its disabled controls there too

Clause-②: no
Metadata-protocol: none

The metadata editor page (Setup's item page, and Studio's "All metadata" area at `/studio/PKG/metadata/flow/NAME`) folds every read-only cause into one flag, and it passed that flag to the scoped inspector with no reason. A flow's node inspector therefore showed disabled controls with nothing to say why, while the same inspector on Studio's Automations pillar explained them.

The page now hands the scoped inspector the reason (`MetadataInspectorProps.readOnlyReason`) as the sentence its own notice gives for the cause in force, in the notices' order: the walled security catalog; a read-only package; a lock, with the reason the server serves for it; a declaration-only catalog; a caller without the `manage_metadata` capability; an item a code package ships; and a type that is read-only at runtime. An editable page passes none. No string is new.

View mode owes no sentence: the scoped inspector exists only beside a designer canvas, and a designer type enters editing whenever it can be written and has no Edit button. The no-selection default inspector (`MetadataDefaultInspectorProps`) is unchanged.
