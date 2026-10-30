---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the list-view panel edits a calendar, gallery, timeline, gantt, map or tree view's own settings

Clause-②: no
Metadata-protocol: none

In Studio › Interfaces, the list-view panel of an object now has a section for the settings of the view's own type, below the type it was created as: a calendar's start date, end date, title, color and all-day fields; a gallery's cover, title and card fields, cover fit and card size; a timeline's dates, title, grouping, color and scale; and the blocks of a gantt, a map and a tree. Before, only a kanban's card could be edited there, so a view made with "Add view" kept the fields it was created with.

The section is drawn from the spec's own schema for that type's block, so every setting the spec declares appears, with its required marks and allowed values, and a setting that names a field is picked from the object's fields by label. The draft it saves is the same view item, under `config.<type>`. Grid and kanban views are unchanged. A chart view's dataset binding is still edited in the Create View dialog only.
