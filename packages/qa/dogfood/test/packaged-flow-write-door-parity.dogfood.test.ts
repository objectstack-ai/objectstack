// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20679, ADR-0126 §2] Write-door parity on a PACKAGED flow, over the real
// showcase composition — the public checklist item
// `access-security.packaged-flow-write-door-parity`, clauses 1-4.
//
// ## Why this runs on a booted stack and not only in the runtime package
//
// `packages/runtime/src/domains/automation-packaged-base-lock.test.ts` pins the
// door against a real metadata protocol over a real `SchemaRegistry`. What it
// cannot answer is a question about the COMPOSITION: whether, on the stack an
// operator actually runs, the `/automation` door reaches the same protocol
// instance the `/meta` door answers from, and whether that protocol sees the
// showcase's flow as a packaged artifact. The door keeps today's behaviour when
// the composition carries no protocol, so a boot that resolved nothing would
// leave the door open and every unit test green. Only a real boot can show it
// does not.
//
// ## What each case pins
//
//   1 control — `PUT /meta/flow/:name` refuses the packaged flow with a
//     ledgered code, and the live definition is unchanged. The answering code is
//     recorded, not over-pinned (the checklist's own rule).
//   2 `PUT /automation/:name` with the same body is refused; the flow the engine
//     serves is byte-identical to the capture taken before any probe.
//   3 `DELETE /automation/:name` is refused; the flow still serves.
//   4 no residue: the engine's enabled/bound row for the flow is unchanged.
//   A flow the customer authored through the same door is created, updated and
//   removed as before — the lock is not a closed door.
//
// Nothing is restored afterwards because nothing is mutated: a refused probe is
// the whole assertion, and the byte-identical read-backs prove it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
// The showcase declares `connectors:` bound to these providers, and the
// automation service refuses to start without their factories (ADR-0097) —
// the same composition `packaged-activation-ledger-reach.dogfood.test.ts` boots.
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';
import { fileURLToPath } from 'node:url';

/**
 * The showcase's connectors carry package-relative file refs resolved against
 * the process cwd — the same `chdir` its sibling automation-carrying boots do,
 * restored in `afterAll`.
 */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

/** The checklist item's packaged flow (`com.example.showcase`). */
const FLOW = 'showcase_urgent_task_alert';
/** A flow no package ships — created through the door under test, and removed by it. */
const CUSTOMER_FLOW = 'dogfood_customer_flow_20679';

/** The ledgered locked-base family the metadata door answers with (ADR-0112). */
const LOCKED_BASE_CODES = ['NOT_OVERRIDABLE', 'ITEM_LOCKED'];

/**
 * The two transports answer in two envelopes, and this file reads each where
 * it lives rather than tolerating both at one read: the `/automation` door is
 * the dispatcher's (`{ success, error: { code, message } }`), while `/meta` on
 * this composition is served by the REST server, whose refusal is
 * `{ error: <sentence>, code }` (`@objectstack/rest` `error-response.ts`).
 */
interface DispatcherEnvelope {
    success?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
}
interface RestRefusal {
    error?: string;
    code?: string;
}
const dataOf = (json: unknown) => (json as DispatcherEnvelope).data;
const dispatcherCode = (json: unknown) => (json as DispatcherEnvelope).error?.code;

describe('a packaged flow keeps its locked base at every write door (showcase)', () => {
    let stack: VerifyStack;
    let token: string;
    let prevCwd: string;
    /** The flow as the engine served it before any probe — the no-residue reference. */
    let capture: Record<string, unknown>;
    /** Its enabled/bound row before any probe. */
    let statusBefore: unknown;

    const call = async (method: string, path: string, body?: unknown) => {
        const res = await stack.apiAs(token, method, path, body);
        const json: unknown = await res.json().catch(() => ({}));
        return { status: res.status, json };
    };
    const statusRow = async () => {
        const { status, json } = await call('GET', '/automation/_status');
        expect(status).toBe(200);
        const flows = (dataOf(json) as { flows?: Array<{ name: string }> } | undefined)?.flows ?? [];
        return flows.find((f) => f.name === FLOW);
    };
    const probeBody = () => ({ ...capture, label: `${String(capture.label)} (probe)` });

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        stack = await bootStack(showcaseStack, {
            automation: true,
            extraPlugins: [
                new ConnectorRestPlugin(),
                new ConnectorOpenApiPlugin(),
                new ConnectorMcpPlugin({ declarativeStdio: ['node'] }),
            ],
        });
        token = await stack.signIn();

        const read = await call('GET', `/automation/${FLOW}`);
        expect(read.status, `the packaged flow must be registered: ${JSON.stringify(read.json)}`).toBe(200);
        capture = dataOf(read.json)!;
        statusBefore = await statusRow();
        expect(statusBefore, 'the packaged flow has no runtime status row').toBeDefined();
    }, 120_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
    });

    it('control: the metadata door refuses the packaged flow with a ledgered code, and the definition is unchanged', async () => {
        const put = await call('PUT', `/meta/flow/${FLOW}`, probeBody());

        expect(put.status, JSON.stringify(put.json)).toBe(403);
        // Recorded, not over-pinned: which member of the family answers is part
        // of the evidence (package-less on this topology: `NOT_OVERRIDABLE`).
        expect(LOCKED_BASE_CODES, JSON.stringify(put.json)).toContain((put.json as RestRefusal).code);
        expect(dataOf((await call('GET', `/automation/${FLOW}`)).json)).toEqual(capture);
    });

    it('PUT /automation/:name on the same artifact is refused, and the engine still serves the captured definition', async () => {
        const put = await call('PUT', `/automation/${FLOW}`, probeBody());

        expect(put.status, JSON.stringify(put.json)).toBe(403);
        expect(dispatcherCode(put.json)).toBe('NOT_OVERRIDABLE');
        const after = await call('GET', `/automation/${FLOW}`);
        expect(after.status).toBe(200);
        expect(dataOf(after.json)).toEqual(capture);
    });

    it('DELETE /automation/:name on the same artifact is refused, and the flow still serves', async () => {
        const del = await call('DELETE', `/automation/${FLOW}`);

        expect(del.status, JSON.stringify(del.json)).toBe(403);
        expect(dispatcherCode(del.json)).toBe('NOT_OVERRIDABLE');
        const after = await call('GET', `/automation/${FLOW}`);
        expect(after.status).toBe(200);
        expect(dataOf(after.json)).toEqual(capture);
    });

    it('no residue: the flow\'s enabled/bound row is the one it had before the probes', async () => {
        expect(await statusRow()).toEqual(statusBefore);
    });

    it('a flow no package ships is still created, updated and removed through the same door', async () => {
        const definition = {
            name: CUSTOMER_FLOW,
            label: 'Customer Flow',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: {} },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        };

        const created = await call('POST', '/automation', definition);
        expect(created.status, JSON.stringify(created.json)).toBe(200);

        const updated = await call('PUT', `/automation/${CUSTOMER_FLOW}`, { ...definition, label: 'Customer Flow (edited)' });
        expect(updated.status, JSON.stringify(updated.json)).toBe(200);
        expect(dataOf((await call('GET', `/automation/${CUSTOMER_FLOW}`)).json)?.label).toBe('Customer Flow (edited)');

        const removed = await call('DELETE', `/automation/${CUSTOMER_FLOW}`);
        expect(removed.status, JSON.stringify(removed.json)).toBe(200);
        expect((await call('GET', `/automation/${CUSTOMER_FLOW}`)).status).toBe(404);
    });
});
