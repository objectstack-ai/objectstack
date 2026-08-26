---
"@objectstack/runtime": patch
"@objectstack/cli": patch
---

Ship a **declared** `api.projectResolution` from the standalone boot path (#11999)

`@objectstack/runtime`'s `createStandaloneStack()` / `createDefaultHostConfig()`
returned `api: { enableProjectScoping: false, projectResolution: 'none' }`, and
`os serve` forwarded it unchanged. `'none'` is not a member of the declared enum:
`RestApiConfigSchema` (`packages/spec/src/api/rest-server.zod.ts`) declares
`z.enum(['required', 'optional', 'auto'])`. Three packages disagreed about this
key's vocabulary, and the disagreement survived because nothing ever executed
the schema — `RestServer` cast its config instead of parsing it.

`StandaloneStackResult['api']` now declares, and the factory now emits,
`projectResolution: 'auto'`.

**Behaviour on the routing path is unchanged, and that is measured, not assumed.**
Every reader that acts on this key is gated on `enableProjectScoping` first:
`RestServer.registerRoutes` takes its `else` arm, `mountAndRecordDirectRoutes`
mounts `[versionedBase]`, and the Dispatcher plugin's two
`enableProjectScoping && … === 'required'` guards short-circuit. With scoping off
the strategy really is moot for routing — which is why this migrates the value
rather than teaching the enum a fourth member.

**One reader is not gated, and that is the user-visible fix.** `RestServer`'s
discovery handler copies `api.projectResolution` into
`discovery.scoping.resolution` unconditionally, and `DiscoverySchema` declares
that field as the same three-member enum. So `GET /api/v1` on every `os serve`
boot advertised a payload the platform's own schema rejects. Clients that
validate discovery — or switch on `scoping.resolution` — now receive a declared
value.

Both halves are pinned rather than described: `merge-boot-config.test.ts` parses
the CLI's real boot block against `RestApiConfigSchema` and against the discovery
field's enum, and `standalone-stack.test.ts` parses the block the factory
actually returns. Each pin asserts the refusal of `'none'` alongside the
acceptance of `'auto'`, so it can be seen to say no. The CLI constant is now
typed as `StandaloneStackResult['api']`, so it can no longer drift from the
producer without failing `tsc`.
