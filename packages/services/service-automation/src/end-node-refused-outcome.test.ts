// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15788 — the `end` executor honours `outcome: 'refused'` (lane 2 of the
 * #14945 ruling 2′).
 *
 * `packages/spec` landed the contract first (lane 1): `ExecutionStatus` gained
 * `refused`, `EndConfigSchema` gained `outcome: 'completed' | 'refused'` with a
 * `message` that is REQUIRED beside a refusal and REFUSED beside a completion,
 * `ExecutionLogSchema` gained `refusalMessage`, and `AutomationResult` /
 * `TriggerFlowResponseSchema` gained both. Nothing in this package produced any
 * of it: `executeNode` opened with `if (node.type === 'end') return;`, so an
 * author's refusal ran as a plain completion — the run recorded `completed`,
 * the caller got the flow's `successMessage`, and the authored reason reached
 * nobody. Declared, never enforced.
 *
 * ⚠️ Direction, predicted before running. The tests under "the defect" FAIL
 * against the unfixed engine — `undefined` / `'completed'` where the refusal is
 * expected. The ones under "the boundary" are green on both sides ON PURPOSE:
 * they fence the change rather than demonstrate it, and each says which side it
 * guards. The `successMessage` / `silent` pins are of that second kind —
 * the ruling names them ⛔ do not touch, so a pin that reddened would mean the
 * change had reached something it must not.
 *
 * ⚠️ `refused` is NOT the `refused` this package says everywhere else. A guard
 * refusal (`guard-refusal.ts`, `refuseNode`, the resume-authority gate) means
 * "the engine refused to execute" — a FAILURE. This file's `refused` is the
 * terminal run outcome the ruling defines: *a refusal is a successful
 * evaluation that says no*. Nearly opposite senses, same word, so grep hits in
 * this package are mostly the other family.
 */

import { describe, it, expect } from 'vitest';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { installBuiltinNodes } from './builtin/index.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

/** The flow author's completion toast — must never ride a refusal. */
const SUCCESS_TEXT = 'Account created — the owner has been notified.';
/** The authored refusal template. `{record.name}` is what makes it per-record. */
const REFUSAL_TEMPLATE = 'Refused: {record.name} is a confirmed duplicate';

/**
 * A two-node flow whose `end` node carries the config under test.
 * `successMessage` is always declared, so every refusal assertion doubles as a
 * "the completion toast stayed silent" assertion.
 */
function endFlow(name: string, endConfig?: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        successMessage: SUCCESS_TEXT,
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'finish', type: 'end', label: 'Finish', ...(endConfig ? { config: endConfig } : {}) },
        ],
        edges: [{ id: 'e0', source: 'start', target: 'finish' }],
    };
}

/** The two records of the fixture the ruling names — per-record text, not one constant. */
const ACME = { id: 'rec_1', name: 'Acme Corp' } as const;
const GLOBEX = { id: 'rec_2', name: 'Globex Industries' } as const;

function ctxFor(record: Record<string, unknown>): AutomationContext {
    return { event: 'manual', object: 'account', record } as unknown as AutomationContext;
}

function engineWithStore() {
    const store = new InMemorySuspendedRunStore();
    const engine = new AutomationEngine(createTestLogger(), store);
    return { engine, store };
}

/** The newest run id for a flow — a refusal carries no `runId` (only a pause does). */
async function newestRunId(engine: AutomationEngine, flowName: string): Promise<string> {
    const runs = await engine.listRuns(flowName, { limit: 5 });
    expect(runs.length).toBeGreaterThan(0);
    return runs[0]!.id;
}

