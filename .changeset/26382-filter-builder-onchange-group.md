---
'@object-ui/components': patch
---

fix(components): the `filter-builder` renderer calls `onChange` with the `FilterGroup` that `FilterBuilderSchema.onChange` declares

Clause-②: no
Metadata-protocol: none

`FilterBuilderSchema.onChange` declares `(filter: FilterGroup) => void`, but the `filter-builder` renderer typed its own `onChange` as `(event: any) => void` and called it with a form-style `{ target: { name, value } }` event. A handler written from the declaration read `.logic` and `.conditions` off that event and got `undefined`, and the `any` kept the compiler from reporting the mismatch. The renderer now takes the schema's own `onChange` type and passes the group it holds, so the declaration is the contract on both sides. No in-repo host bound the event shape. A host that read `event.target.value` reads the argument itself instead.

The builder's own rows also admit the opt-in `exists` / `notExists` operators, which a `FilterGroup` cannot carry. The renderer no longer forwards a host's `extraOperators` to the builder, since `FilterBuilderSchema` declares no such key, so the node never offers them. The `FilterGroup` zod mirror refuses them in an authored `value`. If a stored value that skipped that validation still carries one, the renderer does not call `onChange` and logs a console error naming the operator, instead of handing on a group the declared type does not describe.
