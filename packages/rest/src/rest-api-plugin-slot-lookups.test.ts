// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4251 B4] The REST composition root's slot lookups, pinned at runtime.
 *
 * `rest-api-plugin.ts` resolves the service slots enumerated by `BOOT_SLOTS`
 * and `PROVIDERS` below and hands most of them to `RestServer` as
 * lazily-invoked providers. B4 replaced the `any` on every one of those
 * lookups with the slot's contract — a change that cannot alter behaviour, but
 * CAN silently mis-wire it: the providers are positional arguments of one
 * constructor, all with the same shape (`(environmentId?) => Promise<unknown>`),
 * so a provider that resolves the wrong slot name is assignable everywhere and
 * invisible to the compiler.
 *
 * ⛔ [#17716] Neither the slot count nor the argument span is written in this
 * header as a numeral, on purpose. The two that were — a spelled-out slot
 * count, and an "arguments A..B of an N-argument constructor" span — were
 * undated present-tense constants. The span figures were accurate the day B4
 * wrote them and went stale by one the day a provider was appended to the
 * constructor; the slot count matched no quantity derivable from
 * `rest-api-plugin.ts` even then. Nothing recomputes a sentence, and a reader
 * cannot tell a figure that was never measured from one that has since
 * drifted. Both figures now exist only in the tables below and in the cases
 * that pin them, so the only spelling of either is one this suite can fail on.
 *
 * Why a RUNTIME pin and not a type-level one. ⚠️ NOT because nothing compiles
 * this file. `packages/rest/tsconfig.json` does exclude its `.test.ts` files,
 * but that is the BUILD config alone: the sibling `tsconfig.test.json` puts
 * this layer back in front of tsc (`include: ["src/**\/*"]`) and the package's
 * own `typecheck` NAMES it — `tsc --noEmit && pnpm check:test-typecheck`, whose
 * second half runs `--project tsconfig.test.json`. This header used to say the
 * package "declares no `typecheck` script (it is a DEBT/TEST_DEBT ledger
 * entry), so NO tsc program compiles this file"; all three halves are false on
 * this tree — the script exists, neither the `DEBT` nor the `TEST_DEBT` object
 * literal in `scripts/check-type-check-coverage.mjs` names `@objectstack/rest`,
 * and `tsc --listFiles -p tsconfig.test.json` lists this file. A
 * `@ts-expect-error` written here is LIVE and reports TS2578 the moment it
 * suppresses nothing — not the phantom-check shape AGENTS.md bans and
 * #5286 / #5449 paid for.
 *
 * It is a runtime pin for a reason that outlives any script list: the property
 * is not expressible as a type. `RestServer` receives the providers as
 * POSITIONAL parameters declared with one identical type,
 * `(environmentId?: string) => Promise<any | undefined>`, so every permutation
 * of them is assignable and no assertion over that signature can go red when
 * the wiring is wrong. And the slot name a provider resolves is a string
 * literal handed to `PluginContext.getService<T>(name: string): T` — a bare
 * `string` parameter whose `T` the CALLER supplies, so neither the argument type
 * nor the result type carries evidence of which slot was read. "This argument
 * resolves that slot" is a value-level identity between a position and a literal
 * inside a closure body: only invoking the closure observes it, and the same
 * holds for the SET of slot names, which exists only as the `getService` calls
 * `init`/`start` actually make. So that is what this pins:
 *
 *   1. every provider resolves the slot it is NAMED for (the mapping the B4
 *      types assert, verified against the registry), and
 *   2. the exact set of slot names the boot asks for — so a retyped literal
 *      (`'sharingRules'` → `'sharing-rules'`) fails here rather than degrading
 *      one route to a permanent 501 in production.
 */

import { describe, it, expect, vi } from 'vitest';

const captured = vi.hoisted(() => ({ ctorArgs: [] as unknown[][] }));

// Capture RestServer's constructor arguments without registering ~hundreds of
// routes. Everything else in the module (RestEnvRegistry & co) stays real, so
// the plugin's imports resolve normally.
//
// The double EXTENDS the real class rather than replacing it: `registerRoutes`
// is the only expensive thing here, so it is the only thing suppressed, and
// every other method the composition root calls stays the production one. That
// matters beyond tidiness — the plugin also asks the instance for the API base
// (`getApiBasePath()`, #6306), and a hand-written stub that lists only the
// methods the plugin happened to call the day it was written turns each new
// collaborator call into a `TypeError` here, in a file about slot WIRING that
// has no opinion on the base. Inheriting the contract keeps this test measuring
// its own subject. The real constructor is field assignment plus
// `new RouteManager(server)` (a `Map`), so nothing is paid for it.
vi.mock('./rest-server.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rest-server.js')>();
  return {
    ...actual,
    RestServer: class extends actual.RestServer {
      constructor(...args: unknown[]) {
        super(...(args as ConstructorParameters<typeof actual.RestServer>));
        captured.ctorArgs.push(args);
      }
      override registerRoutes(): void {
        /* routes are not under test here */
      }
    },
  };
});

