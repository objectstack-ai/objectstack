---
'create-objectstack': minor
---

feat(create-objectstack): the blank starter wires a `src/picklists` barrel for `objectstack generate picklist`

Clause-②: yes (widening)

A new blank project ships an empty `src/picklists/index.ts`, and its `objectstack.config.ts` imports it and hands its exports to `defineStack` under `picklists`, as it already does for every other directory `objectstack generate` writes into. `objectstack generate picklist NAME` then writes `src/picklists/NAME.picklist.ts` and its export line, and the list is part of the stack with no edit to the config. A select field takes its options from the list with `Field.select({ picklist: 'NAME' })`, and the server serves that field with the list's options.

A project scaffolded by an earlier release keeps its config. There, `objectstack generate picklist NAME` writes the list, reports that it does not reach the stack, and prints the import line and the `defineStack` key that wire `src/picklists`.
