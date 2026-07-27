---
"@objectstack/spec": minor
---

feat(spec)!: remove the dead static capabilities-descriptor cluster (`ObjectQL`/`ObjectUI`/`Kernel`/`ObjectStack`/`ObjectOS CapabilitiesSchema`) (#1878 family)

The "RUNTIME CAPABILITIES PROTOCOL" tail of `stack.zod.ts` — `ObjectQLCapabilitiesSchema`,
`ObjectUICapabilitiesSchema`, `KernelCapabilitiesSchema`, `ObjectStackCapabilitiesSchema`,
the deprecated `ObjectOSCapabilitiesSchema` alias, and all five inferred types — is
removed. Verified zero consumers repo-wide (framework, objectui apart from bare
re-exports, cloud, downstream-contract): it was never authorable (`defineStack` has
no such key), never registered, and never fed any endpoint.

Worse than dead, it **lied**: the fixed-boolean self-portrait defaulted
`fieldLevelSecurity` / `rowLevelSecurity` / `auditLogging` / `backgroundJobs` to
`false` while every one of those is live and enforced on the platform, and
advertised `odataApi` which has never existed. An AI reading the schema would
build a systematically wrong model of the platform.

**Migration — runtime capability discovery is dynamic, not a static schema:**

| Removed | Live replacement |
| --- | --- |
| `KernelCapabilitiesSchema` booleans (`restApi`/`websockets`/`auditLogging`/…) | `GET /api/v1/discovery` — dynamic `capabilities` record with **declared === enforced** discipline (#3298: a capability is advertised only when the route is actually mounted AND the engine supports it) |
| `WellKnown`-style backend feature probes | `WellKnownCapabilitiesSchema` (`@objectstack/spec/api` discovery contract: `comments`/`automation`/`cron`/`search`/…) |
| `ObjectQLCapabilitiesSchema` driver/query booleans | driver-level `DriverCapabilities` / `DatasourceCapabilities` (`@objectstack/spec/data`) — per-connection, resolved at runtime |
| `ObjectStackCapabilitiesSchema` layer roll-up + `ObjectOS*` aliases | none — no replacement import |

The objectui `@object-ui/types` re-exports of these symbols are dropped in the
companion objectui change. `ClusterCapabilityConfigSchema` / `FeatureFlagSchema` /
`ApiEndpointSchema` (referenced by the dead cluster) are untouched — they live in
their own modules and `ApiEndpointSchema` remains consumed by the stack `apis` key.
