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

/**
 * #16038 — the EVALUATION half of #15662's principle, ruled by the maintainer
 * on 2026-09-06 (decision batch #57, option A): `evaluateCondition` refuses a
 * malformed condition shape with the SAME `STRUCTURAL_CONDITION_SHAPE_REFUSAL`
 * registration already raises, so a shape that slipped past registration —
 * older stored data, or a direct caller of this public method on an exported
 * class — can never surface as a raw `TypeError`, nor as a silent `false`.
 *
 * ## The enumeration, measured on `3e7ef9c23` before the fix
 *
 * There is ONE unguarded read — `exprStr`, derived at the top of
 * `evaluateCondition` — and it has three distinct failure arms. Every helper
 * the method delegates to (`templateHoles`, `celScope`,
 * `refuseUnresolvedTemplateHole`, `refuseUnresolvedCelOperand`,
 * `compareValues`) is handed `exprStr` and nothing else, so a guard above the
 * derivation closes the whole delegation tree. One test per arm, below:
 *
 *  - **A — a raw `TypeError`.** An envelope whose `source` is PRESENT and not a
 *    string, under a predicate dialect. `?? ''` covers only absent/`null`, so
 *    `exprStr` becomes the non-string value and `.trim()` throws
 *    `TypeError: exprStr.trim is not a function` — naming no flow, no node and
 *    no expression. This is the reported arm.
 *  - **B — a silent `false`.** A value that is neither text nor envelope-shaped:
 *    the read yields `undefined`, `?? ''` supplies the empty source, and the
 *    "an unauthored branch must not open" arm answers `false` for a value that
 *    was very much authored — on the same key a start node's TRIGGER GATE is
 *    read from.
 *  - **C — a silent `false` one statement earlier.** A malformed envelope
 *    carrying a NON-predicate dialect (`{ dialect: 'cron', source: 1 }`) returns
 *    `false` at the dialect pre-check, BEFORE the trim. This arm is why the
 *    guard is the method's first statement rather than a patch at the reported
 *    line: a fix written at `exprStr` never reaches it.
 *
 * ## The sibling value path is NOT a site — measured, not assumed
 *
 * `evaluateValueEnvelope` already derives its verdict from
 * `valueEnvelopeRefusals`, the same call `registerFlow` makes (#15137), so it
 * is already this shape one door over with its own shared constructor. Driven
 * before the fix, `{ source: 1 }`, `{ dialect: 'cel', source: 1 }`,
 * `{ dialect: 'cel', source: {} }`, `{ ast, source: 1 }`, `{ dialect: 'cel' }`,
 * `42`, `['a']` and `{}` each threw an ATTRIBUTED error leading with
 * `ASSIGNMENT_VALUE_ENVELOPE_REFUSAL` or a located CEL fault — zero raw
 * `TypeError`s. Nothing to move there, which is why nothing here does.
 *
 * ## No caller depended on the `TypeError`
 *
 * Also measured, because the ruling's landing shape turns on it: repo-wide,
 * every occurrence of `is not a function` on this path is PROSE recording the
 * pre-fix symptom, never an assertion and never a `catch` that branches. The
 * two engine-internal callers (the start gate and the edge gate) call it bare,
 * so a throw propagates to `execute()`'s catch and is recorded as a loud flow
 * failure — ADR-0032 §1c's prescribed handling, not a regression.
 */
const REFUSED_AT_EVALUATION: Array<[label: string, value: unknown, arm: string]> = [
    // Arm A — reached `.trim()` and threw a bare `TypeError`.
    ['`{ source: 1 }` (the reproduction)', { source: 1 }, 'A'],
    ['a `cel` envelope with a number source', { dialect: 'cel', source: 1 }, 'A'],
    ['a `cel` envelope with an object source', { dialect: 'cel', source: {} }, 'A'],
    ['a `template` envelope with a number source', { dialect: 'template', source: 1 }, 'A'],
    // Arm C — returned `false` at the dialect pre-check, one statement earlier.
    ['a non-predicate-dialect envelope with a number source', { dialect: 'cron', source: 1 }, 'C'],
    // Arm B — returned `false` off the empty-source arm.
    ['a number', 42, 'B'],
    ['a boolean', true, 'B'],
    ['an array', ['a'], 'B'],
    ['an object that is neither', {}, 'B'],
    ['an envelope with no source and no ast', { dialect: 'cel' }, 'B'],
];

