// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4454 — `armRuntime: false`: an engine, and nothing armed.
 *
 * `os migrate meta --stored` needs this plugin for exactly one read-only thing:
 * the live executor registry, so ADR-0078's open-namespace conflict guard can
 * tell a flow-node rename from a clobber. It must not get the runtime that
 * normally rides along — booting a migration process that arms record triggers,
 * fires scheduled jobs, opens connector connections, or resumes a paused
 * approval is indefensible.
 *
 * The two halves are equally load-bearing and are tested as such: nothing is
 * armed, AND the registry is complete. A partial registry would not fail
 * loudly — it would make the guard read a live custom node type as unowned and
 * rewrite over it, which is the exact silent clobber the guard exists to stop.
 */
import { describe, expect, it, vi } from 'vitest';
import { AutomationServicePlugin } from './plugin.js';

/** A minimal PluginContext that records what the plugin did with it. */
function makeCtx() {
    const services = new Map<string, unknown>();
    const hooks: string[] = [];
    const triggered: string[] = [];
    const ctx: any = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: (name: string, svc: unknown) => services.set(name, svc),
        getService: (name: string) => {
            if (services.has(name)) return services.get(name);
            throw new Error(`no service ${name}`);
        },
        getServices: () => services,
        hook: (name: string) => { hooks.push(name); },
        trigger: async (name: string) => { triggered.push(name); },
    };
    return { ctx, services, hooks, triggered };
}

async function boot(options: Record<string, unknown>) {
    const h = makeCtx();
    const plugin = new AutomationServicePlugin(options as any);
    await plugin.init(h.ctx);
    await plugin.start(h.ctx);
    return { ...h, plugin, engine: h.services.get('automation') as any };
}

describe('armRuntime: false — nothing is armed (#4454)', () => {
    it('registers no flow, so no trigger or schedule is bound', async () => {
        const { engine } = await boot({ armRuntime: false, suspendedRunStore: 'memory' });

        expect(await engine.listFlows()).toEqual([]);
        // The audit is the engine's own account of what it would fire.
        expect(engine.getFlowRuntimeStates()).toEqual([]);
    });

    it('arms none of the runtime lifecycle hooks that would register flows later', async () => {
        // Skipping only the boot pull would be a half-measure: `kernel:ready`
        // and `metadata:reloaded` both re-register flows, so a long-lived
        // inert process would arm them a moment later.
        const { hooks } = await boot({ armRuntime: false, suspendedRunStore: 'memory' });

        expect(hooks).not.toContain('kernel:ready');
        expect(hooks).not.toContain('metadata:reloaded');
    });

    it('still fires automation:ready — a partial registry would corrupt the guard', async () => {
        // This is the one thing inert mode must NOT skip. Third-party executors
        // register on this hook; without them `reservedNodeTypes` is short, and
        // the conflict guard silently rewrites over a live custom node type
        // instead of refusing.
        const { triggered } = await boot({ armRuntime: false, suspendedRunStore: 'memory' });

        expect(triggered).toContain('automation:ready');
    });

    it('has the built-in node registry populated, which is what the migration needs', async () => {
        const { engine } = await boot({ armRuntime: false, suspendedRunStore: 'memory' });

        const types = engine.getRegisteredNodeTypes();
        expect(types.length).toBeGreaterThan(0);
        expect(types).toContain('delete_record');
        // …and the method the migration actually calls works off it.
        expect(typeof engine.canonicalizeStoredFlow).toBe('function');
    });

    it('canonicalizes a stored flow — the whole point of booting it at all', async () => {
        const { engine } = await boot({ armRuntime: false, suspendedRunStore: 'memory' });

        const { storable, notices } = engine.canonicalizeStoredFlow('purge', {
            name: 'purge',
            label: 'Purge',
            type: 'autolaunched',
            status: 'active',
            nodes: [{ id: 'n1', type: 'delete_record', label: 'Purge', config: { objectName: 'lead', filters: { status: 'stale' } } }],
            edges: [],
        });

        expect((storable as any).nodes[0].config.filter).toEqual({ status: 'stale' });
        expect(notices.some((n: any) => n.from === 'filters')).toBe(true);
        // Still nothing registered — canonicalizing is not registering.
        expect(await engine.listFlows()).toEqual([]);
    });
});

describe('the default is unchanged (#4454)', () => {
    it('arms the runtime hooks when armRuntime is not set', async () => {
        const { hooks, triggered } = await boot({ suspendedRunStore: 'memory' });

        expect(triggered).toContain('automation:ready');
        expect(hooks).toContain('kernel:ready');
        expect(hooks).toContain('metadata:reloaded');
    });

    it('arms them when armRuntime is explicitly true', async () => {
        const { hooks } = await boot({ armRuntime: true, suspendedRunStore: 'memory' });
        expect(hooks).toContain('kernel:ready');
    });
});
