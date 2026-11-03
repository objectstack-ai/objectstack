---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(i18n, app-shell): Studio and Setup give a switched-on, switched-off or customized item one word, and the permission matrix reads its columns in Chinese

Clause-②: no
Metadata-protocol: none

- Switched on and switched off read 启用 / 停用 in zh-CN wherever Studio and Setup name the state: the packaged-flow ledger switch said 开启 / 关闭, and Setup's packaged actions said 已关闭 in the column and 开启 / 关闭 in the switch-off confirm and its toasts. In en, Studio's flow run status says "Switched on" / "Switched off" (it said On / Off and Enabled / Disabled), the word the landing and the ledger switch use; the ledger switch reads "Switched on/off for this deployment".
- The Customize act reads 定制 in zh-CN (the button, its titles, the restore confirmations, the landing lines quoting the button, the form-editor notes), matching 已定制 and 可定制. 自定义 stays where it means user-defined (a custom value, key, renderer, page or code).
- A permission set no package ships reads 新增 / "Added" (it read 自定义 / "Custom"): it is an item this deployment added, not a customized one.
- The permission matrix's object columns read the action words in zh-CN (创建 … 查看全部, 修改全部) through new `perm.col.*` rows; en keeps C … MA and the legend line that spells them out, which zh no longer needs. Setup's per-object chip reads through `perm.owd.chip` (zh 记录共享模型：私有), not a hard-coded `OWD ` prefix.
- Fixed: in zh-CN, Setup's matrix legend and every column tooltip read English when the matrix rendered before the Chinese Studio strings had loaded. The columns are rebuilt once they land.
