// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-security-scanner-retired',
  surface:
    '`@objectstack/core` runtime exports: `PluginSecurityScanner`, and the two types '
    + 'declared only to feed it, `ScanTarget` and `SecurityIssue`',
  replacement:
    'nothing to re-declare — delete the import and every call. Plugin security scanning is '
    + 'not a platform capability and there is no replacement export. A caller that branched '
    + 'on `result.status === "passed"` takes that branch unconditionally, because it is the '
    + 'only branch the scanner ever produced. What the platform does still enforce, and what '
    + 'to reach for instead: artifact integrity and signatures '
    + '(`verifyPluginArtifactIntegrity`, the plugin signature verifier) answer "is this the '
    + 'artifact the publisher signed?" and never "is this artifact safe?"; plugin permissions '
    + 'and the sandbox resource limits are unchanged. For dependency vulnerabilities use the '
    + 'tools built for it against your own project — `npm audit` / `pnpm audit`, Dependabot, '
    + 'the GitHub Advisory Database, OSV — and treat an unaudited third-party plugin as '
    + 'untrusted code.',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-05 on #14919 (director summon #14, '
    + 'decision batch #42, ruled A: retire in three surfaces). The class shipped on '
    + '`@objectstack/core`\'s public barrel as a SECURITY control and could not fail. `scan()` '
    + 'composed five private scanners: four of them (`scanCode`, `scanMalware`, `scanLicenses`, '
    + '`scanConfiguration`) allocated an empty issue array, logged and returned it with no code '
    + 'in between, so none could report a finding for any input; the fifth, `scanDependencies`, '
    + 'ran a real loop but matched only against an in-memory vulnerability database whose sole '
    + 'writer, the public `addVulnerability`, had zero callers in objectstack, in objectui at '
    + 'the pinned sha, or in the one demonstration that constructed the scanner, and '
    + '`updateVulnerabilityDatabase()` logged twice and fetched nothing. The database was '
    + 'therefore empty on every code path that has ever executed: no issue was ever produced, '
    + 'the score stayed 100, and the verdict was `status: "passed"` for every plugin the '
    + 'scanner was ever handed — a malicious one as readily as a benign one. Repair was refused '
    + 'by name: a real vulnerability scanner is a feature with a design surface, not a defect '
    + 'fix. Why this entry exists at all, and why D3 semantic rather than a D2 conversion: '
    + '`PluginSecurityScanner` has no spec schema and never had one — it is a runtime TS class, '
    + 'so there is no authorable key to tombstone with `retiredKey()`, no stored `sys_metadata` '
    + 'row that could carry it (a scanner was constructed per call and every result lived in a '
    + 'per-instance Map discarded with the object), and hence no seam `applyConversionsToStored'
    + 'Item` would ever reach. The enforced channel is tsc, at the consumer\'s own import site; '
    + 'for anyone it does not reach, this ledger entry and the generated upgrade guide are the '
    + 'only channel there is. That is the `contracts.IDataDriver.findStream` (#4484) and '
    + '`actor-user-roles-to-positions` (#6011) disposition — a TS/API contract, no stored '
    + 'source, no tombstone, tsc at the call site — applied to a surface one layer further out '
    + 'than either: those are declared in `packages/spec`, this one only in `packages/core`. '
    + '⚠️ The out-of-repo consumer population is NOT MEASURED. Zero constructors were found in '
    + 'objectstack, in objectui at the pinned sha, and in the deleted example, but no download, '
    + 'dependent or source telemetry was consulted for consumers of the published package, so '
    + 'this is breaking for an unmeasured population rather than a removal proven to break '
    + 'nobody.',
  acceptanceCriteria:
    'No source imports `PluginSecurityScanner`, `ScanTarget` or `SecurityIssue` from '
    + '`@objectstack/core` (or from `@objectstack/core/security`, a subpath the package has '
    + 'never declared in its `exports` and which therefore resolved for nobody). A TypeScript '
    + 'consumer gets the refusal at compile time at the import site — the export is absent from '
    + 'the built `dist/index.d.ts`, not merely undocumented. ⚠️ Runtime behaviour is '
    + 'deliberately UNCHANGED and must be verified as such: every scan this class ever '
    + 'performed returned zero issues and `status: "passed"`, so deleting a call removes no '
    + 'check that was running. A caller that treated a passing scan as evidence of safety was '
    + 'never getting any, and its remediation is to audit dependencies with a real tool, not to '
    + 'find a replacement symbol — there is none. Verified in-repo by export-list assertions on '
    + 'both barrels (`packages/core/src/security/security-scanner-retirement.pin.test.ts`), not '
    + 'by a grep: the name legitimately survives in the tombstone comments that explain the '
    + 'retirement.',
};
