---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(flow designer): add variables, say why Runs is empty, Debug takes the side column, and autosave reads 已保存 in the header

Clause-②: no
Metadata-protocol: none

- **Variables can be added and edited.** The Variables tab says what variables are for and has an **Add variable** button. Each row edits its name, type, default value, input and output. A `$` name, a blank name or a duplicate is held with a note. A variable a step still reads cannot be renamed or removed until those steps change, and the note names them. A read-only package keeps the plain list.
- **Runs says why it is empty.** A flow that has never been published reads 「发布并启用后，这里显示每次运行的记录」 and fetches nothing. A published flow whose automation engine does not answer says so, and only that.
- **Debug takes the side column.** While Debug is open the simulator is drawn where the Configuration was: in Studio's right panel, or, where the page keeps its own side column, at that column's width beside the canvas. Leaving Debug brings the Configuration back with the same selection.
- **Autosave reads 已保存 in the header.** A landed flow autosave no longer raises a "Draft saved" toast. The header's 正在保存 settles into 已保存, which names the flow to screen readers and stays until the next edit. A failed save keeps its message and also raises one error toast. Other Studio editors keep their toast.
- **The node panel reads Chinese throughout.** The decision's branching mode, the approval's resolve-as, group and empty-approvers settings, the help the server sends for each approver column, exclude-submitter, backup approvers and the escalation settings, and the prose placeholders are translated, and quorum and per-group sign-off read 法定人数 and 分组会签. The approvers help says the approve and reject connections come with the node.
