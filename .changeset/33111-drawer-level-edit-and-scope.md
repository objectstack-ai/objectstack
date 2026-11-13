---
'@object-ui/app-shell': patch
---

fix(app-shell): a record drawer level's Edit opens the form of the level's object

Clause-②: no
Metadata-protocol: none

**Edit in a drawer level.** A record opened one level down in a record drawer, from a related list or a lookup, is a record of its own object, which is not always the route's. Its header Edit now opens that object's form for that record, as the console's child task over the route (`?form=ID&formObject=OBJECT`, the same URL the related list's row Edit writes), on the object list's drawer and on the drawer over a record page. Before, the form was the route object's, with the child's id: "Edit Sales Order" and "Record not found". The route object's own Edit, and a level of the route's object, are unchanged: a top-level task with no `formObject`. A level whose object declares `editMode: 'page'` opens that object's edit page.
