// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Platform SERVICE capability vocabulary — the canonical tokens accepted in a
 * stack's `requires: [...]` declaration (framework#3265).
 *
 * ONE vocabulary across every runtime that resolves `requires`: the standalone
 * `os serve` / `os start` path (`@objectstack/cli`) and cloud's multi-tenant
 * `objectos-runtime` capability loader. Both loaders key their provider
 * registries by these tokens, so a stack declaration means the same thing
 * wherever it boots. (These are platform SERVICE capabilities — NOT the
 * ADR-0066 authorization capabilities declared in `capabilities: [...]`.)
 *
 * Canonical spelling is lower-case kebab-case (`ai-studio`, `pinyin-search`,
 * `hierarchy-security`). The legacy camelCase spellings (`aiStudio` / `aiSeat`)
 * that shipped transitionally were honored as deprecated aliases for one cycle
 * (framework#3265) and have been REMOVED (framework#3308) — they are now plain
 * unknown tokens, rejected by `defineStack` like any other typo.
 *
 * Growing the platform: when a new `requires`-resolvable service ships, add
 * its token HERE as well as to the runtime's provider registry — the CLI's
 * vocabulary-drift test fails if the registries and this list fall out of
 * sync. An unknown token is REJECTED by `defineStack` at authoring time
 * (framework#3265) — the vocabulary is the union of every token the framework
 * CLI and cloud's objectos-runtime resolve, so a token outside it is a typo or
 * stale reference no runtime provides (Prime Directive #12: surface producer
 * mistakes at authoring, loudly). The serve resolver still only WARNS on an
 * unknown token in a raw artifact — a pre-built/older-spec artifact must not
 * crash-boot a running server over a no-op token; authoring is the gate.
 */
export const PLATFORM_CAPABILITY_TOKENS: readonly string[] = Object.freeze([
  // Tier-gated capabilities (framework `serve.ts` CAPABILITY_TO_TIER)
  'ai',
  'ai-studio',
  'i18n',
  'ui',
  'auth',
  // Service capabilities (framework `serve.ts` CAPABILITY_PROVIDERS)
  'automation',
  'analytics',
  'audit',
  'cache',
  'storage',
  'queue',
  'job',
  'messaging',
  'triggers',
  'realtime',
  'mcp',
  'marketplace',
  'email',
  'sms',
  'sharing',
  'pinyin-search',
  'reports',
  'approvals',
  'settings',
  'webhooks',
  // Enterprise / cloud-runtime capabilities (no open-edition provider:
  // `hierarchy-security` ships in @objectstack/security-enterprise via
  // `plugins[]`; `ai-seat` / `governance` are resolved by cloud's
  // objectos-runtime loader only)
  'hierarchy-security',
  'ai-seat',
  'governance',
]);

/**
 * True when the token is part of the platform capability vocabulary. There is
 * no longer any alias canonicalization (framework#3308) — a token is known iff
 * it appears verbatim in {@link PLATFORM_CAPABILITY_TOKENS}.
 */
export function isKnownPlatformCapability(token: string): boolean {
  return PLATFORM_CAPABILITY_TOKENS.includes(token);
}
