// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11060 — the flow VALUE-expression function table, both halves of the ruling:
 *
 *  1. `round` / `floor` / `ceil` / `abs` / `min` / `max` work in value
 *     expressions, every name and semantic mirrored **1:1 from the CEL
 *     stdlib** — proven here by PARITY, not by re-stating the numbers: one
 *     input grid drives BOTH engines (`ExpressionEngine` CEL vs the template
 *     evaluator) and the results must agree exactly. A drift in either
 *     implementation reds this file.
 *
 *  2. The silent-`null` rewrite is gone for CALL positions: an unknown
 *     function name is a LOUD named error ({@link FlowExpressionFunctionError},
 *     guard-marked so a `fault` edge cannot swallow it) — never an `undefined`
 *     field write. This is the half the ruling weights most: without it the
 *     seventh name anyone types silently falls into the same trap the six
 *     functions climbed out of.
 *
 * Over-denial controls pin that the diagnostic did NOT become a blanket
 * refusal: operator-only arithmetic, `NOW()`/`TODAY()` (whole-token macros),
 * and unresolved NON-call identifiers all behave exactly as before.
 */

import { describe, it, expect } from 'vitest';
import { ExpressionEngine } from '@objectstack/formula';
import { interpolateString, FlowExpressionFunctionError } from './template.js';
import { isGuardRefusal } from '../guard-refusal.js';

const ctx = {} as any;

function tpl(expr: string, vars: Record<string, unknown> = {}): unknown {
    return interpolateString(`{${expr}}`, new Map(Object.entries(vars)), ctx);
}

function cel(source: string): { ok: boolean; value?: unknown; error?: { message: string } } {
    // The CEL engine requires a context object (it reads `ctx.timezone`);
    // an empty one gives the stdlib its UTC defaults.
    return ExpressionEngine.evaluate({ dialect: 'cel', source } as any, {}) as any;
}

// ── Half 1: the six functions, semantics pinned BY PARITY with CEL ─────────

