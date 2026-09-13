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
 *  - `FlowEdgeSchema.condition` is `EvaluatedExpressionInputSchema` (#15807;
 *    `ExpressionInputSchema` before), whose string arm TRANSFORMS into
 *    `{ dialect: 'cel', source }` — so after `FlowSchema.parse` every authored
 *    edge condition is an envelope. The ledger rule applied here would refuse
 *    every conditional edge in every flow.
 *  - `FlowNodeSchema.config` is an open `z.record`, so an envelope written at
 *    `config.condition` is passed through verbatim by the parse and evaluated
 *    correctly by `evaluateCondition` (#4336's ruling: the dialect is decided
 *    by the SOURCE, so both spellings evaluate the same).
 *
 * Both are therefore controls that must stay GREEN here, not cases to refuse.
 */
import { describe, expect, it, vi } from 'vitest';
import { STRUCTURAL_CONDITION_SHAPE_REFUSAL } from '@objectstack/spec/automation';
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '@objectstack/spec';

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

        it('a whitespace-only STRING is refused at registration (#17322) and still evaluates false', () => {
            // FLIPPED from "still registers and still evaluates false — ruled
            // correct". #15662 ruled it correct because it was consistent on
            // both sides; #15807 made the EDGE door refuse it at parse and
            // #17322 rebound this door to that rule. It is NOT #15662's shape
            // refusal that answers now — a string is still a well-shaped
            // condition — but the evaluated-slot sentence, so this control also
            // pins that the two refusals stayed distinct.
            expect(register(flowWith({ decisionCondition: '   ' }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
            expect(register(flowWith({ decisionCondition: '   ' }))).not.toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
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
    // Arm B too, since #15807 — admitted by #15792 on purpose while the spec
    // still admitted the shape, and answering `false` off the empty-source arm.
    ['an `ast`-only envelope (the #15792 admission, revisited by #15807)', { dialect: 'cel', ast: { kind: 'const', value: true } }, 'B'],
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

        it('an `ast` BESIDE a string `source` still evaluates — the engine reads `source`', () => {
            // FLIPPED from "an `ast`-only envelope still answers `false`": that
            // population was #15430/#15807's, and #15807 closed it (see the
            // block below). What stays admitted is the envelope the engine can
            // run: a string `source`, with or without an `ast` next to it.
            expect(evaluate({ dialect: 'cel', source: 'record.rating >= 4', ast: { kind: 'const' } })()).toBe(true);
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

/**
 * #15807 — the edge condition is an EVALUATED slot, and the `ast`-only
 * admission #15792 left in `structuralConditionRefusal` is revisited with it.
 *
 * Measured on #15430 (comment 5550509137): `{ dialect: 'cel', ast: { kind:
 * 'const', value: true } }` through `evaluateCondition` answered `false` — the
 * engine reads `expression.source ?? ''`, never `ast`, so an `ast`-only
 * envelope landed in the empty-source arm and the branch quietly never fired;
 * registration said nothing. A whitespace-only `source` was the same seam
 * through the other key.
 *
 * Two doors close it, and they close different populations on purpose:
 *
 *  - `FlowEdgeSchema.condition` now composes `EvaluatedExpressionInputSchema`,
 *    so on an EDGE both spellings are refused by `FlowSchema.parse` inside
 *    `registerFlow`, before the structural pass ever sees the edge — with the
 *    spec's own sentence (`EVALUATED_EXPRESSION_SOURCE_REQUIRED`).
 *  - `config.condition` is an open record with no schema in front of it, so
 *    there the structural pass IS the producer-side gate: the
 *    `rec.ast !== undefined` admission is gone, and an `ast`-only envelope on
 *    a start node's trigger gate or a decision node's predicate is refused at
 *    `registerFlow` and at `evaluateCondition` with ONE
 *    `STRUCTURAL_CONDITION_SHAPE_REFUSAL`. The whitespace-only STRING ruling on
 *    that slot was left alone here and MOVED one card later — see #17322 below,
 *    which rebound the node door to this same evaluated-slot rule at
 *    registration; the EVALUATOR half of #15662's ruling still stands.
 */
describe('#15807 — the edge condition is an evaluated slot; the ast-only admission is gone', () => {
    const AST_ONLY = { dialect: 'cel', ast: { kind: 'const', value: true } };

    describe('on an EDGE — refused by the schema, at registerFlow, with the evaluated-slot sentence', () => {
        it('refuses an `ast`-only envelope', () => {
            expect(register(flowWith({ edgeCondition: AST_ONLY }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
            // The schema refuses it BEFORE the structural pass runs on the parsed
            // flow, so the refusal is the spec's, not the structural sentence.
            expect(register(flowWith({ edgeCondition: AST_ONLY }))).not.toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
        });

        it('refuses a `source` that is blank after trimming — envelope and bare-string spellings alike', () => {
            expect(register(flowWith({ edgeCondition: { dialect: 'cel', source: '   ' } }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
            expect(register(flowWith({ edgeCondition: '   ' }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
        });

        it('locates the refusal at the edge the author wrote', () => {
            expect(register(flowWith({ edgeCondition: AST_ONLY }))).toThrow(/edges.*0.*condition/s);
        });

        it('CONTROL — an `ast` beside a string `source`, and the bare-string shorthand, still register', () => {
            expect(register(flowWith({ edgeCondition: { dialect: 'cel', source: '1 == 1', ast: { kind: 'const' } } }))).not.toThrow();
            expect(register(flowWith({ edgeCondition: '1 == 1' }))).not.toThrow();
        });
    });

    describe('on `config.condition` — the revisited admission, one refusal at both doors', () => {
        const evaluate = (value: unknown) => () =>
            new AutomationEngine(silentLogger).evaluateCondition(value as never, new Map<string, unknown>([['record', { rating: 5 }]]));

        it('refuses an `ast`-only envelope on the decision predicate and on the START trigger gate', () => {
            for (const site of ['decisionCondition', 'startCondition'] as const) {
                expect(register(flowWith({ [site]: AST_ONLY })), site).toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
                expect(register(flowWith({ [site]: AST_ONLY })), site).toThrow('Found an object carrying an `ast` but no string `source`');
            }
        });

        it('refuses it at evaluation with the SAME sentence — no silent `false` any more', () => {
            // The measured defect: this answered `false`. It now throws, and the
            // error names what was found and what the engine evaluates.
            expect(evaluate(AST_ONLY)).toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
            expect(evaluate(AST_ONLY)).toThrow('the engine evaluates `source`, never `ast`');
            expect(evaluate({ ast: { kind: 'const', value: true } })).toThrow(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
        });

        it('the whitespace-only STRING ruling on this slot MOVED at registration (#17322)', () => {
            // FLIPPED from "…is untouched (#15662)". #15662 ruled the blank
            // string correct on the ground that it was consistent on both
            // sides; #15807 (the block above) removed that ground by making the
            // EDGE door refuse it at parse, and #17322 rebound the node door to
            // the same rule. The EVALUATOR half is deliberately unchanged — see
            // the #17322 block for why.
            expect(register(flowWith({ decisionCondition: '   ' }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
            expect(evaluate('   ')()).toBe(false);
        });
    });
});

/**
 * #17322 — a whitespace-only `config.condition` STRING is refused at the NODE
 * door, by the rule the EDGE door has carried since #15807.
 *
 * Two doors, the same authored value `'   '`, two fates. On an edge,
 * `FlowEdgeSchema.condition` is `EvaluatedExpressionInputSchema`, so
 * `FlowSchema.parse` refuses it by name before it can be stored. On a node,
 * `config` is an open `z.record` that passes it through verbatim, and it
 * reached `evaluateCondition`'s empty-source arm — `exprStr.trim() === ''` —
 * and answered a SILENT `false`, under a comment that names the arm as being
 * for an UNAUTHORED condition. `'   '` was authored. A branch that never runs,
 * forever, with nothing said at any layer; and on a `start` node that key is
 * the TRIGGER GATE, so a whole flow could be gated shut in silence.
 *
 * The ruling: 一个操作两个实现且行为不一致 ⇒ 带治理的一侧胜出,另一侧改绑.
 * The edge door refuses, so the edge door is the governed side and the node
 * door aligns to it — at the PRODUCER (`registerFlow`), which is the only gate
 * `config.condition` has, an open record having no schema in front of it.
 *
 * The refusal is IMPORTED, never re-spelled: `registerFlow` runs the source
 * through `EvaluatedExpressionInputSchema` itself, so the two doors cannot
 * drift into two notions of "blank" or two sentences for it. That is why every
 * assertion below reads `EVALUATED_EXPRESSION_SOURCE_REQUIRED` off the spec's
 * own export rather than matching prose.
 *
 * ## What deliberately did NOT move
 *
 * `evaluateCondition` still answers `false` for a blank string. It is the
 * shared evaluator and a public method on an exported class, so its throw
 * behaviour is itself a contract; and a flow STORED before this card is
 * replayed through `applyConversionsToStoredItem`, which does not re-validate,
 * so it reaches the evaluator whatever the producer now refuses. Turning that
 * into a throw would convert a dead branch into a run-time fault for those
 * deployments — a different question, and not the one this card was ruled on.
 */
describe('#17322 — a blank `config.condition` string is refused at the node door', () => {
    const evaluate = (value: unknown) => () =>
        new AutomationEngine(silentLogger).evaluateCondition(value as never, new Map<string, unknown>([['record', { rating: 5 }]]));

    it('refuses a whitespace-only condition on the decision predicate and on the START trigger gate', () => {
        for (const site of ['decisionCondition', 'startCondition'] as const) {
            expect(register(flowWith({ [site]: '   ' })), site).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
        }
    });

    it('refuses every spelling of blank on the same rule — tabs and newlines included', () => {
        expect(register(flowWith({ decisionCondition: '\t\n ' }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
        expect(register(flowWith({ decisionCondition: '' }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
    });

    it('refuses a blank `source` INSIDE an envelope too — one seam, two keys, one rule', () => {
        // `structuralConditionRefusal` admits an envelope carrying a string
        // `source`, with or without a `dialect`, so both spellings reach the
        // evaluated-slot rule and both are refused by it.
        expect(register(flowWith({ decisionCondition: { dialect: 'cel', source: '   ' } }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
        expect(register(flowWith({ decisionCondition: { source: '   ' } }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
    });

    it('locates the refusal at the node the author wrote', () => {
        expect(register(flowWith({ startCondition: '   ' }))).toThrow(/node 'start' \(start\) condition/);
        expect(register(flowWith({ decisionCondition: '   ' }))).toThrow(/node 'branch' \(decision\) condition/);
    });

    it('answers the EDGE door\'s sentence, not a second one — the two doors do not drift', () => {
        // The same value at the two slots earns the same published sentence.
        // If this ever diverges, a private notion of "blank" has grown here.
        expect(register(flowWith({ decisionCondition: '   ' }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
        expect(register(flowWith({ edgeCondition: '   ' }))).toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
    });

    describe('CONTROLS — what this must NOT refuse', () => {
        it('an ABSENT condition is still not a malformed one', () => {
            expect(register(flowWith({}))).not.toThrow();
            expect(register(flowWith({ decisionCondition: null }))).not.toThrow();
            expect(register(flowWith({ startCondition: undefined }))).not.toThrow();
        });

        it('a non-blank condition still registers — bare text and both envelope spellings', () => {
            expect(register(flowWith({ decisionCondition: 'record.rating >= 4' }))).not.toThrow();
            expect(register(flowWith({ decisionCondition: { source: 'record.rating >= 4' } }))).not.toThrow();
            expect(register(flowWith({ decisionCondition: { dialect: 'cel', source: 'record.rating >= 4' } }))).not.toThrow();
            expect(register(flowWith({ startCondition: 'record.rating >= 4' }))).not.toThrow();
        });

        it('a non-blank source earns its pre-existing verdict, never the blank one', () => {
            // RED CONTROL — the new rule is about the SOURCE, so a non-blank
            // one must never reach it whatever else is wrong with the value.
            // `{ dialect: 'cron', … }` at a condition slot was already refused
            // at registration by its own sentence; if that sentence is replaced
            // by the evaluated-slot one, this gate has started shadowing the
            // dialect check instead of sitting in front of it.
            const cron = () => register(flowWith({ decisionCondition: { dialect: 'cron', source: '0 0 * * *' } }))();
            expect(cron).toThrow(/expected a CEL expression but got a `cron` dialect/);
            expect(cron).not.toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
            // Same for the #1491 brace trap on a bare string.
            const brace = () => register(flowWith({ decisionCondition: '{record.rating} >= 4' }))();
            expect(brace).toThrow(/template braces|failed to evaluate as CEL|bare CEL/);
            expect(brace).not.toThrow(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
        });

        it('the EVALUATOR is untouched: a stored blank condition still answers `false`', () => {
            expect(evaluate('   ')()).toBe(false);
            expect(evaluate('')()).toBe(false);
            expect(evaluate(null)()).toBe(false);
        });
    });
});
