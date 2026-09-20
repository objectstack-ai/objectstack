---
'@objectstack/spec': patch
---

Say it out loud when a `.refine()` never reaches the published JSON Schema.

`z.toJSONSchema()` has no arm for a `custom` check, so every rule written as a
`.refine()` / `.superRefine()` is enforced by the runtime and absent from the
`json-schema/` tree that ships inside this package — a published file that is
WIDER than the Zod type it was generated from, in the direction where an
author's (or an AI's) validator says yes and the platform then says no. Measured
on zod 4.4.3: 688 refinement sites across 240 published schemas, none of which
projected anything.

Nothing about what the schemas accept changes. Each affected file now carries an
`x-dropped-refinements` annotation naming the paths whose rules it does not
state — `x-` keywords are ignored by every validator, so the accepted document
set is byte-for-byte what it was — and the generator reports the population on
every run and refuses to grow it silently
(`packages/spec/dropped-refinements.baseline.json`).

Clause-②: no
