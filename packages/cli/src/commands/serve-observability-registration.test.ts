// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os serve` registers the host's observability backends, so
 * `observability:metrics` actually resolves for every consumer (#9832).
 *
 * ## The defect
 *
 * `OBSERVABILITY_METRICS_SERVICE` (`observability:metrics`) has exactly one
 * registrar in the repo — `ObservabilityServicePlugin.init()` — and, measured
 * on the ref this card was filed against, **no host called it**. `serve.ts`
 * built one registry from `OS_OBS_EXPORTER` and threaded it into a single
 * consumer (the dispatcher), so every OTHER consumer walked the canonical
 * chain `ObservabilityServicePlugin` documents — explicit option, then
 * `observability:metrics`, then a no-op — and landed on the no-op. The cache
 * and storage adapters held a `NoopMetricsRegistry` in every shipped
 * `objectstack serve` deployment, however `OS_OBS_EXPORTER` was set.
 *
 * ## Why this file asserts EMISSION, not registration
 *
 * #9650's entire lesson was a seam that was correct in code and inert in the
 * deployment: the transport counter landed, passed its own tests, and emitted
 * nothing in a shipped `serve` because neither link of the resolution chain
 * existed at the host. A test that asserted "the plugin is registered" would
 * repeat exactly that mistake one layer up — registration is the mechanism,
 * emission is the claim. So §1 boots a kernel and reads metric samples that a
 * real HTTP request and a real cache lookup produced.
 *
 * §2 is the half that makes §1 mean something. The fix is an ORDERING fact —
 * every consumer resolves the chain inside its own `init()`, and Phase 1 runs
 * in `resolvePluginOrder()` order, which preserves registration order between
 * plugins with no dependency edge. So registering the service after a consumer
 * is registering too late, and §2 measures that by re-booting the identical
 * composition with only the registration MOVED. Without §2, §1 would stay
 * green if the ordering requirement silently stopped being real, and the
 * comment in `serve.ts` explaining the placement would be the only thing left
 * holding it.
 *
 * §3 pins the zero-cost guarantee that made the "register only when a backend
 * is configured" branch necessary: an all-noop registration would still be
 * truthy at every consumer's step 2, arming the transport's per-request
 * middleware on deployments that export nothing.
 *
 * §4 pins the DEPLOYMENT facts on `serve.ts` itself — the half no booted
 * composition can see, because a hand-composed kernel proves what the chain
 * does, never what the shipped host asks of it. That gap IS #9650.
 *
 * ## Scope of the booted section, stated rather than implied
 *
 * The consumers exercised here are the transport (`HonoServerPlugin`) and the
 * real `CacheServicePlugin`. `StorageServicePlugin` resolves through a
 * `resolveMetrics(ctx, override)` helper that is character-identical to
 * `service-cache`'s, and it was verified in the BOOTED CLI rather than
 * modelled here: booting the showcase app through the real `serve.ts` with
 * `OS_OBS_EXPORTER=console` logs
 *
 *     CacheServicePlugin: registered memory cache adapter (metrics=ConsoleMetricsRegistry)
 *     StorageServicePlugin: registered local storage adapter (swappable, metrics=ConsoleMetricsRegistry)
 *
 * against `metrics=NoopMetricsRegistry` for both on the parent commit, and a
 * real upload then emitted `storage_operations_total{adapter=local,op=put,result=ok}`
 * where the parent commit emitted nothing. That evidence is recorded in the PR;
 * standing a full storage stack up in a CLI unit suite would buy a third copy
 * of the same chain, not a third fact.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LiteKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ObservabilityServicePlugin } from '@objectstack/runtime';
import { CacheServicePlugin } from '@objectstack/service-cache';
import { InMemoryMetricsRegistry, SEMCONV } from '@objectstack/observability';
import type { IHttpServer } from '@objectstack/spec/contracts';
import type { ICacheService } from '@objectstack/spec/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The host under test, read as source — same package, no build required. */
const SERVE_SOURCE = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

const HTTP_REQUESTS_TOTAL = SEMCONV.httpRequestsTotal;
const CACHE_LOOKUPS_TOTAL = SEMCONV.cacheLookupsTotal;