describe('#16038 — evaluation refuses the same shapes registration does', () => {
    const evaluate = (value: unknown) => () =>
        new AutomationEngine(silentLogger).evaluateCondition(
            value as never,
            new Map<string, unknown>([['record', { rating: 5 }]]),
        );

    for (const [label, value, arm] of REFUSED_AT_EVALUATION) {
        it(`refuses ${label} (arm ${arm})`, () => {
            expect(evaluate(value)).toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
        });
    }

    it('never answers a malformed shape with a bare TypeError again', () => {
        // The filed symptom, asserted as an absence: the refusal must REPLACE
        // the `TypeError`, not sit beside it. Without this an implementation
        // that threw the refusal only on the `false` arms would pass every
        // assertion above except the arm-A rows.
        for (const [, value] of REFUSED_AT_EVALUATION) {
            expect(evaluate(value)).not.toThrow('is not a function');
        }
    });

    it('attributes the refusal — ADR-0032 §1d, the error carries its source', () => {
        expect(evaluate({ source: 1 })).toThrow(/source:/);
    });

    /**
     * The property the ruling is actually about, asserted mechanically rather
     * than described: ONE population walked through BOTH doors, refused by both
     * with the same published sentence. Two hand-written envelopes that drifted
     * apart would fail here while every per-site test above stayed green.
     */
    it('the reject set of registration and the reject set of evaluation are ONE set', () => {
        for (const [label, value] of REFUSED_AT_EVALUATION) {
            expect(register(flowWith({ decisionCondition: value })), `registration: ${label}`)
                .toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
            expect(evaluate(value), `evaluation: ${label}`)
                .toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
        }
    });

    describe('CONTROLS — the shapes evaluation must still answer, not refuse', () => {
        it('bare CEL text, and both envelope spellings, still evaluate', () => {
            expect(evaluate('record.rating >= 4')()).toBe(true);
            expect(evaluate({ source: 'record.rating >= 4' })()).toBe(true);
            expect(evaluate({ dialect: 'cel', source: 'record.rating >= 4' })()).toBe(true);
        });

        it('an `ast`-only envelope still answers `false` — that population is #15430/#15807', () => {
            // `structuralConditionRefusal` admits an `ast`, so this must fall
            // through to the empty-source arm exactly as before. If this ever
            // throws, the guard swallowed a different card's population.
            expect(evaluate({ dialect: 'cel', ast: { kind: 'const' } })()).toBe(false);
        });

        it('a WELL-FORMED non-predicate dialect still answers `false`, not a refusal', () => {
            // The arm-C boundary: `cron` is not a boolean predicate here, but a
            // string source makes the SHAPE authorable, so the pre-existing
            // `false` stands. Only the malformed spelling moved.
            expect(evaluate({ dialect: 'cron', source: '0 0 * * *' })()).toBe(false);
        });

        it('an unauthored condition is not a malformed one', () => {
            expect(evaluate(null)()).toBe(false);
            expect(evaluate(undefined)()).toBe(false);
            expect(evaluate('')()).toBe(false);
            expect(evaluate('   ')()).toBe(false);
        });

        it('a malformed STRING still earns its own verdict, not the shape refusal', () => {
            // RED CONTROL — the shape gate must not shadow the #1491 brace trap
            // or the §1c CEL fault. If this goes green the guard is refusing
            // strings, which `structuralConditionRefusal` admits by design.
            expect(evaluate({ dialect: 'cel', source: '{record.rating} >= 4' }))
                .toThrow(/template braces|failed to evaluate as CEL/);
            expect(evaluate({ dialect: 'cel', source: '{record.rating} >= 4' }))
                .not.toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
        });
    });
});
