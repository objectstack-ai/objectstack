// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12157 / #12158] ADR-0126 §5 / §7.2 / §7.3 — the packaged-flow activation
// ledger: the durable off-switch, its runtime consult at the `execute()` seam,
// the trigger unbind, and the subflow guard on disable.
//
// WHAT THIS REPLACES, AND WHY THE REPLACEMENT NEEDED TESTS OF ITS OWN
//
// The engine used to keep its off-switch in a process-local `flowEnabled` map.
// #10243 measured the cost: the bit was NOT a row, so no organization wall
// scoped it — `toggleFlow` wrote a name-keyed in-process map and the automation
// service is ONE instance per environment, so on a real `isolated` posture a
// tenant org owner switched a shipped flow off and an unrelated tenant in a
// DIFFERENT organization read it off. ADR-0126 §7.2 RETIRES that mechanism
// rather than refining it.
//
// So the assertions below come in two families, and both are load-bearing:
//   1. the ledger DOES what the map did (refuse at execute(), unbind the
//      trigger) — otherwise the retirement is a regression; and
//   2. the map is GONE as a mechanism, not merely bypassed — the grep-level
//      pin at the bottom of this file, which is what stops a later edit from
//      quietly reintroducing an in-process off-switch beside the durable one.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding, FlowActivationRow } from './engine.js';
import { InMemoryFlowActivationStore, ObjectStoreFlowActivationStore } from './flow-activation-store.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function createTestLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => l;
    return l;
}

/**
 * A minimal runnable flow. `start` config decides which trigger it binds to,
 * which is how one helper covers every entry path below.
 */
function flowBody(name: string, startConfig: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: startConfig },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        ...extra,
    };
}

/** The same flow, shipped by a code package (ADR-0029 D9.6 provenance). */
function packagedFlow(name: string, startConfig: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    return { ...flowBody(name, startConfig, extra), _packageId: 'crm' };
}

