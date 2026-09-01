---
"@objectstack/types": patch
"@objectstack/service-cluster": minor
"@objectstack/cli": patch
---

fix(types,cli): resolve host-declared packages through the `import` condition, and read the cluster registry instead of assuming it (#13330)

`createHostImporter`'s declared leg resolved with `hostRequire.resolve(pkg)` — a
**CommonJS** resolution, which answers the `require` condition. Every `tsup`
dual build publishes `{ "import": "./dist/index.js", "require": "./dist/index.cjs" }`,
so a package loaded through that leg evaluated as its **CommonJS** build while
the callers (`packages/cli` is `"type": "module"`) held the **ESM** build of the
same package. The process ended up with two instances of everything the loaded
package shares with its caller, each with its own module-scope state.

Measured consequence, on the shipped EE multi-node path (ADR-0018): `os serve`
loaded `@objectstack/service-cluster-redis` through this leg, the driver's
load-time `registerClusterDriver('redis', …)` ran against the CommonJS copy of
`@objectstack/service-cluster`, and the ESM `Runtime` read the ESM copy and
found nothing — `OS_CLUSTER_DRIVER=redis` died at `defineCluster()` with
`Cluster driver "redis" is not registered`, about a package that was installed,
declared and resolvable. Any module-scope registry crossing this seam had the
same defect; the cluster driver is the instance that shipped.

**The seam.** The declared leg now imports the entry the `import` condition
names. The host anchor is untouched — the CJS resolver still answers *where*
the package is, because no flagless Node API resolves a bare specifier against
an arbitrary parent; only the *condition* is re-decided, by reading that
package's own `exports` map. Deliberately narrow, so no load that works today
can regress: a package with no `exports` map is untouched (CJS resolution
already returned `main`), a package publishing no import-condition target is
untouched, and anything unreadable or absent on disk falls back to the
CJS-resolved path.

**The reading.** A residual split is still possible above the seam — two
*physical* copies of one package are two instances in any module system, and no
resolver condition merges them — so `os serve` no longer assumes the driver
registered. `@objectstack/service-cluster` exports `listClusterDrivers()`, the
registry `defineCluster()` itself consults, and `serve` queries it after the
load. The silent `catch` is gone: a driver that loaded but stayed invisible, one
that could not be resolved, and one that resolved and then crashed now read as
three different diagnoses instead of arriving as `not registered` one line
later. An app on an older `@objectstack/service-cluster` has no accessor to
call, and that case reports as unmeasured rather than as either answer.

No behaviour downstream of the diagnosis changed: an absent driver still reaches
`defineCluster()`'s documented error (`cluster.mdx` §8.1) rather than silently
downgrading to the in-memory cluster, and the only documented downgrade here —
a multi-node gate denial — is untouched.