/** A `getRawApp()` mount, the shape `plugin-auth` uses (`auth-plugin.ts:1622`). */
const PROBE_BASE = '/probe';

function rawMountPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.raw-mount',
        version: '1.0.0',
        init: async () => {},
        start: async (ctx: PluginContext) => {
            const httpServer = ctx.getService<IHttpServer>('http.server');
            const rawApp = (httpServer as unknown as { getRawApp(): any }).getRawApp();
            rawApp.all(`${PROBE_BASE}/*`, async (c: any) => c.json({ ok: true }, 200));
        },
    };
}

type Placement = 'before-consumers' | 'after-consumers' | 'absent';

/**
 * Boot the consumer set in the order `serve.ts` composes it, varying ONLY
 * where the observability registration sits. Everything else — the transport,
 * the cache plugin, the raw mount — is identical across placements, so a
 * difference in what gets emitted is attributable to the placement alone.
 */
async function bootWithPlacement(placement: Placement, metrics: InMemoryMetricsRegistry) {
    const kernel = new LiteKernel();

    if (placement === 'before-consumers') {
        kernel.use(new ObservabilityServicePlugin({ metrics }));
    }

    // The shipped order: transport first (serve.ts registers it before the
    // config plugins so `http.server` exists for everything downstream), then
    // the raw mount, then the capability providers.
    kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    kernel.use(rawMountPlugin());
    kernel.use(new CacheServicePlugin());

    if (placement === 'after-consumers') {
        kernel.use(new ObservabilityServicePlugin({ metrics }));
    }

    await kernel.bootstrap();
    const httpServer = kernel.getService<IHttpServer>('http.server');
    const baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;

    // One real inbound request, and one real cache lookup — the two consumers
    // whose emission is the claim.
    await fetch(`${baseUrl}${PROBE_BASE}/anything`);
    const cache = kernel.getService<ICacheService>('cache');
    await cache.get('a-key-that-is-absent');

    return kernel;
}

let booted: LiteKernel | undefined;

afterEach(async () => {
    if (booted) {
        await Promise.race([
            booted.shutdown(),
            new Promise<void>((r) => setTimeout(r, 10_000)),
        ]);
        booted = undefined;
    }
}, 30_000);

describe('#9832 §1 — registered BEFORE its consumers, both of them emit', () => {
    it('emits http_requests_total from the transport and cache_lookups_total from the cache', async () => {
        const metrics = new InMemoryMetricsRegistry();
        booted = await bootWithPlacement('before-consumers', metrics);

        // The transport counts a `getRawApp()` mount, labelled by the
        // registered PATTERN — the surface the dispatcher's own proxy could
        // never see, and the reason the counter lives at the transport.
        expect(metrics.totalCounter(HTTP_REQUESTS_TOTAL, { route: `${PROBE_BASE}/*` })).toBe(1);

        // The cache adapter got the REAL registry rather than its no-op
        // default. This is the family that was dark in every shipped
        // deployment; `result: 'miss'` because the key was never set.
        expect(
            metrics.totalCounter(CACHE_LOOKUPS_TOTAL, { adapter: 'memory', result: 'miss' }),
        ).toBe(1);
    }, 60_000);

    it('counts the request exactly ONCE — one registry, one armed observer', async () => {
        const metrics = new InMemoryMetricsRegistry();
        booted = await bootWithPlacement('before-consumers', metrics);

        // `armHttpRequestCounter` latches per server object (#9835), so a
        // second layer offering the same registry re-arms nothing. If this
        // ever reads 2, the host is building or arming a second emitter and
        // every HTTP series in the deployment is inflated.
        const all = metrics.samples.filter((s) => s.name === HTTP_REQUESTS_TOTAL);
        expect(all.length).toBe(1);
    }, 60_000);
});

