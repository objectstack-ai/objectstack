import { describe, expect, it } from 'vitest';
import {
  PLATFORM_CAPABILITY_TOKENS,
  isKnownPlatformCapability,
} from './platform-capabilities';

// framework#3265 — one capability vocabulary across the standalone serve path
// and cloud's objectos-runtime loader, canonical spelling kebab-case. The
// deprecated `aiStudio`/`aiSeat` aliases were removed in #3308.

describe('PLATFORM_CAPABILITY_TOKENS', () => {
  it('is frozen and duplicate-free', () => {
    expect(Object.isFrozen(PLATFORM_CAPABILITY_TOKENS)).toBe(true);
    expect(new Set(PLATFORM_CAPABILITY_TOKENS).size).toBe(PLATFORM_CAPABILITY_TOKENS.length);
  });

  it('every token is canonical lower-case kebab-case', () => {
    for (const t of PLATFORM_CAPABILITY_TOKENS) {
      expect(t).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('contains the tier-gated and headline service tokens', () => {
    for (const t of ['ai', 'ai-studio', 'automation', 'analytics', 'pinyin-search', 'hierarchy-security']) {
      expect(PLATFORM_CAPABILITY_TOKENS).toContain(t);
    }
  });

  it('contains no camelCase legacy spellings (aliases removed, #3308)', () => {
    for (const legacy of ['aiStudio', 'aiSeat']) {
      expect(PLATFORM_CAPABILITY_TOKENS).not.toContain(legacy);
    }
  });
});

describe('isKnownPlatformCapability', () => {
  it('accepts canonical tokens verbatim', () => {
    expect(isKnownPlatformCapability('ai-studio')).toBe(true);
    expect(isKnownPlatformCapability('ai-seat')).toBe(true);
    expect(isKnownPlatformCapability('governance')).toBe(true);
  });

  it('rejects the removed camelCase aliases and typos (no canonicalization, #3308)', () => {
    expect(isKnownPlatformCapability('aiStudio')).toBe(false);
    expect(isKnownPlatformCapability('aiSeat')).toBe(false);
    expect(isKnownPlatformCapability('automations')).toBe(false);
  });
});
