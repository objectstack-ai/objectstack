---
'@object-ui/app-shell': patch
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-gantt': patch
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/console': patch
---

fix(app-shell,fields,plugin-form,plugin-gantt,plugin-grid,components,console): record pages, forms, drawers and preview cards draw a served object label as served

Clause-②: no
Metadata-protocol: none

- **Now.** The record page (its title, breadcrumbs, related-list titles, delete and access-denied copy), the record form page and the console's create/edit dialog (title, save toast, way back to the list), the record drawer, the record preview card, the hover card over a lookup, a record-pointer cell, an object-ref cell, the closed-form notice, the gantt name column, the page header's record chrome, a form view's heading, the AI dock's surface chip, the Activity row and the report index name an object by the label the server served, as given. The server has already translated it, by its label order for an overridden item, so a `.custom` object extension's rename is kept over the base package's translation. Before, the served label reached the client's catalog lookup only as its fallback, so the base package's translation of the old name won on these surfaces after the list and header were fixed.
- **Unchanged.** When no label is served, the catalog key is asked first and the machine name (or its humanized form) stays the last resort, as before. An unedited object shows the same text as before, because the server serves the catalog's translation for it. Related lists and reference rails that only know an object's name, and the packaged-actions table (its object list is read without the session's language), still look the name up in the catalog. English is unchanged.
