// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#4828] The dispatcher's half of the discovery conformance gate. See the
// sibling file in `packages/metadata-protocol` for the full reasoning; in short,
// `GetDiscoveryResponseSchema` is `DiscoverySchema.partial()` and zod strips
// unknown keys, so the ONLY schema the protocol layer referenced could see
// neither a missing required key nor an undeclared emitted one. This dispatcher
// shape was the worst case of both: it emitted `features` and `endpoints`
// (declared nowhere) and passed `NODE_ENV` through raw into a field the spec
// declares as an ENUM.
//
// The `NODE_ENV` half is self-demonstrating here: vitest sets `NODE_ENV=test`,
// which is not a member of `production|sandbox|development`. Before the fix the
// `environment` assertion below fails **in the very run that proves it** — no
// contrived fixture needed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiRoutesSchema,
  DiscoverySchema,
  GetDiscoveryResponseSchema,
  WELL_KNOWN_CAPABILITY_KEYS,
} from '@objectstack/spec/api';
import * as specApi from '@objectstack/spec/api';
import { HttpDispatcher } from './http-dispatcher.js';
import { ROUTE_LEDGER } from './route-ledger.js';

/** The keys the protocol declares for a discovery response (canonical + declared alias). */
function declaredResponseKeys(): Set<string> {
  return new Set(Object.keys((GetDiscoveryResponseSchema as any).shape));
}

/**
 * [#5679] The keys `ApiRoutesSchema` declares INSIDE `routes` — the same gate
 * one level down, where `routes.mcp` had been hiding.
 *
 * This producer emits `mcp` too, contrary to what #5679's issue body assumed:
 * the routes literal below carries `mcp: isMcpServerEnabled() && hasMcp ? … :
 * undefined`, so the KEY is always present (value `undefined` when the service
 * is absent — `JSON.stringify` drops it on the wire, which is why it read as
 * "not emitted"). `Object.keys()` sees it either way, so this gate covers this
 * producer as squarely as the REST one.
 */
function declaredRouteKeys(): Set<string> {
  return new Set(Object.keys((ApiRoutesSchema as any).shape));
}

/** [#5672] The capability vocabulary, derived from the spec — never hand-listed. */
function declaredCapabilityKeys(): Set<string> {
  return new Set(WELL_KNOWN_CAPABILITY_KEYS as readonly string[]);
}

