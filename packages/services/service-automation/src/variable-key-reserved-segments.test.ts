// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * No flow variable key, nor any dot-separated part of one, is `__proto__`,
 * `constructor` or `prototype` (`./scope-key-segments.ts` states the rule).
 *
 * Two doors hold it:
 *
 *  - **the authoring door** — `registerFlow` (and the stored pass that
 *    previews it) refuses a flow that declares, assigns or binds such a key,
 *    naming the key and where it sits;
 *  - **the resume door** — `resume` refuses a signal whose `output` or `inputs`
 *    carry such a key, before anything reads the submitted values, so nothing
 *    is folded into the run and the pause stays live.
 *
 * The controls hold that an ordinary dotted key, and a name that merely
 * contains one of the three words, still registers and resumes.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { defineActionDescriptor } from '@objectstack/spec/automation';

import { AutomationEngine, applyResumeSignal, engineBuilt, reservedResumeSignalKeys } from './engine.js';
import { VARIABLE_KEY_POSITIONS, validateVariableKeySegments } from './flow-registration-checks.js';
import { installBuiltinNodes } from './builtin/index.js';
import { RESERVED_VARIABLE_KEY_REFUSAL, RESERVED_VARIABLE_KEY_SEGMENTS, hasReservedVariableKeySegment } from './scope-key-segments.js';

function silentLogger(): any {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

function makeEngine(): AutomationEngine {
    const engine = new AutomationEngine(silentLogger());
    installBuiltinNodes(engine, { logger: silentLogger(), getService() { return undefined; } } as any);
    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: defineActionDescriptor({ type: 'hold', version: '1.0.0', name: 'hold', supportsPause: true, resumeAuthority: 'any' }),
        async execute() { return { success: true, suspend: true, correlation: 'approval:req_1' }; },
    } as never);
    return engine;
}

/** start → `middle` → end, with `variables` declared. */
function flowWith(middle: Record<string, unknown>, variables: unknown[] = []) {
    return {
        name: 'vk_flow', label: 'vk_flow', type: 'autolaunched',
        variables,
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'mid', label: 'Middle', ...middle },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'mid' },
            { id: 'e2', source: 'mid', target: 'end' },
        ],
    } as any;
}

const assign = (assignments: Record<string, unknown>) => ({ type: 'assignment', config: { assignments } });

/** Each case: a flow, and the key its refusal must name. Titles are numbered; the data is the sample. */
const AUTHORING_CASES: ReadonlyArray<[string, () => any, string]> = [
    ['case 1 (declared variable)', () => flowWith(assign({ v: 1 }), [{ name: 'constructor', type: 'text' }]), 'constructor'],
    ['case 2 (declared variable, dotted)', () => flowWith(assign({ v: 1 }), [{ name: 'cfg.prototype', type: 'text' }]), 'cfg.prototype'],
    ['case 3 (declared variable)', () => flowWith(assign({ v: 1 }), [JSON.parse('{"name":"__proto__","type":"text"}')]), '__proto__'],
    ['case 4 (assignment map key)', () => flowWith(assign({ 'step.constructor': 1 })), 'step.constructor'],
    ['case 5 (assignment map key)', () => flowWith(assign({ 'step.__proto__.x': 1 })), 'step.__proto__.x'],
    ['case 6 (assignment map key)', () => flowWith(assign({ prototype: 1 })), 'prototype'],
    ['case 7 (bare assignment config key)', () => flowWith({ type: 'assignment', config: { 'a.prototype': 1 } }), 'a.prototype'],
    ['case 8 (node output variable)', () => flowWith({ type: 'get_record', config: { objectName: 'crm_account', outputVariable: 'found.constructor' } }), 'found.constructor'],
    ['case 9 (screen field)', () => flowWith({ type: 'screen', config: { title: 'T', fields: [{ name: 'prototype', label: 'P', type: 'text' }] } }), 'prototype'],
];

