// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0069 D5/D7 — `objectstack serve` hands the stack's `server.trustProxy`,
// as authored and in either form (`true` or the trusted-network form), to both
// consumers of the client-address rule it composes: `AuthPlugin` (the IP
// allow-list, the login audit, the vendored library's limiter) and the
// dispatcher's inbound rate limiter. Each reads the value with the rule's own
// `readTrustProxy` (`@objectstack/plugin-auth/client-address`). A reader here
// that narrows the value to a boolean drops the trusted-network form on the
// floor, and the consumer then trusts no proxy at all.
//
// Two halves. The construction half scans `serve.ts` with comments masked, as
// the sibling `serve-auth-*.contract.test.ts` files do: AuthPlugin is imported
// through a variable specifier, so the type checker cannot see the literal.
// The reading half hands both consumers the trusted-network form, the way
// `serve` hands it over, and reads the declared trust back.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthManager } from '@objectstack/plugin-auth';
import { createDispatcherPlugin } from '@objectstack/runtime';
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVE_SOURCE = maskComments(readFileSync(path.resolve(HERE, 'serve.ts'), 'utf8'));
const normalise = (text: string) => text.replace(/\s+/g, '');

const NETWORKS = { networks: ['10.0.0.0/8'], header: 'x-forwarded-for' as const };

describe('serve hands server.trustProxy to its consumers as authored', () => {
  it('narrows no reading of trustProxy to a boolean', () => {
    expect(normalise(SERVE_SOURCE)).not.toMatch(/trustProxy[^,;)]*===true/);
  });

  it('hands AuthPlugin and the dispatcher the authored value', () => {
    const source = normalise(SERVE_SOURCE);
    expect(source).toContain('trustProxy:(configasany).server?.trustProxy,');
    expect(source).toContain('trustProxy:serverConfig.trustProxy,');
  });

  it('both consumers read the trusted-network form as a declared trust', () => {
    const manager = new AuthManager({
      secret: 'a-test-secret-that-is-at-least-32-chars-long',
      baseUrl: 'http://localhost:3000',
      trustProxy: NETWORKS,
    } as any);
    expect(manager.trustsForwardedHeaders()).toBe(true);
    expect(manager.resolveClientAddress({
      headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' },
      remoteAddress: '10.0.0.2',
    })).toBe('203.0.113.9');
    // The dispatcher reads the value when it is created, and refuses a malformed form there.
    expect(() => createDispatcherPlugin({ rateLimit: { trustProxy: NETWORKS } })).not.toThrow();
    expect(() => createDispatcherPlugin({ rateLimit: { trustProxy: { networks: [] } as never } })).toThrow(/`networks`/);
  });
});