const { createRestApiPlugin } = await import('./rest-api-plugin.js');

/**
 * The provider arguments, by their position in the `RestServer` constructor.
 * `slot` is the service name the provider must resolve — the claim each B4 type
 * annotation makes, restated in a form the runtime can check.
 */
const PROVIDERS = [
  { index: 6, label: 'authServiceProvider', slot: 'auth' },
  { index: 7, label: 'objectQLProvider', slot: 'objectql' },
  { index: 8, label: 'emailServiceProvider', slot: 'email' },
  { index: 9, label: 'sharingServiceProvider', slot: 'sharing' },
  { index: 10, label: 'reportsServiceProvider', slot: 'reports' },
  { index: 11, label: 'approvalsServiceProvider', slot: 'approvals' },
  { index: 12, label: 'sharingRulesServiceProvider', slot: 'sharingRules' },
  { index: 13, label: 'i18nServiceProvider', slot: 'i18n' },
  { index: 14, label: 'analyticsServiceProvider', slot: 'analytics' },
  { index: 15, label: 'settingsServiceProvider', slot: 'settings' },
  { index: 17, label: 'securityServiceProvider', slot: 'security' },
  { index: 19, label: 'metadataServiceProvider', slot: 'metadata' },
  // [#17716] The appended parameter #15256's own docblock warns about. Its
  // provider is kernel-first (`ctx.getKernel()?.getServiceAsync('tenancy')`)
  // and falls back to `ctx.getService('tenancy')` for a host with no async
  // accessor — which is the host `mockCtx` builds, so driving it records
  // `tenancy` in `asked` exactly as every sibling row does. LAZINESS WAS NEVER
  // WHY IT WAS INVISIBLE: `objectQLProvider` at index 7 has the identical
  // two-leg shape and has always been covered. It was invisible because it was
  // absent from this table, so nothing ever drove it, the slot was never asked
  // for, the set the last case compares could not contain it, and the guard
  // read green against ANY binding at this position.
  { index: 20, label: 'tenancyServiceProvider', slot: 'tenancy' },
] as const;

/**
 * The positional arguments inside the provider span that are deliberately NOT
 * providers — so the span is accounted for END TO END, rather than up to
 * whichever argument someone last remembered.
 *
 * [#17716] This table is why the span needs no numeral. With it, every index
 * from the first provider to the last argument the composition root passes is
 * either covered by `PROVIDERS` or excused here, and `accounts for every
 * positional argument` below fails on any that is neither. An argument
 * APPENDED to `RestServer` — the move #15256 made precisely because inserting
 * one mid-list "would silently re-bind every positional argument after it" —
 * now forces a decision here instead of landing uncovered.
 */
const NON_PROVIDERS_IN_SPAN = [
  {
    index: 16,
    label: 'serviceExistsProvider',
    why: '`(name: string) => boolean` — a presence probe, pinned by its own case below',
  },
  {
    index: 18,
    label: 'requestEnvResolver',
    why: '`RestRequestEnvResolver` — a resolver instance, not a slot provider',
  },
] as const;

/**
 * Every slot name the boot itself resolves, before any route runs.
 *
 * `external-datasource` is deliberately NOT here: its lookup lives inside a
 * per-request closure (`external-datasource-routes.ts`), so registering the
 * routes resolves nothing — the federation routes answer 503 per request when
 * the service is absent rather than deciding it once at boot.
 */
const BOOT_SLOTS = [
  'manifest',
  'http.server',
  'protocol',
  'kernel-manager',
  'env-registry',
  'kernel-resolver',
  // [#14503] `package` is NOT here any more: the package registrar mounts
  // `POST /packages/publish` unconditionally and resolves the `package` slot
  // per request, inside the handler (#7563) — the boot-time lookup that used
  // to decide whether to mount its three (since-removed) read/delete routes
  // is gone with them. Same shape as `external-datasource` below.
] as const;

function mockServer() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/** One distinguishable fake per slot, so "which slot did it read" is provable. */
function allServices(): Record<string, unknown> {
  const services: Record<string, unknown> = {
    'http.server': mockServer(),
    protocol: { getDiscovery: vi.fn() },
    manifest: { register: vi.fn() },
    'kernel-manager': { getOrCreate: vi.fn() },
    'env-registry': { resolveByHostname: vi.fn() },
    'kernel-resolver': { resolveKernel: vi.fn() },
    'default-project': { environmentId: 'env_only' },
    package: { listPackages: vi.fn() },
    'external-datasource': { validateAll: vi.fn() },
  };
  for (const { slot } of PROVIDERS) services[slot] = { __slot: slot };
  return services;
}

