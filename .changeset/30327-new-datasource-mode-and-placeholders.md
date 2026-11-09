---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): a new datasource starts on the External schema mode and says what each mode does; a driver box's default is a placeholder, not a value

Clause-②: yes (widening)
Metadata-protocol: none

- **Starts on External.** Setup → Datasources → New datasource now starts on `schemaMode: 'external'` (sent with the `external: {}` block the schema requires) instead of `managed`. The page exists to connect a database that already holds tables and sync them in as objects, and only a federation source offers Sync. A managed datasource is ObjectStack's own storage: once an object is stored in it, the schema sync adds the object's columns to an existing table of the same name. The spec's own default (`managed` when a record declares none) is unchanged; only the dialog's starting choice moved.
- **The modes in business words.** The Schema mode select is ordered External, Managed, Validate only, its two main options are relabelled ("External: read an existing database", "Managed: ObjectStack creates and changes the tables"), and a sentence under it says what the chosen mode does to the database and which one to pick to read an existing database.
- **Why a managed row has no Sync.** A managed datasource's row (not the primary `default`) says it has no Sync objects because ObjectStack creates its tables, and how to read an existing database instead.
- **Box defaults are placeholders.** A driver's text or number box with a default (SQLite `Filename` `:memory:`, PostgreSQL `Host` `localhost` and `Port` `5432`, and so on) starts empty with the default as its placeholder, so a typed path is no longer appended to `:memory:`. A new datasource's Test and Create still send the default for a box left empty, so the request is what it was; an edit shows and sends the stored values. Switches and selects keep their defaults as values.
- **The widening.** Four new `studio` namespace rows in `@object-ui/i18n` (en and zh): `engine.datasource.schemaModeExternalHint`, `engine.datasource.schemaModeManagedHint`, `engine.datasource.schemaModeValidateOnlyHint` and `engine.datasource.noSyncManaged`; the en and zh text of `engine.datasource.schemaModeExternal` and `engine.datasource.schemaModeManaged` changes.
