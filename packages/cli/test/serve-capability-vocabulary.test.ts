import { describe, expect, it } from 'vitest';
import { PLATFORM_CAPABILITY_TOKENS } from '@objectstack/spec/kernel';
import Serve from '../src/commands/serve.js';

// framework#3265 — drift guard: the serve path's provider registries must stay
// inside the spec-owned platform capability vocabulary, so the standalone
// runtime and cloud's objectos-runtime keep resolving the SAME token set.

describe('serve capability registries vs spec vocabulary (#3265)', () => {
  it('every CAPABILITY_PROVIDERS token is in PLATFORM_CAPABILITY_TOKENS', () => {
    for (const token of Object.keys(Serve.CAPABILITY_PROVIDERS)) {
      expect(PLATFORM_CAPABILITY_TOKENS, `provider token '${token}' missing from spec vocabulary`).toContain(token);
    }
  });

  it('every CAPABILITY_TO_TIER token is in PLATFORM_CAPABILITY_TOKENS', () => {
    for (const token of Object.keys(Serve.CAPABILITY_TO_TIER)) {
      expect(PLATFORM_CAPABILITY_TOKENS, `tier token '${token}' missing from spec vocabulary`).toContain(token);
    }
  });

  it('registries use only canonical spellings — never the removed camelCase aliases (#3308)', () => {
    const legacy = ['aiStudio', 'aiSeat'];
    for (const token of [...Object.keys(Serve.CAPABILITY_PROVIDERS), ...Object.keys(Serve.CAPABILITY_TO_TIER)]) {
      expect(legacy).not.toContain(token);
    }
  });

  it('tier-gated and provider-backed tokens do not overlap (each token has ONE resolution path)', () => {
    const providerTokens = new Set(Object.keys(Serve.CAPABILITY_PROVIDERS));
    for (const tierToken of Object.keys(Serve.CAPABILITY_TO_TIER)) {
      expect(providerTokens.has(tierToken)).toBe(false);
    }
  });

  it('ALWAYS_ON_CAPABILITIES stays inside the vocabulary too', () => {
    for (const token of Serve.ALWAYS_ON_CAPABILITIES) {
      expect(PLATFORM_CAPABILITY_TOKENS).toContain(token);
    }
  });
});
