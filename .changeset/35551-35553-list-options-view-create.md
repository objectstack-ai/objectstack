---
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(list): the list's options panel is a menu of second levels, and the view dropdown creates a view in place

Clause-②: no
Metadata-protocol: none

**The options panel (选项) is a menu.** Each row names a setting on the left and shows its current value on the right, and opens a second level: the view name, Layout, Fields (「已显示 N 个」), Grouping, Row color, Row height (紧凑 / 标准 / 宽松), and More (how records open, row numbers, inline edit). On a phone a Sort row is added, as before. The Layout level lists every layout the view offers as one choice each, at any count. The Fields level is the list's shared field list (the one 筛选 and 排序 open), as the view's field manager: a search box on top; the shown fields are listed in their order, can be dragged (or moved with the arrow keys) and hidden by their eye, and the hidden fields sit below, where one click shows a field again or adds a readable field the view does not list. Only fields the reader may read are offered. The footer reads 「恢复默认」 and 「刷新」, and — on one of the reader's own views that differs from what it stores — 「保存」 beside 「恢复默认」, which writes the list on screen into that view (as the 「已个性化」 marker's 保存 does); in the console 「恢复默认」 is the marker's reset, dimmed while there is nothing to restore. The view name at the top is renamed in place by the view's owner, or by an admin on a saved shared view; opening the menu does not put the cursor in it. Fields reorders the grid's columns through the same state a header drag writes, and Row height on a gallery picks its card size by name; every icon button has a name; the developer note under Open records is gone. These settings stay the reader's own preference, stored as before.

**The view dropdown** keeps its search and lists one row per view, led by its type's icon, with the reader's own views (我的视图) and the shared views in groups of their own; a long name wraps instead of being cut. 「添加视图」 at the bottom turns the dropdown into a create card (the separate 「另存为我的视图」 entry and its name dialog are folded into it; the full Create View dialog stays reachable from 「管理视图」): a name, the view type (with icons), the one field the type needs (kanban: the group field; calendar: the date field), 「包含当前的筛选和排序」 while the list holds unsaved conditions (on by default), and — for a reader who may create shared views — a personal / shared switch. The one field a type needs defaults to one the list shows (a kanban groups by 阶段 on a list that shows it, not by a hidden status-like field). 「创建」 creates one of the reader's own views by default and opens it; a shared view goes through the existing draft-and-publish door unchanged. No machine name is asked for: a unique one is generated from the name. A kanban or gallery created this way lists the view's columns as its card fields, as the add-view door does.

The fields count label (`list.optionsMenu.fieldsShown`) is a count family in every pack. Keys no surface reads any more are dropped from every pack: `list.recordOpenNote`, `list.recordOpenDeclaredPage`, `view.switcher.all` and `view.switcher.saveAsMyView`.
