// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `server:` — the authorable half of the inbound rate-limit seam (#4910).
 *
 * These assertions are about the AUTHORING contract only: what a stack may
 * write, what it may not, and what the parse hands the runtime. That the
 * declaration then produces a 429 is proven where it happens —
 * `packages/runtime/src/dispatcher-plugin.rate-limit.integration.test.ts`
 * boots a real server and drives it over a socket. Two halves, deliberately:
 * this issue exists because a schema and an executor were each tested alone
 * and nobody tested that they were connected.
 */

import { describe, it, expect } from 'vitest';

import { defineStack } from '../stack.zod';
import {
  StackServerConfigSchema,
  ServerRateLimitConfigSchema,
} from './stack-server.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';

const manifest = {
  id: 'com.example.rate-limit',
  name: 'Rate limit fixture',
  version: '1.0.0',
  type: 'app' as const,
};

describe('server: reaches the runtime through defineStack', () => {
  it('survives the strict stack parse instead of being stripped', () => {
    const stack = defineStack({
      manifest,
      server: {
        security: { rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 5 } },
        trustProxy: true,
      },
    } as never);

    // The whole point of declaring the key: before #4910 `server:` was an
    // undeclared key, so `defineStack` dropped it silently and the CLI had
    // nothing to read.
    expect((stack as Record<string, unknown>).server).toEqual({
      security: { rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 5 } },
      trustProxy: true,
    });
  });

  it('is optional — a stack that declares nothing gets nothing', () => {
    const stack = defineStack({ manifest } as never);
    expect((stack as Record<string, unknown>).server).toBeUndefined();
  });

  it('is declared on the stack schema itself (so the unknown-key lint stays quiet)', () => {
    expect(Object.keys((ObjectStackDefinitionSchema as never as { shape: object }).shape))
      .toContain('server');
  });
});

describe('server: carries only keys with a consumer (#4938 stays shut)', () => {
  it('declares exactly `security` and `trustProxy`', () => {
    // The hard constraint from the 2026-08-03 adjudication. If this list grows,
    // the new key must have arrived with an executor — the whole reason the
    // nine-key HttpServerConfigSchema was NOT mounted here.
    expect(Object.keys((StackServerConfigSchema as never as { shape: object }).shape).sort())
      .toEqual(['security', 'trustProxy']);
  });

  it.each([
    ['port', /objectstack serve -p/],
    ['host', /belongs to the deployment/],
    ['compression', /retired in v17/],
    ['requestTimeout', /retired in v17/],
    ['bodyLimit', /retired in v17/],
    ['static', /transport plugin/],
    ['cors', /OS_CORS_ORIGIN/],
  ])('rejects the unconsumed HttpServerConfig key `%s` with a prescription', (key, expected) => {
    const result = StackServerConfigSchema.safeParse({ [key]: 1 });
    expect(result.success).toBe(false);
    const message = result.error!.issues.map((i) => i.message).join('\n');
    expect(message).toMatch(/Unrecognized key/);
    expect(message).toMatch(expected);
    // Since #4938 these seven are not merely "not mounted here" — the shape
    // that declared them is GONE, and this strict guidance map is the only
    // surface left that answers for them. That is why the retirement needed no
    // `retiredKey()` tombstone; if this assertion ever stops holding, the
    // prescription has drifted away from the removal it stands in for.
    expect(message).toMatch(/retired in v17/);
  });
});

describe('server.security.rateLimit is strict from birth (#4001)', () => {
  it('accepts every declared key', () => {
    expect(ServerRateLimitConfigSchema.parse({ enabled: true, windowMs: 1000, maxRequests: 3 }))
      .toEqual({ enabled: true, windowMs: 1000, maxRequests: 3 });
  });

  it('applies the shared defaults when only `enabled` is written', () => {
    expect(ServerRateLimitConfigSchema.parse({ enabled: true }))
      .toEqual({ enabled: true, windowMs: 60_000, maxRequests: 100 });
  });

  it('rejects a near-miss and names the key it meant', () => {
    const result = ServerRateLimitConfigSchema.safeParse({ enabled: true, max: 5 });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/`max` → `maxRequests`/);
  });

  it('rejects a budget that can never admit a request', () => {
    // `.int()` alone accepts 0 — and a zero-capacity bucket denies everything,
    // including health checks. Caught at AUTHORING, where the fix is one edit
    // away, rather than at boot or (worse) in production traffic.
    const result = ServerRateLimitConfigSchema.safeParse({ enabled: true, maxRequests: 0 });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['maxRequests']);
    expect(result.error!.issues[0]!.message).toMatch(/set `enabled: false`/);
  });

  it('rejects a zero window', () => {
    const result = ServerRateLimitConfigSchema.safeParse({ enabled: true, windowMs: 0 });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['windowMs']);
    expect(result.error!.issues[0]!.message).toMatch(/MILLISECONDS/);
  });
});

describe('server.trustProxy defaults to not believing the caller', () => {
  it('is false when unwritten', () => {
    expect(StackServerConfigSchema.parse({})).toEqual({ trustProxy: false });
  });

  it('describes what declaring it means, so the security choice is reviewable', () => {
    const description = (StackServerConfigSchema as never as {
      shape: Record<string, { description?: string }>;
    }).shape.trustProxy.description ?? '';
    expect(description).toMatch(/X-Forwarded-For/);
    expect(description).toMatch(/reverse proxy you control/);
  });

  it('documents the key shape on the rateLimit describe (Q3, reviewable in the schema)', () => {
    const description = (StackServerConfigSchema as never as {
      shape: Record<string, { unwrap(): { shape: Record<string, { description?: string }> } }>;
    }).shape.security.unwrap().shape.rateLimit.description ?? '';
    expect(description).toMatch(/RESOLVED PRINCIPAL/);
    expect(description).toMatch(/falling back to the caller IP/);
    expect(description).toMatch(/Retry-After/);
  });
});
