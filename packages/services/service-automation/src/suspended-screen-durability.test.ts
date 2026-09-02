// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `getSuspendedScreen` answers for any run that is genuinely suspended — across
 * a process restart (#4515).
 *
 * `SuspendedRun.screen` has always been persisted (`sys_automation_run.
 * screen_json`), and `resume` cold-reads it back through `loadSuspendedRun` on
 * a cache miss. But `getSuspendedScreen` was SYNCHRONOUS, so it structurally
 * could not consult the store — it read the in-memory hot cache and nothing
 * else. The result, for a durably suspended screen run after a restart:
 * `POST …/runs/:runId/resume` worked while `GET …/runs/:runId/screen` returned
 * 404 "No pending screen for run". The route exists precisely so a user can
 * refresh the page or continue on another device, and it failed exactly when
 * it was needed most — the rendering half of ADR-0019's durable-suspend
 * promise missing while the resuming half shipped.
 *
 * A shared {@link InMemorySuspendedRunStore} stands in for the database: the
 * run suspends on engine A, then a brand-new engine B backed by the same store
 * is the cold boot. The store JSON round-trips on save/load, so it exercises
 * the same serialization boundary `sys_automation_run` imposes.
 *
 * REVERT-PROOF: drop the store fallback in `AutomationEngine.getSuspendedScreen`
 * (back to `this.suspendedRuns.get(runId)?.screen ?? null`) and the cold-boot
 * case below fails while the hot-cache case still passes — which is the whole
 * bug, stated as a test.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import { registerScreenNodes } from './builtin/screen-nodes.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { SuspendedRunStore } from './engine.js';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}

/** A screen flow whose single screen collects one required field. */
const SCREEN_FLOW = {
    name: 'onboard',
    label: 'Onboard',
    type: 'screen',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
            id: 'collect', type: 'screen', label: 'Your details',
            config: {
                title: 'Your details',
                fields: [{ name: 'full_name', label: 'Full name', type: 'text', required: true }],
            },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'collect' },
        { id: 'e2', source: 'collect', target: 'end' },
    ],
} as any;

/** A fresh engine over `store` — one per simulated process lifetime. */
function buildEngine(store?: SuspendedRunStore) {
    const e = new AutomationEngine(silentLogger(), store);
    registerScreenNodes(e, { logger: silentLogger() } as any);
    e.registerFlow('onboard', SCREEN_FLOW);
    return e;
}

describe('getSuspendedScreen is durable (#4515)', () => {
    it('hot path: the screen is re-fetchable from the engine that paused it', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = buildEngine(store);

        const paused = await engine.execute('onboard');
        expect(paused.status).toBe('paused');

        // Same process. [#13617] made this read store-authoritative, so it does
        // consult the store — the point of the case is unchanged: the engine
        // that paused the run still renders its screen.
        const screen = await engine.getSuspendedScreen(paused.runId!);
        expect(screen).toMatchObject({ nodeId: 'collect', title: 'Your details' });
        expect(screen!.fields[0]).toMatchObject({ name: 'full_name', required: true });
    });

    it('THE BUG: after a restart the screen still re-fetches from the durable store', async () => {
        const store = new InMemorySuspendedRunStore();

        // Process lifetime #1 — the run suspends at the screen node.
        const engineA = buildEngine(store);
        const paused = await engineA.execute('onboard');
        expect(paused.status).toBe('paused');
        const runId = paused.runId!;

        // Process lifetime #2 — a cold-booted engine. Nothing in its hot cache…
        const engineB = buildEngine(store);
        expect(engineB.listSuspendedRuns()).toHaveLength(0);

        // …yet the run is genuinely suspended, so its screen must render.
        const screen = await engineB.getSuspendedScreen(runId);
        expect(screen).not.toBeNull();
        expect(screen).toMatchObject({ nodeId: 'collect', title: 'Your details' });
        expect(screen!.fields[0]).toMatchObject({ name: 'full_name', required: true, type: 'text' });
        // The screen the fresh engine serves is the screen the run paused on.
        expect(screen).toEqual(paused.screen);

        // Read-only: the suspension is not consumed, so the resume that the
        // refreshed UI submits next still lands.
        expect(await engineB.getSuspendedScreen(runId)).toEqual(paused.screen);
        const done = await engineB.resume(runId, { variables: { full_name: 'Ada' } });
        expect(done.success).toBe(true);
        expect(done.status).toBeUndefined();

        // Once the run is terminal there is no screen to render any more.
        expect(await engineB.getSuspendedScreen(runId)).toBeNull();
    });

    it('a genuinely absent run is still null (the 404 stays a 404)', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = buildEngine(store);
        expect(await engine.getSuspendedScreen('run_does_not_exist')).toBeNull();

        // …and so is a suspension that carries no screen (paused at a
        // non-screen node): durable ≠ "invent a screen".
        const e = new AutomationEngine(silentLogger(), store);
        e.registerNodeExecutor({
            type: 'pause_node',
            async execute() { return { success: true, suspend: true }; },
        });
        e.registerFlow('approval', {
            name: 'approval', label: 'Approval', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'pause', type: 'pause_node', label: 'Wait' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'pause' },
                { id: 'e2', source: 'pause', target: 'end' },
            ],
        } as any);
        const paused = await e.execute('approval');
        expect(paused.status).toBe('paused');
        // Cold engine over the same store: the run IS suspended, but not at a
        // screen — `null`, not a throw and not a fabricated form.
        expect(await buildEngine(store).getSuspendedScreen(paused.runId!)).toBeNull();
    });

    it('a store outage reads as "no pending screen", never as a throw', async () => {
        // Best-effort by design: this backs a 404, and the caller that must
        // tell "gone" from "unknown" before writing uses `hasSuspendedRun`,
        // which throws instead.
        const brokenStore: SuspendedRunStore = {
            async save() {},
            async load() { throw new Error('sqlite: database is locked'); },
            async delete() {},
            async list() { return []; },
        };
        const engine = buildEngine(brokenStore);
        await expect(engine.getSuspendedScreen('run_x')).resolves.toBeNull();
        await expect(engine.hasSuspendedRun('run_x')).rejects.toThrow(/database is locked/);
    });

    it('with no store at all, behaviour is unchanged (in-memory only)', async () => {
        const engine = buildEngine(); // no store
        const paused = await engine.execute('onboard');
        expect(await engine.getSuspendedScreen(paused.runId!)).toMatchObject({ nodeId: 'collect' });
        // A different engine has no way to know about it — nothing was persisted.
        expect(await buildEngine().getSuspendedScreen(paused.runId!)).toBeNull();
    });
});
