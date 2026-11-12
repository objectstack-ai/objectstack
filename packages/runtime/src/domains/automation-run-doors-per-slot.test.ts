// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4/D5/D9, #31696] The run doors under a flow name two namespaces'
 * packages hold — `send_digest`, held by CRM and HR, one engine slot each,
 * every run carrying its slot key (`PACKAGE/NAME`).
 *
 *  - Under a namespace's address (`/automation/:ns/:name/runs/:runId/…`) the
 *    run read, resume, cancel, restore-suspension and the screen read act on
 *    the address's own run; another holder's run under that address is
 *    answered as the door answers a run nobody holds, and its verb is never
 *    called (the #25820 scope check, read through the holder's slot).
 *  - The BARE run doors (`/automation/:name/runs/:runId/…`) act on the run's
 *    own slot: a run id names exactly one run, and the run carries its slot
 *    key. A run of another flow, a run carrying no package and a run nobody
 *    holds keep the `409` naming both, as does the bare run list.
 *
 * Driven through the real `HttpDispatcher`, with an automation double holding
 * the slots and the run verbs, and a registry double answering the holder and
 * namespace tables.
 */

import { describe, it, expect, vi } from 'vitest';
import '@objectstack/metadata';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const CRM = 'com.crm.pkg';
const HR = 'com.hr.pkg';
const NAME = 'send_digest';

/** Each run the engine holds, by id → the flow key it carries. */
const RUNS: Record<string, string> = {
    'r-crm': `${CRM}/${NAME}`,
    'r-hr': `${HR}/${NAME}`,
    'r-other': 'other_flow',
    // A package-less run of the shared name: the engine's unfiled spelling.
    'r-unfiled': `\u0000${NAME}`,
};

interface HarnessOptions {
    /** The flow key each run carries; defaults to {@link RUNS}. */
    runs?: Record<string, string>;
    /** The packages the ENGINE holds a slot of `NAME` for (the registry holds CRM and HR either way). */
    slots?: string[];
    /** The engine has no slot entries at all. */
    noSlots?: boolean;
    /** `getRun` answers `null` for every run: only the suspended-run list names it. */
    getRunBlind?: boolean;
}

function harness(options: HarnessOptions = {}) {
    const runs = options.runs ?? RUNS;
    const slots = options.slots ?? [CRM, HR];
    const known = (runId: string) => Object.prototype.hasOwnProperty.call(runs, runId);
    const keyOf = (pkg: string | null, name: string) => {
        if (name !== NAME || pkg === null || !slots.includes(pkg)) return undefined;
        return slots.length > 1 ? `${pkg}/${NAME}` : NAME;
    };
    const shared = () => Object.assign(new Error(`Flow '${NAME}' is held by several packages`), { code: 'RESOURCE_CONFLICT', status: 409 });
    const automation: Record<string, any> = {
        handlerReady: true,
        getFlow: vi.fn(async (name: string) => { if (name === NAME) throw shared(); return null; }),
        execute: vi.fn(),
        resume: vi.fn(async (runId: string) => (known(runId)
            ? { success: true, runId, output: { done: true } }
            : { success: false, code: 'RUN_NOT_FOUND', error: `No suspended run '${runId}'` })),
        cancelRun: vi.fn(async (runId: string) => known(runId)),
        restoreConsumedSuspension: vi.fn(async (runId: string) => (known(runId)
            ? { restored: true, runId, reason: 'Suspension restored.' }
            : { restored: false, runId, refusal: 'RUN_NOT_FOUND', reason: `No run '${runId}' is known` })),
        getSuspendedScreen: vi.fn(async (runId: string) => (known(runId) ? { title: 'Digest', fields: [] } : null)),
        getRun: vi.fn(async (runId: string) => (options.getRunBlind || !known(runId)
            ? null
            : { id: runId, flowName: runs[runId], status: 'paused', trigger: { type: 'api', userId: 'usr_admin' } })),
        listSuspendedRuns: vi.fn(() => Object.entries(runs).map(([runId, flowName]) => ({ runId, flowName, nodeId: 'collect' }))),
        listRunsPage: vi.fn(async () => ({ runs: [], hasMore: false })),
    };
    if (!options.noSlots) {
        Object.assign(automation, {
            flowSlotKey: vi.fn((pkg: string | null, name: string) => keyOf(pkg, name)),
            getFlowSlot: vi.fn((pkg: string | null, name: string) => (keyOf(pkg, name) ? { name, label: `${pkg} flow` } : null)),
            executeSlot: vi.fn(async () => ({ success: true, output: {} })),
            toggleFlowSlot: vi.fn(async () => {}),
        });
    }
    const namespaces: Record<string, string> = { [CRM]: 'crm', [HR]: 'hr' };
    const holdersOf = (type: string, name: string) => (type === 'flow' && name === NAME ? [CRM, HR] : []);
    const registry = {
        getNamespaceOwners: (ns: string) => Object.keys(namespaces).filter((id) => namespaces[id] === ns),
        packageScopedHoldersOf: holdersOf,
        getPackageScopedItem: (type: string, name: string, packageId: string) =>
            (holdersOf(type, name).includes(packageId) ? { name, _packageId: packageId } : undefined),
        getEnvironmentScopedItem: () => undefined,
        getPackage: (id: string) => (namespaces[id] ? { manifest: { id, namespace: namespaces[id] } } : undefined),
    };
    const services: Record<string, unknown> = { automation, objectql: { registry } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve, trigger: async () => undefined },
    };
    return { dispatcher: new HttpDispatcher(kernel), automation };
}

