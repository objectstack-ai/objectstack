// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25820] The `:name` segment of every `/automation/:name/runs/:runId/*` door
 * is a SCOPE the door checks, not a decoration it ignores.
 *
 * Every one of these doors reads the run by `runId` alone, so before this card
 * `POST /automation/OTHER_FLOW/runs/RUNID/resume` completed another flow's
 * paused run, and `GET /automation/OTHER_FLOW/runs/RUNID` served it. The URL
 * claimed a scope the server never checked: a caller holding a stale or
 * mixed-up runId acted on the wrong flow's run, silently, and the audit trail
 * read as if the named flow had been acted on.
 *
 * The ruling (triage 6399818476): a flow name that exists but does not own the
 * run answers what an UNKNOWN name answers — `404 RUN_NOT_FOUND` on the resume
 * and run-read doors — byte for byte. Each door below is held to the same
 * sentence: "exists but not the owner" ≡ "unknown flow" ≡ "unknown run", where
 * the last is that door's own not-found answer for a runId nobody holds. The
 * fake engine answers an unknown run in the real engine's spelling
 * (`service-automation` `run-resume.ts` / `consumed-suspension-restore.ts`).
 *
 * ⛔ Not an authorization change. Who may act is still decided where it was
 * (`refuseUnrelatedResume`, the #7900 read gate, the #13953 operator gate); the
 * scope check runs after those, immediately before the verb, so a mismatched
 * request consumes nothing: the run stays paused and nothing is written.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const OWNER = 'showcase_reassign_wizard';
const OTHER = 'showcase_project_closure';
const UNKNOWN = 'no_such_flow';
const RUN = 'run_wizard_1';
const NOBODYS_RUN = 'run_nobody_holds';

interface HarnessOptions {
    /** `getRun` answers `null` for every run, as after a degraded durable read. */
    getRunBlind?: boolean;
    /** Neither `getRun` nor `listSuspendedRuns` is mounted. */
    noOwnerProbe?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
    const runs = new Map([[RUN, {
        id: RUN,
        flowName: OWNER,
        status: 'paused',
        trigger: { type: 'api', userId: 'usr_admin' },
        startedAt: '2026-10-26T00:00:00.000Z',
    }]]);
    const flows = new Set([OWNER, OTHER]);
    const screen = { title: 'Reassign', fields: [{ name: 'new_assignee', type: 'text' }] };

    const resume = vi.fn(async (runId: string) => (runs.has(runId)
        ? { success: true, runId, output: { done: true } }
        : { success: false, code: 'RUN_NOT_FOUND', error: `No suspended run '${runId}'` }));
    const cancelRun = vi.fn(async (runId: string) => runs.has(runId));
    const restoreConsumedSuspension = vi.fn(async (runId: string) => (runs.has(runId)
        ? { restored: true, runId, reason: 'Suspension restored.' }
        : { restored: false, runId, refusal: 'RUN_NOT_FOUND', reason: `No run '${runId}' is known` }));
    const getSuspendedScreen = vi.fn(async (runId: string) => (runs.has(runId) ? screen : null));

    const automation: Record<string, unknown> = {
        handlerReady: true,
        execute: vi.fn(),
        resume,
        cancelRun,
        restoreConsumedSuspension,
        getSuspendedScreen,
        listFlows: async () => [...flows],
        getFlow: async (name: string) => (flows.has(name) ? { name, nodes: [] } : null),
    };
    if (!options.noOwnerProbe) {
        automation.getRun = async (runId: string) => (options.getRunBlind ? null : runs.get(runId) ?? null);
        automation.listSuspendedRuns = () => [...runs.values()].map((r) => ({ runId: r.id, flowName: r.flowName, nodeId: 'collect' }));
    }

    const services: Record<string, unknown> = { automation };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve, trigger: async () => undefined },
    };
    return {
        dispatcher: new HttpDispatcher(kernel as never),
        resume,
        cancelRun,
        restoreConsumedSuspension,
    };
}

/** Clears every gate the doors keep (#7900 read, #19987 resume, #13953 operator). */
const ADMIN_CTX = (): HttpProtocolContext =>
    ({ request: {}, executionContext: { userId: 'usr_admin', posture: 'PLATFORM_ADMIN' } } as HttpProtocolContext);

interface Door {
    label: string;
    method: 'GET' | 'POST';
    path: (flow: string, runId: string) => string;
    body?: unknown;
    /** The verb that changes state; asserted never called on a mismatch. */
    verb?: 'resume' | 'cancelRun' | 'restoreConsumedSuspension';
    /** The door's own success status for the owning flow. */
    okStatus: number;
}

