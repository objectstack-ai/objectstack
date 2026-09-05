---
"@objectstack/core": minor
---

feat(core)!: retire `PluginSecurityScanner` — plugin security scanning is not a platform capability (#14919)

<!-- adr-0087: registered plugin-security-scanner-retired -->

**ADR-0087 disposition: registered**, as `plugin-security-scanner-retired` in
`MIGRATIONS_BY_MAJOR[18].semantic` — a **D3 semantic** entry, not a D2 conversion,
and so not the metadata migration the ruling excludes. The class has no spec schema
and never had one, so there is no authorable key to tombstone with `retiredKey()`
and no stored `sys_metadata` row a conversion could rewrite: a scanner was
constructed per call and every result lived in a per-instance Map discarded with the
object, so `applyConversionsToStoredItem` has no seam that would ever see one. An
entry is nevertheless owed rather than optional, because this changeset carries a
real consumer prescription — the enforced channel is tsc at the import site, and for
any consumer it does not reach, the ledger and the generated upgrade guide are the
only channel there is. Same disposition as `contracts.IDataDriver.findStream` and
`actor-user-roles-to-positions`.

**BREAKING** — `PluginSecurityScanner` is removed from `@objectstack/core`,
together with its two companion types `ScanTarget` and `SecurityIssue`. Landing
as `minor` under the repo's launch-window convention for breaking changes.
**There is no replacement**, and none is planned.

⚠️ **The out-of-repo consumer population for these three exports is NOT
MEASURED.** This changeset can state only what was measured *inside* the
sources this repo can read: zero constructors in objectstack, zero in objectui
at the pinned sha, and zero in the deleted example itself. How many published
consumers of `@objectstack/core` import the class is unknown — no download,
dependent or source telemetry was consulted. Read the removal as breaking for
an unmeasured population, not as a removal proven to break nobody.

## Why it was removed rather than repaired

The class was a shell that reported success. `scan()` composed five private
scanners: four of them (`scanCode`, `scanMalware`, `scanLicenses`,
`scanConfiguration`) allocated an empty issue array, logged, and returned it
with no code in between — none could report a finding for any input. The fifth,
`scanDependencies`, ran a real loop but matched only against an in-memory
vulnerability database whose sole writer, the public `addVulnerability`, had
zero callers; `updateVulnerabilityDatabase()` logged twice and fetched nothing.
The database was therefore empty on every code path that has ever executed, so
no issue was ever produced, the score stayed 100, and the result was
`status: 'passed'` for every plugin the scanner was ever handed — a malicious
one included.

A security control that cannot fail is worse than no security control, because
callers rely on it. Repair — writing a real vulnerability scanner — was refused
by name: it is a feature with a design surface and no demand, not a defect fix.

## FROM → TO

```ts
// FROM — compiles today, and passes every plugin it is given
import { PluginSecurityScanner } from '@objectstack/core';

const scanner = new PluginSecurityScanner(kernel.logger);
const result = await scanner.scan({ pluginId, version, dependencies });
if (result.status === 'passed') { await kernel.use(plugin); }

// TO — delete it. The condition above was always true.
await kernel.use(plugin);
```

**The one-line fix:** delete the import and every call; no symbol replaces it.
If your code branched on `result.status`, take the `'passed'` branch — that is
the only branch it ever took.

**If you were relying on it for actual security**, you were not getting any.
Audit dependencies with the tools built for it (`npm audit` / `pnpm audit`,
Dependabot, the GitHub Advisory Database, OSV) and treat an unaudited
third-party plugin as untrusted code. What ObjectStack does still enforce is
artifact **integrity and signatures** (`verifyPluginArtifactIntegrity`, the
plugin signature verifier — "is this what the publisher signed?", never "is
this safe?"), explicit plugin **permissions**, and the sandbox **resource
limits**; all three are unchanged.

Removed under ADR-0049 enforce-or-remove, per the maintainer ruling of
2026-09-05 (director summon #14, decision batch #42). The retirement is pinned
as an export-list assertion on both barrels in
`packages/core/src/security/security-scanner-retirement.pin.test.ts`.
