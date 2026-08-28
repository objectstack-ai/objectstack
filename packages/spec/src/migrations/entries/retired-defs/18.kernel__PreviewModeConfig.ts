// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11846 — `kernel/PreviewModeConfig` (the six-key preview/demo config block:
// `autoLogin` default true, `simulatedRole` default 'admin',
// `simulatedUserName`, `readOnly`, `expiresInSeconds`, `bannerMessage`). Its
// only carrier key, `KernelContext.previewMode`, is tombstoned in this same
// major (both walked-shape copies — see the two `…:previewMode` entries in
// RETIRED_KEYS_BY_MAJOR[18]), and an exported value schema with no consumer
// reads as a capability (#3950, the `PerformanceConfigSchema` rule) — so the
// def leaves the emitted set whole, with its `PreviewModeConfig` /
// `PreviewModeConfigParsed` types. Measured before removal: zero consumers of
// the schema or any of its six keys in objectstack, objectui or cloud
// (cloud#1651, 2026-08-26, positive controls on record). The declared
// behaviour (auto-login as a simulated admin, a read-only demo session) was
// never implemented by any layer; preview DEPLOYMENTS belong to the
// deployment layer, whose `OS_PREVIEW_MODE` is routing-only and stays. If a
// preview experience becomes a product capability it re-declares fresh, with
// the production-posture hard-refusal as the first-landed half (#11846 ruling
// record).
export const entry = 'kernel/PreviewModeConfig';
