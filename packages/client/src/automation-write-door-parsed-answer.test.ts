// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12206, Option A — ruled 2026-08-26] The two `/automation` definition-write
 * doors answer the CANONICALIZED, PARSED flow the engine stored — the same
 * shape `GET /automation/:name` answers — never an echo of the caller's own
 * pre-parse bytes.
 *
 * Everything here is real end to end, on the pattern of
 * `analytics-automation-json-erasure.test.ts`: the real `AutomationEngine`
 * (`@objectstack/service-automation`), the real `HttpDispatcher`
 * (`@objectstack/runtime`), and the real `ObjectStackClient` reading the
 * result. The only stand-in is the socket: `fetch` hands the request to the
 * dispatcher in-process and hands back the producer's own body untouched —
 * a mocked response body here would assert this file's own assumption, which
 * is exactly the mistake that let the old response schemas sit aspirational.
 *
 * What each leg pins:
 *
 *  1. the answer is NOT the echo — schema defaults the caller never wrote
 *     (`version`, `status`, `runAs`, per-edge `type`/`isDefault`) are
 *     materialized, and a string `edge.condition` is lowered to its
 *     `{dialect, source}` envelope (the one genuine type change the #12206
 *     survey measured, zero consumers);
 *  2. write ≡ read — the write door's `data` deep-equals what the read door
 *     then serves for the same resource, so write-then-read is stable;
 *  3. the published `CreateFlowResponseSchema` / `UpdateFlowResponseSchema`
 *     parse the REAL wire body (inherited item ①: conformant, not
 *     aspirational — the first response these schemas have ever seen);
 *  4. the PUT answer always carries `name`, which the old echo could omit
 *     (the name rode the path, not the body).
 *
 * Reverse verification, direction predicted BEFORE running: reverting the two
 * route exits in `packages/runtime/src/domains/automation.ts` back to
 * `deps.success(body)` / `deps.success(definition)` turns legs 1-4 RED (the
 * echo carries no `version`, no lowered condition, and PUT's echo has no
 * `name`); reverting `AutomationEngine.registerFlow` to `void` turns the
 * routes' answer `undefined` and reds leg 2/3 the same way.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore } from '@objectstack/service-automation';
import { HttpDispatcher } from '@objectstack/runtime';
import { CreateFlowResponseSchema, UpdateFlowResponseSchema } from '@objectstack/spec/api';
import type { FlowParsed } from '@objectstack/spec/automation';
import { ObjectStackClient } from './index';

const BASE_URL = 'http://localhost:3000';

/** The definition writes demand `manage_metadata` (ADR-0066 D1). */
const CONTEXT = (): any => ({
    request: {},
    executionContext: { userId: 'usr_1', isSystem: false, systemPermissions: ['manage_metadata'] },
});

/** A raw authored condition string — what the schema lowers to a CEL envelope. */
const RAW_CONDITION = "record.status == 'approved'";

/**
 * A raw authored flow body, the way a real HTTP caller writes one: no
 * `version`, no `status`, no `runAs`, no per-edge `type`/`isDefault`, and a
 * bare STRING `edge.condition`. Every one of those is a delta the parsed
 * answer materializes — which is what makes this fixture able to tell the
 * canonicalized answer apart from an echo.
 */
const RAW_DEFINITION = {
    label: 'Write Door Flow',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end', condition: RAW_CONDITION }],
};

function producerBackedClient() {
    const engine = new AutomationEngine(
        { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } as never,
        new InMemorySuspendedRunStore(),
    );
    const services: Record<string, unknown> = { automation: engine };
    const resolve = (name: string): unknown => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    const dispatcher = new HttpDispatcher(kernel);

    /** The last RAW wire body — the envelope `unwrapResponse` strips, kept so
     * the response schemas can be parsed against what really crossed the wire. */
    const wire: { last: unknown } = { last: undefined };

    const fetchImpl = async (url: string, init: RequestInit = {}): Promise<any> => {
        const parsed = new URL(String(url));
        const method = init.method ?? 'GET';
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        const query = Object.fromEntries(parsed.searchParams);
        const dispatched = await dispatcher.handleAutomation(
            parsed.pathname.slice('/api/v1/automation'.length), method, body, CONTEXT(), query);
        expect(dispatched.handled, `the dispatcher must serve ${method} ${parsed.pathname}`).toBe(true);
        const status = dispatched.response?.status ?? 500;
        wire.last = dispatched.response?.body;
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: String(status),
            headers: new Headers(),
            json: async () => dispatched.response?.body,
        };
    };

    const client = new ObjectStackClient({ baseUrl: BASE_URL, fetch: fetchImpl as any });
    return { client, engine, wire };
}

describe('#12206 — POST /automation answers the canonicalized parsed flow, not the echo', () => {
    it('materializes schema defaults, lowers edge.condition, matches the read door, and conforms to CreateFlowResponseSchema', async () => {
        const { client, wire } = producerBackedClient();

        const answered: FlowParsed = await client.automation.create('wd_flow', RAW_DEFINITION);

        // ① NOT the echo: the caller never wrote any of these.
        expect(answered.name).toBe('wd_flow');
        expect(answered.version).toBe(1);
        expect(answered.status).toBe('draft');
        expect((answered as any).runAs).toBe('user');
        expect(answered.edges[0]).toMatchObject({ type: 'default', isDefault: false });
        // The one genuine type change the survey measured: string condition →
        // lowered `{dialect, source}` envelope.
        expect(answered.edges[0].condition).toEqual({ dialect: 'cel', source: RAW_CONDITION });

        // ③ Inherited item ①: the published response schema parses the REAL
        // wire envelope — conformant, no longer aspirational.
        const envelope = CreateFlowResponseSchema.parse(wire.last);
        expect(envelope.success).toBe(true);
        expect(envelope.data.name).toBe('wd_flow');

        // ② Write ≡ read: the write door answered exactly what the read door
        // now serves for the same resource.
        const read = await client.automation.get('wd_flow');
        expect(answered).toEqual(read);
    });
});

describe('#12206 — PUT /automation/:name answers the canonicalized parsed flow, not the echo', () => {
    it('always carries name, matches the read door, and conforms to UpdateFlowResponseSchema', async () => {
        const { client, wire } = producerBackedClient();
        await client.automation.create('wd_flow', RAW_DEFINITION);

        // The SDK sends `{ definition }`; the engine requires a COMPLETE
        // definition (inherited item ② — `UpdateFlowRequestSchema` no longer
        // claims a partial-update capability nothing implements).
        const updated = { name: 'wd_flow', ...RAW_DEFINITION, label: 'Write Door Flow v2' };
        const answered: FlowParsed = await client.automation.update('wd_flow', updated);

        // ④ The old PUT echo answered `body.definition ?? body`, which could
        // omit `name` entirely; the parsed answer always carries it.
        expect(answered.name).toBe('wd_flow');
        expect(answered.label).toBe('Write Door Flow v2');
        // ① NOT the echo — same materialized defaults as the POST door.
        expect(answered.version).toBe(1);
        expect(answered.edges[0].condition).toEqual({ dialect: 'cel', source: RAW_CONDITION });

        // ③ Inherited item ①, update half.
        const envelope = UpdateFlowResponseSchema.parse(wire.last);
        expect(envelope.success).toBe(true);
        expect(envelope.data.label).toBe('Write Door Flow v2');

        // ② Write ≡ read.
        const read = await client.automation.get('wd_flow');
        expect(answered).toEqual(read);
    });
});