function mockCtx(services: Record<string, unknown>) {
  const asked: string[] = [];
  return {
    asked,
    ctx: {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        asked.push(name);
        if (name in services) return services[name];
        throw new Error(`Service '${name}' not found`);
      }),
      getServices: vi.fn(() => new Map(Object.entries(services))),
      hook: vi.fn(),
      trigger: vi.fn().mockResolvedValue(undefined),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getKernel: vi.fn(),
    },
  };
}

async function boot(services: Record<string, unknown>) {
  captured.ctorArgs.length = 0;
  const { ctx, asked } = mockCtx(services);
  const plugin = createRestApiPlugin();
  await plugin.init?.(ctx as never);
  await plugin.start?.(ctx as never);
  expect(captured.ctorArgs).toHaveLength(1);
  return { args: captured.ctorArgs[0]!, asked, ctx };
}

describe('[#4251 B4] rest-api-plugin slot lookups', () => {
  it('resolves each provider from the slot it is named for', async () => {
    const services = allServices();
    const { args } = await boot(services);

    for (const { index, label, slot } of PROVIDERS) {
      const provider = args[index] as (environmentId?: string) => Promise<unknown>;
      expect(typeof provider, `${label} must be wired at argument ${index}`).toBe('function');
      // The provider must hand back the instance registered in ITS slot — not
      // a sibling's. Same shape for all of them, so only identity proves it.
      await expect(provider('env_1'), `${label} must resolve '${slot}'`).resolves.toBe(
        services[slot],
      );
    }
  });

  it('accounts for every positional argument from the first provider to the last', async () => {
    const services = allServices();
    const { args } = await boot(services);

    const classified = new Set<number>([
      ...PROVIDERS.map((p) => p.index),
      ...NON_PROVIDERS_IN_SPAN.map((p) => p.index),
    ]);

    // Derived from the captured call, never hand-typed. The span ends at the
    // LAST argument the composition root passes, so an argument appended to
    // `RestServer` falls inside it by construction and has to be classified.
    const firstProvider = Math.min(...PROVIDERS.map((p) => p.index));
    const span: number[] = [];
    for (let i = firstProvider; i < args.length; i++) span.push(i);

    expect(
      span.filter((i) => !classified.has(i)),
      'a positional argument in the provider span is covered by neither PROVIDERS nor NON_PROVIDERS_IN_SPAN — add a row (provider) or an entry (not a provider)',
    ).toEqual([]);
    // And no row may outlive its argument: a removed parameter takes its row
    // with it, rather than leaving one that silently asserts nothing.
    expect(
      [...classified].filter((i) => i >= args.length),
      'a row points past the end of the argument list the composition root passes',
    ).toEqual([]);
  });

  it('passes the env-registry and default-environment seams as RestServer declares them', async () => {
    const services = allServices();
    const { args } = await boot(services);

    // `envRegistry` is a plain instance, not a provider (constructor arg 4).
    expect(args[4]).toBe(services['env-registry']);
    // `defaultEnvironmentIdProvider` reads the one field this plugin declares
    // on the `default-project` slot.
    expect((args[5] as () => string | undefined)()).toBe('env_only');
  });

  it('reports service presence without touching the occupant', async () => {
    const services = allServices();
    const { args } = await boot(services);
    const exists = args[16] as (name: string) => boolean;

    expect(exists('analytics')).toBe(true);
    // An empty slot throws out of `getService`; the probe answers false rather
    // than propagating.
    expect(exists('nope-not-registered')).toBe(false);
  });

  it('asks for exactly the slots it declares, and no others', async () => {
    const services = allServices();
    const { args, asked } = await boot(services);

    // Providers are lazy, so drive every one to make its lookup observable.
    for (const { index } of PROVIDERS) {
      await (args[index] as (environmentId?: string) => Promise<unknown>)('env_1');
    }
    (args[5] as () => string | undefined)();

    const expected = new Set<string>([
      ...BOOT_SLOTS,
      'default-project',
      ...PROVIDERS.map((p) => p.slot),
    ]);
    expect(new Set(asked)).toEqual(expected);
  });

  it('degrades without optional slots — every provider answers undefined, no throw', async () => {
    // Only the two slots `start()` hard-requires; every other lookup throws.
    const services: Record<string, unknown> = {
      'http.server': mockServer(),
      protocol: { getDiscovery: vi.fn() },
    };
    const { args } = await boot(services);

    for (const { index, label } of PROVIDERS) {
      const provider = args[index] as (environmentId?: string) => Promise<unknown>;
      await expect(provider('env_1'), `${label} must degrade to undefined`).resolves.toBeUndefined();
    }
    expect(args[4]).toBeUndefined();
    expect((args[5] as () => string | undefined)()).toBeUndefined();
    expect((args[16] as (name: string) => boolean)('analytics')).toBe(false);
  });
});
