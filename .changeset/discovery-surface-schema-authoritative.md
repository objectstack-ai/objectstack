---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
"@objectstack/runtime": minor
---

feat(spec,runtime,metadata-protocol)!: one schema for both discovery producers — `capabilities` canonical, `features`/`endpoints` retired, `scoping` declared (#4828)

`/discovery` is a machine-readable surface, but nothing compared what the two
producers emit against what `packages/spec` declares. The only schema the
protocol layer referenced was `GetDiscoveryResponseSchema` —
`DiscoverySchema.partial().required({version}).extend({apiName})` — so
`.partial()` hid every missing REQUIRED key while zod's default unknown-key
strip hid every UNDECLARED emitted one. The two producers then drifted in
opposite directions through the same blind spot.

`DiscoverySchema` is now authoritative for producers, and each producer package
carries a `discovery-schema-conformance.test.ts` that parses its LIVE shape
against it and checks its emitted key set against the protocol schema's shape.

**Breaking for anyone reading the dispatcher's `/.well-known/objectstack` body:**

- `features` → **`capabilities`**, the name `DiscoverySchema` has always
  declared, in the declared `{ enabled }` shape. The same flags survive. This
  fixes a real defect: the SDK's `client.capabilities` getter reads
  `discoveryInfo.capabilities`, so against a dispatcher-served host it returned
  `undefined` for every flag while the answers sat one key away under `features`.
- `endpoints` — **removed**. It duplicated `routes` verbatim as a
  "backward compatibility" alias; a consumer census across `objectstack`,
  `objectui` and `cloud` found no reader. Use `routes`.
- `environment` is now **mapped** into its declared enum instead of passing
  `NODE_ENV` through raw (`test` → `development`, `staging` → `sandbox`,
  unrecognized → `development`, never `production` on a guess). `NODE_ENV=test`
  and `staging` previously advertised values outside the declared enum.

**Additive elsewhere:**

- `DiscoverySchema` declares `scoping` (optional) — the environment-scoping
  posture the REST endpoint has always emitted and `packages/client` has always
  consumed, now part of the contract instead of an undeclared extra.
- The REST `/discovery` body gains the required `name` / `environment` /
  `locale`, so it can satisfy `DiscoverySchema` at all. `locale` is derived from
  the registered i18n service, the same way the dispatcher derives it.
- `name` is canonical on both producers. `apiName` remains as a deprecated alias
  carrying the identical value and is **scheduled for removal in protocol 18**.
- New exports: `DiscoveryEnvironmentSchema`, `DiscoveryEnvironment`,
  `resolveDiscoveryEnvironment`.