describe('#9832 §2 — registered AFTER its consumers, the same composition emits nothing', () => {
    /**
     * The ordering claim, executable. Consumers resolve the chain in their own
     * `init()`, so a service registered later is a service they will never see
     * — they have already fallen through to the no-op and never look again.
     * This is why `serve.ts` places the registration ahead of the transport
     * rather than beside the dispatcher that first needed it.
     */
    it('neither the transport nor the cache sees a service registered after them', async () => {
        const metrics = new InMemoryMetricsRegistry();
        booted = await bootWithPlacement('after-consumers', metrics);

        expect(metrics.totalCounter(HTTP_REQUESTS_TOTAL)).toBe(0);
        expect(metrics.totalCounter(CACHE_LOOKUPS_TOTAL)).toBe(0);
    }, 60_000);
});

describe('#9832 §3 — no backend configured, nothing is registered and nothing is armed', () => {
    /**
     * The zero-cost guarantee #9650 built into the transport seam: no backend
     * means no middleware installed, so an unconfigured deployment pays no
     * per-request cost. `serve.ts` protects it by registering the service ONLY
     * when `buildServeObservability()` returned a backend — an all-noop
     * registration would be truthy at step 2 of every consumer's chain and
     * would arm the seam on deployments that export nothing.
     */
    it('emits nothing when no observability plugin is registered at all', async () => {
        const metrics = new InMemoryMetricsRegistry();
        booted = await bootWithPlacement('absent', metrics);

        expect(metrics.samples.length).toBe(0);
    }, 60_000);
});

describe('#9832 §4 — the deployment facts, pinned on serve.ts itself', () => {
    /**
     * ⭐ The half a booted composition cannot reach. §1–§3 prove what the chain
     * DOES; only this section proves the shipped host asks for it. #9650 is
     * precisely the failure of having the former without the latter.
     */

    /** Where `serve.ts` registers the service, and where it builds the transport. */
    const registrationIndex = SERVE_SOURCE.indexOf('new ObservabilityServicePlugin(');
    const transportIndex = SERVE_SOURCE.indexOf('new HonoServerPlugin(');

    it('registers ObservabilityServicePlugin at all', () => {
        expect(registrationIndex).toBeGreaterThan(-1);
    });

    it('registers it BEFORE the transport is constructed', () => {
        // Both must be found for the comparison to mean anything — a missing
        // needle is -1, which would satisfy a naive `<` against any real index.
        expect(transportIndex).toBeGreaterThan(-1);
        expect(registrationIndex).toBeLessThan(transportIndex);
    });

    /**
     * ⚠️ The trap the card names explicitly. `buildServeObservability()` builds
     * an exporter; calling it twice builds a SECOND one — with
     * `OS_OBS_EXPORTER=otlp` that is two `OtlpHttpMetricsRegistry` instances
     * with two independent flush timers, double-exporting every series to the
     * same backend. The registration site and the dispatcher must therefore
     * share ONE binding, which is only true while there is one call.
     */
    it('calls buildServeObservability() exactly once', () => {
        // Counted over CODE lines only. The first cut of this pin matched the
        // raw source and read 3 — the call plus the two comments that explain
        // why there must only be one. A pin that counts its own rationale is
        // not measuring the thing it names.
        const lines = SERVE_SOURCE.split('\n').map((l) => l.trim());
        const isProse = (t: string) =>
            t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
        const isDeclaration = (t: string) =>
            t.startsWith('function ') || t.startsWith('async function ');

        const mentions = lines.filter((t) => t.includes('buildServeObservability('));
        const declarations = mentions.filter((t) => !isProse(t) && isDeclaration(t));
        const callSites = mentions.filter((t) => !isProse(t) && !isDeclaration(t));

        // Control: a rename that made both counts 0 would otherwise read as a
        // clean single-call file rather than as this pin having gone blind.
        expect(declarations.length).toBe(1);
        expect(callSites.length).toBe(1);
    });

    /**
     * Cache and storage are registered on the `--no-server` path too, and
     * their metrics are as real there as anywhere. A registration that drifted
     * inside the `if (flags.server)` block would leave that path dark again
     * while every assertion above stayed green.
     */
    it('does not gate the registration behind flags.server', () => {
        const serverBlockIndex = SERVE_SOURCE.indexOf(
            '// Register REST API and Dispatcher plugins',
        );
        expect(serverBlockIndex).toBeGreaterThan(-1);
        expect(registrationIndex).toBeLessThan(serverBlockIndex);
    });
});
