// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'kernel-context-preview-mode-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    "context.mode — the value 'preview' left the RuntimeMode enum — and "
    + 'context.previewMode, the whole PreviewModeConfig block it keyed '
    + '(autoLogin / simulatedRole / simulatedUserName / readOnly / '
    + 'expiresInSeconds / bannerMessage, declared on KernelContext and on the '
    + 'TenantRuntimeContext extension). The exported '
    + 'PreviewModeConfigSchema / PreviewModeConfig / PreviewModeConfigParsed '
    + 'names left with the def',
  replacement:
    'nothing declarative — the capability the block described was never '
    + 'implemented by any layer, so there is no working configuration to '
    + 'migrate to. Preview/demo DEPLOYMENTS belong to the deployment layer, '
    + 'which owns auth per-project (ArtifactKernelFactory in the cloud '
    + 'distribution); the OS_PREVIEW_MODE environment variable stays exactly '
    + 'as it is — deployment ROUTING (widening the trusted-origin list for '
    + 'preview subdomains), unrelated to identity. If a preview experience '
    + 'becomes a product capability it re-declares fresh, with the '
    + 'production-posture hard-refusal as the first-landed half (#11846 '
    + 'ruling record)',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-08-27 on #11846 '
    + '(decision-inbox batch 2, Option A: remove — all four decision facets '
    + 'pointed the same way). The declaration was the sharpest '
    + 'declared-≠-enforced shape on a SECURITY surface: the schema promised '
    + '"bypass auth, simulate admin identity" and named a production guard '
    + '"the runtime must enforce", and NO code path implemented either half. '
    + 'Measured zero consumers in all three repos, each leg with positive '
    + 'controls: objectstack — no runtime branches on the mode; the only '
    + "non-declaration hits for RuntimeMode or mode === 'preview' are the "
    + 'schema unit test, a type-alias pin and a measurement-test comment '
    + '(re-verified at dispatch, 2026-08-27, origin/main 15bf9e8). objectui — '
    + 'the #11846 card records the measurement. cloud — cloud#1651 (closed '
    + '2026-08-26): previewMode appears only as a local variable for '
    + 'OS_PREVIEW_MODE whose effect is adding preview-domain wildcards to '
    + "better-auth's CSRF trusted origins; RuntimeMode has zero hits "
    + 'repo-wide; the positive control ArtifactKernelFactory (where serve.ts '
    + 'predicted preview auto-login would live if it existed) has 20+ hits '
    + 'and never touches previewMode. An author — very often an AI (ADR-0033) '
    + '— could write the six-key block per the reference docs, parse cleanly, '
    + 'and get no behaviour and no diagnostic, while a reader of the docs had '
    + 'no way to tell the block from the keys that work. Bookkeeping: the '
    + "enum-VALUE half ('preview') puts nothing in RETIRED_KEYS_BY_MAJOR and "
    + 'leaves the four surface ratchets untouched by itself — its '
    + "prescription hangs on the enum's own error map (the HookBodyCapability "
    + 'precedent); the KEY half is tombstoned with retiredKey() on the '
    + 'non-strict KernelContextSchema (both walked-shape copies registered in '
    + 'RETIRED_KEYS_BY_MAJOR[18]); the DEF half (kernel/PreviewModeConfig, '
    + 'with no carrier left) is registered in RETIRED_DEFS_BY_MAJOR[18]. It '
    + 'is a SEMANTIC entry rather than a D2 conversion because there is no '
    + 'source to rewrite: a kernel context is constructed by host code at '
    + 'boot — not a stack collection member, never stored as a sys_metadata '
    + 'row — so the conversion chain has no seam that would ever see one '
    + '(the kernel/Manifest:loading disposition). ADR-0049 / ADR-0087, '
    + '#11846.',
  acceptanceCriteria:
    "No host constructs a kernel context with mode: 'preview' or a "
    + 'previewMode block: both now fail tsc at the authoring site and fail '
    + 'the parse with the prescription (pinned in '
    + 'kernel/preview-mode-retirement.test.ts). Concretely, check three '
    + "places. (1) Host boot code composing a KernelContext: delete `mode: "
    + "'preview'` (mode defaults to production; use development for local "
    + 'demo work) and delete any previewMode block — neither ever changed '
    + 'runtime behaviour, so removing them changes nothing observable. '
    + '(2) Code importing PreviewModeConfigSchema, PreviewModeConfig or '
    + 'PreviewModeConfigParsed from @objectstack/spec or @objectstack/spec/'
    + 'kernel: every one is TS2305 after upgrade; no working replacement '
    + 'exists to point at, because the vocabulary described nothing real. '
    + "(3) TypeScript branching on the RuntimeMode type (a mode === "
    + "'preview' arm, a switch over modes): the arm is now unreachable and "
    + 'an exhaustiveness check will fail to compile if it stays — that '
    + 'compile error is the enforced channel for TypeScript consumers. '
    + 'Preview deployment ROUTING is untouched: OS_PREVIEW_MODE and '
    + 'OS_PREVIEW_BASE_DOMAINS keep working exactly as documented '
    + '(deployment routing, never identity).',
};
