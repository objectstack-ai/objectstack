// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'kernel-runtime-config-timeout-unit-in-key',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface: 'RuntimeConfig resourceLimits.timeout (kernel/plugin-security-advanced.zod.ts)',
  replacement: 'resourceLimits.timeoutMs — rename the key; the value (milliseconds) is unchanged',
  reason:
    'This entry COMPLETES what #15678 deliberately left alone, and the two are meant to be read '
    + 'as a sequence. #15678 renamed the four plugin-security durations on this same file '
    + '(`kernel-plugin-security-durations-unit-in-key`) and recorded, accurately, that one key was '
    + 'out of its scope: RuntimeConfig.resourceLimits.timeout named its unit only in the JSDoc '
    + 'above it ("Execution timeout in milliseconds"), a channel check:duration-unit-keys does not '
    + 'read — it reads `.describe()` and `.meta({ description })` — and that key\'s describe '
    + '("Maximum execution time") named none, so the gate listed it among the duration-shaped keys '
    + 'without judging it, neither an offender nor an exemption. That JSDoc-channel gap was filed '
    + 'as #15939, and #15678\'s statement about its own scope stays true. #15939 is now ruled and '
    + 'this is its remediation: director-seat ruling A, 2026-09-11, carrying the maintainer\'s '
    + '「同意」 (decision batch #115), which remediates the 21-row JSDoc-channel population per file '
    + 'and lands the widened gate (#17635) last, into a tree already clean. So the reader who most '
    + 'needs the unit — the reader of the published reference page, who never sees the source '
    + 'JSDoc — got a bare integer on '
    + 'content/docs/references/kernel/plugin-security-advanced.mdx and could not tell 60000 '
    + 'milliseconds from 60000 seconds. The key is renamed and the describe is corrected in the '
    + 'same stroke, because under the #14478 rule moving the unit into the describe alone is '
    + 'itself a violation (unit in prose, none in the name). Spelled Ms, the same token '
    + 'SandboxConfig.process.timeoutMs on this very file already carries: counted on this tree, '
    + 'the suffixed family spells it that way in every member (29 key-position `timeoutMs` '
    + 'declarations across packages/spec/src/**/*.zod.ts, 40 distinct *Ms keys) and there is no '
    + 'timeoutMillis, timeout_ms or timeoutMS variant anywhere in packages/spec/src. Tombstoned '
    + 'with retiredKey() because the nested resourceLimits object is not strict, so a bare '
    + 'deletion would silently strip the key. Why a semantic entry and not a D2 conversion: a '
    + 'RuntimeConfig is the engine block of the SandboxConfig a host or a plugin security manifest '
    + 'constructs — stack.zod.ts declares no sandbox, security-policy or runtime-config collection '
    + 'and it is not a stored sys_metadata row — so the conversion chain has no seam that runs on '
    + 'it; the same reading #15678 recorded for the four keys it renamed. Measured on 146c291943: '
    + 'no in-repo runtime reads the key — packages/core/src/security/sandbox-runtime.ts, the one '
    + 'consumer of this shape, reads resourceLimits.maxCpu (3 occurrences of resourceLimits) and '
    + 'spells timeout 0 times; outside the zod file and its test the only live occurrences are the '
    + 'generated rows in content/docs/references/kernel/plugin-security-advanced.mdx, which this '
    + 'rename regenerates. The pinned objectui checkout — .objectui-sha = '
    + '53ded82bf7a494f54e344e19099dbf00854b8694 — spells resourceLimits.timeout 0 times across '
    + '6409 tracked files, against lit controls timeout 832, RuntimeConfig 236 and resourceLimits '
    + '2 on the same corpus; both resourceLimits hits are prose in packages/app-shell recording '
    + 'that objectui\'s own AppShellRuntimeConfig shares not one key with the spec\'s '
    + 'RuntimeConfig, so nothing there authors this key and no pin bump is owed. #15939, #15678, '
    + '#14478, ADR-0087.',
  acceptanceCriteria:
    'Every RuntimeConfigSchema.parse(…) site, and every literal handed to a plugin sandbox as its '
    + 'runtime block, spells resourceLimits.timeoutMs; authoring resourceLimits.timeout fails to '
    + 'compile (input type `never`) and fails to parse with the rename prescription naming '
    + 'timeoutMs and the shape it belongs to. Behaviour is unchanged: a runtime given '
    + 'timeoutMs: 60000 aborts execution after sixty seconds exactly as timeout: 60000 did, and '
    + 'the min(0) integer bound rides along with the renamed key. The published describe reads '
    + '"Maximum execution time in milliseconds". Verify the two same-named keys on this one file '
    + 'apart: RuntimeConfig.resourceLimits.timeout and SandboxConfig.process.timeout both retire '
    + 'to a key spelled timeoutMs, and each refusal names its own shape so an upgrading author '
    + 'edits the right block.',
};
