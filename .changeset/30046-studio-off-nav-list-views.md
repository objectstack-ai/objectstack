---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Studio Interfaces opens a list view from 不在导航中 on its object's page; the 视图 group lists only what no header dropdown reaches, and names a form view and its own type

Clause-②: yes (widening)
Metadata-protocol: none

- **A list view opens on its object's page from every door.** A list view picked under 不在导航中 → 视图, and a link to the view itself (`?surface=view:OBJECT.KEY`, the All metadata door), now land on the object's page with its header dropdown (object / view ▾), on that view: the object's nav entry when it has one, else the object itself, with no entry (`?surface=object:OBJECT`, which a reload or a shared link opens again, `?view=` included). The panel there now also carries what only the view's own page offered: its conditional formatting (条件格式化), whose CEL verdicts hold the view's autosave as they held the view page's Save, and the sections of the spec's authoring form for a view, without the keys the panel already edits. A form view, and a view a read-only base's pair adds, still open as themselves.
- **The 视图 group lists what the dropdowns do not reach.** A list view whose object has a nav entry is no longer listed there, a view only drafted in the package included; the list views of an object with no entry stay listed.
- **Form views read as forms.** A form view is listed by its label, else as the object's name and the word for a form ("Lead form", 「线索表单」), never its item name (`crm_lead.form`); the group's heading says what it holds (表单视图, 视图, or 表单视图与列表视图). In the view inspector, a form view's 视图类型 offers the form layouts of the spec's `FormViewSchema.type` (simple, tabbed, wizard) and reads its own, where it read 「simple（未找到）」; a list view's picker is unchanged.
- **`@object-ui/i18n`: three Studio keys,** `engine.studio.if.offNav.viewForms`, `engine.studio.if.offNav.viewMixed` and `engine.studio.if.offNav.formName`, in en and zh.
