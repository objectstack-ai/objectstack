---
"@objectstack/lint": minor
"@objectstack/spec": patch
---

feat(lint): L2 hook-body writes to undeclared fields warn at author time (#4271)

An L2 (`language:'js'`) hook body that writes a field the target object never
declares — `ctx.input.amout = 0`, `ctx.api.object('deal').update({ stag: … })`
— runs clean in the QuickJS sandbox, reports success, and the unknown column
simply never lands in the stored record. No diagnostic anywhere: the #4001
"silent no-op manufactures false completion" failure mode at the
runtime-expression layer. The read side (`hook.condition`) and the capability
surface were already statically checked; the write side was the one blind face,
and `hook-body.zod.ts` carried it as an **accepted gap**.

**New rule — `hook-body-write-unknown-field` (advisory).** `@objectstack/lint`
now parses each L2 body (TypeScript parser; parsed, never executed, never
type-checked) and resolves its literal writes against the target object's
declared + system fields. An unknown field warns with a did-you-mean. Wired
into `REFERENCE_INTEGRITY_RULES`, so `os validate`, `os lint` and `os compile`
all report it; it never blocks a build.

The recognized write shapes are declared as data — `HOOK_BODY_WRITE_PATTERNS`,
each entry carrying a canonical example that a reconciliation test round-trips
through the real extractor, so a pattern cannot be declared-but-unverified
(#3528's death). v1 ships three:

- `ctx.input.<field> = …` / `ctx.input['<field>'] ⟨op⟩= …` → the hook's own
  target object(s); flat-input envelope keys (`id`/`options`/`ast`/`data`) are
  never treated as record fields.
- `Object.assign(ctx.input, { <field>: … })` → same target.
- `ctx.api.object('<object>').insert|create|update({…})` / `.updateById(id, {…})`
  → the named object, at the **real** `ObjectRepository` payload positions
  (`update(data)` — the payload is argument 0, not `update(id, data)`).

Everything statically unknowable is skipped silently, favouring missed findings
over false ones: computed keys, spreads, non-literal payloads, dynamic object
names, wildcard-target (`object:'*'`) input writes, cross-package targets,
aliased input (`const doc = ctx.input`), and multi-target hooks where the field
exists on *some* target (the body may branch per object — only an
everywhere-miss warns).

The lint stays off the kernel boot path: the TypeScript compiler loads lazily,
only when a hook actually carries a JS body (same contract as the react-page
gates, guarded by `lazy-deps.test.ts`).

`@objectstack/spec`: the `ScriptBodySchema` header's "write-set opacity —
accepted static-analysis gap" note now points at the lint instead, and spells
out what remains opaque so the warning's absence is not read as proof of
correctness.
