// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
// The published refusal sentence, asserted from the spec's own export and
// never re-spelled here: one notion of "a predicate slot takes text", derived
// once and read by both validators.
import { PREDICATE_SLOT_STRING_REFUSAL } from '@objectstack/spec/automation';

import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

/**
 * [#15572] A `decision` branch predicate authored as a CEL **envelope** —
 * `{ dialect, source }` in a slot declared `z.string()`.
 *
 * Four declarations left it invisible to everyone with an opinion:
 * `DecisionConditionSchema.expression` is `z.string()` but a node's `config` is
 * an open `z.record` that schema is never parsed against; the unknown-key walk
 * exempts the schemaless node types (`decision` publishes no descriptor
 * `configSchema` on purpose); the expression ledger's `predicate` arm emitted
 * strings only, skipping the envelope as "a type violation for the schema pass"
 * that, for those types, does not exist; and `evaluateCondition` accepts the
 * envelope. So the flow registered clean, `objectstack validate` reported
 * nothing, and the only layer that ever read the predicate was the evaluator.
 *
 * Measured on the unfixed engine, driven end to end (`registerFlow` then
 * `execute`), and worth recording because it corrects the filed symptom: through
 * the DECISION door the run did not take the other branch silently — the
 * executor wraps the authored value as `{ dialect: 'cel', source: <envelope> }`,
 * so `evaluateCondition` read a non-string `source` and the run failed with
 * `exprStr.trim is not a function`, an unattributed TypeError with no source and
 * no location. The silent `false` is real one door over — `evaluateCondition`
 * called with the envelope directly, which is how an `edge.condition` reaches it
 * — and that arm is deliberately NOT touched here: it is the shared evaluator,
 * and the whitespace-source envelope it turns on belongs to #15430.
 *
 * The fix is at the producer, per the contract-first rule: the flow does not
 * register. Both run-time shapes are then unreachable from authored metadata.
 */