/** Clears every gate the run doors keep (#7900 read, #19987 resume, #13953 operator). */
const ADMIN_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'usr_admin', posture: 'PLATFORM_ADMIN' } } as HttpProtocolContext);

interface Door {
    label: string;
    method: 'GET' | 'POST';
    tail: string;
    body?: unknown;
    /** The verb the door calls with the run id. */
    verb: 'resume' | 'cancelRun' | 'restoreConsumedSuspension' | 'getSuspendedScreen' | 'getRun';
}

const DOORS: Door[] = [
    { label: 'run read', method: 'GET', tail: '', verb: 'getRun' },
    { label: 'resume', method: 'POST', tail: '/resume', body: { inputs: { ok: true } }, verb: 'resume' },
    { label: 'cancel', method: 'POST', tail: '/cancel', verb: 'cancelRun' },
    { label: 'restore-suspension', method: 'POST', tail: '/restore-suspension', verb: 'restoreConsumedSuspension' },
    { label: 'screen read', method: 'GET', tail: '/screen', verb: 'getSuspendedScreen' },
];

/** The door's state-changing verb, never called on a refused request (the reads are judged by their answer). */
const WRITES = new Set<Door['verb']>(['resume', 'cancelRun', 'restoreConsumedSuspension']);

async function send(h: ReturnType<typeof harness>, door: Door, prefix: string, runId: string) {
    const { response } = await h.dispatcher.handleAutomation(`${prefix}/runs/${runId}${door.tail}`, door.method, door.body ?? {}, ADMIN_CTX(), {});
    return { status: (response as any)?.status ?? 200, body: (response as any)?.body };
}

/**
 * The answer `prefix`'s door gives `runId` is the one it gives a run nobody
 * holds (the run id named alike): the door's own not-found, and for cancel
 * its `cancelled: false`.
 */
async function expectAnsweredAsNobodys(h: ReturnType<typeof harness>, door: Door, prefix: string, runId: string) {
    const answer = await send(h, door, prefix, runId);
    const nobody = await send(harness(), door, prefix, 'r-nobody');
    expect(JSON.stringify(answer).split(runId).join('RUNID'), `${prefix} ${runId}`).toBe(JSON.stringify(nobody).split('r-nobody').join('RUNID'));
}

const codeOf = (a: { body?: any }) => a.body?.error?.code;
const candidatesOf = (a: { body?: any }) => a.body?.error?.details?.candidates ?? a.body?.details?.candidates;
const verbRunIds = (h: ReturnType<typeof harness>, verb: Door['verb']) => h.automation[verb].mock.calls.map((c: unknown[]) => c[0]);
const BOTH = [{ kind: 'package', packageId: CRM }, { kind: 'package', packageId: HR }];