describe('the authoring door refuses a variable key with a reserved segment', () => {
    it('the reserved set names exactly the three segments, so the cases below cannot run empty', () => {
        expect([...RESERVED_VARIABLE_KEY_SEGMENTS].sort()).toEqual(['__proto__', 'constructor', 'prototype']);
    });

    it.each(AUTHORING_CASES)('%s is refused at registration, naming the key', (_title, build, key) => {
        const engine = makeEngine();
        let thrown: unknown;
        try {
            engine.registerFlow('vk_flow', build());
        } catch (err) {
            thrown = err;
        }
        expect(thrown, 'registerFlow must refuse').toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        expect(message).toContain(RESERVED_VARIABLE_KEY_REFUSAL);
        expect(message).toContain(`\`${key}\``);
        expect(engine.getFlowSlots('vk_flow')).toEqual([]);
    });

    it.each(AUTHORING_CASES)('%s is listed by the stored pass, which registers nothing', (_title, build, key) => {
        const engine = makeEngine();
        const { todos } = engine.canonicalizeStoredFlow('vk_flow', build());
        const listed = todos.map((t) => JSON.stringify(t)).join('\n');
        expect(listed).toContain(RESERVED_VARIABLE_KEY_REFUSAL);
        expect(listed).toContain(key);
        expect(engine.getFlowSlots('vk_flow')).toEqual([]);
    });

    it('control: ordinary dotted keys, and names that only contain a reserved word, still register and run', async () => {
        const engine = makeEngine();
        engine.registerFlow('vk_flow', flowWith(
            assign({
                'step.result': 5,
                constructor_name: 'c',
                prototype_count: { dialect: 'cel', source: 'step.result + 1' },
                out: { dialect: 'cel', source: "string(prototype_count) + constructor_name" },
            }),
            [{ name: 'out', type: 'text', isOutput: true }, { name: 'my_prototype', type: 'text' }],
        ));
        const result = await engine.execute('vk_flow');
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect((result.output as { out?: unknown }).out).toBe('6c');
    });
});

/** start → screen (one required field, one conditional field) → end. */
const SCREEN_FLOW = {
    name: 'vk_screen', label: 'vk_screen', type: 'screen',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
            id: 'collect', type: 'screen', label: 'Collect',
            config: {
                title: 'Collect',
                fields: [
                    { name: 'full_name', label: 'Name', type: 'text', required: true },
                    { name: 'note', label: 'Note', type: 'text', required: true, visibleWhen: "full_name == 'show'" },
                ],
            },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'collect' },
        { id: 'e2', source: 'collect', target: 'end' },
    ],
} as any;

/** start → hold (a pause whose node declares no input contract) → end. */
const HOLD_FLOW = {
    name: 'vk_hold', label: 'vk_hold', type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'hold', label: 'Hold' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'end' },
    ],
} as any;

/** Each case: the signal field and its JSON (so a `__proto__` key is an own key, as a transport hands it). */
const RESUME_CASES: ReadonlyArray<[string, 'output' | 'variables', string]> = [
    ['case 1 (inputs)', 'variables', '{"full_name":"show","note":"n","constructor":1}'],
    ['case 2 (inputs, dotted)', 'variables', '{"full_name":"show","note":"n","a.prototype":1}'],
    ['case 3 (inputs)', 'variables', '{"full_name":"show","note":"n","__proto__":{"x":1}}'],
    ['case 4 (output)', 'output', '{"prototype":1}'],
    ['case 5 (output, dotted)', 'output', '{"decision.constructor":1}'],
    ['case 6 (output)', 'output', '{"__proto__":{"x":1}}'],
];

function signalOf(field: 'output' | 'variables', json: string, base: Record<string, unknown> = {}) {
    return { ...base, [field]: JSON.parse(json) };
}

