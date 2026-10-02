// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20790] Q4 A — the outbound `http` node's signing secret moves into the
 * write-only flow credential channel with the inbound one, so the node reads
 * it at EXECUTION time. Pinned against a real local HTTP receiver and an
 * in-memory channel:
 *
 *  - a held secret signs the request exactly as the authored literal did;
 *  - the channel's row wins over a literal (a packaged flow, Q3 A);
 *  - a rotation in the channel signs the next run;
 *  - the cleared form `''` sends unsigned on purpose and never asks the channel;
 *  - a held secret that does not come back refuses the node — the request is
 *    never sent unsigned.
 *
 * Every value is a probe sentinel, not a credential.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signHttpBody } from '@objectstack/core';

import { AutomationEngine } from '../engine.js';
import type { FlowCredentialSource } from '../engine.js';
import { registerHttpNodes } from './http-nodes.js';

const HELD = 'pin-http-held-4b8e';
const LITERAL = 'pin-http-literal-71d5';
const ROTATED = 'pin-http-rotated-e30c';
const SIGNATURE = 'x-objectstack-signature';

let server: Server;
let baseUrl: string;
const received: Array<{ headers: Record<string, unknown>; body: string }> = [];

beforeAll(async () => {
    server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
    received.length = 0;
});

function quiet(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

function channel(initial: Record<string, string> = {}) {
    const rows = new Map(Object.entries(initial));
    let asked = 0;
    const source: FlowCredentialSource = {
        holds: (f, n, k) => rows.has(`${f}/${n}/${k}`),
        held: () => [],
        resolve: async (f, n, k) => {
            asked += 1;
            return rows.get(`${f}/${n}/${k}`);
        },
    };
    return { source, rows, asked: () => asked };
}

async function run(source: FlowCredentialSource | undefined, config: Record<string, unknown>) {
    const engine = new AutomationEngine(quiet());
    registerHttpNodes(engine, { logger: quiet(), getService: () => undefined } as any);
    engine.setFlowCredentialSource(source);
    engine.registerFlow('signed_callout', {
        name: 'signed_callout',
        label: 'Signed callout',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'call', type: 'http', label: 'Call', config: { url: `${baseUrl}/hook`, method: 'POST', body: { a: 1 }, ...config } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    } as never);
    return engine.execute('signed_callout');
}

const sentSignature = () => received[0]?.headers[SIGNATURE];

describe('[#20790] the http node signs with the secret the channel holds', () => {
    it('a held secret signs exactly as the literal did; the definition carries none', async () => {
        const result = await run(channel({ 'signed_callout/call/signingSecret': HELD }).source, {});
        expect(result.success).toBe(true);
        expect(received).toHaveLength(1);
        expect(sentSignature()).toBe(signHttpBody(received[0]!.body, HELD));
    });

    it('the channel row wins over a literal; the literal is the fallback', async () => {
        await run(channel({ 'signed_callout/call/signingSecret': HELD }).source, { signingSecret: LITERAL });
        expect(sentSignature()).toBe(signHttpBody(received[0]!.body, HELD));
        received.length = 0;
        await run(channel().source, { signingSecret: LITERAL });
        expect(sentSignature()).toBe(signHttpBody(received[0]!.body, LITERAL));
    });

    it('a rotation in the channel signs the next run', async () => {
        const held = channel({ 'signed_callout/call/signingSecret': HELD });
        await run(held.source, {});
        held.rows.set('signed_callout/call/signingSecret', ROTATED);
        received.length = 0;
        await run(held.source, {});
        expect(sentSignature()).toBe(signHttpBody(received[0]!.body, ROTATED));
    });

    it("the cleared form '' sends unsigned on purpose and never asks the channel", async () => {
        const held = channel({ 'signed_callout/call/signingSecret': HELD });
        const result = await run(held.source, { signingSecret: '' });
        expect(result.success).toBe(true);
        expect(sentSignature()).toBeUndefined();
        expect(held.asked()).toBe(0);
    });

    it('a held secret that does not come back refuses the node; nothing is sent unsigned', async () => {
        const held = channel({ 'signed_callout/call/signingSecret': HELD });
        held.source.resolve = async () => {
            throw new Error('the ciphertext row is missing');
        };
        const result = await run(held.source, {});
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain('signing secret');
        expect(received).toEqual([]);
    });
});
