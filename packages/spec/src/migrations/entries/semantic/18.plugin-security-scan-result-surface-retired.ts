// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-security-scan-result-surface-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface: 'the plugin-security scan-result family: the defs '
    + 'KernelSecurityScanResult and KernelSecurityVulnerability '
    + '(kernel/plugin-security-advanced.zod.ts), their two authorable carriers on '
    + 'PluginSecurityManifest — scanResults and vulnerabilities — and the sibling '
    + 'verdict block PluginQualityMetrics.securityScan (kernel/plugin-registry.zod.ts)',
  replacement:
    'nothing to re-declare — delete the keys and every import of the two types. Plugin '
    + 'security scanning is not a platform capability and there is no replacement schema. '
    + 'What the platform does still enforce, and what to reach for instead: `permissions` and '
    + '`sandbox` on the same PluginSecurityManifest are unchanged, and artifact provenance is '
    + 'answered by `verifyPluginArtifactIntegrity` and the plugin signature verifier — which '
    + 'tell you an artifact is the one its publisher signed, and never that it is safe. For '
    + 'dependency vulnerabilities use the tools built for it against your own project (npm '
    + 'audit / pnpm audit, Dependabot, the GitHub Advisory Database, OSV) and treat an '
    + 'unaudited third-party plugin as untrusted code. A publisher who used scanResults to '
    + 'advertise diligence keeps the surviving securityContact and vulnerabilityDisclosure '
    + 'blocks, which are contact terms rather than a verdict.',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-07 on #15932 (director seat, decision batch #65, adopted verbatim 「同意」). '
    + 'This is the second half of #14919. That card retired PluginSecurityScanner — a '
    + '@objectstack/core class that shipped as a SECURITY control and could not fail, whose '
    + 'verdict was status "passed" for every plugin it was ever handed. The SCHEMAS the '
    + 'scanner fed survived it, and the scanner had been their only importer of any kind (a '
    + 'type-only import in packages/core/src/security/security-scanner.ts), so the family went '
    + 'from one type-only importer to zero consumers while staying fully published: 27 '
    + 'authorable rows across kernel.json, six api-surface exports, two authorable defaults '
    + 'and two json-schema manifest keys. An author could write any of it, be accepted, and '
    + 'get nothing — declared-not-enforced, Prime Directive #10, one layer out from the class '
    + 'removed for the same reason. The census was taken on origin/main after #14919 landed, '
    + 'with a lit control (five hits for PluginSecurityManifest inside the declaring module) '
    + 'proving the file greppable, and found no .parse or .safeParse site against either '
    + 'schema anywhere in packages/**. securityScan is the sharpest member: scanResults '
    + 'published a report, but securityScan.passed published a VERDICT, so a plugin could '
    + 'declare itself clean with nothing behind it. Route: the two defs leave the build whole '
    + '(RETIRED_DEFS_BY_MAJOR[18]) because nothing parses them and a prescription nobody can '
    + 'receive is not worth its cost; the three authorable keys are retiredKey() tombstones '
    + '(RETIRED_KEYS_BY_MAJOR[18]) because both carrying shapes are non-strict, where a bare '
    + 'deletion is a silent strip (ADR-0104). Why this entry and not a D2 conversion: a plugin '
    + 'security manifest and a plugin registry entry are package artifacts a publisher ships, '
    + 'never stack collection members and never stored sys_metadata rows, so the conversion '
    + 'chain has no seam that would see one — the disposition the sibling '
    + 'kernel-plugin-security-durations-unit-in-key entry already records for this same '
    + 'manifest. No deprecation window (maintainer 2026-08-27: 「项目在创业阶段，用户也很少，短期不考虑渐进」). '
    + 'Scope note, recorded rather than acted on: PluginSecurityManifest.vulnerabilities is a '
    + 'forced consequence rather than a name the ruling listed — it was the last authorable '
    + 'referent of KernelSecurityVulnerability and could not outlive the def. Two neighbours '
    + 'the ruling made CONDITIONAL are deliberately untouched here because the repository the '
    + 'condition names, objectstack-ai/cloud, is not reachable from the session that executed '
    + 'this: the marketplace "scanning" status and the incident "malware" type stay exactly as '
    + 'they are, unremoved and not recorded as checked. '
    + '⚠️ The out-of-repo consumer population is NOT MEASURED. @objectstack/spec is published, '
    + 'so this removal is breaking for consumers no download, dependent or source telemetry '
    + 'was consulted for — accepted as an input to the ruling, exactly as #14919 states of its '
    + 'own three exports, and not a reason to soften the removal. #15932, #14919, ADR-0049, ADR-0087.',
  acceptanceCriteria:
    'No source imports KernelSecurityScanResult, KernelSecurityVulnerability or either '
    + 'Schema from @objectstack/spec/kernel: both defs are absent from the built kernel '
    + 'barrel and from api-surface/kernel.json, so a TypeScript consumer gets the refusal at '
    + 'compile time at the import site rather than a missing runtime value. Authoring '
    + 'PluginSecurityManifest.scanResults, PluginSecurityManifest.vulnerabilities or '
    + 'PluginQualityMetrics.securityScan fails to compile (input type `never`) and fails to '
    + 'parse with the tombstone prescription naming that key — verified by refusal pins that '
    + 'assert the issue code, the path naming WHICH key was refused, and the prescription '
    + 'text, plus a positive pin that the surrounding manifest still parses and grows no such '
    + 'property. ⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified as such: '
    + 'nothing ever read any of these keys, so deleting one removes no check that was running. '
    + 'A publisher who believed a declared scanResults entry gated anything was never getting '
    + 'that gate; the remediation is to audit with a real tool, not to find a replacement key. '
    + 'The surviving neighbours must still parse and still be exported — permissions, sandbox, '
    + 'policy, codeSigning, certifications, securityContact and vulnerabilityDisclosure on the '
    + 'manifest, testCoverage/documentationScore/codeQuality/conformanceTests on the quality '
    + 'metrics, and the separately-declared SecurityScanResultSchema / '
    + 'SecurityVulnerabilitySchema in kernel/plugin-security.zod.ts, which this change does '
    + 'not touch.',
};