describe('the resume door refuses a signal key with a reserved segment', () => {
    it.each(RESUME_CASES)('%s on a screen: refused before the submitted values are read, nothing folded', async (_title, field, json) => {
        const engine = makeEngine();
        engine.registerFlow('vk_screen', SCREEN_FLOW);
        const paused = await engine.execute('vk_screen');
        expect(paused.status).toBe('paused');
        const runId = paused.runId!;
        const before = JSON.stringify(((await (engine as any).loadSuspendedRun(runId)) as { variables: unknown }).variables);

        const evaluate = vi.spyOn(engine as any, 'evaluateCondition');
        const base = field === 'output' ? { variables: { full_name: 'show', note: 'n' } } : {};
        const refused = await engine.resume(runId, signalOf(field, json, base));
        expect(refused.success).toBe(false);
        expect(refused.code).toBe('INVALID_SIGNAL');
        expect(refused.error).toContain(RESERVED_VARIABLE_KEY_REFUSAL);
        // The `visibleWhen` path never ran: nothing read the submitted bag.
        expect(evaluate).not.toHaveBeenCalled();
        evaluate.mockRestore();

        // Nothing folded, and the pause is still live for the real submission.
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
        const after = JSON.stringify(((await (engine as any).loadSuspendedRun(runId)) as { variables: unknown }).variables);
        expect(after).toBe(before);
        const done = await engine.resume(runId, { variables: { full_name: 'show', note: 'n' } });
        expect(done.success, JSON.stringify(done)).toBe(true);
    });

    it.each(RESUME_CASES)('%s on a pause with no input contract: refused, nothing folded', async (_title, field, json) => {
        const engine = makeEngine();
        engine.registerFlow('vk_hold', HOLD_FLOW);
        const paused = await engine.execute('vk_hold');
        expect(paused.status).toBe('paused');
        const runId = paused.runId!;

        const refused = await engine.resume(runId, signalOf(field, json));
        expect(refused.success).toBe(false);
        expect(refused.code).toBe('INVALID_SIGNAL');
        expect(await engine.hasSuspendedRun(runId)).toBe(true);

        const done = await engine.resume(runId, { output: { decision: 'approved' } });
        expect(done.success, JSON.stringify(done)).toBe(true);
    });

    it('control: ordinary output and input keys, dotted included, still resume', async () => {
        const engine = makeEngine();
        engine.registerFlow('vk_hold', HOLD_FLOW);
        const paused = await engine.execute('vk_hold');
        const done = await engine.resume(paused.runId!, {
            output: { decision: 'approved', 'detail.constructor_name': 'c' },
            variables: { prototype_count: 1, 'step.result': 2 },
        });
        expect(done.success, JSON.stringify(done)).toBe(true);
    });
});

describe('the resume chokepoint refuses the same keys, whoever calls it', () => {
    it.each(RESUME_CASES)('%s: rejected as a whole, nothing folded', (_title, field, json) => {
        const variables = new Map<string, unknown>([['kept', 1]]);
        const rejected = applyResumeSignal(variables, signalOf(field, json, { variables: { fine: 2 } }) as any, 'n1');
        expect(rejected.length).toBeGreaterThan(0);
        expect([...variables.keys()]).toEqual(['kept']);
    });

    it('control: ordinary keys are folded', () => {
        const variables = new Map<string, unknown>();
        expect(applyResumeSignal(variables, { output: { decision: 'ok' }, variables: { 'step.result': 1 } }, 'n1')).toEqual([]);
        expect([...variables.keys()].sort()).toEqual(['n1.decision', 'step.result']);
    });
});

// ── Every position the door judges ──────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
/** The spec's binding-position vocabulary, read from its source (the module is package-internal). */
const SPEC_BINDING_MODULE = resolve(HERE, '../../../spec/src/automation/flow-bound-variable-name.ts');

function specBindingKeys(): string[] {
    const text = readFileSync(SPEC_BINDING_MODULE, 'utf8');
    const block = /const BINDING_CLAUSES = \{([\s\S]*?)\n\} as const;/.exec(text);
    if (!block) throw new Error('BINDING_CLAUSES not found in the spec module');
    return [...block[1]!.matchAll(/^  ([A-Za-z]+):/gm)].map((m) => m[1]!);
}

/** A parsed-shape flow around `nodes` (the door walks the parsed flow; no parse here, so every shape is reachable). */
function parsedFlow(nodes: any[], variables: any[] = []): any {
    return { name: 'vk_pos', nodes: [{ id: 'start', type: 'start' }, ...nodes], edges: [], variables };
}

