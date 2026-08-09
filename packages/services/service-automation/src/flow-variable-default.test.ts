// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import { registerScreenNodes } from './builtin/screen-nodes.js';

/**
 * #4697 — a flow variable declared with `defaultValue` is bound on EVERY path,
 * so "declared" finally means "bound".
 *
 * Why that mattered enough to change the contract: conditions are strict CEL,
 * and an unbound name does not read as `false` there — it ABORTS the whole
 * predicate, which stops the run. `describes the truth table` below measures
 * that on the live evaluator rather than restating it, because the docs half of
 * this issue (`content/docs/automation/flows.mdx`) prescribes the one guard
 * spelling that survives, and a prescription nothing executes is the kind that
 * silently stops being true.
 */

const createTestLogger = () => {
    const logger: Record<string, unknown> = {
        info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    };
    logger.child = () => logger;
    return logger as any;
};

const fakeScreenCtx = () => ({ logger: { info() {}, warn() {}, error() {} } }) as any;

describe('#4697 flow variable defaultValue', () => {
    let engine: AutomationEngine;
    /** What the `capture` node saw, and whether the name was bound at all. */
    let seen: { value: unknown; bound: boolean };

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        seen = { value: 'NEVER-RAN', bound: false };
        engine.registerNodeExecutor({
            type: 'capture',
            async execute(_node, variables) {
                seen = { value: variables.get('createOpportunity'), bound: variables.has('createOpportunity') };
                return { success: true };
            },
        });
    });

    /** A one-variable flow: start → capture → end. */
    const registerFlow = (name: string, variable: Record<string, unknown>) => {
        engine.registerFlow(name, {
            name, label: name, type: 'autolaunched',
            variables: [variable as never],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'cap', type: 'capture', label: 'Capture' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'cap' },
                { id: 'e2', source: 'cap', target: 'end' },
            ],
        });
    };

    describe('binding', () => {
        it('binds the declared default when the caller supplies no param', async () => {
            registerFlow('f_default', { name: 'createOpportunity', type: 'boolean', isInput: true, defaultValue: false });

            const r = await engine.execute('f_default');

            expect(r.success).toBe(true);
            expect(seen).toEqual({ value: false, bound: true });
        });

        it('leaves the variable UNBOUND when no default is declared — the pre-#4697 behaviour, unchanged', async () => {
            // The reverse direction of the pin above: a declaration WITHOUT
            // `defaultValue` must keep behaving exactly as it did, or this
            // change would be a silent migration of every existing flow.
            registerFlow('f_nodefault', { name: 'createOpportunity', type: 'boolean', isInput: true });

            const r = await engine.execute('f_nodefault');

            expect(r.success).toBe(true);
            expect(seen).toEqual({ value: undefined, bound: false });
        });

        it('binds a NON-input declaration from its default (params cannot reach it at all)', async () => {
            registerFlow('f_noninput', { name: 'createOpportunity', type: 'boolean', isInput: false, defaultValue: true });

            const r = await engine.execute('f_noninput', { params: { createOpportunity: false } } as never);

            expect(r.success).toBe(true);
            // `isInput: false` means the param is not readable — the default is
            // the only thing that can bind the name, and it does.
            expect(seen).toEqual({ value: true, bound: true });
        });
    });

    describe('the `params[name] !== undefined` boundary', () => {
        // The whole point of the boundary is that a FALSY supplied value is
        // still a supplied value. Each of these would be swallowed by a truthy
        // check (`params[name] || defaultValue`), and each is a real answer a
        // screen can collect.
        const falsy: Array<[string, unknown]> = [
            ['false', false],
            ['null', null],
            ['0', 0],
            ['empty string', ''],
        ];

        for (const [label, supplied] of falsy) {
            it(`an explicitly supplied ${label} WINS over the default`, async () => {
                registerFlow(`f_boundary_${label.replace(/\W+/g, '_')}`, {
                    name: 'createOpportunity', type: 'boolean', isInput: true, defaultValue: 'THE-DEFAULT',
                });

                const r = await engine.execute(`f_boundary_${label.replace(/\W+/g, '_')}`, {
                    params: { createOpportunity: supplied },
                } as never);

                expect(r.success).toBe(true);
                expect(seen).toEqual({ value: supplied, bound: true });
            });
        }

        it('an explicitly declared `defaultValue: null` binds null (absence is `undefined`, not `null`)', async () => {
            registerFlow('f_null_default', { name: 'createOpportunity', type: 'object', isInput: true, defaultValue: null });

            const r = await engine.execute('f_null_default');

            expect(r.success).toBe(true);
            expect(seen).toEqual({ value: null, bound: true });
        });
    });

    describe('precedence against the flattened trigger record', () => {
        it('a declared default shadows a record field of the same name — the rule a supplied param already followed', async () => {
            // `execute` flattens the trigger record to top-level names but skips
            // names already seeded from the declarations. Defaults join that
            // seeding, so a name resolves from its declaration whether or not
            // the caller passed it — rather than switching source silently.
            registerFlow('f_shadow', { name: 'createOpportunity', type: 'boolean', isInput: true, defaultValue: false });

            const r = await engine.execute('f_shadow', { record: { id: 'r1', createOpportunity: true } } as never);

            expect(r.success).toBe(true);
            expect(seen).toEqual({ value: false, bound: true });
        });
    });

    describe('the defect this closes, end to end', () => {
        /**
         * hotcrm#643, reduced: a screen collects an optional checkbox, the
         * runner returns only the fields the user touched, and the outgoing
         * edge reads the variable. On the untouched path the name was unbound
         * and the edge ABORTED — a lead conversion that persisted nothing.
         */
        const registerScreenFlow = (name: string, variable: Record<string, unknown> | null) => {
            engine.registerFlow(name, {
                name, label: name, type: 'screen',
                ...(variable ? { variables: [variable as never] } : {}),
                nodes: [
                    { id: 'start', type: 'start', label: 'Start' },
                    {
                        id: 'collect', type: 'screen', label: 'Conversion Details',
                        config: { fields: [{ name: 'notes', label: 'Notes', type: 'text' }] },
                    },
                    { id: 'cap', type: 'capture', label: 'Capture' },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'collect' },
                    // The predicate the untouched path used to abort on.
                    { id: 'e2', source: 'collect', target: 'cap', condition: 'createOpportunity == false' },
                    { id: 'e3', source: 'cap', target: 'end' },
                ],
            });
        };

        it('WITHOUT a default the untouched path aborts the outgoing edge', async () => {
            registerScreenNodes(engine, fakeScreenCtx());
            registerScreenFlow('hotcrm_broken', { name: 'createOpportunity', type: 'boolean', isInput: true });

            const paused = await engine.execute('hotcrm_broken');
            expect(paused.status).toBe('paused');

            // Resume the way the runner does on the untouched path: it returns
            // only the fields the user actually touched.
            const resumed = await engine.resume(paused.runId!, { variables: { notes: 'left the box alone' } });

            expect(resumed.success).toBe(false);
            expect(resumed.error).toContain('Unknown variable: createOpportunity');
            expect(seen.value).toBe('NEVER-RAN'); // downstream never reached
        });

        it('WITH a default the same untouched path routes and the run completes', async () => {
            registerScreenNodes(engine, fakeScreenCtx());
            registerScreenFlow('hotcrm_fixed', { name: 'createOpportunity', type: 'boolean', isInput: true, defaultValue: false });

            const paused = await engine.execute('hotcrm_fixed');
            expect(paused.status).toBe('paused');

            const resumed = await engine.resume(paused.runId!, { variables: { notes: 'left the box alone' } });

            expect(resumed.success).toBe(true);
            expect(seen).toEqual({ value: false, bound: true });
        });
    });

    describe('the strict-CEL truth table the docs half prescribes from', () => {
        // Measured, not restated. `content/docs/automation/flows.mdx` tells an
        // author that `has(X.f)` does NOT survive an unbound variable and that
        // `has(vars.X)` is the form that does; this is that claim, executable.
        const evalCel = (source: string, vars: Map<string, unknown>) => {
            try {
                return { ok: true as const, value: engine.evaluateCondition({ dialect: 'cel', source }, vars) };
            } catch (err) {
                return { ok: false as const, message: (err as Error).message.replace(/\s+/g, ' ') };
            }
        };
        const unbound = () => new Map<string, unknown>();
        const bound = (v: unknown) => new Map<string, unknown>([['X', v]]);

        it('a bare read of an unbound variable aborts — it does not read as false', () => {
            const r = evalCel('X.f == 1', unbound());
            expect(r.ok).toBe(false);
            expect(r.ok === false && r.message).toContain('Unknown variable: X');
        });

        it('`has(X.f)` — the guard an author reaches for first — aborts on the very case it is written for', () => {
            const r = evalCel('has(X.f)', unbound());
            expect(r.ok).toBe(false);
            expect(r.ok === false && r.message).toContain('Unknown variable: X');
        });

        it('`has(vars.X)` is the only spelling that tests bindedness', () => {
            expect(evalCel('has(vars.X)', unbound())).toEqual({ ok: true, value: false });
            expect(evalCel('has(vars.X)', bound(null))).toEqual({ ok: true, value: true });
            expect(evalCel('has(vars.X)', bound({ f: 1 }))).toEqual({ ok: true, value: true });
        });

        it('the guarded composite short-circuits, so `has(vars.X) && X.f == 1` is safe on the unbound leg', () => {
            expect(evalCel('has(vars.X) && X.f == 1', unbound())).toEqual({ ok: true, value: false });
            expect(evalCel('has(vars.X) && X.f == 1', bound({ f: 1 }))).toEqual({ ok: true, value: true });
        });

        it('binding a variable — which a declared default now always does — makes the bare read work', () => {
            expect(evalCel('X.f == 1', bound({ f: 1 }))).toEqual({ ok: true, value: true });
        });
    });
});
