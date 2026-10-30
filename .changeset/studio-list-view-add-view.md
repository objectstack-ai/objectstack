---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): "Add view" in the Interfaces list-view panel creates a kanban, calendar or other list view

Clause-②: no
Metadata-protocol: none

The list-view panel of an object in Studio's Interfaces pillar edited only the view its nav entry opens, usually the default grid, so a kanban, calendar or any other view type could not be created from Studio. The panel now has an "Add view" button. It opens the console's Create View dialog: the author picks the view type, then the fields that type requires by their labels (the group-by field for a kanban, the start date and title fields for a calendar), then a label and a key. The view is created complete in the package's draft, under a name no view holds yet, and the panel and the canvas then show it, with a link back to the view the nav entry opens. The new view is never the object's default, and the nav entry is not changed: the running app lists the view in the object's view switcher once the package is published.
