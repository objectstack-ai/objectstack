// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { ConnectorActionContext } from '../engine.js';
import { registerConnectorNodes } from './connector-nodes.js';
import type { Connector } from '@objectstack/spec/integration';

// ─── Test helpers ────────────────────────────────────────────────────

function createTestLogger() {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => createTestLogger(),
    } as any;
}

/** Minimal PluginContext — registerConnectorNodes only touches ctx.logger. */
function createCtx() {
    return { logger: createTestLogger() } as any;
}

/** A fake connector with one echo action, for exercising the registry. */
function fakeConnector(): Connector {
    return {
        name: 'fake',
        label: 'Fake Connector',
        type: 'api',
        authentication: { type: 'none' },
        actions: [{ key: 'echo', label: 'Echo' }],
    } as Connector;
}

// ─── connector_action baseline node ──────────────────────────────────

describe('connector_action (baseline node)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        registerConnectorNodes(engine, createCtx());
    });

    it('publishes a builtin descriptor in the action registry', () => {
        expect(engine.getRegisteredNodeTypes()).toContain('connector_action');
        const descriptor = engine.getActionDescriptor('connector_action');
        expect(descriptor).toBeDefined();
        expect(descriptor?.source).toBe('builtin');
        expect(descriptor?.category).toBe('io');
        expect(descriptor?.paradigms).toEqual(
            expect.arrayContaining(['flow', 'approval']),
        );
    });

    it('dispatches to the registered handler, passing input through, and surfaces output', async () => {
        let received: { input: Record<string, unknown>; ctx: ConnectorActionContext } | undefined;
        engine.registerConnector(fakeConnector(), {
            async echo(input, ctx) {
                received = { input, ctx };
                return { echoed: input.message, upper: String(input.message).toUpperCase() };
            },
        });

        engine.registerFlow('connector_flow', {
            name: 'connector_flow',
            label: 'Connector Flow',
            type: 'autolaunched',
            variables: [{ name: 'call.upper', type: 'text', isOutput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'Call Fake',
                    connectorConfig: { connectorId: 'fake', actionId: 'echo', input: { message: 'hi' } },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });

        const result = await engine.execute('connector_flow');

        expect(result.success).toBe(true);
        // Handler was invoked with the node's mapped input.
        expect(received?.input).toEqual({ message: 'hi' });
        // Handler context carries the live flow variable map + a logger.
        expect(received?.ctx.variables).toBeInstanceOf(Map);
        expect(typeof received?.ctx.logger.info).toBe('function');
        // Output is written back under `${nodeId}.${key}` and collected as flow output.
        expect(result.output).toEqual({ 'call.upper': 'HI' });
    });

    it('fails the step (not the flow registration) when the connector is unregistered', async () => {
        engine.registerFlow('missing_connector', {
            name: 'missing_connector',
            label: 'Missing Connector',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'Call Ghost',
                    connectorConfig: { connectorId: 'ghost', actionId: 'noop', input: {} },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });

        const result = await engine.execute('missing_connector');
        expect(result.success).toBe(false);
        expect(result.error).toContain('ghost.noop');
    });

    // #4045 — this proves the CONVERSION, not executor tolerance. The executor
    // reads only the declared `connectorConfig` block; the config-authored trio
    // reaches it because `registerFlow` applies
    // `flow-node-connector-config-lift`, which lifts it. This is the exact
    // shape the descriptor's former configSchema mis-taught the schema-driven
    // Studio form to write.
    it('accepts the mis-taught config.{connectorId,actionId,input} shape via the lift', async () => {
        let received: Record<string, unknown> | undefined;
        engine.registerConnector(fakeConnector(), {
            async echo(input) {
                received = input;
                return { echoed: input.message };
            },
        });

        engine.registerFlow('lifted_flow', {
            name: 'lifted_flow',
            label: 'Lifted Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'Config-authored',
                    config: { connectorId: 'fake', actionId: 'echo', input: { message: 'hi' } },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });

        const result = await engine.execute('lifted_flow');
        expect(result.success).toBe(true);
        expect(received).toEqual({ message: 'hi' });
    });

    // #4045 — `input` is optional in the spec block because the executor
    // dispatches with `input ?? {}` and the designer's keyValue editor omits an
    // empty map entirely. Under the old required `input`, this exact designer
    // output failed FlowSchema.parse at registerFlow.
    it('registers and dispatches a connectorConfig with no input (empty map)', async () => {
        let received: Record<string, unknown> | undefined;
        engine.registerConnector(fakeConnector(), {
            async echo(input) {
                received = input;
                return { ok: true };
            },
        });

        engine.registerFlow('no_input_flow', {
            name: 'no_input_flow',
            label: 'No Input Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'No Input',
                    connectorConfig: { connectorId: 'fake', actionId: 'echo' },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });

        const result = await engine.execute('no_input_flow');
        expect(result.success).toBe(true);
        expect(received).toEqual({});
    });

    it('fails the step when connectorConfig is missing required fields', async () => {
        engine.registerFlow('bad_config', {
            name: 'bad_config',
            label: 'Bad Config',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'call', type: 'connector_action', label: 'No Config' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });

        const result = await engine.execute('bad_config');
        expect(result.success).toBe(false);
        expect(result.error).toContain('connectorId');
    });
});

