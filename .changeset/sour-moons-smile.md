---
'@objectstack/cli': patch
---

`os generate schema` can now reach its own `fs.writeFileSync`.

`runSchemaGeneration` called `z.toJSONSchema(ObjectStackDefinitionSchema, { target: 'draft-2020-12' })`
bare — the one `toJSONSchema` call site in this repository that neither fell back nor used the
`unrepresentable` convention. That call has no JSON form in either io direction on today's tree (a
transform in the output direction, a function type in the authoring direction), so the `catch` below
it printed and exited 1 for every repository and every flag combination: the command could never
write the IDE schema it exists to write.

It now runs the same three-tier ladder `packages/spec/scripts/build-schemas.ts` already runs for
every schema it publishes — output, then the authoring (`io: 'input'`) direction, then that direction
with `unrepresentable: 'any'` as `packages/metadata-protocol` spells it — and each tier re-raises any
error the known-unsupported predicate does not recognise, so a real conversion failure is still loud.

No new flag, no new key and no new exported symbol: the change is confined to the body of a
module-private function.

The published document lands on the third tier today. It is the authoring derivation, so a property
carrying a `default` is not reported as required; the nodes that have no JSON form in any direction —
`onEnable`, and the inline-callable branch of each `handler` under `hooks`, `functions` and
`packages` — are published as unconstrained, which means an IDE validates everything else in
`objectstack.config.ts` and asks nothing about those.
