---
'@objectstack/spec': patch
'@objectstack/rest': patch
---

fix(spec,rest): give `api.enableSearch` a declared seat, and stop reading runtime-honoured config keys through `as any` (#11983)

`api.enableSearch` was a live REST config key with no declared seat:
`RestServer.normalizeConfig` read it through `(api as any)` and honoured it
(`enableSearch: false` really unmounted the search endpoints), but no schema in
`packages/spec` declared it. Because `RestApiConfigSchema` is not `.strict()`,
its own parse **stripped** the key — measured:
`RestApiConfigSchema.parse({ version: 'v1', enableSearch: false })` returned an
object with no `enableSearch` property at all — so any consumer of the parsed
config silently got search turned back on for a deployment that turned it off
(the ADR-0104 silent-strip class). It also forced #11637's construction-time
parse to be validation-only, discarding the parsed value.

- `RestApiConfigSchema` now declares
  `enableSearch: z.boolean().default(true)` beside `enableOpenApi`, with the
  runtime's existing default. The opt-out now survives the key's own
  contract's parse (pinned), and a TypeScript author can write
  `api: { enableSearch: false }` without a cast.
- `packages/rest`'s `normalizeConfig` drops all three `as any` reads: the
  newly declared `enableSearch`, the already-declared
  `metadata.maskObjectFields` (its declared seat landed separately; the cast
  was stale), and the long-declared `enableOpenApi` (stale residue from
  before its declaration). `NormalizedRestServerConfig.api.enableSearch` is
  now a required boolean like its siblings.

No runtime behavior changes: defaults are identical (`enableSearch` on,
masking on per ADR-0106 D8, OpenAPI on); this change moves the keys from
cast-reachable to declared = enforced.
