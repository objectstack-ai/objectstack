---
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
---

fix(plugin-form): a record form's inline members resolve `{ $record }` lookupFilters, and only a record form can opt a lookup in

Clause-②: no
Metadata-protocol: none

A lookup field's `lookupFilters` entry `{ $record: 'quote_date' }` (or one hop away, `{ $record: 'account.cb_market' }`) resolves in a record form, whatever its layout. Until now that held only for fields generated from the object schema.

- **Inline members.** A `customFields` member and a self-describing inline section entry are fields of the record being edited too. A record form now stamps every field it draws in the one step every layout draws through (`gateFormFields`), after the members are merged and the sections expanded. Their `{ $record }` entries resolve like a generated field's. Before, they were left out of the candidate query.
- **Only the form says so.** The picker honours only a stamp `withRecordBeingEdited` issued. A `recordBeingEdited` key written as data opts nothing in: on a standalone form's field, an action's parameter, or anywhere else, it is ignored and the `{ $record }` entry is left out. A record form also drops an authored `recordBeingEdited` from the fields it draws before it writes its own.

Fields generated from the object schema, literal entries and `dependsOn` query exactly as before.
