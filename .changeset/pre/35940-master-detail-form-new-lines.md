---
'@object-ui/plugin-form': patch
'@object-ui/fields': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(form): a new detail line on a master-detail create / edit form starts on the child's defaults, does not read red before a save is tried, and a line added and left untouched is skipped with a notice on the form and the record page

Clause-②: no
Metadata-protocol: none

On a parent object's create or edit form, a line added to a detail table started blank, so a required column with a default (a status that defaults to "Pending") read red at once although saving would store the default. The record page's edit state already started its new lines on their defaults; the form now does the same.

**New lines on the form.** A new line starts on the child object's static defaults, the values a create form of the child seeds, whether it is added with Add or with Enter on the last line. A default the server resolves at insert (`NOW()`, a CEL expression) is left to the server. A new line's empty required cell reads red once a save of the form was tried, not the moment the line appears; a stored line is flagged as before. A line added with Add and then applied from the row editor is the user's input and is saved.

**A line added and left untouched** (maintainer ruling, card comment 7056413638: 「跳过并提示未保存」). A line Add started on its defaults that nobody edited holds only those defaults. It is still not written, and the save now says so: once the save lands, the form and the record page's edit state show "1 blank line was not saved" (or "N blank lines were not saved"), also when the host supplies its own save confirmation. Such a line never reads red, before or after a refused save, since there is nothing in it to fix; once the user edits any of its cells it is input, saved and flagged like any other new line. On an edit form that stays open after saving, the skipped line leaves with the save, as it does on the record page. A line the user typed into and then cleared is blank and is skipped as before, without the notice. The pack key is `form.lineItems.untouchedNotSaved`, in every built-in locale.

**Seeding context.** The defaults on both the form and the record page's edit state are now read with the session facts a create form uses: a child field defaulted to the acting user starts on that user, and the organization's currency and time zone seed the fields they seed on a create form. With no known user that field starts empty and the server fills it, as before.
