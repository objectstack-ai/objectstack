---
"@objectstack/spec": patch
---

fix(docs): the schema-extension FAQ rotted in reverse — `.extend()` works on `FieldSchema` again since protocol 17

The #3890 fix taught that `FieldSchema` / `ObjectSchema` / `ActionSchema` are all
`ZodPipe`s and that `FieldSchema.extend` throws. True when written; protocol 17
(#3855) then retired the deprecated aliases whose lowering was the whole reason
for the field/object transforms, the pipes collapsed to plain `ZodObject`s, and
both prose claims inverted within days: `.extend` works, and the recommended
`FieldSchema.in` is now `undefined` — following the FAQ was once again the only
way to hit an error. Only `ActionSchema` (whose `requiresFeature` → `visible`
lowering is still live) remains a pipe.

The example gate never noticed because the checked block used only `.parse()` —
deliberately shape-agnostic after CI rejected the first #3890 attempt. That made
the code durable and left the PROSE as the only load-bearing surface, which is
where the rot settled.

So the rewrite moves the claim into the checked block: it now calls
`FieldSchema.extend({ … })` directly, so if the schema ever grows a transform
again the gate goes red instead of the prose going quietly wrong. Composition
stays as the shape-agnostic default, `ActionSchema` is documented as the pipe
case with the `.in.extend` caveat, and the FAQ teaches the one-line probe
(`typeof SomeSchema.extend === 'function'`) instead of a table of shapes that
history says will not stay true.