// ─── Declared upstream effect (#4395) ────────────────────────────────

/**
 * The three answers a `connector_action` step can give, each driven through the
 * REAL executor: register a connector whose action declares (or omits) `effect`,
 * run a one-node flow, and read #4354's run summary — the actual consumer of
 * these metrics, and what the broken-sweep alert
 * (`selected > 0 AND acted = 0 AND unmeasured = 0`) queries.
 *
 * A one-node flow makes the summary fully discriminating:
 *   declared write, dispatched  → acted 1, unmeasured 0
 *   declared read               → acted 0, unmeasured 0
 *   undeclared                  → acted 0, unmeasured 1
 */
describe('connector_action declared effect (#4395)', () => {
    /** A connector whose single `run` action declares `effect` (or omits it). */
    function connectorDeclaring(effect?: 'read' | 'write'): Connector {
        return {
            name: 'crm',
            label: 'CRM',
            type: 'saas',
            authentication: { type: 'none' },
            actions: [{ key: 'run', label: 'Run', ...(effect ? { effect } : {}) }],
        } as Connector;
    }

    /** One-node flow dispatching `crm.run`. */
    function registerCallerFlow(engine: AutomationEngine): void {
        engine.registerFlow('caller', {
            name: 'caller',
            label: 'Caller',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'Call',
                    connectorConfig: { connectorId: 'crm', actionId: 'run', input: {} },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });
    }

    async function runWith(
        effect: 'read' | 'write' | undefined,
        handler: () => Promise<Record<string, unknown>>,
    ) {
        const engine = new AutomationEngine(createTestLogger());
        registerConnectorNodes(engine, createCtx());
        engine.registerConnector(connectorDeclaring(effect), { run: handler });
        registerCallerFlow(engine);
        return engine.execute('caller');
    }

    const ok = async () => ({ id: 'ext_1' });
    const boom = async () => { throw new Error('upstream refused'); };

    it('declared write + successful dispatch → acted: 1 (the sweep can prove it worked)', async () => {
        const result = await runWith('write', ok);
        expect(result.success).toBe(true);
        expect(result.summary).toMatchObject({ acted: 1, unmeasured: 0 });
    });

    it('declared read → acted: 0, and a REAL zero (unmeasured stays 0)', async () => {
        const result = await runWith('read', ok);
        expect(result.success).toBe(true);
        // The distinction that matters: `acted: 0` here is a measurement, not a
        // shrug — so a flow whose only action is a lookup is correctly eligible
        // for the broken-sweep alert instead of hiding behind `unmeasured`.
        expect(result.summary).toMatchObject({ acted: 0, unmeasured: 0 });
    });

    it('undeclared → unchanged pre-#4395 behaviour: unmeasured, never acted: 0', async () => {
        const result = await runWith(undefined, ok);
        expect(result.success).toBe(true);
        expect(result.summary).toMatchObject({ acted: 0, unmeasured: 1 });
    });

    it('declared write whose dispatch FAILED is uncountable, not zero', async () => {
        // The handler threw, but the upstream may already have been reached —
        // same call the `http` node makes for a rejected mutating request.
        const result = await runWith('write', boom);
        expect(result.success).toBe(false);
        expect(result.summary).toMatchObject({ acted: 0, unmeasured: 1 });
    });

    it('declared read that failed still reports acted: 0 — it could not have mutated', async () => {
        const result = await runWith('read', boom);
        expect(result.success).toBe(false);
        expect(result.summary).toMatchObject({ acted: 0, unmeasured: 0 });
    });

    it('resolves the declaration per ACTION, not per connector', async () => {
        const engine = new AutomationEngine(createTestLogger());
        registerConnectorNodes(engine, createCtx());
        engine.registerConnector(
            {
                name: 'crm',
                label: 'CRM',
                type: 'saas',
                authentication: { type: 'none' },
                actions: [
                    { key: 'push', label: 'Push', effect: 'write' },
                    { key: 'lookup', label: 'Lookup', effect: 'read' },
                    { key: 'legacy', label: 'Legacy' },
                ],
            } as Connector,
            { push: ok, lookup: ok, legacy: ok },
        );
        expect(engine.resolveConnectorActionEffect('crm', 'push')).toBe('write');
        expect(engine.resolveConnectorActionEffect('crm', 'lookup')).toBe('read');
        expect(engine.resolveConnectorActionEffect('crm', 'legacy')).toBeUndefined();
        // Unknown connector / unknown action are the same undeclared answer,
        // never a throw: the executor already refuses those with its own error.
        expect(engine.resolveConnectorActionEffect('crm', 'ghost')).toBeUndefined();
        expect(engine.resolveConnectorActionEffect('ghost', 'push')).toBeUndefined();
    });

    it('serves the declaration to the designer through GET /connectors', async () => {
        const engine = new AutomationEngine(createTestLogger());
        engine.registerConnector(
            {
                name: 'crm',
                label: 'CRM',
                type: 'saas',
                authentication: { type: 'none' },
                actions: [
                    { key: 'push', label: 'Push', effect: 'write' },
                    { key: 'legacy', label: 'Legacy' },
                ],
            } as Connector,
            { push: ok, legacy: ok },
        );
        const [descriptor] = engine.getConnectorDescriptors();
        expect(descriptor.actions.map((a) => [a.key, a.effect])).toEqual([
            ['push', 'write'],
            ['legacy', undefined],
        ]);
    });
});

