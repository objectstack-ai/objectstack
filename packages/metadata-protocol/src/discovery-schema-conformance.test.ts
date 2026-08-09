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

import { describe, it, expect, afterEach } from 'vitest';
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
  // [#6633] The direct-mount surface keys: `packages` flows, `datasources`
  // deliberately does not
  // ═════════════════════════════════════════════════════════════════════════
  describe('[#6633] direct-mount surface keys', () => {
    it('advertises `routes.packages` iff the `package` service is registered', async () => {
      // Registered — the same predicate that gates the @objectstack/rest
      // direct-mount registrar (`direct-mount-composition.ts`), so on the host
      // that serves this builder's shape, advertised ⇔ mounted.
      const withPackage: any = await makeImpl(new Map([['package', {}]])).getDiscovery();
      expect(withPackage.routes.packages).toBe('/api/v1/packages');

      // Absent — nothing mounts the surface for this boot, so the key is
      // absent, never a promise of a 404 (ADR-0076 D12).
      const without: any = await makeImpl().getDiscovery();
      expect(Object.prototype.hasOwnProperty.call(without.routes, 'packages')).toBe(false);
    });

    it('does NOT advertise `datasources` — this builder knows nothing about the federation mount', async () => {
      // Same disposition as `mcp` above: the `datasources/:name/external/*`
      // family is mounted by the REST host (unconditionally, 503-degrading),
      // which this builder cannot see — and the runtime dispatcher serves no
      // /datasources domain at all. Even a registered `external-datasource`
      // service says nothing about an HTTP mount, so advertising here would be
      // the advertise-the-unmounted half of D12. The REST discovery endpoint
      // advertises it from its recorded direct mounts.
      const discovery: any = await makeImpl(
        new Map([['external-datasource', {}]]),
      ).getDiscovery();

      expect(Object.prototype.hasOwnProperty.call(discovery.routes, 'datasources')).toBe(false);
      expect(declaredRouteKeys().has('datasources')).toBe(true);
    });

    it('[#6714] does NOT advertise `email` — this builder knows nothing about the email mount', async () => {
      // Same disposition as `datasources` above: `registerEmailEndpoints`
      // mounts `POST {base}/email/send` on the REST host (unconditionally,
      // 501-degrading when no email service is configured), which this builder
      // cannot see — and the runtime dispatcher serves no /email domain at
      // all. Advertising here would be the advertise-the-unmounted half of
      // ADR-0076 D12. The REST discovery endpoint advertises it from its
      // recorded route registrations.
      const discovery: any = await makeImpl().getDiscovery();

      expect(Object.prototype.hasOwnProperty.call(discovery.routes, 'email')).toBe(false);
      expect(declaredRouteKeys().has('email')).toBe(true);
    });
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

  // ═══════════════════════════════════════════════════════════════════════════
  // [#5936] The unset-NODE_ENV default, asserted on THIS producer
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // `/discovery` has two producers. #5673 ruled that a deployment whose operator
  // never set `NODE_ENV` must not call itself `development` — `environment` is
  // machine-readable and a client may loosen a destructive action's
  // confirmation on it — but that dispatch was scoped to the runtime dispatcher
  // and forbade touching `packages/spec`, so the default landed at that
  // producer's own call site and THIS producer went on answering `development`
  // for the same input. The 2026-08-07 ruling (direction 1) folded the default
  // into `resolveDiscoveryEnvironment`, which is what makes one decision reach
  // both.
  //
  // This case is the half a mapper test cannot cover: that this producer passes
  // the operator's value through AS READ and adds no default of its own. Its
  // sibling lives in `packages/runtime/src/discovery-schema-conformance.test.ts`
  // and asserts the identical fact about the dispatcher — the pair is what makes
  // "the two producers agree" a checked fact rather than a comment.
  //
  // Reverse verification, direction predicted BEFORE running — and the
  // interesting part is that the two revert shapes go DIFFERENT ways:
  //
  //   * Revert the whole change (the mapper back to `development` for a
  //     non-string AND the dispatcher back to `getEnv('NODE_ENV', 'production')`)
  //     and the two unset rows HERE go RED reading `development` while the
  //     runtime's sibling rows stay GREEN. That asymmetry IS the bug #5936
  //     reports, reproduced on demand.
  //   * Revert only the mapper and BOTH producers go red, because the
  //     dispatcher no longer carries a default of its own to fall back on —
  //     which is the point of the consolidation, stated as a test outcome.
  //
  // The unrecognised-spelling rows stay green under every revert; they are
  // #4828's rule, which this change deliberately leaves alone.
  describe('[#5936] NODE_ENV defaults are the shared mapper\'s decision, not this producer\'s', () => {
    const OLD_NODE_ENV = process.env.NODE_ENV;
    afterEach(() => {
      if (OLD_NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = OLD_NODE_ENV;
    });

    it.each([
      ['unset', undefined],
      // `NODE_ENV=` exports an empty string; the mapper reads a blank value as
      // "the host did not say", the same absence `os serve` / `os doctor` and
      // the runtime producer already read as production.
      ['empty', ''],
    ])('NODE_ENV %s advertises production — never development', async (_label, raw) => {
      if (raw === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = raw;

      const discovery: any = await makeImpl().getDiscovery();

      expect(discovery.environment).toBe('production');
      expect(DiscoverySchema.safeParse(discovery).success).toBe(true);
    });

    // [#6287] `preview` left this list when it stopped being unrecognised: it is
    // a declared `EnvironmentTypeSchema` member and now has a stated fold
    // (`sandbox`), so asserting `development` for it here would assert the
    // opposite of the mapper's decision. The RULE these rows pin — an unknown
    // spelling degrades to `development` and never claims production — is
    // unchanged; only the examples had to be ones that are genuinely unknown.
    it.each(['qa', 'uat', 'nonsense'])(
      'NODE_ENV=%s is an unrecognised spelling — still development, never production (#4828)',
      async (raw) => {
        process.env.NODE_ENV = raw;

        const discovery: any = await makeImpl().getDiscovery();

        expect(discovery.environment).toBe('development');
      },
    );

    it.each([
      ['test', 'development'],
      ['staging', 'sandbox'],
      ['production', 'production'],
    ])('NODE_ENV=%s advertises %s — the same table the dispatcher reads', async (raw, expected) => {
      process.env.NODE_ENV = raw;

      const discovery: any = await makeImpl().getDiscovery();

      expect(discovery.environment).toBe(expected);
    });
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
