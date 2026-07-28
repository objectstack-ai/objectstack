---
"@objectstack/spec": patch
---

fix(docs): `FieldSchema.extend()` does not exist — the FAQ was recommending a call that throws

#3882 brought `content/docs` under the example type-check gate and left an open
question: of the blocks still unmarked, is any of it **genuine rot** rather than a
fragment? Swept them. One real one:

`content/docs/deployment/troubleshooting.mdx` answered *"How do I extend a
built-in schema?"* with

```ts
const CustomFieldSchema = FieldSchema.extend({ … });   // TypeError
```

`FieldSchema` carries a `.transform()` that lowers author-facing sugar at parse
time, which makes it a **`ZodPipe`, not a `ZodObject`** — `.extend` is `undefined`
on it (verified against the built package). Anyone following the FAQ got a
`not a function` throw. The example also used `z` without importing it.

Rewritten to `FieldSchema.in.extend({ … })` — `.in` is the input object the pipe
wraps — verified to parse, and marked so the gate holds it. It also now names why
(the same applies to `ObjectSchema` / `ActionSchema`) and warns that the extended
schema no longer runs the transform.

**The sweep's method is recorded in the gate's docstring**, because two traps make
a naive pass report a confident "nothing found":

1. **`tsc` stops after syntactic diagnostics** — it never reaches the semantic
   pass. Marking all 780 blocks at once let ~200 broken fragments suppress
   type-checking for every other block; the run came back with only TS1xxx codes,
   which reads exactly like "no rot" and proves nothing. Verified by injecting a
   deliberate type error and watching it go unreported.
2. **Unimported type names resolve against the DOM lib.** `Plugin`, `Event`,
   `Response`, `Storage` all exist there, so a block missing its import reports
   *"'version' does not exist in type 'Plugin'"* against `lib.dom`'s `Plugin` —
   an artefact, not drift. Three of the strongest-looking candidates were this.

After both corrections the remaining blocks are fragments, plus
`protocol/kernel/config-resolution.mdx`, whose aspirational snippets are already
labelled as design intent by a callout on the page.
