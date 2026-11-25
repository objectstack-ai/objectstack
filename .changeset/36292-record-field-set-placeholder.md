---
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(console): on the record page's field list an empty field you can edit reads 「设置{字段名}」 and one click fills it in; an editable value offers the copy icon too

Clause-②: yes (widening)
Metadata-protocol: none

The synthesized record page's field area (the side preview, the phone's 「详情」 tab, the wide page's pinned left column and a full page alone):

- **Empty editable fields read 「设置」 plus their label.** An empty value the reader can edit is drawn as light text, 「设置」 plus the field's label (`Set Phone` in English), and a single click on it opens the field's editor, as a click on any editable value already does. A read-only field, a field the caller may not write and a record that is not inline-editable keep the shared 「—」 placeholder. Empty fields still fold into the list's one 「显示 N 个空字段」 row; shown, they read 「设置…」 instead of 「—」.
- **An editable value can be copied without editing.** Its copy icon is drawn on hover or keyboard focus at the value's right, as a read-only value's is; it copies the value and does not enter edit. A touch screen draws none, as before for read-only values. The keyboard's way into edit (the pencil, drawn on focus only) is unchanged.
- Authored record pages and every other DetailView keep their faces: an empty field there reads 「—」 and an editable row keeps its double-click and pencil.

`@object-ui/i18n` widens: one new key in every pack, `detail.setField` (`Set {{field}}` / `设置{{field}}`).
