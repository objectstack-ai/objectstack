// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The turso/libSQL config contract (#6345).
 *
 * These assertions are what "`validateDriverConfig('turso')` flipped from
 * `{ known: false }` to `{ known: true }`" MEANS in practice: before this file
 * every one of the rejections below was an acceptance, because the platform had
 * no shape to judge a libSQL `config` against.
 */

import { describe, expect, it } from 'vitest';

import { DatasourceSchema } from '../datasource.zod';
import { validateDriverConfig } from './config-registry.zod';
import { TursoConfigSchema, TursoDriverSpec } from './turso.zod';

describe('TursoConfigSchema', () => {
  it('accepts the shapes the driver actually connects with', () => {
    // `{ url, authToken }` left this list in #7990: an inline `authToken` is
    // refused at authoring (driver-credential-refusal.test.ts pins it). The
    // remote-with-credential shape is authored as `{ url }` +
    // `external.credentialsRef`; the boot hosts' env-resolved token never
    // passes through this schema.
    for (const config of [
      { url: 'libsql://my-db.turso.io' },
      { url: 'file:./data/objectstack.db' },
      { url: ':memory:' },
      { url: 'file:./local.db', syncUrl: 'libsql://my-db.turso.io', sync: { intervalSeconds: 60 } },
      { url: 'libsql://x.turso.io', concurrency: 10, timeoutMs: 5000, mode: 'remote' },
    ]) {
      const result = TursoConfigSchema.safeParse(config);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    }
  });

  // `url` is the fact that makes `hasLocalDefault: false` true for turso, and
  // the reason both boot hosts refuse a turso selection with no URL.
  it('REQUIRES url — there is no libSQL endpoint to guess', () => {
    expect(TursoConfigSchema.safeParse({}).success).toBe(false);
    expect(TursoConfigSchema.safeParse({ authToken: 'jwt' }).success).toBe(false);
  });

  // The exact failure this contract was written for: `token` is the plausible
  // spelling, `authToken` is the real one, and before #6345 the misspelling was
  // accepted in silence and the connection attempted unauthenticated. Until
  // #7990 the fix was a rename hint onto `authToken`; now that `authToken` is
  // itself unwritable the same spelling gets the credential refusal directly —
  // a rename hint would send the author into a second rejection.
  it('rejects `token` with the inline-credential refusal, not a rename hint', () => {
    const result = TursoConfigSchema.safeParse({ url: 'libsql://x.turso.io', token: 'jwt' });
    expect(result.success).toBe(false);
    const issues = JSON.stringify(result.error?.issues);
    expect(issues).toContain('credentialsRef');
    expect(issues).toContain('sys_secret');
    expect(issues).not.toContain('Did you mean');
  });

  it('rejects `sync` without `syncUrl` — on its own it configures nothing', () => {
    const result = TursoConfigSchema.safeParse({
      url: 'file:./local.db',
      sync: { intervalSeconds: 60 },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('syncUrl');
  });

  it('points a sqlite-style `filename` at `url` rather than accepting it', () => {
    const result = TursoConfigSchema.safeParse({ filename: './data/objectstack.db' });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('url');
  });
});

describe('turso is a known driver to the config registry now (#6345)', () => {
  it('validateDriverConfig answers `known: true` for both spellings', () => {
    expect(validateDriverConfig('turso', { url: 'libsql://x.turso.io' }))
      .toEqual({ known: true, issues: [] });
    expect(validateDriverConfig('libsql', { url: 'libsql://x.turso.io' }))
      .toEqual({ known: true, issues: [] });
  });

  it('a bad turso config now produces ISSUES instead of `{ known: false }`', () => {
    const result = validateDriverConfig('turso', { token: 'jwt' });
    expect(result.known).toBe(true);
    expect(result.known && result.issues.length).toBeGreaterThan(0);
  });

  // The consumer that matters most: `DatasourceSchema` replays the driver-config
  // parse onto its own issue list, so the flip reaches authored metadata.
  it('DatasourceSchema now judges a turso datasource config', () => {
    expect(DatasourceSchema.safeParse({
      name: 'edge', driver: 'turso', config: { url: 'libsql://x.turso.io' },
    }).success).toBe(true);
    // An inline `authToken` is refused (#7990), re-pathed under the config slot
    // it was written in — driver-credential-refusal.test.ts pins the message.
    expect(DatasourceSchema.safeParse({
      name: 'edge', driver: 'turso', config: { url: 'libsql://x.turso.io', authToken: 'jwt' },
    }).success).toBe(false);
    expect(DatasourceSchema.safeParse({
      name: 'edge', driver: 'turso', config: { token: 'jwt' },
    }).success).toBe(false);
  });
});

describe('TursoDriverSpec', () => {
  it('publishes the canonical id and a projected config schema', () => {
    expect(TursoDriverSpec.id).toBe('turso');
    expect(TursoDriverSpec.label).toBe('Turso / libSQL');
    const json = TursoDriverSpec.configSchema as { type?: string; properties?: Record<string, unknown> };
    expect(json.type).toBe('object');
    expect(Object.keys(json.properties ?? {})).toContain('url');
  });
});

// #15680 (stack card 5/6 of #14478) — ruling B. The old spelling is a
// `retiredKey()` tombstone; asserted on the issue CODE and the prescription,
// never on a bare `toThrow()` — this shape IS `strictObject`, so a bare throw
// assertion passes identically on the unrecognized-key error, which is precisely
// the error that cannot carry a FROM → TO mapping.
describe('TursoConfig.timeout carries its unit (#15680)', () => {
  const base = { url: 'libsql://app.turso.io' };

  it('REFUSES the retired `timeout` with the rename in the message', () => {
    const result = TursoConfigSchema.safeParse({ ...base, timeout: 30000 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'timeout');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`turso config.timeout` was renamed to `timeoutMs`');
  });

  it('accepts `timeoutMs` at the same magnitude and still refuses a non-positive one', () => {
    expect(TursoConfigSchema.parse({ ...base, timeoutMs: 30000 }).timeoutMs).toBe(30000);
    expect(TursoConfigSchema.safeParse({ ...base, timeoutMs: 0 }).success).toBe(false);
  });

  it('leaves `sync.intervalSeconds` alone — it already carried its unit, and is the neighbour that made the bare `timeout` a collision', () => {
    const parsed = TursoConfigSchema.parse({
      ...base,
      syncUrl: 'libsql://replica.turso.io',
      sync: { intervalSeconds: 60 },
    });
    expect(parsed.sync!.intervalSeconds).toBe(60);
  });
});
