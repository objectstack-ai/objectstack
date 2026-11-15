// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/core/egress` — the outbound-request guard: one policy seam
 * ({@link EgressPolicy}), its open-core default ({@link createEnvEgressPolicy},
 * reading `OS_EGRESS_ALLOWED_TARGETS`), and the guarded fetch every request a
 * tenant can aim goes through. A separate entry so the main kernel entry does
 * not load the HTTP client.
 */
export * from './egress/address.js';
export * from './egress/policy.js';
export * from './egress/guarded-fetch.js';
