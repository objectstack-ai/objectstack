// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13906 — maintainer ruling 2026-09-02, decision 1 option B′] The
 * single-kernel provider wiring REFUSES a configured wall-enforcing tenancy
 * posture at BOOT, because it cannot enforce one.
 *
 * ## Why a boot refusal and not a seam repair
 *
 * `RestServer.computeExecCtx` reads the tenancy posture off its local `kernel`
 * variable, and that variable is assigned on the `kernelManager` branches ONLY.
 * With no kernel-manager the transport resolves auth and data through the
 * injected providers, `kernel` stays `undefined`, and the posture is never
 * asked for. Phase 1 drove that on one real `ObjectKernel` carrying a healthy
 * `isolated` tenancy behind a RECORDING factory, wired both ways, same
 * ex-member org-stamped key:
 *
 * | wiring                  | door           | tenancy factory invocations |
 * |:--|:--|:--|
 * | via `kernelManager`     | 401 refused    | 1 |
 * | via the provider wiring | **200 served** | **0** |
 *
 * ⇒ NOT "absent on failure" — never read. A healthy, correctly-configured,
 * wall-enforcing tenancy service enforces nothing there, and no failure is
 * required to reach that state. There is therefore no posture to repair at
 * request time, which is why the ruling put the answer at boot: tell the
 * deployment that what it configured is not being enforced, instead of letting
 * it find out from a served request.
 *
 * ⚠️ §3 of `execctx-authz-input-seam-reachability.test.ts` still measures 200
 * on the provider wiring, and that stays CORRECT: this refuses the
 * COMPOSITION at boot, it does not change `computeExecCtx`.
 *
 * ⛔ Option B — wiring a tenancy provider into the single-kernel path — was NOT
 * taken. It needs a product answer (should these deployments run walled
 * postures at all?) that the ruling explicitly declined to pre-empt.
 *
 * ## §1 is the ruling's OWN opening question, driven
 *
 * The ruling made B′ conditional: *"B′ opens with a measurement: can a walled
 * posture be configured on that wiring at all? If it cannot, B′ reduces to
 * documenting that the single-kernel wiring carries no posture."* §1 answers
 * it — YES, it can — which is what makes B′ a refusal rather than a doc note.
 * ⛔ Do not delete §1 as redundant: it is the precondition of everything below.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectKernel, ServiceLifecycle, effectiveTenancyPosture } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import { postureEnforcesWall } from '@objectstack/spec/security';

const captured = vi.hoisted(() => ({ ctorArgs: [] as unknown[][] }));

// The same double the sibling plugin tests use: EXTENDS the real class so the
// composition root runs production code, and only suppresses route
// registration. Route registration is not what is under measurement here.
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
                /* not under test */
            }
        },
    };
});

const { createRestApiPlugin } = await import('./rest-api-plugin.js');

function mockHttpServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeObjectKernel(): ObjectKernel {
    return new ObjectKernel({
        logger: { level: 'error' },
        gracefulShutdown: false,
        skipSystemValidation: true,
    });
}

/**
 * Boot the REAL rest plugin on a real kernel. `wire` runs in a host plugin's
 * init BEFORE the rest plugin starts — where a real composition registers its
 * services. Returns whether a `RestServer` was constructed, which is the
 * observable that says whether the door came up at all.
 */
async function bootRealPluginOn(
    kernel: ObjectKernel,
    wire?: (ctx: PluginContext) => void,
): Promise<{ booted: boolean; error?: unknown }> {
    captured.ctorArgs.length = 0;
    await kernel.use({
        name: 'test.host.wiring',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('http.server', mockHttpServer());
            ctx.registerService('protocol', {});
            wire?.(ctx);
        },
    });
    await kernel.use(createRestApiPlugin());
    try {
        await kernel.bootstrap();
        return { booted: captured.ctorArgs.length === 1 };
    } catch (error) {
        return { booted: false, error };
    }
}

/** The shape `effectiveTenancyPosture` reads — structural, as core declares it. */
const isolatedTenancy = () => ({ posture: 'isolated', isolationActive: true });
const singleTenancy = () => ({ posture: 'single', isolationActive: false });

/** Flatten a boot rejection to the text an operator would actually read. */
function bootText(error: unknown): string {
    const parts: string[] = [];
    let cur: any = error;
    for (let i = 0; cur && i < 5; i++) {
        if (cur.message) parts.push(String(cur.message));
        cur = cur.cause;
    }
    return parts.join(' || ');
}

// ---------------------------------------------------------------------------
// §1 — the ruling's opening measurement: CAN a walled posture be configured on
// this wiring at all? If not, B′ collapses to documentation.
// ---------------------------------------------------------------------------

