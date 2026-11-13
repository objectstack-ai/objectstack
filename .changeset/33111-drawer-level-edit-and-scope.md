---
'@object-ui/app-shell': patch
---

fix(app-shell): a record drawer level's Edit opens the form of the level's object

Clause-②: no
Metadata-protocol: none

**Edit in a drawer level.** A record opened one level down in a record drawer, from a related list or a lookup, is a record of its own object, which is not always the route's. Its header Edit now opens that object's form for that record, as the console's child task over the route (`?form=ID&formObject=OBJECT`, the same URL the related list's row Edit writes), on the object list's drawer and on the drawer over a record page. Before, the form was the route object's, with the child's id: "Edit Sales Order" and "Record not found". The route object's own Edit, and a level of the route's object, are unchanged: a top-level task with no `formObject`. A level whose object declares `editMode: 'page'` opens that object's edit page.

**Related tabs in a drawer over a record page.** A record opened in the drawer over a record page now shows its own related lists, the objects that point at it included, as it does in the object list's drawer and on its own page. A record page reads only the objects around its own record, so a level showed Overview and Activity and none of the child's own related lists. While the page's drawer is open, the console reads the whole object list beside the page's objects, once, as it already did for the object list's drawer (`?recordId=`); a record page with no drawer open reads no more than before.
