---
"@objectstack/spec": minor
"@objectstack/service-cluster": patch
---

feat(spec): remove the dangling `postgres` and `nats` values from `ClusterDriverSchema` (#13393)

<!-- adr-0087: registered cluster-driver-dangling-values-removed -->

**BREAKING** accept-set narrowing on `ClusterDriverSchema`
(`kernel/cluster.zod.ts`), shipped as `minor` under the repo's launch-window
convention for breaking changes; the migration prescription is registered
under protocol major 18.

`postgres` and `nats` validated in `ClusterDriverSchema` but no package
implemented either — the only non-test `registerClusterDriver()` caller is
`@objectstack/service-cluster-redis` — so `defineCluster({ driver: 'postgres' })`
(or `'nats'`) passed schema validation and then reached the unconditional
`Cluster driver "<name>" is not registered` throw at runtime. Maintainer
ruling on objectstack-ai/cloud#1626 (2026-08-24, option B adopted): the
DB-first postgres driver is not built absent concrete customer pull, and —
the ruling's principle rider — a schema-valid value must not be an
unconditional runtime throw. The honest schema states the accept set the
runtime serves.

FROM → TO:

- `cluster: { driver: 'postgres' }` → `cluster: { driver: 'redis', url }`
  (`@objectstack/service-cluster-redis`, the production recommendation), or
  `cluster: { driver: 'custom' }` + `registerClusterDriver(name, factory)`
  for a self-provided transport. Same mapping for `'nats'`. One-line fix:
  pick a driver that ships. No stored config breaks at rest — a config
  naming either value never survived boot in the first place.
- `ClusterDriver` (the `z.input` type) no longer includes the two spellings;
  TypeScript call sites typing them fail `tsc` on upgrade with the same
  remedy.
- The `useExistingPool` field **stays** (it is a ledgered authorable field);
  only its postgres-only prose was corrected — it is forwarded verbatim to
  the registered driver factory and is meaningful for database-backed
  `custom` drivers.

If a future ruling flips under the recorded reversal condition (a concrete
multi-node customer/contract), a value returns to the enum in the same
release that ships its implementation.

`@objectstack/service-cluster` patch: doc comments no longer instruct the
removed spellings (`defineCluster({ driver: 'postgres' })` →
`{ driver: 'redis' }` in the `registerClusterDriver()` example); no runtime
behaviour change.
