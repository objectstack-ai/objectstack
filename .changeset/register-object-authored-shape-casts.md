---
"@objectstack/objectql": patch
---

fix(objectql): drop the 135 `as any` that dodged `registerObject`'s old parameter type, and pin the authored shape (#5543)

**Runtime behaviour is unchanged in both directions.** Nothing in this change
adds, removes, or reorders a single runtime step: `registerObject` still runs no
`parse`, still fills no zod defaults, and still warns rather than throws on a
sparse object. What changes is what the compiler is allowed to see at the call.

#5543 reported that `registerObject(schema: ServiceObject, …)` demanded the
POST-parse object shape, so a perfectly legal authored literal —

```ts
ql.registerObject({ name: 'task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } })
```

— failed with TS2740 asking for ~9 keys (`searchable`, `required`, `multiple`,
`unique`, …) that are zod `.default(...)` products, only exist after a parse the
registry never runs, and that no author is supposed to write.

The annotation itself is already fixed upstream: ADR-0122 phase 2 (#6083,
`@objectstack/spec` 17.0.0) made the bare alias `ServiceObject` mean the
**authored** (`z.input`) shape, so the existing `ServiceObject` annotation on
both `ObjectQL.registerObject` and `SchemaRegistry.registerObject` now names
exactly what the runtime accepts. No annotation in this package needed to move.

What the flip left behind — and what this change removes — is the workaround it
made obsolete: **135 `as any` casts** across 46 files in `packages/objectql`,
every one of them written only to get an authored literal past the old
parameter type. A blanket `as any` does not suppress one error, it suppresses
all of them, so those casts were also hiding real mistakes. Deleting them
surfaced four, now fixed:

- `save-meta-response-conformance.test.ts` declared `primaryKey: true` on a
  field. There is no such Field key in the spec (it exists only on
  external-catalog remote columns) — inert metadata nothing ever read.
- the same fixture typed a field `'longtext'`, which is not a field type; the
  spec spells it `'textarea'`.
- two validation-rule fixtures in `registry.test.ts` omitted the required
  `name` and `message`.

Two casts in `engine.ts` were load-bearing for a different reason — `registerApp`
takes `manifest: any`, so its map branch widens object definitions to `unknown`.
Those are replaced by stating the contract once on the entries
(`as [string, ServiceObject][]`), which also lets the adjacent
`(objDef as any).name = name` become a checked `objDef.name = name`.

New `register-object-authored-shape.pin.ts` pins both halves of the contract so
a re-flip cannot land quietly: the #5543 literal compiles with no cast, and an
unknown key, a wrong field type, a missing `name`, and a bare-string field each
still fail. It is a `.pin.ts` and not a test because this package's `tsconfig`
excludes its tests, which would make a `@ts-expect-error` there a phantom check.
A companion test registers the same literal for real and asserts the register
path still materializes no defaults and still does not throw.
