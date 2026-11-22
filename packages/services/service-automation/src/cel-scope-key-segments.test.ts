// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The scope a flow's conditions, value envelopes and text holes read is built
 * so that no variable key can write outside the run's own scope object
 * (`./scope-key-segments.ts` states the rule and why a key is skipped rather
 * than refused).
 *
 * Read the engine pins first: a run is handed record keys and node output keys
 * the way its entrances hand them, and afterwards a fresh object of the process
 * must inherit nothing. The builder pins below them hold each half of the rule
 * on its own, and the controls hold that an ordinary dotted key still nests.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { AutomationEngine } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';
import { celScope } from './dag-traversal.js';
import { renderTextSlot, textTemplateScope } from './builtin/template.js';
import { SCOPE_KEY_SKIPPED_SEGMENTS } from './scope-key-segments.js';

function silentLogger(): any {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

function makeEngine(): AutomationEngine {
    const engine = new AutomationEngine(silentLogger());
    installBuiltinNodes(engine, { logger: silentLogger(), getService() { return undefined; } } as any);
    return engine;
}

const PROBES = ['x', 'cskProbeA', 'cskProbeB', 'cskProbeC', 'cskProbeD', 'cskProbeE'] as const;

/** What a fresh object of this process inherits under `name`. */
const inherited = (name: string): unknown => ({} as Record<string, unknown>)[name];

afterEach(() => {
    for (const name of PROBES) delete (Object.prototype as Record<string, unknown>)[name];
});

/** start (condition `cond`) → assignment `v = source` → end, `v` the run's output. */
function conditionFlow(cond: string, source = 'true') {
    return {
        name: 'csk_flow', label: 'csk_flow', type: 'autolaunched',
        variables: [{ name: 'v', type: 'text', isOutput: true }],
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { condition: cond } },
            { id: 'set', type: 'assignment', label: 'Set', config: { assignments: { v: { dialect: 'cel', source } } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'set' },
            { id: 'e2', source: 'set', target: 'end' },
        ],
    } as any;
}

async function runWith(context: Record<string, unknown>, cond: string, source?: string) {
    const engine = makeEngine();
    engine.registerFlow('csk_flow', conditionFlow(cond, source));
    return engine.execute('csk_flow', context as any);
}

describe('a run: no variable key writes outside the run scope object', () => {
    it('a run with the key __proto__.x leaves ({}).x undefined', async () => {
        const result = await runWith({ record: { name: 'a', '__proto__.x': true } }, "record.name == 'a'");
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(inherited('x')).toBeUndefined();
    });

    it('a key with a constructor or prototype segment stays inside the run scope, a walk into a held value included', async () => {
        const record = {
            name: 'a',
            'constructor.prototype.cskProbeA': true,
            'record.constructor.prototype.cskProbeA': true,
            'name_holder.prototype.cskProbeA': true,
        };
        const result = await runWith({ record }, "name == 'a'");
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(inherited('cskProbeA')).toBeUndefined();
    });

    it("a key that descends into a variable's own object value leaves a fresh object unchanged", async () => {
        // `record` is a plain object the run holds; the walk enters it.
        const result = await runWith({ record: { name: 'a', 'record.__proto__.cskProbeB': true } }, "name == 'a'");
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(inherited('cskProbeB')).toBeUndefined();
    });

    it('control: the condition reads the ordinary record keys of the same run', async () => {
        const result = await runWith({ record: { name: 'a', '__proto__.x': true } }, "name == 'a' && record.name == 'a'", 'name');
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect((result.output as { v?: unknown }).v).toBe('a');
    });
});

describe('constructor and prototype stay ordinary keys', () => {
    it('a variable or output key of either name still binds, and a condition reads it', () => {
        const engine = makeEngine();
        const variables = new Map<string, unknown>([['prototype', 'p1'], ['step.prototype', 'p2'], ['step.result', 1]]);
        expect((engine as any).evaluateCondition("vars['prototype'] == 'p1' && step.prototype == 'p2' && step.result == 1", variables)).toBe(true);
        expect((engine as any).evaluateCondition("constructor == 'c1'", new Map<string, unknown>([['constructor', 'c1']]))).toBe(true);
    });

    it('a record field named prototype is still read through the record it came from', async () => {
        const result = await runWith({ record: { name: 'a', prototype: 'p1' } }, "record.prototype == 'p1'", 'record.prototype');
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect((result.output as { v?: unknown }).v).toBe('p1');
    });
});

