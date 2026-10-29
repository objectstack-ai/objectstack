---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the app's report index groups reports by their object and offers All and Recent views with search

Clause-②: no
Metadata-protocol: none

An app's report index (`/apps/APP/reports`) used to list every report the member may open as one flat list. Now:

- **Grouped by object.** The index has one section per object, in the order the app's navigation names them; objects the navigation does not name come next, by label, and a report that reads no object is in an **Other** section at the end. Each section header shows how many reports it holds and collapses the section. A report's object is derived, not declared: it is the object of the first dataset the report binds that names one (for a joined report, its own dataset first, then its blocks'). Nothing is added to the report schema.
- **All and Recent.** Two views across the top: **All reports**, grouped as above, and **Recent**, the reports the reader opened last, most recent first, from the console's recent items. The choice is the reader's own and is kept in the browser under `os:pref:reports.index.view`, across apps; a reader who never chose sees All reports.
- **Rows and search.** A row shows the report's label and description, its object, and when the reader last opened it. The search box filters the current view by report label, description or object.

There is no "Created by me" view: the report list the console reads carries no creator.

What to do: nothing. No metadata changes.
