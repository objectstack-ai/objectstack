---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(app-shell): the permission matrix's object rows show exactly what the runtime enforces for every grant shape

Clause-②: no
Metadata-protocol: none

- **Object rows.** In the permission-set editor (Studio Access, and the permission sets under Setup), each object row shows the object grant the runtime applies to that object. A row that inherits its grant is drawn in grey with a dashed edge, the look inherited field rows already use, with a tooltip and a legend line saying where the grant comes from. Editing such a row writes an entry for the object that starts from what the row shows.
- **Summaries.** "Only granted", the granted-object count and the delegated-admin companion list under Admin scope read the object grant as the rows show it.
