---
'@object-ui/app-shell': patch
---

fix(app-shell): the Studio item header's "Saved to X's customizations" note says where the customization lives, in the publish sheet's own sentence (#30436)

Clause-②: no
Metadata-protocol: none

The note on an item header (Interfaces item, navigation editor, Data object, Automations flow) now goes on with the sentence the pending-changes sheet draws under it (`preview.changes.customizationEnvironment`, from #30119): the changes are kept in this environment's database as items of the real `<base>.custom` pair, and reach another environment only through `os package export`. No new i18n key: the note reuses `customizationEnvironmentText`. Before the pair's first save the note names the `<base>.custom` id that save creates.
