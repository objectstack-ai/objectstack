---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): an external object's fields show their datasource and write state, and the object designer offers no control that would reshape the remote table

Clause-②: no
Metadata-protocol: none

An object that carries an `external` binding (ADR-0015) is never a DDL target: its table belongs to the remote database. The object designer now says so instead of offering edits the platform cannot carry out.

- **Every field is marked.** On the field canvas and in the field inspector, each field of an external object carries a mark such as "From plan_gantt · Read-only", and a note above the canvas names the datasource. Read-only is settled from the object alone when it does not set `external.writable: true`. When it does, the datasource is read for `external.allowWrites`: both set reads "Writable", otherwise "Read-only", and a datasource that cannot be read reads "Writes unconfirmed" rather than a guess.
- **No DDL controls.** On an external object the canvas offers no "Add field" (bottom bar, empty state, section header) and its bulk bar has no Delete. The field inspector disables the API name and the Type picker and offers no Duplicate and no Remove. Label, section, order and the other display settings stay editable.
- **Strings.** Six new `designer.external.*` rows in the `studio` namespace of `@object-ui/i18n`, in English and Chinese.