// ─── Engine connector registry ───────────────────────────────────────

describe('AutomationEngine connector registry', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    it('registers and lists a connector', () => {
        engine.registerConnector(fakeConnector(), { async echo() { return {}; } });
        expect(engine.getRegisteredConnectors()).toContain('fake');
        expect(engine.resolveConnectorAction('fake', 'echo')).toBeTypeOf('function');
    });

    it('throws when a declared action has no handler', () => {
        expect(() => engine.registerConnector(fakeConnector(), {})).toThrow(/echo/);
    });

    it('rejects an invalid connector definition', () => {
        expect(() =>
            engine.registerConnector({ name: 'Bad Name', type: 'api' } as any, {}),
        ).toThrow();
    });

    it('unregisters a connector', () => {
        engine.registerConnector(fakeConnector(), { async echo() { return {}; } });
        engine.unregisterConnector('fake');
        expect(engine.getRegisteredConnectors()).not.toContain('fake');
        expect(engine.resolveConnectorAction('fake', 'echo')).toBeUndefined();
    });

    it('exposes a designer-facing descriptor per connector, omitting handlers (ADR-0022)', () => {
        engine.registerConnector(
            {
                name: 'fake',
                label: 'Fake Connector',
                type: 'api',
                icon: 'plug',
                authentication: { type: 'none' },
                actions: [
                    {
                        key: 'echo',
                        label: 'Echo',
                        description: 'Echo the input back',
                        inputSchema: { message: { type: 'string' } },
                    },
                ],
            } as unknown as Connector,
            { async echo() { return {}; } },
        );

        const descriptors = engine.getConnectorDescriptors();
        expect(descriptors).toHaveLength(1);
        const fake = descriptors[0];
        expect(fake.name).toBe('fake');
        expect(fake.label).toBe('Fake Connector');
        expect(fake.type).toBe('api');
        expect(fake.icon).toBe('plug');
        expect(fake.actions).toHaveLength(1);
        expect(fake.actions[0]).toEqual({
            key: 'echo',
            label: 'Echo',
            description: 'Echo the input back',
            inputSchema: { message: { type: 'string' } },
            outputSchema: undefined,
        });
        // Handlers are runtime code, never leaked into the metadata view.
        expect((fake as any).handlers).toBeUndefined();
    });

    it('returns an empty descriptor list when no connectors are registered', () => {
        expect(engine.getConnectorDescriptors()).toEqual([]);
    });
});