describe('[ADR-0150 D4/D9, #31696] a namespace\'s address acts on its own holder\'s run, at every run door', () => {
    for (const door of DOORS) {
        describe(door.label, () => {
            it('the address\'s own run is served: CRM\'s under `crm`, HR\'s under `hr`', async () => {
                const h = harness();
                const crm = await send(h, door, `/crm/${NAME}`, 'r-crm');
                expect(crm.status, JSON.stringify(crm.body)).toBe(200);
                const hr = await send(h, door, `/hr/${NAME}`, 'r-hr');
                expect(hr.status, JSON.stringify(hr.body)).toBe(200);
                if (WRITES.has(door.verb)) expect(verbRunIds(h, door.verb)).toEqual(['r-crm', 'r-hr']);
            });

            it('another holder\'s run under that address is answered as a run nobody holds, and its verb is never called', async () => {
                const h = harness();
                await expectAnsweredAsNobodys(h, door, `/crm/${NAME}`, 'r-hr');
                await expectAnsweredAsNobodys(h, door, `/hr/${NAME}`, 'r-crm');
                if (WRITES.has(door.verb)) expect(h.automation[door.verb]).not.toHaveBeenCalled();
            });

            it('a package-less run of the name is served by neither address', async () => {
                const h = harness();
                await expectAnsweredAsNobodys(h, door, `/crm/${NAME}`, 'r-unfiled');
                await expectAnsweredAsNobodys(h, door, `/hr/${NAME}`, 'r-unfiled');
                if (WRITES.has(door.verb)) expect(h.automation[door.verb]).not.toHaveBeenCalled();
            });

            it('[M1] while the engine holds only CRM\'s slot, filed under the bare name, CRM\'s run is not served under `hr`', async () => {
                const h = harness({ slots: [CRM], runs: { 'r-lone': NAME } });
                await expectAnsweredAsNobodys(h, door, `/hr/${NAME}`, 'r-lone');
                if (WRITES.has(door.verb)) expect(h.automation[door.verb]).not.toHaveBeenCalled();
                const underCrm = await send(h, door, `/crm/${NAME}`, 'r-lone');
                expect(underCrm.status, JSON.stringify(underCrm.body)).toBe(200);
                if (WRITES.has(door.verb)) expect(verbRunIds(h, door.verb)).toEqual(['r-lone']);
            });
        });
    }
});

describe('[ADR-0150 D4, #31696] a bare run door on a shared name acts on the run\'s own slot', () => {
    for (const door of DOORS) {
        describe(door.label, () => {
            it('each holder\'s run is served at the bare door, exactly as under its own address', async () => {
                for (const [runId, ns] of [['r-crm', 'crm'], ['r-hr', 'hr']] as const) {
                    const bareH = harness();
                    const bare = await send(bareH, door, `/${NAME}`, runId);
                    expect([runId, bare.status], JSON.stringify(bare.body)).toEqual([runId, 200]);
                    const addressed = await send(harness(), door, `/${ns}/${NAME}`, runId);
                    expect(bare).toEqual(addressed);
                    if (WRITES.has(door.verb)) expect(verbRunIds(bareH, door.verb)).toEqual([runId]);
                }
            });

            it('a run the suspended-run list alone names is still its own slot\'s', async () => {
                const h = harness({ getRunBlind: true });
                const answer = await send(h, door, `/${NAME}`, 'r-crm');
                // The run read answers `getRun`'s own miss; every other door is served.
                if (door.verb === 'getRun') expect(answer.status).toBe(404);
                else expect(answer.status, JSON.stringify(answer.body)).toBe(200);
            });

            for (const [runId, what] of [
                ['r-other', 'a run of another flow'],
                ['r-unfiled', 'a run carrying no package'],
                ['r-nobody', 'a run nobody holds'],
            ] as const) {
                it(`${what} keeps the 409 naming both, and nothing is acted on`, async () => {
                    const h = harness();
                    const answer = await send(h, door, `/${NAME}`, runId);
                    expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
                    expect(candidatesOf(answer)).toEqual(BOTH);
                    if (WRITES.has(door.verb)) expect(h.automation[door.verb]).not.toHaveBeenCalled();
                });
            }

            it('CONTROL — an engine with no slot entries keeps the 409 naming both (fail closed)', async () => {
                const h = harness({ noSlots: true });
                const answer = await send(h, door, `/${NAME}`, 'r-crm');
                expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
                if (WRITES.has(door.verb)) expect(h.automation[door.verb]).not.toHaveBeenCalled();
            });

            it('CONTROL — the run filed under the bare name while the registry holds the name twice carries no package: 409', async () => {
                const h = harness({ slots: [CRM], runs: { 'r-lone': NAME } });
                const answer = await send(h, door, `/${NAME}`, 'r-lone');
                expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
                if (WRITES.has(door.verb)) expect(h.automation[door.verb]).not.toHaveBeenCalled();
            });
        });
    }

    it('CONTROL — the bare run list names no run: still 409 naming both', async () => {
        const h = harness();
        const { response } = await h.dispatcher.handleAutomation(`/${NAME}/runs`, 'GET', {}, ADMIN_CTX(), {});
        const answer = { status: (response as any)?.status, body: (response as any)?.body };
        expect([answer.status, codeOf(answer)], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(candidatesOf(answer)).toEqual(BOTH);
        expect(h.automation.listRunsPage).not.toHaveBeenCalled();
    });

    it('the bare run read answers the run named as its flow, as the address does', async () => {
        const h = harness();
        const answer = await send(h, DOORS[0], `/${NAME}`, 'r-hr');
        expect(answer.body?.data?.flowName ?? answer.body?.flowName).toBe(NAME);
    });
});
