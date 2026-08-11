// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #7481 — the sibling of `api/AuthFeaturesConfig:passkeys`, retired in the same
// maintainer ruling (2026-08-11) and for the same reason, but with one
// difference a reader of this table must not lose: what was inert here is the
// ADVERTISEMENT, not the capability. `AuthPluginConfig.plugins.magicLink` still
// wires better-auth's magic-link plugin and `/api/v1/auth/magic-link/{send,verify}`
// still answer — no client just renders anything off the served flag, so the
// flag alone was the false promise. The prescription says so explicitly rather
// than reusing its sibling's string.
//
// Same response-surface disposition as its sibling: no D2 conversion (nothing
// authors an `AuthFeaturesConfig`), prescription carried by this tombstone plus
// the D3 semantic entry `auth-config-unadvertised-reserved-features`.
export const entry = 'api/AuthFeaturesConfig:magicLink';
