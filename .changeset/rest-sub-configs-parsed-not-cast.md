---
'@objectstack/rest': minor
---

**BREAKING (accept-set tightening)**: `RestServer` now parses `config.crud`,
`config.metadata`, `config.batch` and `config.routes` against the schemas that
declare them (`CrudEndpointsConfigSchema`, `MetadataEndpointsConfigSchema`,
`BatchEndpointsConfigSchema`, `RouteGenerationConfigSchema` in
`@objectstack/spec/api`) at construction, instead of casting to them — and
builds the normalized config from the parsed output (#11984).

The constraints were always declared. `packages/spec/src/api/rest-server.zod.ts`
carries `batch.maxBatchSize: z.number().int().min(1).max(1000)`, the
`routes.nameTransform` and `crud.objectParamStyle` enums and
`metadata.cacheTtl: z.number().int()`, and nothing ran them: both hops into
`@objectstack/rest` are casts, the plugin declares no `configSchema`, and #11637
deliberately parsed `api` alone so that one narrowing went in front of contract
review rather than five. Measured on the pre-fix tree: `batch.maxBatchSize: 0`
constructed happily and became the live batch cap (`?? 200` does not fire — `0`
is not nullish), and `routes.nameTransform: 'snake_case'` sat in the normalized
config as if it were declared.

**Newly refused, all at `new RestServer(...)` / `createRestApiPlugin().start()`,
with a message naming the sub-object, the failing key(s) and the declaring
schema** (a construction-time refusal, not an HTTP envelope):

- `batch.maxBatchSize` outside `1..1000` or not an integer — `0`, `-5`,
  `2000`, `2.5`. Refused with zod's own bound text (`expected number to be >=1`,
  `<=1000`, `expected int`).
- `routes.nameTransform` outside `'none' | 'plural' | 'kebab-case' | 'camelCase'`.
- `crud.objectParamStyle` outside `'path' | 'query'`.
- `metadata.cacheTtl` that is not an integer (`2.5`, `'60'`).
- A declared key of any of the four written with the wrong type:
  `crud.dataPrefix: 42`, `metadata.enableCache: 'yes'`,
  `routes.includeObjects: 'account'`, `batch.defaultAtomic: 'yes'`, ...
- `crud.patterns` keyed by an operation outside the CRUD vocabulary
  (`patterns: { bogus: {...} }`), or a pattern whose `method` is not an HTTP
  method — `patterns` is an enum-keyed `z.record`, which zod validates key by key.
- A **partial** `routes.overrides.<object>.operations`. That record is
  `z.record(CrudOperation, z.boolean())` with a non-optional value, which zod 4
  reads as exhaustive: all five operations must be present. The input TYPE
  already demanded all five at typed authoring sites; this is the day the
  runtime agrees with `tsc`.

**Deliberately NOT refused** — the narrowing is exactly what the schemas
declare, and no more:

- A **negative** `metadata.cacheTtl`. The card that filed this defect listed
  "a negative TTL" among the values the parse would refuse; the schema declares
  `.int()` only, with no lower bound, so `-1` and `0` stay accepted. A lower
  bound is `packages/spec`'s to declare, and is filed separately.
- **Unknown keys inside a sub-object**: all four schemas are non-strict
  `z.object()`s, so `batch: { bogus: 1 }` is stripped, not refused — as before,
  where the cast simply never read it.
- The retired whole-config key `openApi31` (#4579). Its `retiredKey()`
  tombstone lives on `RestServerConfigSchema`, and this seam parses the five
  sub-objects rather than the whole config, so the tombstone stays unexecuted:
  the key keeps the ignore posture #3963 chose for `api.requireAuth`, and
  flipping it into a boot failure is a maintainer's decision, not this seam's.
- `api`: unchanged from #11637 / #12450 (validate-only, `requireAuth` still
  `.omit()`ed).

**The parsed output is now consumed** for the four sub-objects — defaults come
from the schema and unknown keys are stripped — because the decision was
measured per sub-object rather than inherited from `api`: for each of the four,
every key `normalizeConfig` reads is one its schema declares (the key diff is
empty), and none carries a tombstone, so nothing a consumed parse could strip
is anything the runtime honours. The one honoured-but-undeclared key this
family ever had, `metadata.maskObjectFields`, gained its declared seat in
#11983 and is pinned to survive the parse. Defaults are unchanged
(`maxBatchSize` 200, `cacheTtl` 3600, `dataPrefix` `/data`, `prefix` `/meta`,
`nameTransform` `'none'`, every operation/endpoint switch on, masking on per
ADR-0106 D8), and a partial `crud.operations` / `batch.operations` /
`metadata.endpoints` still takes per-key defaults (ADR-0122 author state). The
seam is one table of declared sub-object schemas and one `parseDeclaredSubConfig`;
`api` runs through the same table with its `.omit()`.

**Migration.** Correct the offending key at its producer; the refusal names the
sub-object, the key, the declared rule and the schema that declares it. A
deployment that meant "no batch cap" wants `enableBatchEndpoint: false` or
`api.enableBatch: false` (the cap's range is the declared policy), and a
partial `routes.overrides.<object>.operations` wants all five operations
spelled out.

**In-repo blast radius, measured per sub-object on `origin/main` @ `08e49496f`.**
140 files construct a REST server (`new RestServer(` or
`createRestApiPlugin(`, 277 sites); across all of them, **zero** pass a
`crud` / `metadata` / `batch` / `routes` block carrying any key the four
schemas declare (the `routes: { data: '', ... }` fixtures are `discovery.routes`
payloads, and every `metadata: { ... }` inside those files is endpoint or plugin
metadata — verified by scanning each block for the schema's own keys; positive
control: `rest-server.ts`'s own `NormalizedRestServerConfig` and `normalizeConfig`
blocks hit).
Repo-wide value census of the constrained keys, every file type: `maxBatchSize`
24 lines, 3 out-of-range literals — two are `packages/spec`'s own schema tests
(`0`, `2000`, which never construct a server) and one is a different schema's
key (`tracing.test.ts`); `nameTransform` and `objectParamStyle` 6 lines each, 0
unknown values; `cacheTtl` 69 lines, 1 non-integer literal (`30.7` in
`packages/runtime`'s endpoint-policy tests — the declarative endpoint's
`cacheTtl`, a different schema). No fixture changes; no in-repo boot path is
affected.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed or renamed — no spec key, export or config field changes spelling, and the four schemas in `packages/spec` are untouched. What changes is that constraints already declared at those keys are finally executed at the consumption seam, so `objectstack migrate meta` has no mechanical rewrite to list: a config carrying `maxBatchSize: 0` or `nameTransform: 'snake_case'` states an intent (which cap, which transform did you mean?) that no conversion can decide for the author, and the refusal text names the fix at the call site. -->
