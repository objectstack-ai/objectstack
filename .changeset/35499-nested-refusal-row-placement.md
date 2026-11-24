---
'@object-ui/app-shell': patch
---

fix(console): a refused metadata save draws a nested cause under the row its path names

Clause-②: no
Metadata-protocol: none

After a refused save, Studio's metadata form drew an issue under a field only when the issue's path was exactly that field's key. A cause one level down — a label carrying a key that is not a locale (`label.not_a_locale`), a nested predicate's part, a list column's sub-field (`columns.0.field`) — lit no field at all, and since the server stopped sending the bare "Invalid input" head at the field's own key, about 25 keys across 12 metadata types showed no red line after a refused save.

An issue is now drawn on the deepest field the form shows for a prefix of its path, for every issue source (the server's refusal, the live check, load-time diagnostics):

- a field draws a deeper issue itself, led by the path's trail (`Label → not_a_locale: …`, `Columns → #1 → field: …`);
- a field rendered as a nested form passes the issue down to the nested field it names, which draws it as its plain message;
- an issue under a list, map or code field stays on that field, with its trail; an issue under a hidden or canvas-owned key stays in the summary banner, as before.

One mistake is still one message: the summary banner and the refusal line leave out every issue whose top-level field the form draws it under. In a new item's form, a nested field's issue shows exactly when its parent field's does.

The Save button's reason for a refused draft no longer starts with a comma when the server also refused the document as a whole: the whole-document entry is not named as an empty field, and a refusal of only the whole document names its own message.

No locale keys, props or exports change.
