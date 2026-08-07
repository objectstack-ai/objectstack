// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export {
  buildSecurityHeaders,
  type SecurityHeadersOptions,
} from './security-headers.js';
export {
  RateLimiter,
  DEFAULT_RATE_LIMITS,
  applyTokenBucket,
  bucketIdleTtlSeconds,
  type BucketState,
  type RateLimitBucketConfig,
  type RateLimitDecision,
  type RateLimitDefaults,
  type RateLimitStore,
} from './rate-limit.js';
export {
  createInboundRateLimitMiddleware,
  deriveBucketConfig,
  resolveRateLimitKey,
  SharedTokenBucketLimiter,
  type InboundRateLimitBudget,
  type InboundRateLimitOptions,
  type RateLimitKeyInput,
  type RateLimitKeyKind,
  type RateLimitLogger,
} from './inbound-rate-limit.js';
// The dispatch-side arm of the sandbox seam's `ScriptUser` union (#5521).
// Exported as a TYPE only: `ScriptUser` is public, so both its arms must be
// nameable by a consumer that wants to discriminate one — the sibling
// `ScriptSession`'s arms (`ActionSession`, `HookContext['session']`) already
// are, being spec types. The builders stay internal; nothing outside this
// package produces an `ActorUser`, and #5372's whole point is that there is
// exactly ONE producer.
export type { ActorUser } from './actor-user.js';
export {
  API_KEY_PREFIX,
  hashApiKey,
  generateApiKey,
  extractApiKey,
  parseScopes,
  isExpired,
  resolveApiKeyPrincipal,
  type GeneratedApiKey,
  type ApiKeyPrincipal,
} from './api-key.js';
