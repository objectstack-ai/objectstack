---
'create-objectstack': minor
---

feat(create-objectstack): the blank starter wires a `src/picklists` barrel for `objectstack generate picklist`

Clause-②: yes (widening)

A new blank project ships an empty `src/picklists/index.ts`, and its `objectstack.config.ts` imports it and hands its exports to `defineStack` under `picklists`, as it already does for every other directory `objectstack generate` writes into. `objectstack generate picklist NAME` then writes `src/picklists/NAME.picklist.ts` and its export line, and the list is part of the stack with no edit to the config. A select field takes its options from the list with `Field.select({ picklist: 'NAME' })`, and the server serves that field with the list's options.

A project scaffolded by an earlier release keeps its config. Add the two lines by hand to wire the directory: `import * as picklists from './src/picklists';` beside the other barrel imports, and `picklists: exportsOf(picklists),` inside `defineStack({ … })`. `objectstack generate picklist` prints both when the list does not reach the stack.