describe('[#4828] getDiscoveryInfo() conforms to DiscoverySchema', () => {
  let dispatcher: HttpDispatcher;

  beforeEach(() => {
    const kernel = {
      context: {
        getService: (name: string) => {
          if (name === 'objectql') {
            return {
              registry: {
                getObject: vi.fn().mockReturnValue({ name: 'test_obj' }),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
                getAllPackages: vi.fn().mockReturnValue([]),
              },
            };
          }
          return null;
        },
      },
    } as any;
    dispatcher = new HttpDispatcher(kernel);
  });

  it('satisfies the canonical DiscoverySchema', async () => {
    const info = await dispatcher.getDiscoveryInfo('/api/v1');

    const result = DiscoverySchema.safeParse(info);
    expect(
      result.success ? [] : result.error.issues.map(i => `${i.path.join('.')}: ${i.code}`),
      'getDiscoveryInfo() must satisfy the canonical DiscoverySchema',
    ).toEqual([]);
  });

  it('emits NO key the protocol does not declare', async () => {
    const info = await dispatcher.getDiscoveryInfo('/api/v1');

    const declared = declaredResponseKeys();
    const undeclared = Object.keys(info).filter(k => !declared.has(k));
    expect(undeclared, 'undeclared top-level keys on the getDiscoveryInfo() shape').toEqual([]);
  });

  it('[#5679] emits NO `routes` key the schema does not declare', async () => {
    const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

    const declared = declaredRouteKeys();
    const undeclared = Object.keys(info.routes).filter(k => !declared.has(k));
    expect(undeclared, 'undeclared keys inside `routes` on the getDiscoveryInfo() shape').toEqual([]);
  });

  it('[#5679] advertises `routes.mcp` when the mcp service is registered and shaped', async () => {
    // Anti-vacuity for the gate above, and the fact the issue body got wrong:
    // this producer DOES emit `routes.mcp`. Gated on the handler's own
    // predicate (`typeof mcp.handleHttpRequest === 'function'`, #4024) — the
    // key is present either way, carrying the path or `undefined`.
    const kernel = {
      context: {
        getService: (name: string) => {
          if (name === 'objectql') {
            return {
              registry: {
                getObject: vi.fn().mockReturnValue({ name: 'test_obj' }),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
                getAllPackages: vi.fn().mockReturnValue([]),
              },
            };
          }
          if (name === 'mcp') return { handleHttpRequest: () => undefined };
          return null;
        },
      },
    } as any;
    const info: any = await new HttpDispatcher(kernel).getDiscoveryInfo('/api/v1');

    expect(info.routes.mcp).toBe('/api/v1/mcp');
    expect(declaredRouteKeys().has('mcp')).toBe(true);
    expect(DiscoverySchema.safeParse(info).success).toBe(true);

    // …and with no mcp service the key stays present but empty, which is the
    // shape `optional` (not `nullable`) declares.
    const withoutMcp: any = await dispatcher.getDiscoveryInfo('/api/v1');
    expect(Object.prototype.hasOwnProperty.call(withoutMcp.routes, 'mcp')).toBe(true);
    expect(withoutMcp.routes.mcp).toBeUndefined();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // [#5672] Fullness: the vocabulary, whole, from every producer
  // ═════════════════════════════════════════════════════════════════════════
  //
  // The sibling gate in `packages/metadata-protocol` carries the full reasoning.
  // This producer is the one that owned the OTHER half of the split: before
  // ruling A it emitted `search`/`websockets`/`files`/`analytics`/`ai`/
  // `notifications`/`i18n` and nothing else, so `client.capabilities
  // .transactionalBatch` was statically `boolean` and actually `undefined`
  // against any dispatcher-served host.
  describe('[#5672] the capability vocabulary is emitted in full', () => {
    it('emits EVERY declared capability key — undelivered means `enabled: false`, never absent', async () => {
      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      const missing = [...declaredCapabilityKeys()].filter(
        k => !Object.prototype.hasOwnProperty.call(info.capabilities, k),
      );
      expect(missing, 'capability keys the getDiscoveryInfo() shape fails to emit').toEqual([]);
    });

    it('reports every capability with a boolean `enabled`', async () => {
      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      const nonBoolean = Object.entries(info.capabilities as Record<string, any>)
        .filter(([, v]) => typeof v?.enabled !== 'boolean')
        .map(([k, v]) => `${k}: ${typeof v?.enabled}`);
      expect(nonBoolean, 'capability entries whose `enabled` is not a boolean').toEqual([]);
    });

    it('emits NO capability key the vocabulary does not declare', async () => {
      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      const declared = declaredCapabilityKeys();
      const undeclared = Object.keys(info.capabilities).filter(k => !declared.has(k));
      expect(undeclared, 'undeclared keys inside `capabilities` on the getDiscoveryInfo() shape').toEqual([]);
    });

    it('anti-vacuity: the six keys this producer never used to emit are really answered', async () => {
      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      // The metadata-protocol half of the old split, measured on THIS producer.
      for (const key of ['comments', 'automation', 'cron', 'export', 'chunkedUpload', 'transactionalBatch'] as const) {
        expect(info.capabilities[key], `capabilities.${key}`).toBeDefined();
        expect(typeof info.capabilities[key].enabled, `capabilities.${key}.enabled`).toBe('boolean');
      }

      // `comments` is TRUE here, and that is the anti-vacuity that matters:
      // this suite's kernel stubs `registry.getObject` to answer every name, so
      // `sys_comment` resolves. A hardcoded `false` — the shape ruling A allows
      // for a capability a producer cannot deliver — would read `false` here,
      // so this one assertion is what proves the key is MEASURED rather than
      // stamped. Its `false` counterpart is the dedicated test below.
      expect(info.capabilities.comments.enabled).toBe(true);

      // The rest are genuinely absent on a kernel with no services registered.
      for (const key of ['automation', 'cron', 'export', 'chunkedUpload', 'transactionalBatch'] as const) {
        expect(info.capabilities[key].enabled, `capabilities.${key}.enabled`).toBe(false);
      }
    });

    it('answers `comments` from the registry it can actually reach, not from a hardcoded false', async () => {
      // Ruling A point 3 says an undeliverable capability is `false` — but it
      // does NOT license answering `false` for a capability the producer CAN
      // compute. This dispatcher resolves `objectql` for its own data domain,
      // and `/data/sys_comment` is exactly how comments are served (ADR-0052
      // §5), so the honest answer tracks the object's presence — the same
      // derivation `getDiscovery()` uses, from this producer's own kernel face.
      const kernel = {
        context: {
          getService: (name: string) => {
            if (name === 'objectql') {
              return {
                registry: {
                  getObject: (n: string) => (n === 'sys_comment' ? { name: 'sys_comment' } : undefined),
                  getRegisteredTypes: () => [],
                  getAllPackages: () => [],
                },
              };
            }
            return null;
          },
        },
      } as any;

      const info: any = await new HttpDispatcher(kernel).getDiscoveryInfo('/api/v1');
      expect(info.capabilities.comments.enabled).toBe(true);
      expect(DiscoverySchema.safeParse(info).success).toBe(true);

      // …and the other direction: a registry WITHOUT `sys_comment` answers
      // false. Both halves, so neither a stamped `true` nor a stamped `false`
      // could pass this pair.
      const withoutComments = {
        context: {
          getService: (name: string) => (name === 'objectql'
            ? { registry: { getObject: () => undefined, getRegisteredTypes: () => [], getAllPackages: () => [] } }
            : null),
        },
      } as any;
      const bare: any = await new HttpDispatcher(withoutComments).getDiscoveryInfo('/api/v1');
      expect(bare.capabilities.comments.enabled).toBe(false);
    });

    it('[#7602] answers `search` false WITH a search service registered — the slot is not the predicate', async () => {
      // The `comments` pair above proves a key is measured rather than stamped.
      // This is the opposite direction, and the only assertion that separates
      // "right today" from "right on purpose".
      //
      // `capabilities.search.enabled` read `!!searchSvc` until #7602. That is
      // `false` on every host that exists — nothing registers the slot
      // (`CORE_SERVICE_PROVIDER` records `'search': null`) — so the pin below
      // (`has retired features and endpoints`) passed for a reason that had
      // nothing to do with what this face serves. Fill the slot, which is
      // exactly what it exists for, and the document flipped to `true` while
      // the dispatcher still mounts no `/search` route: an advertised endpoint
      // that 404s (Prime Directive #10), the same defect #7541 closed on the
      // `getDiscovery()` producer.
      //
      // Reverse verification, direction predicted BEFORE running (and observed:
      // 1 failed / 22 passed): restore the old slot-presence predicate —
      // `search: { enabled: searchRegistered }` — and THIS case goes red while the
      // pre-existing `enabled === false` pin — driven by a kernel with no
      // services — stays green. That asymmetry is the whole point of the case.
      const kernel = {
        context: {
          getService: (name: string) => {
            if (name === 'objectql') {
              return {
                registry: {
                  getObject: vi.fn().mockReturnValue({ name: 'test_obj' }),
                  getRegisteredTypes: vi.fn().mockReturnValue([]),
                  getAllPackages: vi.fn().mockReturnValue([]),
                },
              };
            }
            // A real-shaped occupant of the slot — `CoreServiceName`'s
            // "Search Engine (Elastic/Meili)", not a stub that `isServiceServeable`
            // would reject anyway. Nothing about it can make this face serve
            // `/search`, which is the point.
            if (name === 'search') return { searchAll: async () => [] };
            return null;
          },
        },
      } as any;

      const info: any = await new HttpDispatcher(kernel).getDiscoveryInfo('/api/v1');

      // Anti-vacuity: the stub really WAS resolved, so the `false` below is a
      // decision about the HTTP surface and not a failed registration.
      expect(info.services.search.enabled, 'the search slot must actually be filled in this fixture').toBe(true);

      expect(info.capabilities.search.enabled, 'a filled `search` slot must NOT advertise the capability').toBe(false);
      // …and no route is advertised on its behalf either, on the same basis.
      expect(info.routes.search, '`routes.search` must stay unadvertised').toBeUndefined();
      expect(DiscoverySchema.safeParse(info).success).toBe(true);
    });
  });

  it('has retired `features` and `endpoints` (ADR-0049 enforce-or-remove)', async () => {
    const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

    // `features` → the canonical `capabilities`; the flags themselves survive.
    expect(info).not.toHaveProperty('features');
    expect(info.capabilities.search.enabled).toBe(false);
    expect(info.capabilities.websockets.enabled).toBe(false);

    // `endpoints` was a verbatim duplicate of `routes` with no measured reader.
    expect(info).not.toHaveProperty('endpoints');
    expect(info.routes).toBeDefined();
  });

  describe('maps NODE_ENV into the declared enum instead of passing it through', () => {
    const OLD_NODE_ENV = process.env.NODE_ENV;
    afterEach(() => {
      if (OLD_NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = OLD_NODE_ENV;
    });

    // The two out-of-enum spellings named in the issue, driven through the REAL
    // producer — `test` is what vitest itself sets, so the raw passthrough was
    // advertising an undeclared value in every test run of this repo.
    it.each([
      ['test', 'development'],
      ['staging', 'sandbox'],
      ['production', 'production'],
      ['qa', 'development'],
    ])('NODE_ENV=%s advertises %s', async (nodeEnv, expected) => {
      process.env.NODE_ENV = nodeEnv;

      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      expect(info.environment).toBe(expected);
      // …and the whole body still satisfies the schema with that value in place.
      expect(DiscoverySchema.safeParse(info).success).toBe(true);
    });

    // [#5673] The pin for that issue: the whole setup is deleting the variable
    // — precisely the state of a production deployment whose operator never set
    // it — driven through the REAL producer rather than through
    // `resolveDiscoveryEnvironment` alone.
    //
    // [#5936] It stays here, and driven end-to-end, for a reason that survived
    // the default moving. When #5673 landed, the default WAS this call site
    // (`getEnv`'s second argument) and a green mapper test in `packages/spec`
    // could not have seen it. The 2026-08-07 ruling folded the default into the
    // mapper, so the spec-side case now covers the decision itself — and this
    // one covers the wiring: that this producer passes the operator's value
    // through as read and adds no default of its own. A local default here
    // would satisfy the mapper's test and still be the drift #5936 removed;
    // only an end-to-end assertion can tell the two apart. Its sibling in
    // `@objectstack/metadata-protocol` asserts the same fact about the other
    // producer, which is the pair that makes "one decision" checkable.
    //
    // Reverse verification, direction predicted BEFORE running: restore the
    // mapper's pre-#5936 `development` default and these two cases go RED
    // reading `development`, while every `it.each` row above stays green,
    // because the default is only ever consulted when NODE_ENV is absent. Note
    // this producer no longer has a second place to be fixed: the call site
    // carries no default, so the mapper's answer IS this producer's answer.
    // Measured both ways.
    it.each([
      ['unset', undefined],
      // `NODE_ENV=` exports an empty string. `getEnv` collapses it to its
      // default (`process.env[key] || default`) and, since #5936, the mapper
      // reads a blank string as unset too — so this is the same absence
      // `doctorNodeEnv()` and `os serve` already read as production, and it
      // answers the same on both producers.
      ['empty', ''],
    ])('NODE_ENV %s advertises production — never development (#5673)', async (_label, raw) => {
      if (raw === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = raw;

      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      expect(info.environment).toBe('production');
      expect(DiscoverySchema.safeParse(info).success).toBe(true);
    });

    // [#5673] The other half, stated as the invariant it is: absence claims
    // production, a spelling this repo does not recognise never does. These are
    // two different rules and #5673 deliberately moved only the first — #4828's
    // "never CLAIM production on a guess" is untouched, and this case is the
    // guard against a later simplification collapsing them back into one.
    // [#6287] `preview` dropped out of this list when it gained a declared fold
    // (`sandbox`) — it is an `EnvironmentTypeSchema` member, so it is no longer
    // an example of a spelling this repo does not recognise. The rule and its
    // remaining examples are untouched.
    it.each(['qa', 'uat', 'nonsense'])(
      'NODE_ENV=%s is an unrecognised spelling — still development, never production (#4828)',
      async (raw) => {
        process.env.NODE_ENV = raw;

        const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

        expect(info.environment).toBe('development');
      },
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // [#5791] The ledger row points AT this suite
  // ═════════════════════════════════════════════════════════════════════════
  //
  // `route-ledger.ts`'s `GET /discovery` row is one of the two first-ever
  // filled `responseSchema` values, and the field's rule is that a name may
  // only be written where the double assertion above already runs. That rule
  // lives in a JSDoc, which cannot fail a build — so the closing of the loop is
  // asserted here, in the file the row names: the schema the ledger advertises
  // is required to be the same object this suite parses with, not merely a name
  // that resolves. `packages/client/src/route-ledger-response-schema.test.ts`
  // carries the other half (every name across all five ledgers resolves).
  describe('[#5791] the ledger declares the schema this suite parses with', () => {
    it('names `DiscoverySchema`, resolving to the very object asserted above', async () => {
      const row = ROUTE_LEDGER.find(e => e.route === 'GET /discovery');
      expect(row, 'the dispatcher discovery row must exist in ROUTE_LEDGER').toBeDefined();
      expect(row!.responseSchema).toBe('DiscoverySchema');

      // Identity, not just resolvability: a name that resolved to some OTHER
      // schema would pass the client-side resolver and still describe the wrong
      // contract.
      expect((specApi as unknown as Record<string, unknown>)[row!.responseSchema!])
        .toBe(DiscoverySchema);
    });

    it('describes the ENVELOPE PAYLOAD — this producer wraps, the REST one does not', async () => {
      // The whole reason `responseSchema` is defined against the payload rather
      // than the wire body: these two discovery routes serve the same object at
      // two different depths. Here `dispatch()` returns `{ success, data }`, so
      // the ledger's `DiscoverySchema` is a claim about `body.data`; the REST
      // row's identical value is a claim about the whole body (`res.json`, no
      // envelope). Measured on both sides rather than asserted once.
      const result = await dispatcher.dispatch('GET', '/discovery', undefined, {}, { request: {} } as any);

      expect(result.handled).toBe(true);
      expect(result.response?.body?.success).toBe(true);

      // The envelope itself is NOT this field's business (check:route-envelope
      // owns that); what matters here is that the thing the ledger names is the
      // `data`, and that the whole body is NOT it.
      expect(DiscoverySchema.safeParse(result.response?.body?.data).success).toBe(true);
      expect(DiscoverySchema.safeParse(result.response?.body).success).toBe(false);
    });
  });

  it('emits the canonical `name`, never the deprecated `apiName` alias', async () => {
    const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

    expect(info.name).toBe('ObjectOS');
    // This producer was already canonical-only; pin it so the alias cannot be
    // reintroduced here while it is being retired on the other producer.
    expect(info).not.toHaveProperty('apiName');
  });
});
