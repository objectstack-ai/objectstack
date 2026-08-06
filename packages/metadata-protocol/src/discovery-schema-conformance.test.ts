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
import {
  ApiRoutesSchema,
  DiscoverySchema,
  GetDiscoveryResponseSchema,
  WELL_KNOWN_CAPABILITY_KEYS,
} from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './index.js';

/** The keys the protocol declares for a discovery response (canonical + declared alias). */
function declaredResponseKeys(): Set<string> {
  return new Set(Object.keys((GetDiscoveryResponseSchema as any).shape));
}

/**
 * [#5679] The keys `ApiRoutesSchema` declares INSIDE `routes` — the #4828 gate
 * extended one level down, where `routes.mcp` had been living undeclared.
 *
 * Unlike the REST and dispatcher gates, this one was ALREADY green before
 * #5679: this builder's `routes` is annotated `const routes: ApiRoutes`, so
 * the compiler kept it inside the declared key set and it never grew an `mcp`.
 * It is added anyway so all three producers carry the same gate — this is the
 * producer the OTHER two compose over, and the one place where an undeclared
 * routes key would today be caught by `tsc` rather than by a test.
 */
function declaredRouteKeys(): Set<string> {
  return new Set(Object.keys((ApiRoutesSchema as any).shape));
}

/**
 * [#5672] The capability vocabulary, taken from the spec's own key list.
 *
 * Derived, never hand-listed — same discipline as `declaredResponseKeys` and
 * `declaredRouteKeys` above. A gate that spells the vocabulary itself is a
 * fourth dialect of the contract and drifts the moment a key is added.
 */
function declaredCapabilityKeys(): Set<string> {
  return new Set(WELL_KNOWN_CAPABILITY_KEYS as readonly string[]);
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

  it('[#5679] emits NO `routes` key the schema does not declare', async () => {
    const discovery: any = await makeImpl().getDiscovery();

    const declared = declaredRouteKeys();
    const undeclared = Object.keys(discovery.routes).filter(k => !declared.has(k));
    expect(undeclared, 'undeclared keys inside `routes` on the getDiscovery() shape').toEqual([]);
  });

  it('[#5679] does NOT advertise `mcp` — this builder knows nothing about the /mcp mount', async () => {
    const discovery: any = await makeImpl().getDiscovery();

    // The negative half of the same fact: `mcp` is now DECLARED (optional), and
    // this producer legitimately leaves it empty — the /mcp route is mounted by
    // the host (rest-server) or gated on the kernel's mcp service (dispatcher),
    // neither of which this builder can see. Declaring the key does not oblige
    // every producer to fill it; it obliges every producer that fills it to
    // spell it this way.
    expect(Object.prototype.hasOwnProperty.call(discovery.routes, 'mcp')).toBe(false);
    expect(declaredRouteKeys().has('mcp')).toBe(true);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // [#5672] Fullness: the vocabulary, whole, from every producer
  // ═════════════════════════════════════════════════════════════════════════
  //
  // The #4828 gate above judges the shape; #5679 extended it one level into
  // `routes`. This is the same move into `capabilities`, plus the one criterion
  // neither of those needed: COMPLETENESS. `routes.mcp` is legitimately absent
  // from a producer that cannot know it — a capability never is, because ruling
  // A gives "cannot deliver" a spelling of its own (`enabled: false`).
  //
  // Three criteria, deliberately separate questions:
  //   1. every vocabulary key present   — the split this issue is about;
  //   2. every `enabled` a real boolean — no truthy string / undefined slipping
  //      through as a capability claim;
  //   3. no key outside the vocabulary  — the KEY question `safeParse` cannot
  //      answer, because a zod object strips unknown keys (the #5679 lesson).
  describe('[#5672] the capability vocabulary is emitted in full', () => {
    it('emits EVERY declared capability key — undelivered means `enabled: false`, never absent', async () => {
      const discovery: any = await makeImpl().getDiscovery();

      const missing = [...declaredCapabilityKeys()].filter(
        k => !Object.prototype.hasOwnProperty.call(discovery.capabilities, k),
      );
      expect(missing, 'capability keys the getDiscovery() shape fails to emit').toEqual([]);
    });

    it('reports every capability with a boolean `enabled`', async () => {
      const discovery: any = await makeImpl().getDiscovery();

      const nonBoolean = Object.entries(discovery.capabilities as Record<string, any>)
        .filter(([, v]) => typeof v?.enabled !== 'boolean')
        .map(([k, v]) => `${k}: ${typeof v?.enabled}`);
      expect(nonBoolean, 'capability entries whose `enabled` is not a boolean').toEqual([]);
    });

    it('emits NO capability key the vocabulary does not declare', async () => {
      const discovery: any = await makeImpl().getDiscovery();

      const declared = declaredCapabilityKeys();
      const undeclared = Object.keys(discovery.capabilities).filter(k => !declared.has(k));
      expect(undeclared, 'undeclared keys inside `capabilities` on the getDiscovery() shape').toEqual([]);
    });

    it('anti-vacuity: the vocabulary really does span BOTH producers\' historical halves', async () => {
      const discovery: any = await makeImpl().getDiscovery();

      // Without this the three gates above would pass on a vocabulary that had
      // quietly shrunk back to one producer's half. `websockets` was the
      // dispatcher's alone before #5672 and `transactionalBatch` this
      // builder's; both must now be answered here.
      expect(discovery.capabilities.transactionalBatch.enabled).toBe(false); // no transaction() on this stub engine
      expect(discovery.capabilities.websockets.enabled).toBe(false);
      expect(declaredCapabilityKeys().size).toBeGreaterThanOrEqual(13);
    });
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
