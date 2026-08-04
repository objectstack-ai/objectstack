import { describe, it, expect } from 'vitest';
import {
  SharingConfigSchema,
  type SharingConfig,
} from './sharing.zod';

// ---------------------------------------------------------------------------
// SharingConfigSchema
// ---------------------------------------------------------------------------
describe('SharingConfigSchema', () => {
  it('should accept empty config with defaults', () => {
    const config: SharingConfig = SharingConfigSchema.parse({});
    expect(config.enabled).toBe(false);
    expect(config.allowAnonymous).toBe(false);
    expect(config.publicLink).toBeUndefined();
    expect(config.password).toBeUndefined();
    expect(config.allowedDomains).toBeUndefined();
    expect(config.expiresAt).toBeUndefined();
  });

  it('should accept full sharing config', () => {
    const config = SharingConfigSchema.parse({
      enabled: true,
      publicLink: 'https://app.example.com/share/abc123',
      password: 'secret123',
      allowedDomains: ['example.com', 'partner.com'],
      expiresAt: '2027-01-01T00:00:00Z',
      allowAnonymous: true,
    });

    expect(config.enabled).toBe(true);
    expect(config.publicLink).toBe('https://app.example.com/share/abc123');
    expect(config.password).toBe('secret123');
    expect(config.allowedDomains).toEqual(['example.com', 'partner.com']);
    expect(config.expiresAt).toBe('2027-01-01T00:00:00Z');
    expect(config.allowAnonymous).toBe(true);
  });

  it('should accept config with only enabled', () => {
    const config = SharingConfigSchema.parse({ enabled: true });
    expect(config.enabled).toBe(true);
    expect(config.password).toBeUndefined();
  });

  it('should accept config with domain restrictions', () => {
    const config = SharingConfigSchema.parse({
      enabled: true,
      allowedDomains: ['acme.com'],
    });
    expect(config.allowedDomains).toEqual(['acme.com']);
  });

  it('should accept empty allowedDomains array', () => {
    const config = SharingConfigSchema.parse({
      enabled: true,
      allowedDomains: [],
    });
    expect(config.allowedDomains).toEqual([]);
  });
});

// `EmbedConfigSchema` had a describe block here until #5015 removed the schema
// (ADR-0049 enforce-or-remove — no carrier key anywhere, unreachable from every
// metadata root, zero parse outside this file; its would-be carrier `App.embed`
// was itself retired in 17.0.0). Its absence is pinned by symbol identity in
// `notification-embed-retirement.test.ts`, not by the silence here.
//
// `SharingConfigSchema` above is deliberately untouched — it is a LIVE door
// (`FormViewSchema.sharing`, read by `rest-server.ts`). One file, two verdicts.
