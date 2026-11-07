---
'@object-ui/fields': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/cli': patch
'@objectstack/plugin-sharing': patch
---

feat(console): the sharing-rule object picker lists only the objects a rule can take effect on, business objects first

Clause-②: yes (widening) — `field:shareable-object-ref` joins `@object-ui/fields`' registered widget keys (`RegisteredFieldWidgetType`) and the console's known schema types; nothing is narrowed and no translation key is added.
Metadata-protocol: none

The object field of a new sharing rule listed every registered object, most of them platform `sys_*` objects, including ones a save refuses with `SHARING_NOT_ENABLED` and the credential and session objects. It now lists only what `GET /api/v1/sharing/shareable-objects` answers: the objects a rule saved on would take effect on, business objects first and then platform objects, each group by label, in the order the server sends.

- **The widget (`@object-ui/fields`).** `field:shareable-object-ref` reads the list through the host's authenticated fetch (`SchemaRendererContext.apiFetch`) and stores the object's name, as `object-ref` does, with the same `Label (name)` spelling. A stored name the list does not hold stays on screen as its own option, so editing a rule never drops it. The read-only face is `object-ref`'s.
- **When the list is not served.** A `403` (the caller is not a sharing-rule administrator), a `501` (sharing rules do not run on this deployment), any other failed or unreadable answer, and a host with no authenticated fetch all give the `object-ref` picker over every registered object, as before. The field is never an empty picker; the save doors still decide which object a rule may name.
- **The declaration (`@objectstack/plugin-sharing`).** `sys_sharing_rule.object_name` declares `widget: 'shareable-object-ref'` (was `object-ref`). A console without the widget draws the field as a text box, as with any unregistered widget.
- **The list cell, the record form and the grid.** The new key draws the same object label cell as `object-ref` (`@object-ui/app-shell`), the record form hands it the data source its fallback reads (`@object-ui/components`), and it is not edited inline in a grid cell, like the other widget-hint pickers.