describe('#15788 — the defect: a refusing `end` ran as a plain completion', () => {
    it('a `refused` end terminates the run with status `refused` and the rendered message', async () => {
        const { engine } = engineWithStore();
        engine.registerFlow('dedupe', endFlow('dedupe', { outcome: 'refused', message: REFUSAL_TEMPLATE }) as never);

        const result = await engine.execute('dedupe', ctxFor({ ...ACME }));

        // A refusal is a SUCCESSFUL evaluation that says no — `success` stays
        // true and the run is not an error.
        expect(result.success).toBe(true);
        expect(result.status).toBe('refused');
        expect(result.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
        // ⛔ Distinct from `failed`, in both directions: nothing threw, so
        // there is no `error` and no `errorMessage`.
        expect(result.error).toBeUndefined();
        expect(result.errorMessage).toBeUndefined();
    });

    it('interpolates PER RECORD — the two-record fixture the ruling names', async () => {
        const { engine } = engineWithStore();
        engine.registerFlow('dedupe', endFlow('dedupe', { outcome: 'refused', message: REFUSAL_TEMPLATE }) as never);

        const first = await engine.execute('dedupe', ctxFor({ ...ACME }));
        const second = await engine.execute('dedupe', ctxFor({ ...GLOBEX }));

        expect(first.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
        expect(second.refusalMessage).toBe('Refused: Globex Industries is a confirmed duplicate');
        // The template itself never reaches a caller — that is the whole point
        // of rendering it here rather than on the wire.
        expect(first.refusalMessage).not.toContain('{record.name}');
    });

    it('the run RECORD carries the outcome and the rendered message', async () => {
        const { engine, store } = engineWithStore();
        engine.registerFlow('dedupe', endFlow('dedupe', { outcome: 'refused', message: REFUSAL_TEMPLATE }) as never);

        await engine.execute('dedupe', ctxFor({ ...ACME }));
        const runId = await newestRunId(engine, 'dedupe');

        // The observability surface (`GET /automation/:name/runs/:runId`).
        const entry = await engine.getRun(runId);
        expect(entry?.status).toBe('refused');
        expect(entry?.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');

        // …and the DURABLE row behind it, which is what survives a restart.
        const record = await store.loadTerminal!(runId);
        expect(record?.status).toBe('refused');
        expect(record?.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
    });

    it('a restarted process reads the refusal back off the store, not the ring', async () => {
        // The second engine shares the store and has an EMPTY in-memory ring,
        // so `getRun` can only answer from the durable row — the read path a
        // real operator takes after a restart.
        const store = new InMemorySuspendedRunStore();
        const writer = new AutomationEngine(createTestLogger(), store);
        writer.registerFlow('dedupe', endFlow('dedupe', { outcome: 'refused', message: REFUSAL_TEMPLATE }) as never);
        await writer.execute('dedupe', ctxFor({ ...GLOBEX }));
        const runId = await newestRunId(writer, 'dedupe');

        const reader = new AutomationEngine(createTestLogger(), store);
        const entry = await reader.getRun(runId);

        expect(entry?.status).toBe('refused');
        expect(entry?.refusalMessage).toBe('Refused: Globex Industries is a confirmed duplicate');
    });

    it('a refused run is NOT resumable — `refused` is terminal', async () => {
        const { engine } = engineWithStore();
        engine.registerFlow('dedupe', endFlow('dedupe', { outcome: 'refused', message: REFUSAL_TEMPLATE }) as never);

        await engine.execute('dedupe', ctxFor({ ...ACME }));
        const runId = await newestRunId(engine, 'dedupe');

        const resumed = await engine.resume(runId, { variables: {} } as never);

        // ADR-0112 envelope, not a bare throw: the run has no suspension, so
        // there is nothing for the resume verb to continue.
        expect(resumed.success).toBe(false);
        expect(resumed.code).toBe('RUN_NOT_FOUND');
    });

    it('a refusal reached through a RESUMED screen flow is a refusal too', async () => {
        // The second producer. `resumeInternal` is a separate terminal exit
        // from `execute()`'s — the #9414 asymmetry in this same file's
        // neighbourhood — so a repair that stopped at `execute()` would leave
        // every screen flow's refusal recorded as a completion.
        const { engine, store } = engineWithStore();
        installBuiltinNodes(engine, { logger: createTestLogger(), getService: () => undefined } as never);
        engine.registerFlow('review', {
            name: 'review',
            label: 'review',
            type: 'screen',
            successMessage: SUCCESS_TEXT,
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'ask', type: 'screen', label: 'Ask',
                    config: { waitForInput: true, title: 'Confirm', fields: [{ name: 'ok', label: 'OK', type: 'checkbox' }] },
                },
                { id: 'finish', type: 'end', label: 'Finish', config: { outcome: 'refused', message: REFUSAL_TEMPLATE } },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'ask' },
                { id: 'e1', source: 'ask', target: 'finish' },
            ],
        } as never);

        const paused = await engine.execute('review', ctxFor({ ...ACME }));
        expect(paused.status).toBe('paused');
        // ⛔ The `silent` pause contract, untouched: a paused run carries NO
        // completion toast. The ruling names this ⛔ do not touch.
        expect(paused.successMessage).toBeUndefined();

        const resumed = await engine.resume(paused.runId!, { variables: { ok: true } } as never);

        expect(resumed.success).toBe(true);
        expect(resumed.status).toBe('refused');
        expect(resumed.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
        expect(resumed.successMessage).toBeUndefined();

        const record = await store.loadTerminal!(paused.runId!);
        expect(record?.status).toBe('refused');
        expect(record?.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
    });

    it('a refusal on a RETRY attempt is a refusal, not a retried failure', async () => {
        // `errorHandling.strategy: 'retry'` hands the run to `retryExecution`,
        // whose attempts leave through `executeWithoutRetry` — a third terminal
        // exit. A refusal there must stop the ladder (a refusal is not a
        // failure to retry) and carry the same envelope.
        const { engine } = engineWithStore();
        let attempts = 0;
        engine.registerNodeExecutor({
            type: 'flaky',
            async execute() {
                attempts++;
                return attempts === 1 ? { success: false, error: 'transient 503' } : { success: true };
            },
        } as never);
        engine.registerFlow('dedupe_retry', {
            name: 'dedupe_retry',
            label: 'dedupe_retry',
            type: 'autolaunched',
            successMessage: SUCCESS_TEXT,
            errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 0 },
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'work', type: 'flaky', label: 'Work' },
                { id: 'finish', type: 'end', label: 'Finish', config: { outcome: 'refused', message: REFUSAL_TEMPLATE } },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'work' },
                { id: 'e1', source: 'work', target: 'finish' },
            ],
        } as never);

        const result = await engine.execute('dedupe_retry', ctxFor({ ...ACME }));

        expect(attempts).toBe(2); // the ladder really ran
        expect(result.success).toBe(true);
        expect(result.status).toBe('refused');
        expect(result.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
    });
});