/** One case per judged position: the flow, and the path suffix its refusal names. */
const POSITION_CASES: Record<string, [() => any, string]> = {
    nodeId: [() => parsedFlow([{ id: 'step.constructor', type: 'assignment', config: { assignments: { v: 1 } } }]), 'nodes[1].id'],
    variableName: [() => parsedFlow([], [{ name: 'prototype', type: 'text' }]), 'variables[0].name'],
    outputVariable: [() => parsedFlow([{ id: 'run', type: 'script', config: { function: 'f', outputVariable: ' constructor' } }]), 'nodes[1].config.outputVariable'],
    errorVariable: [() => parsedFlow([{ id: 'guard', type: 'try_catch', config: { try: { nodes: [], edges: [] }, errorVariable: 'caught.prototype' } }]), 'nodes[1].config.errorVariable'],
    iteratorVariable: [() => parsedFlow([{ id: 'each', type: 'loop', config: { collection: [1], iteratorVariable: 'row.__proto__', body: { nodes: [], edges: [] } } }]), 'nodes[1].config.iteratorVariable'],
    indexVariable: [() => parsedFlow([{ id: 'each', type: 'loop', config: { collection: [1], iteratorVariable: 'row', indexVariable: 'constructor', body: { nodes: [], edges: [] } } }]), 'nodes[1].config.indexVariable'],
    idVariable: [() => parsedFlow([{ id: 'form', type: 'screen', config: { objectName: 'crm_account', idVariable: ' cfg.prototype ' } }]), 'nodes[1].config.idVariable'],
    screenFieldName: [() => parsedFlow([{ id: 'ask', type: 'screen', config: { fields: [{ name: 'constructor', type: 'text' }] } }]), 'nodes[1].config.fields[0].name'],
    assignmentTarget: [() => parsedFlow([{ id: 'set', type: 'assignment', config: { assignments: { 'a.prototype': 1 } } }]), 'nodes[1].config.assignments["a.prototype"]'],
};

describe('the authoring door judges every binding position the spec names, and node ids', () => {
    it('its positions are the spec\'s binding positions plus the node id', () => {
        expect([...VARIABLE_KEY_POSITIONS].sort()).toEqual([...specBindingKeys(), 'nodeId'].sort());
    });

    it('the cases below cover every judged position, one each', () => {
        expect(Object.keys(POSITION_CASES).sort()).toEqual([...VARIABLE_KEY_POSITIONS].sort());
    });

    it.each(Object.entries(POSITION_CASES))('position %s: refused, naming the site', (position, [build, suffix]) => {
        const refusal = validateVariableKeySegments('vk_pos', build());
        expect(refusal, 'the door must refuse').toBeDefined();
        expect(refusal!.message).toContain(RESERVED_VARIABLE_KEY_REFUSAL);
        expect(refusal!.sites.some((site) => site.path.endsWith(suffix) && site.detail.includes(`(${position})`)), JSON.stringify(refusal!.sites)).toBe(true);
    });

    it.each([
        ['case 1 (assignment map)', { assignments: { 'x.constructor': 1 } }, 'assignments["x.constructor"]'],
        ['case 2 (legacy array, variable)', { assignments: [{ variable: 'x.prototype', value: 1 }] }, 'assignments[0].variable'],
        ['case 3 (legacy array, name)', { assignments: [{ name: 'constructor', value: 1 }] }, 'assignments[0].name'],
        ['case 4 (legacy array, key)', { assignments: [{ key: '__proto__', value: 1 }] }, 'assignments[0].key'],
        ['case 5 (bare config)', { 'y.prototype': 1 }, 'config["y.prototype"]'],
    ])('%s: every assignment shape is judged', (_title, config, suffix) => {
        const refusal = validateVariableKeySegments('vk_pos', parsedFlow([{ id: 'set', type: 'assignment', config }]));
        expect(refusal?.sites.some((site) => site.path.endsWith(suffix)), JSON.stringify(refusal?.sites)).toBe(true);
    });

    it('a key inside a nested graph is judged where it sits', () => {
        const inner = { id: 'inner', type: 'assignment', config: { assignments: { 'z.constructor': 1 } } };
        const refusal = validateVariableKeySegments('vk_pos', parsedFlow([
            { id: 'each', type: 'loop', config: { collection: [1], iteratorVariable: 'row', body: { nodes: [inner], edges: [] } } },
        ]));
        expect(refusal?.sites.map((site) => site.path)).toEqual(['flows[0].nodes[1].config.body.nodes[0].config.assignments["z.constructor"]']);
    });

    it.each([
        ['case 1', ' constructor'],
        ['case 2', ' cfg.prototype '],
        ['case 3', ' __proto__'],
    ])('%s: a name an executor trims is judged trimmed', (_title, name) => {
        expect(validateVariableKeySegments('vk_pos', parsedFlow([{ id: 'run', type: 'script', config: { function: 'f', outputVariable: name } }]))).toBeDefined();
        expect(validateVariableKeySegments('vk_pos', parsedFlow([{ id: 'form', type: 'screen', config: { objectName: 'o', idVariable: name } }]))).toBeDefined();
    });

    it('a map node whose id has a reserved part is refused at registration', () => {
        const engine = makeEngine();
        const flow = flowWith({ type: 'map', config: { flowName: 'child', collection: [1], iteratorVariable: 'item' } });
        flow.nodes[1].id = 'batch.prototype';
        flow.edges[0].target = 'batch.prototype';
        flow.edges[1].source = 'batch.prototype';
        expect(() => engine.registerFlow('vk_flow', flow)).toThrow(RESERVED_VARIABLE_KEY_REFUSAL);
    });

    it('control: every position with an ordinary name passes', () => {
        expect(validateVariableKeySegments('vk_pos', parsedFlow([
            { id: 'step_constructor', type: 'script', config: { function: 'f', outputVariable: ' result ' } },
            { id: 'form', type: 'screen', config: { objectName: 'o', idVariable: 'saved.id' } },
            { id: 'set', type: 'assignment', config: { assignments: [{ variable: 'prototype_count', value: 1 }] } },
        ], [{ name: 'cfg.mode', type: 'text' }]))).toBeUndefined();
    });
});

