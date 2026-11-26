---
'@object-ui/app-shell': patch
'@object-ui/plugin-list': patch
'@object-ui/fields': patch
---

fix(console): data-page filter chips name lookup records and say booleans in the reader's language; filter-condition sentences use translated labels

Clause-②: yes (widening) — three new members on the `@object-ui/plugin-list` package entry, `useLookupValueNames` (with its `LookupValueName` and `NamedCondition` types); nothing removed or renamed
Metadata-protocol: none

On the bare data page (`/:objectName/data?filter[...]`), the page a dashboard drill's "Open in list" lands on, two kinds of filter chip still showed the stored comparand. A chip on a lookup field showed the related record's id; it now shows that record's name, read the way the list's own condition chips read it (the target's records by id, named by the lookup's `displayField`, else the target's name field), and keeps the id while the read is in flight, when it fails, or when it names nothing. A chip on a boolean (`filter[field][bool]=true|false`) showed `= true` / `= false`; it now shows the filter builder's true / false words in the reader's language (in zh-CN, `= 是`). A "not in" chip on a select field draws each member as the option's translated label, as the "in" chip does.

The read-only sentence a field declaring `widget: 'filter-condition'` draws (a sharing rule's criteria, for one) now says the object's translated field and option labels, the way a record page draws the same field, and keeps the authored label where the app bundle has none.

`@object-ui/plugin-list` adds `useLookupValueNames` (with its `LookupValueName` and `NamedCondition` types) to its public entry, a new export: the read the list's condition chips use to name lookup records, so a host drawing its own chips over the same object names a record the same way.