describe('#15788 — the boundary: what must NOT change', () => {
    // ⚠️ Green before and after, deliberately. Each fences a behaviour the
    // ruling names ⛔ do not touch, or a default the change must leave alone.

    it('a plain `end` (no config) still completes and still carries successMessage', async () => {
        const { engine } = engineWithStore();
        engine.registerFlow('plain', endFlow('plain') as never);

        const result = await engine.execute('plain', ctxFor({ ...ACME }));

        expect(result.success).toBe(true);
        expect(result.status).toBeUndefined();       // the terminal-success exit stamps none
        expect(result.successMessage).toBe(SUCCESS_TEXT);
        expect(result.refusalMessage).toBeUndefined();

        const entry = await engine.getRun(await newestRunId(engine, 'plain'));
        expect(entry?.status).toBe('completed');
        expect(entry?.refusalMessage).toBeUndefined();
    });

    it('an explicit `outcome: \'completed\'` end is the same completion', async () => {
        const { engine } = engineWithStore();
        engine.registerFlow('explicit', endFlow('explicit', { outcome: 'completed' }) as never);

        const result = await engine.execute('explicit', ctxFor({ ...ACME }));

        expect(result.success).toBe(true);
        expect(result.successMessage).toBe(SUCCESS_TEXT);
        expect(result.refusalMessage).toBeUndefined();
        expect((await engine.getRun(await newestRunId(engine, 'explicit')))?.status).toBe('completed');
    });

    it('a genuinely FAILED run still reads `failed` — the discriminating control', async () => {
        // Without this, "the refusal path reads `refused`" would be consistent
        // with an engine that had started calling everything `refused`.
        const { engine } = engineWithStore();
        engine.registerNodeExecutor({
            type: 'boom',
            async execute() { return { success: false, error: 'downstream 503' }; },
        } as never);
        engine.registerFlow('breaks', {
            name: 'breaks', label: 'breaks', type: 'autolaunched',
            successMessage: SUCCESS_TEXT,
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'work', type: 'boom', label: 'Work' },
                { id: 'finish', type: 'end', label: 'Finish', config: { outcome: 'refused', message: REFUSAL_TEMPLATE } },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'work' },
                { id: 'e1', source: 'work', target: 'finish' },
            ],
        } as never);

        const result = await engine.execute('breaks', ctxFor({ ...ACME }));

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.refusalMessage).toBeUndefined();
        expect((await engine.getRun(await newestRunId(engine, 'breaks')))?.status).toBe('failed');
    });
});

