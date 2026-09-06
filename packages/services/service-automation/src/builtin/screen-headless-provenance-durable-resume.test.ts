// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The caller-provenance record leg survives a DURABLE resume (#15812).
 *
 * `judgeHeadlessScreen` (#15705) lets a screen continue when the CALLER already
 * answered it. It cannot read that off `context.params`, because the params bag
 * a flow action reaches the engine with is not the caller's bag —
 * `seedFlowActionParams` spreads the whole subject row in first. So it proves
 * the NEGATIVE instead: a key is not caller-supplied when the record carries it
 * and `params` holds the same value.
 *
 * That leg was written as `Object.is`, i.e. as reference identity, and the
 * record spread does copy the record's own value by reference — so in memory a
 * run that supplied nothing IS identity-equal there. **Persistence destroys
 * that.** A suspended run persists its `context` as JSON
 * (`suspended-run-store.ts`: `context_json: JSON.stringify(...)` on save,
 * `parseJson` on load) and `resumeInternal` continues the run with the parsed
 * value — and `loadSuspendedRunStrict` prefers the STORE over the hot cache
 * whenever one is wired, so it does not take a process restart. After that
 * round trip `params.tags` and `record.tags` are equal but no longer identical:
 * the record leg could not disprove them, the field read as caller-supplied,
 * and a later all-optional screen was SKIPPED on a run that had supplied
 * nothing.
 *
 * The direction is the one #15705 exists to prevent: an INTERACTIVE run
 * skipping a screen it should have rendered. Hence the remedy here — compare by
 * VALUE, which survives serialisation.
 *
 * ## The rig, and why it is shaped like this
 *
 * The card lists the conjunction that has to hold together, and every clause is
 * load-bearing, so the rig satisfies all of them at once rather than stubbing
 * any: the **actions door** (so the row is spread into `params`), a **wired
 * durable store**, **a later screen in the same run** entered after the resume,
 * a **non-primitive** colliding column, and **no other required field** on that
 * screen to force the pause anyway. Remove any one and the run pauses for a
 * different reason, which is what the controls below are for — they are not
 * decoration, they are the evidence that the pause the fixed code produces
 * comes from this leg and not from one of the others.
 *
 * ⚠️ Primitive columns were never affected: `Object.is('x','x')` is true across
 * a round trip. `records the primitive column` below is the control that keeps
 * that boundary honest — it passes before AND after the fix, so it cannot be
 * mistaken for evidence of the fix.
 *
 * REVERT-PROOF: put `Object.is` back on the record leg of `callerSupplied` and
 * `THE BUG` fails (the run completes instead of pausing) while every control
 * here stays green.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerScreenNodes } from './screen-nodes.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import type { SuspendedRunStore } from '../engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}

/**
 * Two screens, deliberately. The FIRST one pauses (a required field nobody
 * supplied) — that is what puts the context through the store. The SECOND is
 * the one under test: a single OPTIONAL field, so nothing but the provenance
 * verdict can decide whether it renders.
 */
function twoScreenFlow(secondField: string) {
    return {
        name: 'lead_review',
        label: 'Lead review',
        type: 'screen',
        status: 'active',
        version: 1,
        variables: [
            { name: 'full_name', type: 'text', isInput: true, isOutput: true },
            { name: secondField, type: 'text', isInput: true, isOutput: true },
        ],
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'collect', type: 'screen', label: 'Your details',
                config: { title: 'Your details', fields: [{ name: 'full_name', label: 'Full name', type: 'text', required: true }] },
            },
            {
                id: 'review', type: 'screen', label: 'Review',
                // All-optional and single-field: no `required` can force this
                // pause, so "it paused" means exactly "nothing was judged
                // caller-supplied".
                config: { title: 'Review', fields: [{ name: secondField, label: 'Review', type: 'text' }] },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'collect', type: 'default' },
            { id: 'e2', source: 'collect', target: 'review', type: 'default' },
            { id: 'e3', source: 'review', target: 'end', type: 'default' },
        ],
    } as any;
}

/** A fresh engine over `store` (or none) — one per simulated process lifetime. */
function buildEngine(secondField: string, store?: SuspendedRunStore) {
    const e = new AutomationEngine(silentLogger(), store);
    registerScreenNodes(e, { logger: silentLogger() } as any);
    e.registerFlow('lead_review', twoScreenFlow(secondField));
    return e;
}

/**
 * The bag a flow ACTION actually reaches the engine with — the subject row
 * first, the caller's own params last, exactly as `seedFlowActionParams`
 * (`@objectstack/runtime`) composes it. Reproduced rather than imported so this
 * package's pins do not depend on the other package's build, matching
 * `screen-headless-satisfaction.test.ts`.
 */
function actionContext(
    record: Record<string, unknown>,
    params: Record<string, unknown> = {},
): AutomationContext {
    return {
        record,
        object: 'crm_lead',
        params: { ...record, recordId: record.id, crmLeadId: record.id, ...params },
    } as AutomationContext;
}

