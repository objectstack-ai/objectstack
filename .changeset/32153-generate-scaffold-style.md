---
'@objectstack/cli': patch
---

fix(cli): `os generate` writes the starter's authoring style, a view can be named apart from its object, an action without a flow is a declarative update, `os g dashboard` names the app navigation entry that lists it, and `os --help` describes each topic

Clause-②: yes (widening)
Metadata-protocol: none

What a newcomer, or a coding agent following the CLI's output, meets on the documented path, FROM → TO:

- `os g object NAME`: FROM a raw `{ type: 'text', … }` field literal, a default export and no field groups TO the `npm create objectstack` starter's style: the field declared through `Field.text({ … })`, placed in a declared `fieldGroups` section (`details`), and the object exported by name (`export const NAME = ObjectSchema.create({ … })`). The barrel line it appends re-exports that name (`export { NAME } from './NAME.object'`). The default export stays beside it, so a default import of a generated object keeps working.
- `os g view NAME --object OBJECT`: FROM refused (`--object` was not taken, and the name was always read as the object's) TO a views container for OBJECT whose one list view is the named entry `listViews.NAME`. `os g view OBJECT` without `--object` writes what it always wrote. A stack holds one views container per object, so for an object that already has one the command now refuses before writing anything and prints the `listViews` entry to add to it (it used to write the file and take it back out when the config no longer loaded).
- `os g action NAME --object OBJECT` in a stack that declares no flow: FROM refused ("an action runs a flow") TO a declarative update action: `operation: 'update'` with a `params` entry naming one field of OBJECT (its title field, else its first field), placed on the record header. With `--flow`, or one flow in the stack, it still writes the flow action; several flows and no `--flow` is still refused.
- `os g dashboard NAME`: the dashboard is still written with `widgets: []`, and now its header and the command's output name the app navigation entry that lists it, and the stack's app to add it to. `os g` edits no app.
- `os --help`: FROM each topic showing one of its commands' descriptions (`data  Create a new record`, `meta  Delete a metadata item`) TO a description of the topic, declared under `oclif.topics`.