describe('#15788 — one interpolator, not a second template engine', () => {
    /**
     * The ruling: the refusal message goes through *the same interpolation a
     * screen `description` gets*. Asserting "it substitutes `{record.name}`" is
     * far too weak — a hand-rolled `replace` would pass it. These drive both
     * slots with templates whose behaviour is SPECIFIC to
     * `builtin/template.ts`, and compare the two renderings for equality.
     */
    const PROBES = [
        // Dotted path walk.
        '{record.name}',
        // Numeric segment indexing into an array.
        'first={record.tags.0}',
        // Context token, resolved from `AutomationContext`, not from variables.
        'by {$User.Id}',
        // The CEL-mirrored numeric stdlib (#11060) — nothing a naive
        // substitution implements.
        'score {round(record.score)}',
        // Unresolvable embedded token renders as the empty string, not the
        // literal token and not `undefined`.
        'missing[{record.nope}]',
        // Object-valued token is JSON-serialized, never `[object Object]` (#3450).
        'blob {record.meta}',
    ];

    it('renders a refusal `message` byte-identically to a screen `description`', async () => {
        const record = {
            id: 'rec_1', name: 'Acme Corp', tags: ['vip', 'eu'], score: 4.6,
            meta: { tier: 'gold' },
        };
        const context = { event: 'manual', object: 'account', record, userId: 'usr_7' } as unknown as AutomationContext;

        for (const template of PROBES) {
            const screenEngine = new AutomationEngine(createTestLogger(), new InMemorySuspendedRunStore());
            installBuiltinNodes(screenEngine, { logger: createTestLogger(), getService: () => undefined } as never);
            screenEngine.registerFlow('probe_screen', {
                name: 'probe_screen', label: 'probe_screen', type: 'screen',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    {
                        id: 'ask', type: 'screen', label: 'Ask',
                        config: { waitForInput: true, title: 'T', description: template },
                    },
                ],
                edges: [{ id: 'e0', source: 'start', target: 'ask' }],
            } as never);

            const refuseEngine = new AutomationEngine(createTestLogger(), new InMemorySuspendedRunStore());
            refuseEngine.registerFlow('probe_refuse', endFlow('probe_refuse', { outcome: 'refused', message: template }) as never);

            const paused = await screenEngine.execute('probe_screen', context);
            const refused = await refuseEngine.execute('probe_refuse', context);

            expect(paused.screen?.description, `screen description for ${template}`).toBeDefined();
            expect(refused.refusalMessage, `refusal message for ${template}`)
                .toBe(paused.screen!.description);
        }
    });
});

describe('#15788 — the region boundary, made loud', () => {
    /**
     * A refusal terminates the RUN, and a structured region's body cannot end
     * one — the same statement `runRegion` already makes about a durable pause,
     * at the same line, for the same reason. Left to propagate, the signal
     * would unwind into `try_catch`'s own `catch (err)` arm, which reads every
     * throw as the try region FAILING: the author's refusal would run the catch
     * handler and the run would still record `completed`.
     *
     * ⛔ Nothing an author had is narrowed. Before #15788 an `end` inside a
     * region was a no-op whatever its `outcome`, so this shape has never once
     * been honoured; whether a refusal should instead propagate out of a region
     * is a real question the #14945 ruling does not answer.
     */
    it('a refusing `end` inside a `loop` body fails the run loudly instead of vanishing', async () => {
        const { engine } = engineWithStore();
        installBuiltinNodes(engine, { logger: createTestLogger(), getService: () => undefined } as never);
        engine.registerFlow('in_region', {
            name: 'in_region', label: 'in_region', type: 'autolaunched',
            successMessage: SUCCESS_TEXT,
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'sweep', type: 'loop', label: 'Sweep',
                    config: {
                        collection: '{items}',
                        iteratorVariable: 'item',
                        body: {
                            nodes: [{ id: 'nope', type: 'end', label: 'Nope', config: { outcome: 'refused', message: REFUSAL_TEMPLATE } }],
                            edges: [],
                        },
                    },
                },
            ],
            edges: [{ id: 'e0', source: 'start', target: 'sweep' }],
        } as never);

        // `items` rides on the trigger record, which the engine flattens into
        // the variable map — so `{items}` resolves without declaring an input.
        const result = await engine.execute('in_region', {
            event: 'manual', object: 'account', record: { ...ACME, items: [1] },
        } as unknown as AutomationContext);

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        // The message names the shape and the one-line fix, per "absence must
        // be loud" — ⛔ not a bare stringified sentinel.
        expect(result.error).toContain('structured region');
        expect(result.error).toContain("outcome: 'refused'");
        // ⛔ And it is NOT recorded as a refusal: the run did not refuse, the
        // engine declined to honour a shape it cannot express.
        expect(result.refusalMessage).toBeUndefined();
    });
});