describe('[#13906] §1 — B′ opening measurement: is a walled posture configurable on the single-kernel wiring?', () => {
    it('YES: a kernel with NO kernel-manager still carries a readable, wall-enforcing tenancy posture', async () => {
        // Nothing about registering a tenancy service depends on a
        // kernel-manager: the service is a kernel service like any other, and
        // it reconciles to `isolated` exactly as it would on the multi-kernel
        // wiring. So the misconfiguration B′ refuses is REACHABLE — the
        // deployment can, and this proves it does, hold a wall it is not
        // enforcing.
        const kernel = makeObjectKernel();
        await kernel.use({
            name: 'test.tenancy.host',
            version: '1.0.0',
            init: async (ctx: PluginContext) => { ctx.registerService('tenancy', isolatedTenancy()); },
        });
        await kernel.bootstrap();

        // Read it the way the transport would, through the same helper.
        const tenancy = await kernel.getServiceAsync('tenancy');
        const posture = effectiveTenancyPosture(tenancy as any);
        expect(posture).toBe('isolated');
        expect(postureEnforcesWall(posture!)).toBe(true);

        // ⛔ And no kernel-manager exists here — the condition that makes the
        // transport blind to the posture just read.
        await expect(kernel.getServiceAsync('kernel-manager')).rejects.toBeDefined();

        await kernel.shutdown();
    });

    it('POSITIVE CONTROL for the criterion: a `single` posture on the SAME wiring does NOT enforce a wall', async () => {
        // Without this leg, "the posture enforces a wall" could be an artifact
        // of the reader rather than a fact about the configuration.
        const kernel = makeObjectKernel();
        await kernel.use({
            name: 'test.tenancy.host',
            version: '1.0.0',
            init: async (ctx: PluginContext) => { ctx.registerService('tenancy', singleTenancy()); },
        });
        await kernel.bootstrap();

        const posture = effectiveTenancyPosture(await kernel.getServiceAsync('tenancy') as any);
        expect(posture).toBe('single');
        expect(postureEnforcesWall(posture!)).toBe(false);

        await kernel.shutdown();
    });
});

// ---------------------------------------------------------------------------
// §2 — the refusal itself.
// ---------------------------------------------------------------------------

describe('[#13906] §2 — B′: the boot refusal', () => {
    it('⭐ REFUSES: wall-enforcing posture + no kernel-manager → the plugin does not start and the door never comes up', async () => {
        const kernel = makeObjectKernel();
        const r = await bootRealPluginOn(kernel, (ctx) => {
            ctx.registerService('tenancy', isolatedTenancy());
        });

        expect(r.booted).toBe(false);
        expect(r.error).toBeDefined();
        // ⭐ The door must not have been constructed — a refusal that still
        // built a serving RestServer would be a log line, not a refusal.
        expect(captured.ctorArgs).toHaveLength(0);

        const text = bootText(r.error);
        // The message has to carry the three things an operator needs: WHAT is
        // configured, WHY it is not enforced, and HOW to fix it.
        expect(text).toContain('isolated');
        expect(text).toContain('kernel-manager');
        expect(text).toMatch(/never reads a tenancy posture/i);
        expect(text).toContain('#13906');

        await kernel.shutdown().catch(() => undefined);
    });

    it('the refusal fires on a FACTORY-registered tenancy service too — the shape a real composition uses', async () => {
        // Instance registration is the simplest case; a real host commonly
        // registers a factory. Both must be seen, or the refusal is trivially
        // evaded by the more realistic wiring.
        const kernel = makeObjectKernel();
        kernel.registerServiceFactory('tenancy', () => isolatedTenancy(), ServiceLifecycle.SINGLETON);
        const r = await bootRealPluginOn(kernel);

        expect(r.booted).toBe(false);
        expect(bootText(r.error)).toContain('isolated');

        await kernel.shutdown().catch(() => undefined);
    });
});

// ---------------------------------------------------------------------------
// §3 — narrowness controls. Each of these MUST still boot; together they are
// what stops B′ from becoming "the rest plugin refuses to start".
// ---------------------------------------------------------------------------

describe('[#13906] §3 — B′ narrowness: what must keep booting', () => {
    it('⭐ CONTROL: NO tenancy service at all — the overwhelmingly common single-kernel shape — boots untouched', async () => {
        const kernel = makeObjectKernel();
        const r = await bootRealPluginOn(kernel);

        expect(r.error).toBeUndefined();
        expect(r.booted).toBe(true);

        await kernel.shutdown();
    });

    it('CONTROL: a `single` tenancy posture boots — no wall is configured, so nothing is being pretended', async () => {
        const kernel = makeObjectKernel();
        const r = await bootRealPluginOn(kernel, (ctx) => {
            ctx.registerService('tenancy', singleTenancy());
        });

        expect(r.error).toBeUndefined();
        expect(r.booted).toBe(true);

        await kernel.shutdown();
    });

    it('⭐ CONTROL: an `isolated` posture WITH a kernel-manager boots — that wiring CAN carry a posture', async () => {
        // This is the leg that proves the refusal keys on the WIRING and not
        // merely on the posture. Same tenancy service, same posture, opposite
        // answer, because `computeExecCtx` reads the posture on this path.
        const kernel = makeObjectKernel();
        const r = await bootRealPluginOn(kernel, (ctx) => {
            ctx.registerService('tenancy', isolatedTenancy());
            ctx.registerService('kernel-manager', { getOrCreate: async () => kernel });
        });

        expect(r.error).toBeUndefined();
        expect(r.booted).toBe(true);

        await kernel.shutdown();
    });

    it('CONTROL: a tenancy service that FAILS TO CONSTRUCT does not refuse — an unreadable posture cannot assert a configured wall', async () => {
        // Deliberate, and named as residue on the card: positive knowledge is
        // required to refuse. We could not read a posture, so we cannot claim
        // one is configured, and refusing here would take down deployments on
        // a guess. The condition is logged loudly instead.
        const kernel = makeObjectKernel();
        kernel.registerServiceFactory(
            'tenancy',
            () => { throw new Error('tenancy store handshake failed'); },
            ServiceLifecycle.SINGLETON,
        );
        const r = await bootRealPluginOn(kernel);

        expect(r.error).toBeUndefined();
        expect(r.booted).toBe(true);

        await kernel.shutdown();
    });
});
