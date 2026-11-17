---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(studio): the permissions page speaks business wording; the bulk buttons show on every row

Clause-②: no
Metadata-protocol: none

Studio's permissions page now reads in the words an app builder uses, in zh-CN and in English. It changes wording and presentation only; the permission model, the suggestion and confirmation mechanism (ADR-0090 D5/D9) and every request are the same.

- **The default-grant banner is one sentence.** When an app's member permission set is accepted for everyone, the banner reads "所有成员默认拥有这个权限集，新加入的人也会自动拥有。" ("Every member has this permission set by default, and new members get it automatically."). Its button reads "取消默认授予" ("Stop granting by default") instead of "撤销" ("Revoke"), and it makes the same call. The pending, not-in-force, dismissed and guest lines say the same thing in the same tone. None of them names the Everyone or Guest position.
- **The open set's title is "app · set label".** The set's machine name moves to the title's tooltip, and the provenance, default and lock labels move to the line under the title. The rail row shows the set's label, with the machine name as its tooltip.
- **Plain terms.** "记录共享模型(OWD)" ("Record sharing (OWD)") is now "谁能看到哪些记录" ("Who can see which records"). The values read "只有负责人能看 / 所有人能看 / 所有人都能看和改" ("Only the owner can see / Everyone can see / Everyone can see and edit"), and "受父级控制 → {master}" reads "跟随所属的{master}" ("Follows its {master}"). The stored `sharingModel` values do not change. The tabs read "对象权限 / 系统功能 / 数据范围规则 / 菜单可见" ("Object permissions / System features / Record scope rules / Menu visibility").
- **The bulk buttons show on every row**, not only on the row under the pointer, as "全选 · 只读 · 清空" ("All · Read only · None"), then the CRUD set as a fourth button ("增删改查", "Read & write"). Each button writes what All / R / None / CRUD wrote before. The footnote that explained the hidden buttons is gone.
- **An object row shows the object's label**, in the matrix and in the package's "who can see which records" overview. Its machine name is the tooltip. The record-visibility chip stays on one line now that its labels are longer.

The Draft Changes publish refusal now points to "Settings → Who can see which records" (all 11 language packs), since the old "Settings → Record sharing" label no longer exists.

Setup's permission-set page reads some of the same strings, so it changes too: the bulk buttons' labels, the sharing values, and the record-scope-rules, menu-visibility and system-features headings. Its layout does not change.
