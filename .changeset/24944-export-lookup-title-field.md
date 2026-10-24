---
'@objectstack/rest': patch
---

fix(rest): a lookup cell in the list export names the record by the target object's title field (#24944)

Clause-②: no

`GET /api/v1/data/:object/export` (Display → Export as CSV / XLSX) wrote a lookup, master-detail, user or tree cell from the lookup field's own `displayField`. Without one, it took the first key of a fixed list (`name`, `title`, `label`, `full_name`, …) found on the expanded record. It never read the target object's `nameField`. So a contact that declares `nameField: 'full_name'` and has no `name` column exported as its job `title` ("VP of Engineering" instead of "John Smith").

- **Now.** The export reads each target object's title field once per export, by ADR-0079's `resolveDisplayField`: the `nameField`, then the deprecated `displayNameField` alias. The registry sets that pointer on every object it holds. The cell shows that field's value from the expanded record. This applies to csv, xlsx and json.
- **Precedence.** The lookup field's own `displayField` still wins when it is set. The key list is used only when the target resolves no title field, or when its schema cannot be read.
- **Field-level security.** When the caller cannot read the target's title field, the `$expand` read leaves it off the record. The cell then shows the record's id. Another column, such as the job title, no longer stands in for the name.
- **Visible change.** A target with a literal `name` column and a different declared title now exports the declared title. For example, an account with `nameField: 'display_title'` exports its display title instead of `name`.
- **Unchanged.** No query parameter, header, column set or payload shape moves. Only the text of a lookup cell changes.
