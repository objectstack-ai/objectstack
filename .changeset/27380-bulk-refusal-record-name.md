---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a bulk action's result lists each refused record by its title, not by its id

Clause-②: no
Metadata-protocol: none

When a bulk action is refused for some of the selected records, the result panel lists every refusal with the reason the server gave. Each refusal used to be labelled with the record's raw id (`lead_2: … is already a member of this campaign`), so the user had to work out which record it was. It is now labelled with the record's title, resolved the same way the confirm step lists the affected records (the object's `nameField`, or `Record #<id>` when the record has no readable title). An entry that is not a record of the run, such as a row with no id or a batch the server answered with a count only, keeps its id. The counts and the error CSV are unchanged.