describe('value-expression functions mirror the CEL stdlib 1:1 (#11060)', () => {
    // The grid deliberately covers the rounding-mode traps: halves (JS
    // Math.round rounds half toward +∞: round(-1.5) === -1, round(2.5) === 3),
    // negative floor/ceil direction (toward −∞ / +∞), zero, and the issue's
    // own unrounded product ×100.
    const UNARY_GRID = [1.4, 1.5, 1.6, 2.5, -1.2, -1.5, -2.5, 0, 0.5, -0.5, 3.7, -3.7, 12599999.999999998, 125999.99999999999];

    for (const fn of ['round', 'floor', 'ceil', 'abs'] as const) {
        it(`${fn}(x) agrees with ExpressionEngine CEL on every grid input`, () => {
            for (const x of UNARY_GRID) {
                const c = cel(`${fn}(${x})`);
                expect(c.ok, `CEL ${fn}(${x}) must evaluate: ${JSON.stringify(c)}`).toBe(true);
                const t = tpl(`${fn}(x)`, { x });
                // CEL int results come back as plain numbers (safe range) —
                // Object.is equality, so a -0/0 or carrier drift also reds.
                expect(t, `${fn}(${x}): template=${String(t)} cel=${String(c.value)}`).toBe(c.value);
            }
        });
    }

    it('min/max agree with CEL and return the operand verbatim (type preserved)', () => {
        const PAIRS: Array<[unknown, unknown]> = [[1, 2], [2, 1], [1.5, 1.5], [-1, -2], [0.1, 0.2], [180000, 200000]];
        for (const fn of ['min', 'max'] as const) {
            for (const [a, b] of PAIRS) {
                const c = cel(`${fn}(${String(a)}, ${String(b)})`);
                expect(c.ok, `CEL ${fn}(${String(a)}, ${String(b)})`).toBe(true);
                expect(tpl(`${fn}(a, b)`, { a, b })).toBe(c.value);
            }
        }
        // Operand-verbatim on non-numeric operands (numeric comparison is NaN
        // → both predicates false → second operand), same lambda both sides.
        const cs = cel(`min("apple", "banana")`);
        expect(cs.ok).toBe(true);
        expect(tpl(`min(a, b)`, { a: 'apple', b: 'banana' })).toBe(cs.value);
    });

    it("abs of a non-numeric value is NaN in BOTH engines (CEL's abs(dyn): double does not fault)", () => {
        const c = cel(`abs("x")`);
        expect(c.ok).toBe(true);
        expect(Number.isNaN(c.value as number), `cel abs("x") = ${String(c.value)}`).toBe(true);
        const t = tpl(`abs(v)`, { v: 'x' });
        expect(Number.isNaN(t as number), `template abs("x") = ${String(t)}`).toBe(true);
    });

    it('round of a non-numeric value REFUSES in both engines (CEL faults on BigInt(NaN); here it is the named error)', () => {
        // CEL side: stdlib round → BigInt(Math.round(Number("x"))) throws.
        const c = cel(`round("x")`);
        expect(c.ok, 'CEL must fault, not return a value').toBe(false);
        // Template side: same direction, as the named diagnostic.
        let caught: unknown;
        try { tpl(`round(v)`, { v: 'x' }); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(FlowExpressionFunctionError);
        expect((caught as FlowExpressionFunctionError).problem).toBe('argument');
        expect((caught as FlowExpressionFunctionError).fn).toBe('round');
    });

    it('wrong arity REFUSES in both engines — round(x, 2) has NO precision form, and the refusal says what to write', () => {
        const c = cel('round(1.5, 2)');
        expect(c.ok, 'CEL has no round/2 overload').toBe(false);
        let caught: unknown;
        try { tpl('round(x, 2)', { x: 1.5 }); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(FlowExpressionFunctionError);
        const err = caught as FlowExpressionFunctionError;
        expect(err.problem).toBe('arity');
        expect(err.fn).toBe('round');
        // The prescription IS the contract here: the refusal must hand the
        // author the CEL-identical authoring pattern for N-decimal rounding.
        expect(err.message).toContain('round(x * 100) / 100');
        // min/max are exactly binary, like their CEL registrations.
        expect(() => tpl('min(1)', {})).toThrow(FlowExpressionFunctionError);
        expect(() => tpl('min(1, 2, 3)', {})).toThrow(FlowExpressionFunctionError);
    });

    it('declared divergence pin: beyond MAX_SAFE_INTEGER, CEL switches carrier to string; the template dialect refuses loudly', () => {
        const c = cel('round(10000000000000000.0)'); // 1e16 > 2^53
        expect(c.ok).toBe(true);
        expect(typeof c.value, 'CEL boundary hands back a string carrier here').toBe('string');
        // A string riding into this dialect's JS arithmetic would corrupt
        // silently (`"1e16" / 100`), so the mirror's documented edge is a
        // named error instead.
        let caught: unknown;
        try { tpl('round(x)', { x: 1e16 }); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(FlowExpressionFunctionError);
        expect((caught as FlowExpressionFunctionError).problem).toBe('argument');
    });

    it('the issue’s oracle shape: round(amount * (1 - discount / 100) * 100) / 100 lands the scale-2 value', () => {
        // 180000 * (1 - 30/100) = 125999.99999999999 — the raw product #7501
        // refuses on a scale: 2 field. The CEL-identical authoring pattern
        // produces the exact representable value.
        expect(tpl('amount * (1 - discount / 100)', { amount: 180000, discount: 30 })).toBe(125999.99999999999);
        expect(tpl('round(amount * (1 - discount / 100) * 100) / 100', { amount: 180000, discount: 30 })).toBe(126000);
        // A case where the cents matter (integer round would be WRONG):
        expect(tpl('round(amount * (1 - discount / 100) * 100) / 100', { amount: 199.99, discount: 15 })).toBe(169.99);
    });

    it('functions compose with variables, nesting, and embedded substitution', () => {
        expect(tpl('min(round(a), ceil(b))', { a: 2.6, b: 1.2 })).toBe(2);
        expect(tpl('max(abs(a), b)', { a: -5, b: 3 })).toBe(5);
        expect(interpolateString('Total: {round(amount * 1.5)}', new Map([['amount', 180000]]), ctx)).toBe('Total: 270000');
    });

    it('in call position the function table wins; bare, a variable of the same name still wins', () => {
        const vars = { round: 99 };
        expect(tpl('round', vars)).toBe(99);              // bare → variable (unchanged)
        expect(tpl('round(1.4)', vars)).toBe(1);          // call → the function
    });
});

// ── Half 2: the LOUD diagnostic — unknown function ⇒ named error, never null ─

describe('unknown function in call position is a named, guard-marked error (#11060)', () => {
    const CASES: Array<{ expr: string; fn: string; hint?: string }> = [
        // The issue's measured spellings, verbatim:
        { expr: 'ROUND(amount * (1 - discount / 100), 2)', fn: 'ROUND', hint: "Did you mean 'round'" },
        { expr: 'round2(x)', fn: 'round2', hint: "Did you mean 'round'" },
        { expr: 'Math.round(amount)', fn: 'Math.round', hint: "Did you mean 'round'" },
        { expr: 'Number(x)', fn: 'Number' },
        { expr: '(amount * 0.7).toFixed(2)', fn: 'toFixed' },
    ];

    for (const { expr, fn, hint } of CASES) {
        it(`'${expr}' names '${fn}' instead of writing undefined`, () => {
            let caught: unknown;
            try { tpl(expr, { amount: 180000, discount: 30, x: 1 }); } catch (e) { caught = e; }
            expect(caught, `'${expr}' must throw — got value instead`).toBeInstanceOf(FlowExpressionFunctionError);
            const err = caught as FlowExpressionFunctionError;
            expect(err.problem).toBe('unknown-function');
            expect(err.fn).toBe(fn);
            expect(err.message).toContain(`'${fn}'`);
            if (hint) expect(err.message).toContain(hint);
            // #3863 — the metadata is wrong; a `fault` edge must not route it.
            expect(isGuardRefusal(err), 'must be guard-marked').toBe(true);
        });
    }

    it('the diagnostic reaches EMBEDDED tokens too — no silent empty-string leg left', () => {
        expect(() => interpolateString('Total: {ROUND(amount)}', new Map([['amount', 1]]), ctx))
            .toThrow(FlowExpressionFunctionError);
    });

    it('NOW/TODAY misused inside arithmetic get the whole-token guidance (they never worked here — but now they say so)', () => {
        let caught: unknown;
        try { tpl('TODAY() + amount * 2', { amount: 1 }); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(FlowExpressionFunctionError);
        expect((caught as FlowExpressionFunctionError).message).toContain('whole token');
    });
});

// ── Over-denial controls: everything that worked keeps working ─────────────

describe('over-denial controls — the diagnostic is not a blanket refusal (#11060)', () => {
    it('operator-only arithmetic (no identifiers in call position) still evaluates', () => {
        const x = 125999.99999999999;
        expect(tpl('(x * 100 + 0.5 - ((x * 100 + 0.5) % 1)) / 100', { x })).toBe(126000);
        expect(tpl('a + b * 2', { a: 1, b: 3 })).toBe(7);
    });

    it('NOW()/TODAY() whole-token macros are unchanged', () => {
        expect(String(tpl('NOW()'))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(String(tpl('TODAY()'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const plus90 = new Date();
        plus90.setDate(plus90.getDate() + 90);
        expect(tpl('TODAY() + 90')).toBe(plus90.toISOString().slice(0, 10));
    });

    it('unresolved NON-call identifiers keep the documented fail-soft contract', () => {
        expect(tpl('missing')).toBeUndefined();
        expect(interpolateString('x={missing}', new Map(), ctx)).toBe('x=');
    });
});
