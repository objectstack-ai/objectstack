---
'@objectstack/spec': patch
---

Published agent-authoring prompts now reference real exports.

`prompts/create-new-project.md`, `prompts/implement-objectql.md` and
`prompts/implement-objectos.md` told agents to import five symbols that
`@objectstack/spec` does not export. Four failed loudly. The fifth did not:
`import { Object } from '@objectstack/spec/data'` does not resolve, so the
annotation in `export const AccountObject: Object = { ... }` bound to the
**JavaScript global** `Object` instead — metadata authored from that prompt
type-checked against a type that constrains nothing.

- Object definitions now use the house authoring convention measured in the
  example apps, `ObjectSchema.create({ ... })`, which genuinely validates.
  Correcting it exposed that the prompt's own example set `enable.audit` /
  `enable.workflow`, neither of which exists; they are now `trackHistory` /
  `files`, the pair the schema's own docstring uses.
- `implement-objectql.md` keeps the real `Field` and `QuerySchema` imports and
  derives the object metadata type as `z.infer<typeof ObjectSchema>`, matching
  both `prompts/instructions.md` ("interfaces must be inferred from Zod") and
  spec's own `src/contracts/schema-driver.ts`.
- `ManifestSchema` becomes `ObjectStackDefinitionSchema` from the package root:
  the prompt's subject is `objectstack.config.ts`, which is neither of the
  `/system` manifests.
- `IdentitySchema` / `PolicySchema` have no bare referent; Rule #2 now names
  `RLSUserContextSchema` and `RowLevelSecurityPolicySchema` from
  `@objectstack/spec/security`.
- The three non-existent "Key Files to Watch" paths
  (`system/{manifest,identity,events}.zod.ts`) now point at `stack.zod.ts`,
  `security/rls.zod.ts` and `kernel/events.zod.ts`.
