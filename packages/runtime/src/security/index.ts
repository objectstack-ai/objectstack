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
