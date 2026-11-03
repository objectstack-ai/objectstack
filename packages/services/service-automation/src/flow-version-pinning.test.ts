// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28405 (ADR-0146 D9 item 4) — a suspended run resumes on the flow body it
 * started on, not on the definition registered under its name now.
 *
 * An approval or screen step can wait for days. Before this card a flow
 * republished meanwhile moved the waiting run onto the new definition, or —
 * when the parked node was renamed — ended it `RUN_NOT_FOUND`. The run now
 * records the content identity of its body (`SuspendedRun.flowChecksum`) and
 * the resume looks that body up: the armed definition when it matches, else
 * the metadata history (`setFlowHistorySource`), else a body this process
 * registered.
 *
 * Pinned here, each against the engine and a JSON-cloning store:
 *  - a run parked on v1 finishes on v1 after v2 renames its node;
 *  - an edit without a `version` bump is still a different body;
 *  - new runs after v2 start on v2, while the old run finishes on v1;
 *  - a run with no recorded identity (a row written before the field) keeps
 *    the old reading: the armed definition, node checked;
 *  - a pinned body recoverable nowhere warns, naming the version it lost, and
 *    resumes on the armed definition (item 4 as decided on the card);
 *  - a history that cannot be read leaves the run parked and answers the
 *    retryable `STORE_UNAVAILABLE`, never "not stored".
 *
 * The restart on the durable store, through the real metadata history, is
 * `flow-version-pinning.integration.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { hashSpec } from '@objectstack/metadata-core';

import { AutomationEngine } from './engine.js';
import type { FlowHistorySource, SuspendedRunStore } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';

/** `resumeAuthority: 'any'` is required of a pausing fixture since #5561. */
const HOLD_DESCRIPTOR = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'Hold',
    supportsPause: true, resumeAuthority: 'any',
});

function recordingLogger() {
    const warnings: string[] = [];
    const logger: Record<string, unknown> = {
        info() {}, error() {}, debug() {},
        warn(message: string) { warnings.push(String(message)); },
        child() { return logger; },
    };
    return { logger: logger as never, warnings };
}

/**
 * start → `holdId` (pauses) → `mark` (records `tag`) → end. Which body a resume
 * ran on is read off the tag the `mark` node recorded after the pause.
 */
function taggedFlow(name: string, opts: { holdId?: string; tag: string; version?: number }) {
    const holdId = opts.holdId ?? 'approve';
    return {
        name, label: name, type: 'autolaunched', version: opts.version ?? 1,
        nodes: [
            { id: 'start', type: 'start', label: 's' },
            { id: holdId, type: 'hold', label: 'h' },
            { id: 'mark', type: 'mark', label: 'm', config: { tag: opts.tag } },
            { id: 'end', type: 'end', label: 'e' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: holdId },
            { id: 'e2', source: holdId, target: 'mark' },
            { id: 'e3', source: 'mark', target: 'end' },
        ],
    };
}

function engineOver(store: SuspendedRunStore) {
    const { logger, warnings } = recordingLogger();
    const ran: string[] = [];
    const engine = new AutomationEngine(logger, store);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: HOLD_DESCRIPTOR,
        async execute() { return { success: true, suspend: true, correlation: 'held' }; },
    } as never);
    engine.registerNodeExecutor({
        type: 'mark',
        async execute(node: { config?: { tag?: string } }) {
            ran.push(String(node.config?.tag));
            return { success: true };
        },
    } as never);
    engine.sealNodeTypeVocabulary();
    return { engine, ran, warnings };
}

async function park(engine: AutomationEngine, flowName: string): Promise<string> {
    const parked = await engine.execute(flowName, {} as never);
    expect(parked.status, JSON.stringify(parked)).toBe('paused');
    return parked.runId!;
}

describe('a suspended run resumes on the flow body it started on (#28405)', () => {
    it('parked on v1, resumed after v2 renamed its node: it finishes on v1, not RUN_NOT_FOUND', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, ran } = engineOver(store);
        engine.registerFlow('expense', taggedFlow('expense', { tag: 'v1' }) as never);
        const runId = await park(engine, 'expense');

        engine.registerFlow('expense', taggedFlow('expense', { holdId: 'approve_v2', tag: 'v2', version: 2 }) as never);

        expect(await engine.unresumableSuspensionCause(runId), 'the pre-flight classifies through the same read').toBeUndefined();
        const resumed = await engine.resume(runId);
        expect(resumed.success, JSON.stringify(resumed)).toBe(true);
        expect(ran, 'the node after the pause ran from the v1 body').toEqual(['v1']);
    });

    it('the run records the checksum of the body it started on — hashSpec(body, "flow"), the history key — beside the display version', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine } = engineOver(store);
        const v1 = taggedFlow('expense', { tag: 'v1', version: 7 });
        engine.registerFlow('expense', v1 as never);
        const runId = await park(engine, 'expense');

        const row = await store.load(runId);
        expect(row?.flowChecksum).toBe(hashSpec(v1, 'flow'));
        expect(row?.flowVersion, 'flow_version stays the author number').toBe(7);
    });

    it('a body changed without a `version` bump is still pinned', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, ran } = engineOver(store);
        engine.registerFlow('expense', taggedFlow('expense', { tag: 'v1' }) as never);
        const runId = await park(engine, 'expense');

        // Same `version: 1`, same node ids, different body.
        engine.registerFlow('expense', taggedFlow('expense', { tag: 'v1-edited' }) as never);

        expect((await engine.resume(runId)).success).toBe(true);
        expect(ran).toEqual(['v1']);
    });

    it('new runs after v2 start on v2 while the run parked on v1 finishes on v1', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, ran } = engineOver(store);
        engine.registerFlow('expense', taggedFlow('expense', { tag: 'v1' }) as never);
        const oldRun = await park(engine, 'expense');

        engine.registerFlow('expense', taggedFlow('expense', { tag: 'v2', version: 2 }) as never);
        expect((await engine.resume(oldRun)).success).toBe(true);

        const newRun = await park(engine, 'expense');
        expect((await engine.resume(newRun)).success).toBe(true);
        expect(ran, 'old run on v1, then the new run on v2').toEqual(['v1', 'v2']);
        expect((await engine.getFlow('expense'))?.version, 'the armed definition is still v2').toBe(2);
    });

    it('a row with no recorded identity (written before this field) keeps today\'s reading: the armed definition, node checked', async () => {
        const store = new InMemorySuspendedRunStore();
        const { engine, ran, warnings } = engineOver(store);
        engine.registerFlow('expense', taggedFlow('expense', { tag: 'v1' }) as never);
        const legacyRun = await park(engine, 'expense');
        const editedRun = await park(engine, 'expense');
        for (const runId of [legacyRun, editedRun]) {
            const row = (await store.load(runId))!;
            delete row.flowChecksum;
            await store.save(row);
            // A fresh read reaches the store, as after a restart.
            (engine as unknown as { suspendedRuns: Map<string, unknown> }).suspendedRuns.delete(runId);
        }

        engine.registerFlow('expense', taggedFlow('expense', { tag: 'v2', version: 2 }) as never);
        expect((await engine.resume(legacyRun)).success).toBe(true);
        expect(ran, 'the legacy row runs the armed v2 body').toEqual(['v2']);

        engine.registerFlow('expense', taggedFlow('expense', { holdId: 'approve_v3', tag: 'v3', version: 3 }) as never);
        const cause = await engine.unresumableSuspensionCause(editedRun);
        expect(cause).toBe(`Suspended node 'approve' no longer exists in flow 'expense'`);
        const resumed = await engine.resume(editedRun);
        expect(resumed.code).toBe('RUN_NOT_FOUND');
        expect(resumed.error, 'one classification, not two').toBe(cause);
        expect(warnings.filter((w) => w.includes('can no longer be recovered')), 'no identity, nothing lost').toEqual([]);
    });

    it('an unrecoverable pinned body (a code package upgraded under the run) warns, naming the version, and resumes on the armed definition', async () => {
        const store = new InMemorySuspendedRunStore();
        const first = engineOver(store);
        const v1 = taggedFlow('expense', { tag: 'v1', version: 4 });
        first.engine.registerFlow('expense', v1 as never);
        const runId = await park(first.engine, 'expense');

        // A new lifetime loads only the upgraded code body and no history.
        const second = engineOver(store);
        second.engine.registerFlow('expense', taggedFlow('expense', { tag: 'v2', version: 5 }) as never);

        expect(await second.engine.unresumableSuspensionCause(runId)).toBeUndefined();
        const resumed = await second.engine.resume(runId);
        expect(resumed.success, JSON.stringify(resumed)).toBe(true);
        expect(second.ran).toEqual(['v2']);
        const lost = second.warnings.filter((w) => w.includes('can no longer be recovered'));
        expect(lost, 'one warn, from the resume (the pre-flight only classifies)').toHaveLength(1);
        expect(lost[0]).toContain(`flow 'expense' version 4`);
        expect(lost[0]).toContain(hashSpec(v1, 'flow'));
    });

    it('a pinned body the history holds is recovered after a restart, and a history outage leaves the run parked', async () => {
        const store = new InMemorySuspendedRunStore();
        const first = engineOver(store);
        const v1 = taggedFlow('expense', { tag: 'v1' });
        first.engine.registerFlow('expense', v1 as never);
        const runId = await park(first.engine, 'expense');

        const second = engineOver(store);
        second.engine.registerFlow('expense', taggedFlow('expense', { holdId: 'approve_v2', tag: 'v2', version: 2 }) as never);
        let outage = true;
        const history = vi.fn<FlowHistorySource>(async (name, checksum) => {
            if (outage) throw new Error('history connection reset');
            return name === 'expense' && checksum === hashSpec(v1, 'flow') ? v1 : null;
        });
        second.engine.setFlowHistorySource(history);

        await expect(second.engine.unresumableSuspensionCause(runId)).rejects.toThrow(/history connection reset/);
        const refused = await second.engine.resume(runId);
        expect(refused.code).toBe('STORE_UNAVAILABLE');
        expect((await store.load(runId))?.nodeId, 'the suspension was not consumed').toBe('approve');

        outage = false;
        const resumed = await second.engine.resume(runId);
        expect(resumed.success, JSON.stringify(resumed)).toBe(true);
        expect(second.ran).toEqual(['v1']);
        expect(history).toHaveBeenLastCalledWith('expense', hashSpec(v1, 'flow'));
    });
});
