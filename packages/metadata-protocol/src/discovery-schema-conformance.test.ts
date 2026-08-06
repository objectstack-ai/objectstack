// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#4828] The discovery surface is machine-readable (AGENTS.md "Route & surface
// ownership" #4: machine-readable surfaces must not lie), and until this issue
// NOTHING compared what a producer actually emits against what the spec
// declares. `GetDiscoveryResponseSchema` — the only schema the protocol layer
// referenced — is `DiscoverySchema.partial().required({version}).extend({apiName})`,
// and a zod object strips unknown keys by default. So BOTH failure directions
// were swallowed at once:
//
//   1. missing REQUIRED keys — `.partial()` made `name`/`environment`/`locale`
//      optional, so this producer never emitting them parsed clean;
//   2. UNDECLARED keys — the default strip made `features` / `endpoints`
//      (emitted by the runtime dispatcher) parse clean too.
//
// The maintainer's 2026-08-05 ruling makes `DiscoverySchema` authoritative:
// every producer fills the required keys. These tests are that gate for the
// `getDiscovery()` producer; `packages/runtime` and `packages/rest` carry the
// sibling gates for the other two shapes.
//
// The two assertions are deliberately different questions (key vs value):
//
//   * `DiscoverySchema.parse()` judges VALUES — required keys present,
//     `environment` inside its declared enum, `scoping` well-formed.
//   * the key-set subset check judges KEYS — nothing is emitted that the
//     protocol never declared. Its allowed set is exactly
//     `GetDiscoveryResponseSchema`'s shape, i.e. `DiscoverySchema`'s keys plus
//     the one declared deprecated alias (`apiName`). Deriving the allowance
//     from the schema instead of a hand-listed array is what stops this gate
//     from becoming a third dialect of the contract.

import { describe, it, expect } from 'vitest';
import { DiscoverySchema, GetDiscoveryResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './index.js';

/** The keys the protocol declares for a discovery response (canonical + declared alias). */
function declaredResponseKeys(): Set<string> {
  return new Set(Object.keys((GetDiscoveryResponseSchema as any).shape));
}

/**
 * A protocol impl over a minimal engine. `getDiscovery()` reads
 * `engine.registry` (for `sys_comment`), `engine.transaction` (for
 * `transactionalBatch`) and the services registry — nothing else.
 */
function makeImpl(services: Map<string, any> = new Map()) {
  const engine = {
    registry: {
      getObject: (_name: string) => undefined,
      getRegisteredTypes: () => [],
    },
  };
  return new ObjectStackProtocolImplementation(engine as any, () => services);
}

describe('[#4828] getDiscovery() conforms to DiscoverySchema', () => {
  it('emits every REQUIRED key the spec declares (name / environment / locale)', async () => {
    const discovery = await makeImpl().getDiscovery();

    const result = DiscoverySchema.safeParse(discovery);
    expect(
      result.success ? [] : result.error.issues.map(i => `${i.path.join('.')}: ${i.code}`),
      'getDiscovery() must satisfy the canonical DiscoverySchema',
    ).toEqual([]);
  });

  it('emits NO key the protocol does not declare', async () => {
    const discovery = await makeImpl().getDiscovery();

    const declared = declaredResponseKeys();
    const undeclared = Object.keys(discovery).filter(k => !declared.has(k));
    expect(undeclared, 'undeclared top-level keys on the getDiscovery() shape').toEqual([]);
  });

  it('carries the canonical `name`, and keeps `apiName` for its deprecation window', async () => {
    const discovery: any = await makeImpl().getDiscovery();

    // Canonical (required by DiscoverySchema).
    expect(discovery.name).toBe('ObjectStack API');
    // Deprecated alias — still emitted so a client pinned to it (the
    // `01-discovery.test.ts` integration assertion) keeps working until the
    // scheduled removal. Both spellings must name the SAME thing.
    expect(discovery.apiName).toBe(discovery.name);
  });

  it('reports an `environment` inside the declared enum', async () => {
    const discovery: any = await makeImpl().getDiscovery();

    expect(['production', 'sandbox', 'development']).toContain(discovery.environment);
  });

  it('reports a `locale` block derived from the i18n service when one is registered', async () => {
    const services = new Map<string, any>([
      ['i18n', {
        getDefaultLocale: () => 'zh-CN',
        getLocales: () => ['zh-CN', 'en'],
      }],
    ]);
    const discovery: any = await makeImpl(services).getDiscovery();

    expect(discovery.locale.default).toBe('zh-CN');
    expect(discovery.locale.supported).toEqual(['zh-CN', 'en']);
  });
});
