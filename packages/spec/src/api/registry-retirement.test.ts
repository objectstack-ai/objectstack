// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4939] The `ApiRegistry` / `ApiEndpointRegistration` family is RETIRED.
 *
 * ## What was wrong
 *
 * `packages/spec/src/api/registry.zod.ts` declared a whole second shape for
 * "an API endpoint", served by a ~500-line `ApiRegistry` in `packages/core`
 * that `createApiRegistryPlugin()` registered as the `api-registry` service.
 * Nothing composed it: every assembly site lived in
 * `packages/core/examples/api-registry-example.ts`, with no registration in
 * `packages/runtime`, `packages/cli` or any `examples/app-*`, and a real
 * 47-plugin boot carried no `api-registry` service at all.
 *
 * So the entire schema family was zero-execution — `parameters`, `requestBody`,
 * `responses`, `security`, `operationId`, `tags`, and worst of all
 * `requiredPermissions`, whose TSDoc promised in the PRESENT TENSE that "the
 * gateway layer automatically validates these permissions" while no gateway
 * anywhere read it. That is false compliance in the ADR-0049 sense, not debt.
 *
 * It also left the repo carrying TWO declaration shapes for one concept, both
 * inert. The 2026-08-04 verdict retired this one unconditionally and kept
 * `ApiEndpointSchema` (`./endpoint.zod`), whose executor is tracked by #5040 —
 * converging on one shape rather than choosing between two dead ones.
 *
 * ## Why these assertions are runtime namespace probes
 *
 * A removed export cannot be imported by name — that would not compile, so the
 * pin has to ask the namespace object instead. `#4642` established that a
 * compile-time conditional-type pin is a no-op in this package (tsconfig
 * excludes `**\/*.test.ts`, and vitest never enables `typecheck`), so the
 * load-bearing check must be a runtime one, with anti-vacuity guards.
 */

import { describe, it, expect } from 'vitest';

/** Every name the retirement removed from the `./api` surface. */
const RETIRED_NAMES = [
  // The #4939 subject and its factory.
  'ApiEndpointRegistrationSchema',
  'ApiEndpointRegistration',
  // The registry container family.
  'ApiRegistrySchema',
  'ApiRegistry',
  'ApiRegistryEntrySchema',
  'ApiRegistryEntry',
  'ApiMetadataSchema',
  // Value schemas that existed only to serve the above (#3950: an exported
  // schema with no consumer is read as a capability by whoever finds it).
  'ApiParameterSchema',
  'ApiResponseSchema',
  'ApiProtocolType',
  'HttpStatusCode',
  'ObjectQLReferenceSchema',
  'SchemaDefinition',
  'ApiDiscoveryQuerySchema',
  'ApiDiscoveryResponseSchema',
] as const;

describe('[#4939] ApiRegistry family retired from `@objectstack/spec/api`', () => {
  it('exports none of the retired names', async () => {
    const api = await import('./index');

    // Anti-vacuity FIRST: the namespace we are about to probe must be real and
    // non-trivial, or every `toBe(false)` below passes for the wrong reason.
    const names = Object.keys(api);
    expect(names.length, './api must export a non-trivial surface').toBeGreaterThan(100);
    expect(names).toContain('ApiEndpointSchema');

    for (const retired of RETIRED_NAMES) {
      expect(retired in api, `./api must not export ${retired}`).toBe(false);
    }
  });

  it('keeps `ApiEndpointSchema` — the ONE surviving endpoint shape', async () => {
    const api = await import('./index');
    expect('ApiEndpointSchema' in api).toBe(true);
    expect('ApiEndpoint' in api).toBe(true);
    // `ApiMappingSchema` is its input/output mapping type and survives with it.
    expect('ApiMappingSchema' in api).toBe(true);
  });

  it('keeps `ConflictResolutionStrategy`, moved to router.zod (NOT re-introducing the registry)', async () => {
    const api = await import('./index');
    expect(
      'ConflictResolutionStrategy' in api,
      'two independent ratchets pin this as a ./api export: spec/src/automation/' +
        'sync-retirement.test.ts (#4738, the fourth ConflictResolution relative) and, ' +
        'cross-repo, objectui offline-nav-performance-spec-parity.test.ts',
    ).toBe(true);

    // Its VALUE domain must survive the move byte-for-byte — a moved symbol
    // that quietly changed vocabulary would be the #4738 trap, not a move.
    const strategy = (api as Record<string, unknown>).ConflictResolutionStrategy as {
      parse: (v: unknown) => unknown;
    };
    for (const ok of ['error', 'priority', 'first-wins', 'last-wins']) {
      expect(() => strategy.parse(ok), `${ok} must stay legal`).not.toThrow();
    }
    // And it must still be the ROUTE-conflict vocabulary, not ui's offline one.
    for (const notOurs of ['client_wins', 'server_wins', 'last_write_wins', 'target_wins']) {
      expect(() => strategy.parse(notOurs), `${notOurs} belongs to another enum`).toThrow();
    }
  });

  it('declares it exactly once — the retirement must not leave a second owner', async () => {
    const api = await import('./index');
    const router = await import('./router.zod');
    expect('ConflictResolutionStrategy' in router).toBe(true);
    expect(
      (api as Record<string, unknown>).ConflictResolutionStrategy,
      './api must re-export the router declaration itself, not a copy',
    ).toBe((router as Record<string, unknown>).ConflictResolutionStrategy);
  });
});
