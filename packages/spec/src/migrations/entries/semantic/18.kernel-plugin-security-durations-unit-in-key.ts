// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'kernel-plugin-security-durations-unit-in-key',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface: 'the four plugin-security durations whose name carried no unit: '
    + 'SandboxConfig.process.timeout, KernelSecurityPolicy.authentication.tokenExpiration, '
    + 'KernelSecurityPolicy.auditLog.retention and '
    + 'PluginSecurityManifest.vulnerabilityDisclosure.responseTime '
    + '(kernel/plugin-security-advanced.zod.ts)',
  replacement: 'timeoutMs, tokenExpirationSeconds, retentionDays and responseTimeHours — '
    + 'rename each key; every value is unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'These four are one entry because they are one document — everything here hangs off a '
    + 'PluginSecurityManifest — and because together they are this rule\'s clearest case in '
    + 'the whole spec: FOUR durations on one manifest carried FOUR DIFFERENT units '
    + '(milliseconds, seconds, days, hours) and not one of them said so in its name. The '
    + 'sharpest pair is responseTime. On this manifest it means HOURS (how fast a publisher '
    + 'promises to answer a vulnerability report); on PluginHealthReport.metrics, renamed by '
    + 'the same card, the identical bare name meant MILLISECONDS. So `responseTime: 24` was a '
    + 'day on one kernel shape and a fortieth of a second on another, with nothing at the '
    + 'authoring site to tell them apart. The policy was already inconsistent with itself, '
    + 'too: its rate-limit window two blocks above tokenExpiration was ALREADY spelled '
    + 'windowMs, so one security policy carried both conventions. All four are retiredKey() '
    + 'tombstones inside live blocks whose siblings must keep parsing; no shape here is '
    + 'strict, so a bare deletion would strip in silence. Why a semantic entry and not a D2 '
    + 'conversion: a PluginSecurityManifest is a package artifact a publisher ships and a '
    + 'SandboxConfig is the isolation argument a host constructs, so neither is a stack '
    + 'collection member or a stored sys_metadata row and the conversion chain has no seam '
    + 'that would see one. That is what ruling B prescribes for a key that is not authorable '
    + 'metadata. One key deliberately left alone: RuntimeConfig.resourceLimits.timeout on this '
    + 'same file names its unit only in the JSDoc above it ("Execution timeout in '
    + 'milliseconds"), a channel the gate does not read: it reads `.describe()` and '
    + '`.meta({ description })`, and that key\'s describe ("Maximum execution time") names '
    + 'none. So the gate lists it among the duration-shaped keys without judging it — neither '
    + 'an offender nor an exemption — and it is outside this rename; that JSDoc-channel gap is '
    + '#15939. #15678, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every SandboxConfigSchema.parse(…), KernelSecurityPolicySchema.parse(…) and '
    + 'PluginSecurityManifestSchema.parse(…) site, and every literal handed to a plugin '
    + 'sandbox or security manifest, spells the suffixed keys; authoring any old spelling '
    + 'fails to compile (input type `never`) and fails to parse with the rename prescription. '
    + 'Behaviour is unchanged in every case: a sandbox given `timeoutMs: 30000` kills a spawned '
    + 'process after thirty seconds exactly as `timeout: 30000` did, a policy with '
    + '`tokenExpirationSeconds: 3600` still expires tokens hourly, `retentionDays: 90` still '
    + 'keeps ninety days of audit log, and `responseTimeHours: 24` still promises a '
    + 'twenty-four-hour disclosure response. Every integer bound rides along with its renamed '
    + 'key. Verify the sharp pair explicitly: a manifest and a health report in the same '
    + 'codebase must now read responseTimeHours and responseTimeMs respectively, and neither '
    + 'accepts the bare name.',
};
