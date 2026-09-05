---
"@objectstack/core": minor
---

feat(core)!: retire `PluginSecurityScanner` — plugin security scanning is not a platform capability (#14919)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed. This removes a RUNTIME class from `@objectstack/core`'s barrel; it parses no metadata, is named by no spec key, and wrote nothing to `sys_metadata` — every `scan()` result lived in a per-instance in-memory Map that was discarded with the object. So no stored row carries a shape a conversion could rewrite, `objectstack migrate meta` has nothing to touch, and there is no FROM -> TO for an ADR-0087 registry to hold. The consumer-side prescription (delete the call; there is no replacement) is prose below, deliberately: a hand deletion is not a migration. -->

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