describe('the CEL scope builder', () => {
    it('creates every container without a prototype, the root included', () => {
        const { extra } = celScope(new Map<string, unknown>([['step.result', 5], ['a.b.c', 1]]));
        const vars = extra.vars as Record<string, any>;
        expect(Object.getPrototypeOf(vars)).toBeNull();
        expect(Object.getPrototypeOf(vars.step)).toBeNull();
        expect(Object.getPrototypeOf(vars.a)).toBeNull();
        expect(Object.getPrototypeOf(vars.a.b)).toBeNull();
    });

    it.each([...SCOPE_KEY_SKIPPED_SEGMENTS])('binds nothing for a key with a %s segment, wherever it sits', (segment) => {
        const keys = [segment, `${segment}.cskProbeC`, `step.${segment}`, `step.${segment}.cskProbeC`];
        const { extra } = celScope(new Map<string, unknown>([['step.result', 5], ...keys.map((k) => [k, { cskProbeD: true }] as [string, unknown])]));
        const vars = extra.vars as Record<string, any>;
        expect(Object.keys(vars)).toEqual(['step']);
        expect(Object.keys(vars.step)).toEqual(['result']);
        expect(Object.getPrototypeOf(vars)).toBeNull();
        expect(Object.getPrototypeOf(vars.step)).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(extra, segment)).toBe(false);
        expect(inherited('cskProbeC')).toBeUndefined();
        expect(inherited('cskProbeD')).toBeUndefined();
    });

    it('control: an ordinary dotted key still nests, and a condition reads it', () => {
        const engine = makeEngine();
        const variables = new Map<string, unknown>([['step.result', 5], ['step.label', 'ok'], ['$error', { message: 'm' }]]);
        const { extra } = celScope(variables);
        expect((extra.vars as any).step).toEqual({ result: 5, label: 'ok' });
        expect((extra as any).step.result).toBe(5);
        expect((engine as any).evaluateCondition("step.result == 5 && vars.step.label == 'ok'", variables)).toBe(true);
        expect((engine as any).evaluateCondition('has(step.result) && !has(step.missing)', variables)).toBe(true);
        expect((engine as any).evaluateCondition("vars['$error'].message == 'm'", variables)).toBe(true);
    });

    it('a skipped key leaves its siblings readable', () => {
        const engine = makeEngine();
        const variables = new Map<string, unknown>([['step.__proto__', { result: 9 }], ['step.result', 5], ['__proto__', { name: 'x' }], ['name', 'a']]);
        expect((engine as any).evaluateCondition("step.result == 5 && name == 'a' && vars.name == 'a'", variables)).toBe(true);
    });
});

describe('the text-hole scope builder', () => {
    it('creates every container without a prototype and binds nothing for a key with a skipped segment', () => {
        const keys = ['__proto__', '__proto__.cskProbeE', 'n1.__proto__', 'n1.__proto__.cskProbeE'];
        const scope = textTemplateScope(new Map<string, unknown>([['n1.result', 'ok'], ...keys.map((k) => [k, { cskProbeE: true }] as [string, unknown])]));
        expect(Object.getPrototypeOf(scope)).toBeNull();
        expect(Object.keys(scope)).toEqual(['n1']);
        expect(Object.getPrototypeOf(scope.n1)).toBeNull();
        expect(Object.keys(scope.n1 as object)).toEqual(['result']);
        expect(inherited('cskProbeE')).toBeUndefined();
    });

    it('control: a hole still reads an ordinary dotted key', () => {
        const rendered = renderTextSlot('{{ n1.result }} / {{ title }}', new Map<string, unknown>([['n1.result', 'ok'], ['title', 'T']]));
        expect(rendered).toBe('ok / T');
    });
});