/** A recording trigger, so binding state is asserted for real rather than inferred. */
function recordingTrigger(type: string) {
    const bound = new Map<string, (ctx: AutomationContext) => Promise<void>>();
    const trigger: FlowTrigger = {
        type,
        start(binding: FlowTriggerBinding, cb: (ctx: AutomationContext) => Promise<void>) {
            bound.set(binding.flowName, cb);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return { trigger, isBound: (n: string) => bound.has(n) };
}

/** An engine with the in-memory ledger attached and the four triggers registered. */
function engineWithLedger() {
    const engine = new AutomationEngine(createTestLogger());
    const store = new InMemoryFlowActivationStore();
    engine.setFlowActivationStore(store);
    const triggers = {
        record_change: recordingTrigger('record_change'),
        schedule: recordingTrigger('schedule'),
        time_relative: recordingTrigger('time_relative'),
        api: recordingTrigger('api'),
    };
    for (const t of Object.values(triggers)) engine.registerTrigger(t.trigger);
    return { engine, store, triggers };
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — absence of a row means ACTIVE
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §4 — absence of a row = active (an empty ledger changes nothing)', () => {
    it('a stock boot with an EMPTY ledger arms and runs every flow', async () => {
        const { engine, triggers } = engineWithLedger();
        engine.registerFlow('welcome', packagedFlow('welcome', { objectName: 'lead', triggerType: 'record-after-create' }));

        const disarmed = await engine.hydrateFlowActivations();

        expect(disarmed).toEqual([]);
        expect(triggers.record_change.isBound('welcome')).toBe(true);
        expect((await engine.execute('welcome')).success).toBe(true);
    });

    it('an engine with NO store attached behaves exactly as a stock boot', async () => {
        const engine = new AutomationEngine(createTestLogger());
        engine.registerFlow('welcome', packagedFlow('welcome'));

        // Nothing to hydrate, and nothing refused.
        expect(await engine.hydrateFlowActivations()).toEqual([]);
        expect((await engine.execute('welcome')).success).toBe(true);
    });

    it('re-enabling UPDATES the row rather than deleting it — the ledger records the choice', async () => {
        const { engine, store } = engineWithLedger();
        engine.registerFlow('welcome', packagedFlow('welcome'));

        await engine.toggleFlow('welcome', false);
        await engine.toggleFlow('welcome', true);

        // Still one row, now `active: true` — not an absent row. ADR-0126 §6
        // wall 3: the ledger records the customer's CHOICES.
        expect(await store.list()).toEqual([{ name: 'welcome', packageId: 'crm', active: true }]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7.2 — the execute() consult, on every entry path
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.2 — a ledger-disabled flow refuses at the execute() seam', () => {
    // The four trigger types whose flows reach `execute()` through their own
    // entry path. `execute()` is the ONE seam all of them cross (#11665 §2.3),
    // which is why the ADR puts the consult here — but "they all cross it" is
    // exactly the claim worth pinning, so each is driven separately.
    const entryPaths: Array<[string, Record<string, unknown>, keyof ReturnType<typeof engineWithLedger>['triggers']]> = [
        ['record-change', { objectName: 'lead', triggerType: 'record-after-create' }, 'record_change'],
        ['schedule', { schedule: '0 9 * * *' }, 'schedule'],
        ['time-relative', { timeRelative: { object: 'task', field: 'due_at' }, schedule: '0 * * * *' }, 'time_relative'],
        ['api', { triggerType: 'api' }, 'api'],
    ];

    for (const [label, startConfig, triggerKey] of entryPaths) {
        it(`refuses a disabled ${label} flow with FLOW_DISABLED, and re-enabling restores firing`, async () => {
            const { engine, triggers } = engineWithLedger();
            engine.registerFlow('f', packagedFlow('f', startConfig));
            expect((await engine.execute('f')).success).toBe(true);

            await engine.toggleFlow('f', false);
            const refused = await engine.execute('f');

            expect(refused.success).toBe(false);
            // ADR-0126 §7.2 reuses the code deliberately — ⛔ no new ADR-0112
            // ledger entry — so the CODE must be the existing one...
            expect(refused.code).toBe('FLOW_DISABLED');
            // ...and the distinction has to ride the MESSAGE.
            expect(refused.error).toContain('sys_metadata_activation');
            expect(refused.error).toContain('ADR-0126');
            // The trigger is unbound too, so it does not even fire (§7.2).
            expect(triggers[triggerKey].isBound('f')).toBe(false);

            await engine.toggleFlow('f', true);
            expect((await engine.execute('f')).success).toBe(true);
            expect(triggers[triggerKey].isBound('f')).toBe(true);
        });
    }

    it('refuses on the SUBFLOW entry path, and the caller fails with the child refusal composed in', async () => {
        const { engine } = engineWithLedger();
        registerSubflowNode(engine, { logger: createTestLogger(), getService: () => undefined } as any);

        engine.registerFlow('child', packagedFlow('child'));
        engine.registerFlow('parent', {
            ...packagedFlow('parent'),
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: {} },
                { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'child' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });
        expect((await engine.execute('parent')).success).toBe(true);

        // `child` has a packaged caller, so §7.3 refuses disabling it through
        // `toggleFlow`. That guard is the SUBJECT of the next describe block;
        // here the point is the runtime consult, so the ledger row is placed
        // directly — the shape a second process (or a previous boot) leaves.
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'child', packageId: 'crm', active: false });
        engine.setFlowActivationStore(store);
        await engine.hydrateFlowActivations();

        const direct = await engine.execute('child');
        expect(direct.success).toBe(false);
        expect(direct.code).toBe('FLOW_DISABLED');

        // The parent's own run fails at its subflow node, carrying the child's
        // refusal — the "inexplicable late failure" ADR-0126 §7.3 exists to
        // keep an administrator from causing by accident.
        const viaParent = await engine.execute('parent');
        expect(viaParent.success).toBe(false);
        expect(String(viaParent.error)).toContain('child');
    });

    it('a STATUS-disabled flow keeps its original message — the two disable reasons stay distinguishable', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('obsolete_flow', { ...packagedFlow('obsolete_flow'), status: 'obsolete' });

        const refused = await engine.execute('obsolete_flow');

        expect(refused.code).toBe('FLOW_DISABLED');
        expect(refused.error).toBe("Flow 'obsolete_flow' is disabled");
        // The point of the distinction: an operator reading this must not be
        // sent to the activation ledger for an authoring-state problem.
        expect(refused.error).not.toContain('sys_metadata_activation');
    });

    it('a ledger-disabled flow stays disabled across re-registration (publish / hot reload / boot pull)', async () => {
        const { engine, triggers } = engineWithLedger();
        const def = packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-create' });
        engine.registerFlow('f', def);
        await engine.toggleFlow('f', false);

        // The boot pull, a Studio publish and a dev hot reload all land here.
        engine.registerFlow('f', def);

        expect(triggers.record_change.isBound('f')).toBe(false);
        expect((await engine.execute('f')).code).toBe('FLOW_DISABLED');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7.2 — trigger unbind / rebind, and boot hydration
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.2 — the install-level row unbinds the trigger', () => {
    it('disable UNBINDS and enable REBINDS, asserted on the trigger itself', async () => {
        const { engine, triggers } = engineWithLedger();
        engine.registerFlow('f', packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-update' }));
        expect(triggers.record_change.isBound('f')).toBe(true);

        await engine.toggleFlow('f', false);
        expect(triggers.record_change.isBound('f')).toBe(false);

        await engine.toggleFlow('f', true);
        expect(triggers.record_change.isBound('f')).toBe(true);
    });

    it('hydration at boot unbinds a flow a PREVIOUS process disabled — the durability the map lacked', async () => {
        const store = new InMemoryFlowActivationStore();
        await store.setActive({ name: 'f', packageId: 'crm', active: false });

        // A brand-new engine: the #10243 map's "cold boot reads enabled: true
        // again" was recorded as mitigating-but-not-exculpating. It must no
        // longer be true.
        const engine = new AutomationEngine(createTestLogger());
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);
        engine.setFlowActivationStore(store);
        engine.registerFlow('f', packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-create' }));

        const disarmed = await engine.hydrateFlowActivations();

        expect(disarmed).toEqual(['f']);
        expect(trigger.isBound('f')).toBe(false);
        expect((await engine.execute('f')).code).toBe('FLOW_DISABLED');
    });

    it('getFlowRuntimeStates reports a ledger-disabled flow as disabled and unbound', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('f', packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-create' }));
        await engine.toggleFlow('f', false);

        const [state] = engine.getFlowRuntimeStates();

        expect(state.name).toBe('f');
        expect(state.enabled).toBe(false);
        expect(state.bound).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7.3 — the subflow cascade guard
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §7.3 — disabling a flow is refused while packaged flows call it as a subflow', () => {
    /** A packaged caller invoking `target` through the given node type. */
    function callerFlow(name: string, target: string, nodeType: 'subflow' | 'map') {
        return {
            ...packagedFlow(name),
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: {} },
                { id: 'call', type: nodeType, label: 'Call', config: { flowName: target } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        };
    }

    it('refuses, NAMES the caller, and carries the ADR-0112 envelope (code AND status)', async () => {
        const { engine, store } = engineWithLedger();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        engine.registerFlow('vendor_process', callerFlow('vendor_process', 'shared_step', 'subflow'));

        await expect(engine.toggleFlow('shared_step', false)).rejects.toThrow(/vendor_process/);

        const thrown = await engine.toggleFlow('shared_step', false).catch((e) => e);
        // ADR-0112 envelope: code AND status. `DELETE_RESTRICTED` is the
        // standard catalog's "cannot, due to dependencies" member (409) — ⛔ no
        // new ledger entry was minted for this refusal.
        expect(thrown.code).toBe('DELETE_RESTRICTED');
        expect(thrown.status).toBe(409);
        expect(thrown.subflowCallers).toEqual(['vendor_process']);
        // Q2(c)'s rationale rides the message: WHY refusing beats letting the
        // caller fail late, and what the administrator can do instead.
        expect(thrown.message).toContain('subflow');
        expect(thrown.message).toContain('ADR-0126 §7.3');
        expect(thrown.message).toMatch(/Disable the calling flow/);

        // Refused means nothing moved: no row, still armed, still runnable.
        expect(await store.list()).toEqual([]);
        expect((await engine.execute('shared_step')).success).toBe(true);
    });

    it('names EVERY packaged caller, not just the first', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        engine.registerFlow('caller_a', callerFlow('caller_a', 'shared_step', 'subflow'));
        engine.registerFlow('caller_b', callerFlow('caller_b', 'shared_step', 'subflow'));

        const thrown = await engine.toggleFlow('shared_step', false).catch((e) => e);

        expect(thrown.subflowCallers).toEqual(['caller_a', 'caller_b']);
        expect(thrown.message).toContain("'caller_a'");
        expect(thrown.message).toContain("'caller_b'");
    });

    it('guards a `map` caller too — its per-item target is a subflow by the node\'s own definition', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('per_item', packagedFlow('per_item'));
        engine.registerFlow('sweeper', callerFlow('sweeper', 'per_item', 'map'));

        const thrown = await engine.toggleFlow('per_item', false).catch((e) => e);

        // Scanning only `subflow` would let a `map` caller break exactly the
        // way §7.3 exists to prevent — it reaches its target through the same
        // `engine.execute`.
        expect(thrown?.code).toBe('DELETE_RESTRICTED');
        expect(thrown.subflowCallers).toEqual(['sweeper']);
    });

    it('with NO callers, disable lands', async () => {
        const { engine, store } = engineWithLedger();
        engine.registerFlow('lonely', packagedFlow('lonely'));

        await expect(engine.toggleFlow('lonely', false)).resolves.toBeUndefined();

        expect(await store.list()).toEqual([{ name: 'lonely', packageId: 'crm', active: false }]);
        expect((await engine.execute('lonely')).code).toBe('FLOW_DISABLED');
    });

    it('a NON-packaged caller does not guard — a tenant\'s own flow cannot hold a packaged one hostage', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        // Same graph, no `_packageId`: authored by the customer.
        engine.registerFlow('my_own_process', {
            ...callerFlow('my_own_process', 'shared_step', 'subflow'),
            _packageId: undefined,
        });

        await expect(engine.toggleFlow('shared_step', false)).resolves.toBeUndefined();
    });

    it('ENABLE is never guarded — arming a flow cannot break a caller', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('shared_step', packagedFlow('shared_step'));
        engine.registerFlow('vendor_process', callerFlow('vendor_process', 'shared_step', 'subflow'));

        // Disabled out-of-band (a previous boot), then re-enabled with the
        // caller still present: §7.3 attaches the guard to DISABLE only.
        await expect(engine.toggleFlow('shared_step', true)).resolves.toBeUndefined();
    });

    it('a flow calling ITSELF does not guard its own disable', async () => {
        const { engine } = engineWithLedger();
        engine.registerFlow('recursive', callerFlow('recursive', 'recursive', 'subflow'));

        await expect(engine.toggleFlow('recursive', false)).resolves.toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 / §4 — what actually reaches the ledger table
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0126 §4/§5 — the row this line writes', () => {
    /**
     * The exact ObjectQL slice the store declares — find/insert/update, and
     * deliberately NO `delete`: re-enabling updates the `active` bit, it never
     * removes the row.
     */
    function fakeEngine(rows: any[] = []) {
        const inserted: any[] = [];
        const updated: any[] = [];
        return {
            inserted,
            updated,
            rows,
            find: vi.fn(async (_object: string, options: any) => {
                const where = options?.where ?? {};
                return rows.filter((r) =>
                    Object.entries(where).every(([k, v]) => r[k] === v),
                );
            }),
            insert: vi.fn(async (_object: string, data: any) => {
                inserted.push(data);
                rows.push({ id: `row_${rows.length}`, ...data });
                return data;
            }),
            update: vi.fn(async (_object: string, data: any) => {
                updated.push(data);
                return data;
            }),
        };
    }

    it('writes metadata_type `flow` and leaves organization_id UNSET (install-level, §5)', async () => {
        const fake = fakeEngine();
        const store = new ObjectStoreFlowActivationStore(fake as any);

        await store.setActive({ name: 'welcome', packageId: 'crm', active: false });

        expect(fake.inserted).toHaveLength(1);
        expect(fake.inserted[0]).toEqual({
            metadata_type: 'flow',
            name: 'welcome',
            package_id: 'crm',
            active: false,
        });
        // ⛔ The absence of the key is what leaves the column NULL, which is
        // the whole of §5's install-level scope on this line. Writing an
        // organization here would be #10243 with persistence.
        expect(fake.inserted[0]).not.toHaveProperty('organization_id');
    });

    it('UPDATES the existing install-level row rather than inserting a second one', async () => {
        const fake = fakeEngine([
            { id: 'r1', metadata_type: 'flow', name: 'welcome', package_id: 'crm', active: false, organization_id: null },
        ]);
        const store = new ObjectStoreFlowActivationStore(fake as any);

        await store.setActive({ name: 'welcome', packageId: 'crm', active: true });

        expect(fake.inserted).toHaveLength(0);
        expect(fake.updated).toEqual([{ id: 'r1', active: true, package_id: 'crm' }]);
    });

    it('SKIPS rows carrying an organization_id — a per-org row is not an install-level answer', async () => {
        const fake = fakeEngine([
            { id: 'r1', metadata_type: 'flow', name: 'install_wide', active: false, organization_id: null },
            { id: 'r2', metadata_type: 'flow', name: 'one_tenant_only', active: false, organization_id: 'org_42' },
        ]);
        const store = new ObjectStoreFlowActivationStore(fake as any);

        const rows = await store.list();

        // Reading `r2` as install-level would apply one organization's choice
        // to the whole installation — the #10243 direction, from the read side.
        expect(rows.map((r: FlowActivationRow) => r.name)).toEqual(['install_wide']);
    });

    it('reads a driver 0/1 boolean as disabled, not as active', async () => {
        const fake = fakeEngine([
            { id: 'r1', metadata_type: 'flow', name: 'f', active: 0, organization_id: null },
        ]);
        const store = new ObjectStoreFlowActivationStore(fake as any);

        // SQLite/libsql round-trip booleans as integers; a bare truthiness test
        // is fine here but an `=== false` test would silently re-arm the flow.
        expect((await store.list())[0].active).toBe(false);
    });

    it('a failing durable write ABORTS the flip — the engine never reports state the ledger lacks', async () => {
        const engine = new AutomationEngine(createTestLogger());
        const trigger = recordingTrigger('record_change');
        engine.registerTrigger(trigger.trigger);
        engine.setFlowActivationStore({
            list: async () => [],
            setActive: async () => { throw new Error('datasource unavailable'); },
        });
        engine.registerFlow('f', packagedFlow('f', { objectName: 'lead', triggerType: 'record-after-create' }));

        await expect(engine.toggleFlow('f', false)).rejects.toThrow('datasource unavailable');

        // Nothing moved in process: still armed, still bound, still runnable.
        expect(trigger.isBound('f')).toBe(true);
        expect((await engine.execute('f')).success).toBe(true);
    });

    it('with no store attached the flip still applies, and WARNS that it is not durable', async () => {
        const logger = createTestLogger();
        const engine = new AutomationEngine(logger);
        engine.registerFlow('f', packagedFlow('f'));

        await engine.toggleFlow('f', false);

        expect((await engine.execute('f')).code).toBe('FLOW_DISABLED');
        // Degrading to in-process is a legitimate mode; degrading to it while
        // REPORTING durability is not.
        const warned = logger.warn.mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(warned).toContain('IN PROCESS ONLY');
        expect(warned).toContain('sys_metadata_activation');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// #10243 — the retired mechanism is GONE, not shaded
// ─────────────────────────────────────────────────────────────────────────────

describe('#10243 — the process-local `flowEnabled` map is retired', () => {
    const engineSource = readFileSync(
        fileURLToPath(new URL('./engine.ts', import.meta.url)),
        'utf8',
    );

    it('the identifier no longer exists as engine STATE', () => {
        // A grep-level pin, because the thing being asserted is the absence of
        // a mechanism and no runtime surface can show an absence. Prose
        // mentions survive (the docblocks explaining the retirement name it on
        // purpose); a field declaration or any read/write does not.
        expect(engineSource).not.toMatch(/private\s+flowEnabled/);
        expect(engineSource).not.toMatch(/this\.flowEnabled/);
    });

    it('the only writers of the activation projection are hydration and toggleFlow', () => {
        // What made the retired map a leak was that it was the TRUTH and
        // anything could set it. This pins that the replacement projection has
        // exactly two writers, both of which go through the durable ledger —
        // so it cannot drift into being an independent off-switch.
        const writes = [...engineSource.matchAll(/this\.flowLedgerDisabled\.(add|delete)\(/g)];
        expect(writes.length).toBeGreaterThan(0);

        const writingMethods = engineSource
            .split(/\n    (?=[a-zA-Z]|\/\*\*)/)
            .filter((chunk) => /this\.flowLedgerDisabled\.(add|delete)\(/.test(chunk));
        for (const chunk of writingMethods) {
            expect(
                /hydrateFlowActivations|toggleFlow/.test(chunk),
                `an unexpected method writes flowLedgerDisabled:\n${chunk.slice(0, 400)}`,
            ).toBe(true);
        }
    });

    it('the engine exposes no way to set activation state without the ledger', () => {
        const engine = new AutomationEngine(createTestLogger());
        // The retired mechanism's public shape, in every spelling a caller
        // might reach for. `toggleFlow` is the sanctioned door and it writes
        // the ledger; nothing else may exist beside it.
        expect((engine as any).setFlowEnabled).toBeUndefined();
        expect((engine as any).flowEnabled).toBeUndefined();
        expect(typeof engine.toggleFlow).toBe('function');
        expect(typeof engine.setFlowActivationStore).toBe('function');
    });
});