describe('decision branch predicate — envelope in a `z.string()` slot (#15572)', () => {
    let engine: AutomationEngine;

    beforeEach(async () => {
        const kernel = new LiteKernel();
        kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();
        engine = kernel.getService('automation') as AutomationEngine;
    });

    const decisionFlow = (name: string, expression: unknown) => ({
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'check', type: 'decision', label: 'Check', config: { conditions: [{ label: 'yes', expression }] } },
            { id: 'yes_node', type: 'assignment', label: 'Yes', config: { assignments: { took: 'yes' } } },
            { id: 'no_node', type: 'assignment', label: 'No', config: { assignments: { took: 'no' } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'check' },
            { id: 'e1', source: 'check', target: 'yes_node', label: 'yes' },
            { id: 'e2', source: 'check', target: 'no_node', label: 'default', isDefault: true },
            { id: 'e3', source: 'yes_node', target: 'end' },
            { id: 'e4', source: 'no_node', target: 'end' },
        ],
    });

    /**
     * The serious half as filed: a whitespace-only SOURCE inside the envelope.
     * Nothing downstream can tell it apart from "no predicate at all", so the
     * only place it can be caught is here, on the shape.
     */
    it('refuses a whitespace-source envelope at registration', () => {
        const register = () => engine.registerFlow('ws_flow', decisionFlow('ws_flow', { dialect: 'cel', source: '   ' }));
        expect(register).toThrow(PREDICATE_SLOT_STRING_REFUSAL);
        // Located: which node, which slot, which index.
        expect(register).toThrow(/node 'check' \(decision\) decision branch expression at config\.conditions\[0\]\.expression/);
        expect(register).toThrow(/an expression envelope/);
    });

    it('refuses an un-parseable-source envelope at registration', () => {
        const register = () => engine.registerFlow('bad_flow', decisionFlow('bad_flow', { dialect: 'cel', source: 'rows.map(r,' }));
        expect(register).toThrow(PREDICATE_SLOT_STRING_REFUSAL);
        // The envelope's own source is attributed, so the author is pointed at
        // the text they wrote rather than at an empty string.
        expect(register).toThrow(/source: `rows\.map\(r,`/);
    });

    it('refuses an `ast`-only envelope, and every other non-string, on the same rule', () => {
        // NOT a claim about `ExpressionSchema` accepting `source`-or-`ast`
        // (#15430, a different card and a different mechanism): this refusal is
        // about the SHAPE reaching a slot declared as text, whatever is in it.
        expect(() => engine.registerFlow('ast_flow', decisionFlow('ast_flow', { dialect: 'cel', ast: { kind: 'const' } })))
            .toThrow(PREDICATE_SLOT_STRING_REFUSAL);
        expect(() => engine.registerFlow('num_flow', decisionFlow('num_flow', 42)))
            .toThrow(/Found a number/);
        expect(() => engine.registerFlow('bool_flow', decisionFlow('bool_flow', true)))
            .toThrow(/Found a boolean/);
    });

    /**
     * The boundary the card states explicitly, so nobody "fixes" it: a
     * whitespace-only STRING predicate behaves consistently on both sides —
     * "not authored" at the ledger, `false` at the evaluator — and is left
     * exactly as it was. Only the envelope shape moved.
     */
    it('leaves string predicates alone — including the whitespace-only one', () => {
        expect(() => engine.registerFlow('str_ok', decisionFlow('str_ok', 'record.rating >= 4'))).not.toThrow();
        expect(() => engine.registerFlow('str_ws', decisionFlow('str_ws', '   '))).not.toThrow();
        expect(() => engine.registerFlow('str_absent', decisionFlow('str_absent', undefined))).not.toThrow();
    });

    /**
     * The pre-existing arm still issues its own verdict: a refusal on shape
     * must not swallow the #1491 brace-trap a malformed STRING earns.
     */
    it('still reports a brace-in-CEL string predicate as the brace trap, not as a shape refusal', () => {
        const register = () => engine.registerFlow('brace_flow', decisionFlow('brace_flow', '{record.rating} >= 4'));
        expect(register).toThrow(/template braces|bare CEL/);
        expect(register).not.toThrow(PREDICATE_SLOT_STRING_REFUSAL);
    });

    /** One class, not one node type — `screen.fields[].visibleWhen` is the other predicate slot. */
    it('refuses an envelope in a screen field `visibleWhen` on the same rule', () => {
        const register = () => engine.registerFlow('screen_flow', {
            name: 'screen_flow',
            label: 'screen_flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'form', type: 'screen', label: 'Form',
                    config: { fields: [{ name: 'amount', type: 'number', visibleWhen: { dialect: 'cel', source: 'x == 1' } }] },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'form' },
                { id: 'e1', source: 'form', target: 'end' },
            ],
        });
        expect(register).toThrow(PREDICATE_SLOT_STRING_REFUSAL);
        expect(register).toThrow(/screen field visibleWhen at config\.fields\[0\]\.visibleWhen/);
    });

    /**
     * The run-time consequence, closed at the producer: the flow never enters
     * the registry, so there is nothing to execute. Asserting through
     * `execute()` rather than by re-reading the registry keeps the pin on the
     * behaviour that mattered — a run that decided a branch on a predicate no
     * validator had read.
     */
    it('leaves nothing to run: the refused flow is not registered', async () => {
        expect(() => engine.registerFlow('never', decisionFlow('never', { dialect: 'cel', source: '   ' }))).toThrow();
        const result = await engine.execute('never');
        expect(result.success).toBe(false);
        expect(String(result.error)).toMatch(/not found|not registered|Flow/i);
    });

    /**
     * The same flow with a plain string predicate still registers AND still
     * runs to completion — the refusal is scoped to the shape, and a run
     * through the decision executor is what it is scoped away from.
     */
    it('still registers and runs a plain string predicate', async () => {
        expect(() => engine.registerFlow('runs', decisionFlow('runs', 'true'))).not.toThrow();
        const result = await engine.execute('runs');
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
    });
});
