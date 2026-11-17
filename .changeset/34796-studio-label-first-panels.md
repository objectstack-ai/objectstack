---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(studio): flow node and list-view panels lead with labels, node delete moves to the header menu, navigation kinds read in words

Clause-②: no
Metadata-protocol: none

Studio's Automations and Interfaces panels name things the way the author named them and keep machine names out of the way:

- **Flow node panel.** The first field is the node's Label. The node id moves into a "Developer info" section that starts collapsed. "Remove node" moves from the full-width footer button into the header's "···" menu; in Studio that menu sits in the automation panel's title bar. The removal itself is unchanged: neither the menu item nor the canvas Delete key asks to confirm, and both still refuse while a boundary event or an expression names the node.
- **Objects by label.** In the node panel, the sentences that name an object ("Targets the … record that started this flow", "Fields of …") use the object's label. The object picker shows the label and keeps the machine name on its hover title.
- **"Formula", not "CEL expression".** The node panel's value toggle, its placeholders and the zh help rows of the record, loop, map, HTTP, action, screen, subflow and notify nodes say 公式 / "formula" (the Decision node's rows are left to the change rewording them). The Update Records filter help no longer names `recordId`. The zh panel also gains the Update Records "update every matching record" row, which used to show in English.
- **New automation dialog.** The first field is "Automation name" (自动化名称), matching the dialog title and the Automations list.
- **List-view panel.** No `object.view` machine name under the title. The not-yet-created notice is one sentence: "Changes save as a draft first." Column rows show the field label, with the field name on hover. The Setup designers' column rows are unchanged.
- **Navigation edit mode.** Each entry's kind badge reads the kind the navigation list shows (对象 / 视图 / 仪表盘 / 页面 …). An object entry that opens a named view, such as a kanban, reads 视图. The Setup designer keeps the raw type.

`@object-ui/i18n`: two new `studio` namespace keys (`engine.inspector.flowNode.moreActions`, `engine.inspector.flowNode.developerInfo`). Some existing `studio` values are reworded in en and zh.
