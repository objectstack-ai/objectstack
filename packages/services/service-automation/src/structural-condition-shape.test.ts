// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15662 — a non-string, non-expression value in a STRUCTURAL condition slot
 * (`config.condition` on any node, `edge.condition`) is refused at
 * `registerFlow` instead of being read as an empty condition.
 *
 * `evaluateCondition` derives its source as
 * `typeof expression === 'string' ? expression : (expression?.source ?? '')`.
 * For a value that is neither a string nor envelope-shaped the read yields
 * `undefined`, the `??` supplies `''`, and the empty-source arm returns
 * `false` — the "an unauthored branch must not open" rule, applied to a value
 * that was very much authored. Measured before the fix: `42`, `true` and
 * `['a']` at a decision node's `config.condition` each REGISTERED clean and
 * executed `success: true` with nothing said anywhere, and the same key on a
 * `start` node is the TRIGGER GATE — a flow silently gated shut forever.
 *
 * ## Why this is not `PREDICATE_SLOT_STRING_REFUSAL`
 *
 * The ledger arm (#15572) refuses every non-string because those slots are
 * declared `z.string()`. Neither structural slot is, and the difference was
 * measured rather than assumed:
 *
 *  - `FlowEdgeSchema.condition` is `ExpressionInputSchema`, whose string arm
 *    TRANSFORMS into `{ dialect: 'cel', source }` — so after `FlowSchema.parse`
 *    every authored edge condition is an envelope. The ledger rule applied here
 *    would refuse every conditional edge in every flow.
 *  - `FlowNodeSchema.config` is an open `z.record`, so an envelope written at
 *    `config.condition` is passed through verbatim by the parse and evaluated
 *    correctly by `evaluateCondition` (#4336's ruling: the dialect is decided
 *    by the SOURCE, so both spellings evaluate the same).
 *
 * Both are therefore controls that must stay GREEN here, not cases to refuse.
 */
import { describe, expect, it, vi } from 'vitest';
import { STRUCTURAL_CONDITION_SHAPE_REFUSAL } from '@objectstack/spec/automation';

import { AutomationEngine } from './engine.js';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

/** A two-node flow whose `condition` sites are the ones under test. */
const flowWith = (opts: { startCondition?: unknown; decisionCondition?: unknown; edgeCondition?: unknown }) => ({
    name: 'gate_flow',
    label: 'Gate Flow',
    type: 'autolaunched',
    status: 'active',
    nodes: [
        {
            id: 'start', type: 'start', label: 'Start',
            config: {
                objectName: 'lead', triggerType: 'record-after-update',
                ...('startCondition' in opts ? { condition: opts.startCondition } : {}),
            },
        },
        {
            id: 'branch', type: 'decision', label: 'Branch',
            config: { ...('decisionCondition' in opts ? { condition: opts.decisionCondition } : {}) },
        },
    ],
    edges: [{
        id: 'e1', source: 'start', target: 'branch',
        ...('edgeCondition' in opts ? { condition: opts.edgeCondition } : {}),
    }],
});

const register = (flow: unknown) => () => new AutomationEngine(silentLogger).registerFlow('gate_flow', flow as never);

/** The three values the card measured registering clean and answering silently. */
const SILENT_VALUES: Array<[label: string, value: unknown, found: string]> = [
    ['a number', 42, 'Found a number'],
    ['a boolean', true, 'Found a boolean'],
    ['an array', ['a'], 'Found an array'],
];

describe('#15662 — a structural condition that is neither text nor an expression', () => {
    describe('the decision/branch predicate (`config.condition`)', () => {
        for (const [label, value, found] of SILENT_VALUES) {
            it(`refuses ${label} at registerFlow`, () => {
                expect(register(flowWith({ decisionCondition: value }))).toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
                expect(register(flowWith({ decisionCondition: value }))).toThrow(found);
            });
        }

        it('names the node in the failure, so the author can find it', () => {
            expect(register(flowWith({ decisionCondition: 42 }))).toThrow(/node 'branch' \(decision\) condition/);
        });
    });

    describe('the START node trigger gate — the reason this is not cosmetic', () => {
        for (const [label, value] of SILENT_VALUES) {
            it(`refuses ${label} on the trigger gate`, () => {
                expect(register(flowWith({ startCondition: value }))).toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
            });
        }

        it("names the start node, not the decision one", () => {
            expect(register(flowWith({ startCondition: ['a'] }))).toThrow(/node 'start' \(start\) condition/);
        });
    });

    it('refuses `{ source: 1 }` with the refusal instead of a bare TypeError', () => {
        // Before the fix this reached `exprStr.trim()` and threw
        // `TypeError: source.trim is not a function` out of the validator — a
        // refusal by accident, with no location and no rule.
        const thrown = ((): Error | undefined => {
            try { register(flowWith({ decisionCondition: { source: 1 } }))(); } catch (e) { return e as Error; }
            return undefined;
        })();
        expect(thrown).toBeDefined();
        expect(thrown!.message).toContain(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
        expect(thrown!.message).not.toContain('is not a function');
    });

    describe('CONTROLS — the shapes that must stay accepted', () => {
        it('an expression ENVELOPE at `config.condition` still registers (the blast-radius case)', () => {
            expect(register(flowWith({ decisionCondition: { dialect: 'cel', source: '1 == 1' } }))).not.toThrow();
            expect(register(flowWith({ startCondition: { dialect: 'cel', source: '1 == 1' } }))).not.toThrow();
            // No dialect: `evaluateCondition` reads it as CEL, so does this.
            expect(register(flowWith({ decisionCondition: { source: '1 == 1' } }))).not.toThrow();
        });

        it('an envelope on an EDGE still registers — every parsed edge condition is one', () => {
            // `FlowEdgeSchema` transforms the authored string into the
            // envelope, so this is the shape the arm sees for a plain
            // `condition: "…"` too. Both spellings, one control.
            expect(register(flowWith({ edgeCondition: { dialect: 'cel', source: '1 == 1' } }))).not.toThrow();
            expect(register(flowWith({ edgeCondition: '1 == 1' }))).not.toThrow();
        });

        it('a whitespace-only STRING still registers and still evaluates false', () => {
            // Ruled correct, stated so nobody "fixes" it.
            expect(register(flowWith({ decisionCondition: '   ' }))).not.toThrow();
            expect(new AutomationEngine(silentLogger).evaluateCondition('   ', new Map())).toBe(false);
        });

        it('a bare CEL string still registers, and the brace trap still throws', () => {
            expect(register(flowWith({ decisionCondition: 'record.rating >= 4' }))).not.toThrow();
            // RED CONTROL — the pre-existing string verdict is untouched by the
            // shape gate. If this ever goes green, the arm stopped reaching
            // `check()` and every `not.toThrow()` above is void.
            expect(register(flowWith({ decisionCondition: '{record.rating} >= 4' })))
                .toThrow(/template braces/);
        });
    });
});