/** A row whose `tags` column is an ARRAY — the shape identity cannot survive. */
function lead() {
    return { id: 'lead_1', tags: ['a', 'b'], company: 'Acme Inc' };
}

/**
 * Drive the whole conjunction: launch through the actions door, pause on the
 * first screen, resume, and report what the SECOND screen did.
 */
async function driveThroughResume(
    secondField: string,
    store: SuspendedRunStore | undefined,
    context: AutomationContext,
) {
    const engine = buildEngine(secondField, store);
    const paused = await engine.execute('lead_review', context);
    // Precondition, asserted rather than assumed: if the first screen did not
    // park, nothing below went through the store and the case is vacuous.
    expect(paused.status).toBe('paused');
    expect(paused.screen?.nodeId).toBe('collect');
    return engine.resume(paused.runId!, { variables: { full_name: 'Ada' } });
}

describe('caller-provenance survives a durable resume (#15812)', () => {
    /**
     * THE BUG. Every clause of the card's conjunction holds: actions door,
     * wired store, a later screen after the resume, a non-primitive colliding
     * column, and no other required field.
     *
     * The caller supplied NOTHING — `params.tags` is there only because the
     * dispatcher spread the row in. So the review screen must render.
     */
    it('THE BUG — an array column does not answer a later screen after a durable resume', async () => {
        const resumed = await driveThroughResume('tags', new InMemorySuspendedRunStore(), actionContext(lead()));
        expect(resumed.status).toBe('paused');
        expect(resumed.screen?.nodeId).toBe('review');
        // Not merely "it stopped": it stopped WITHOUT having answered itself
        // from the row.
        expect((resumed.output as Record<string, unknown> | undefined)?.tags).toBeUndefined();
    });

    /**
     * The same run with NO store: the engine resumes from its hot cache, where
     * `params.tags` is still the very array `record.tags` is, so identity holds
     * and the leg worked even before the fix. Green on both sides — its job is
     * to localise the defect to the serialisation boundary, not to the screen
     * logic.
     */
    it('CONTROL — with no store wired the same run pauses too (identity never left memory)', async () => {
        const resumed = await driveThroughResume('tags', undefined, actionContext(lead()));
        expect(resumed.status).toBe('paused');
        expect(resumed.screen?.nodeId).toBe('review');
    });

    /**
     * The card's own ⚠️: a PRIMITIVE column is unaffected, because
     * `Object.is('Acme Inc', 'Acme Inc')` is true across a round trip. Green
     * before and after — ⛔ never read this one as evidence of the fix.
     */
    it('CONTROL — a primitive colliding column was already refused across the round trip', async () => {
        const resumed = await driveThroughResume('company', new InMemorySuspendedRunStore(), actionContext(lead()));
        expect(resumed.status).toBe('paused');
        expect(resumed.screen?.nodeId).toBe('review');
    });

    /**
     * The row-id leg reads scalars, so serialisation cannot defeat it either.
     * Pinned because the fix deliberately leaves that leg on `Object.is` — this
     * is the case that says the decision was measured, not overlooked.
     */
    it('CONTROL — the row-id seed leg still refuses across a durable resume', async () => {
        const resumed = await driveThroughResume('recordId', new InMemorySuspendedRunStore(), actionContext(lead()));
        expect(resumed.status).toBe('paused');
        expect(resumed.screen?.nodeId).toBe('review');
    });

    /**
     * #15705's own purpose, preserved: a caller who genuinely drove the screen
     * still continues past it after a durable resume. Without this the fix
     * could "pass" by making everything pause.
     */
    it('a caller who genuinely supplied a DIFFERENT value still continues after the resume', async () => {
        const resumed = await driveThroughResume(
            'tags', new InMemorySuspendedRunStore(), actionContext(lead(), { tags: ['urgent'] }),
        );
        expect(resumed.status).not.toBe('paused');
        expect(resumed.success).toBe(true);
        expect(resumed.output).toMatchObject({ tags: ['urgent'] });
    });

    /**
     * THE WIDENING, pinned as behaviour rather than left as prose.
     *
     * Value equality enlarges the not-caller-supplied set: a caller that
     * re-sends a value structurally identical to the row's now reads as
     * indistinguishable from the record seed and the screen renders. Under
     * `Object.is` this run CONTINUED (two distinct arrays), so this case is a
     * deliberate behaviour change and it changes in this module's standing
     * direction — every ambiguity resolves to pausing, which costs a headless
     * run a skip and costs an interactive run nothing.
     *
     * No store here: the widening is a property of the comparison, not of
     * persistence.
     */
    it('WIDENING — a caller re-sending a value equal to the row is now indistinguishable, so it pauses', async () => {
        const resumed = await driveThroughResume('tags', undefined, actionContext(lead(), { tags: ['a', 'b'] }));
        expect(resumed.status).toBe('paused');
        expect(resumed.screen?.nodeId).toBe('review');
    });
});
