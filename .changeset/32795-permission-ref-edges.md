---
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
---

fix(fields, plugin-form): the permission-set picker refuses an option it cannot address by itself, knows a grant by its object, and the list cell labels a set by its package

Clause-②: yes (widening)
Metadata-protocol: none

Edges the permission-set picker still had once two packages provide one permission-set name (after #32770):

- **A disabled option.** The picker now refuses an option this form cannot address by itself. It no longer relies on the dropdown not letting it be clicked. Such a click writes nothing.
- **Which form is a grant's.** The picker treats a column as the grant's permission-set column only on a permission-set grant's form. The form now tells the picker which object it edits. A `permission_set` column on another object, or a field no record form stamped, lists a package's option without letting it be picked, as an action input does.
- **A seeded package.** A permission-set grant's New form no longer opens with a package already filled in, whoever supplied it (a prefill, a duplicated record). The save only writes a package the user picked, so a seeded one showed a choice the save did not keep. The form now shows the name as the server will read it, and a package the user picks is saved as before.
- **Option keys.** A package's option is keyed by the name and package as a pair, so no stored value can share its key.
- **The list and detail cell.** Where more than one package provides a name and the row carries the grant's package column, the cell shows the label of the set that row names. Where the row names none of them, it shows the bare name.
- **Unchanged.** A name one provider serves is listed, saved and shown exactly as before. An edit form, every other object's form, and every other seeded field are unchanged. The server still judges every write. The save keeps the package under exactly the same conditions as before.
- **The widening.** `@object-ui/fields` exports `withFormObject` and `FORM_OBJECT_KEY`. The record form uses them to stamp the object it edits on a `permission-ref` field. `@object-ui/plugin-form` exports nothing new. No translated string is added.
