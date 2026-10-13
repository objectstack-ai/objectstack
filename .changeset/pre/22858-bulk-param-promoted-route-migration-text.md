---
'@objectstack/spec': patch
---

fix(spec): the `ui-bulk-action-param-unknown-keys-refused` upgrade guidance names the promoted field-backed bulk route instead of saying the bulk surface has none (#22858)

Clause-②: no

The major-18 semantic entry `ui-bulk-action-param-unknown-keys-refused`, which `objectstack migrate meta` prints, said two things that stopped being true once the console resolved a promoted bulk action's params through the single-record dialog's resolver. It called `field` / `objectOverride` contracts "the bulk surface does not implement", and it told the reader that declaring a widget-config key on the object's field cannot help because "the bulk surface has no field-backed param route". The entry now uses the wording the `BulkActionParamSchema` rejection messages already use.

- **`replacement`.** An authored `bulkActionDefs[].params` entry has no field-backed route: it reaches the dialog as written. The `field` rejection offers two fixes: declare the param inline, or declare the action on the object with the field-backed param and name it in the view's `bulkActions`. That second form is the promoted route, whose params are resolved when the bulk dialog opens. Of the widget-config keys, only `accept` / `maxSize` declared on the field reach the dialog, through a promoted action. `carryOver` / `defaultFromRow` / `requiresFeature` are still ACTION-param contracts the bulk surface does not implement.
- **`reason`.** Declaring the key on the field and keeping the authored def still does not reach the dialog. A promoted action is the one route that consults the field. Of the refused keys, only `accept` / `maxSize` arrive that way. `lookupFilters` / `lookupColumns` / `lookupPageSize` / `descriptionField` are resolved and then dropped on the bulk path, and the rest are never read off the field.

Nothing to migrate: the accepted and refused keys are unchanged. Only the guidance text of one migration entry moved.
