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
            } as Connector,
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
