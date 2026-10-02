---
'@objectstack/cli': minor
---

feat(cli): `objectstack generate picklist NAME` scaffolds a shared option list, and the metadata summary counts picklists

Clause-②: yes (widening)

- **`objectstack generate picklist NAME`** (alias `os g picklist`) writes `src/picklists/NAME.picklist.ts`, a list declared with `definePicklist({ name, label, options })`, and adds its export line to `src/picklists/index.ts`. The list is collected under the `picklists` stack key. A select field takes its options from the list by naming it, `Field.select({ picklist: 'NAME' })`, in place of options of its own. The server serves that field with the list's options resolved onto it, together with any options other packages add through `picklistExtensions`, and judges writes against them. `objectstack validate` and `objectstack build` refuse a field whose `picklist` names no list the stack declares, and so does the boot.
- **`objectstack init`** wires the new `src/picklists` barrel in the `app` and `plugin` templates, the same way it wires every other directory `objectstack generate` writes into: an empty `src/picklists/index.ts` and a `picklists: exportsOf(picklists)` key in `objectstack.config.ts`. A project scaffolded by an earlier release keeps its config. `objectstack generate picklist` then reports the list as not wired and prints the import line and the `defineStack` key to add.
- **The metadata summary** that `objectstack validate`, `objectstack build` and `objectstack info` print counts the picklists a stack declares, in the `Data:` row: `Data: 1 Objects  3 Fields  1 Picklists`. A stack that declares none prints the row it printed before. The `stats` object in the `--json` output of the same three commands gains a `picklists` count. A `picklistExtensions` entry is not counted as a list.
