---
'@object-ui/plugin-form': patch
---

fix(form): a new detail line on a master-detail create / edit form starts on the child's defaults and does not read red before a save is tried

Clause-②: no
Metadata-protocol: none

On a parent object's create or edit form, a line added to a detail table started blank, so a required column with a default (a status that defaults to "Pending") read red at once although saving would store the default. The record page's edit state already started its new lines on their defaults; the form now does the same.

A new line on the form starts on the child object's static defaults, the values a create form of the child seeds, whether it is added with Add, typed into the trailing entry line, or added in a form-mode collection (the row editor opens on them). A default the server resolves at insert (`NOW()`, a CEL expression) is left to the server. A new line's empty required cell reads red once a save of the form was tried, not the moment the line appears; a stored line is flagged as before. A line added with Add and then applied from the row editor is the user's input and is saved.

The defaults on both the form and the record page's edit state are now read with the session facts a create form uses: a child field defaulted to the acting user starts on that user, and the organization's currency and time zone seed the fields they seed on a create form. With no known user that field starts empty and the server fills it, as before.