const DOORS: Door[] = [
    {
        label: 'POST /:name/runs/:runId/resume',
        method: 'POST',
        path: (f, r) => `${f}/runs/${r}/resume`,
        body: { inputs: { new_assignee: 'usr_b' } },
        verb: 'resume',
        okStatus: 200,
    },
    { label: 'GET /:name/runs/:runId', method: 'GET', path: (f, r) => `${f}/runs/${r}`, okStatus: 200 },
    { label: 'GET /:name/runs/:runId/screen', method: 'GET', path: (f, r) => `${f}/runs/${r}/screen`, okStatus: 200 },
    {
        label: 'POST /:name/runs/:runId/cancel',
        method: 'POST',
        path: (f, r) => `${f}/runs/${r}/cancel`,
        verb: 'cancelRun',
        okStatus: 200,
    },
    {
        label: 'POST /:name/runs/:runId/restore-suspension',
        method: 'POST',
        path: (f, r) => `${f}/runs/${r}/restore-suspension`,
        verb: 'restoreConsumedSuspension',
        okStatus: 200,
    },
];

async function send(h: ReturnType<typeof makeHarness>, door: Door, flow: string, runId: string) {
    const { response } = await h.dispatcher.handleAutomation(door.path(flow, runId), door.method, door.body, ADMIN_CTX(), {});
    return { status: (response as any)?.status, body: (response as any)?.body };
}

describe('#25820 — a flow name that does not own the run is answered as an unknown one', () => {
    for (const door of DOORS) {
        describe(door.label, () => {
            it('a flow that exists but does not own the run answers exactly what an unknown flow name answers', async () => {
                const h = makeHarness();
                const mismatched = await send(h, door, OTHER, RUN);
                const unknownFlow = await send(h, door, UNKNOWN, RUN);
                expect(mismatched).toEqual(unknownFlow);
            });

            it('…which is exactly the door\'s answer for a run nobody holds — no existence oracle', async () => {
                const h = makeHarness();
                const mismatched = await send(h, door, OTHER, RUN);
                const nobodys = await send(h, door, OWNER, NOBODYS_RUN);
                // The runId is echoed in some answers; compare with it named.
                expect(JSON.stringify(mismatched).split(RUN).join('RUNID'))
                    .toBe(JSON.stringify(nobodys).split(NOBODYS_RUN).join('RUNID'));
            });

            if (door.verb) {
                it('a mismatched request reaches no state-changing verb', async () => {
                    const h = makeHarness();
                    await send(h, door, OTHER, RUN);
                    await send(h, door, UNKNOWN, RUN);
                    expect(h[door.verb!]).not.toHaveBeenCalled();
                });
            }

            it('control: the owning flow name is served as before', async () => {
                const h = makeHarness();
                const owned = await send(h, door, OWNER, RUN);
                expect(owned.status).toBe(door.okStatus);
                if (door.verb) expect(h[door.verb]).toHaveBeenCalledWith(RUN, ...(door.verb === 'resume' ? [expect.anything()] : [expect.anything()]));
            });

            it('the owner is still checked when `getRun` cannot see the run, through the suspended-run list', async () => {
                const h = makeHarness({ getRunBlind: true });
                const mismatched = await send(h, door, OTHER, RUN);
                const unknownFlow = await send(h, door, UNKNOWN, RUN);
                expect(mismatched).toEqual(unknownFlow);
                if (door.verb) expect(h[door.verb]).not.toHaveBeenCalled();
            });
        });
    }

    it('resume and run-read answer the mismatch 404 RUN_NOT_FOUND (the ruling, by code and status)', async () => {
        const h = makeHarness();
        const resumed = await send(h, DOORS[0], OTHER, RUN);
        expect(resumed.status).toBe(404);
        expect(resumed.body?.error?.code).toBe('RUN_NOT_FOUND');
        const read = await send(h, DOORS[1], OTHER, RUN);
        expect(read.status).toBe(404);
        expect(read.body?.error?.code).toBe('RUN_NOT_FOUND');
    });

    it('a service that cannot name a run\'s flow keeps today\'s answer: the door cannot prove a mismatch', async () => {
        const h = makeHarness({ noOwnerProbe: true });
        const resumed = await send(h, DOORS[0], OTHER, RUN);
        expect(resumed.status).toBe(200);
        expect(h.resume).toHaveBeenCalledTimes(1);
    });
});