// ── Resume: delegated signals, and the engine's own continuations ───────────

/** A child screen flow, and a parent that calls it through a `subflow` node. */
function subflowPair(engine: AutomationEngine, outputVariable = 'child_out') {
    engine.registerFlow('vk_child', {
        name: 'vk_child', label: 'vk_child', type: 'screen',
        variables: [{ name: 'note', type: 'text', isOutput: true }],
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'ask', type: 'screen', label: 'Ask', config: { title: 'Ask', fields: [{ name: 'note', label: 'Note', type: 'text', required: true }] } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'ask' }, { id: 'e2', source: 'ask', target: 'end' }],
    } as any);
    engine.registerFlow('vk_parent', {
        name: 'vk_parent', label: 'vk_parent', type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'vk_child', outputVariable } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'call' }, { id: 'e2', source: 'call', target: 'end' }],
    } as any);
}

describe('resume: a delegated signal is judged, an engine-built one is not', () => {
    it.each(RESUME_CASES)('%s delegated to a subflow child: refused, both runs stay paused', async (_title, field, json) => {
        const engine = makeEngine();
        subflowPair(engine);
        const paused = await engine.execute('vk_parent');
        expect(paused.status).toBe('paused');
        const base = field === 'output' ? { variables: { note: 'n' } } : {};
        const body = field === 'variables' ? { variables: { note: 'n', ...JSON.parse(json) } } : signalOf(field, json, base);
        const refused = await engine.resume(paused.runId!, body as any);
        expect(refused.success).toBe(false);
        expect(refused.code).toBe('INVALID_SIGNAL');
        const done = await engine.resume(paused.runId!, { variables: { note: 'n' } });
        expect(done.success, JSON.stringify(done)).toBe(true);
    });

    it.each(RESUME_CASES)('%s in an engine-built signal: not judged, so the continuation is folded', (_title, field, json) => {
        const signal = engineBuilt(signalOf(field, json) as any);
        expect(reservedResumeSignalKeys(signal)).toEqual([]);
        const variables = new Map<string, unknown>();
        expect(applyResumeSignal(variables, signal, 'n1')).toEqual([]);
        expect([...variables.keys()].some((key) => hasReservedVariableKeySegment(key))).toBe(true);
    });

    it('an engine-built continuation under a key the door would now refuse still completes the parent', async () => {
        const engine = makeEngine();
        subflowPair(engine);
        // A parent held from before the rule: its output variable is a key the door now refuses.
        const held = await engine.getFlow('vk_parent');
        (held!.nodes.find((n: any) => n.id === 'call') as any).config.outputVariable = 'child.constructor';
        const paused = await engine.execute('vk_parent');
        expect(paused.status).toBe('paused');
        const done = await engine.resume(paused.runId!, { variables: { note: 'n' } });
        expect(done.success, JSON.stringify(done)).toBe(true);
    });
});
