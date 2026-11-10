// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 row R9, epic #31527 child B (flow), #31696] The outbound
 * `http` node reads its signing secret for the flow it runs in: when two
 * packages ship a flow of one name, a run of one package's flow signs with
 * that package's secret, and never with the other package's.
 *
 * Pinned at the node, against a real local HTTP receiver and a channel
 * stand-in that answers by `(flow name, package)` as the real channel does.
 * Every value is a probe sentinel, not a credential.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signHttpBody } from '@objectstack/core';

import { AutomationEngine } from '../engine.js';
import type { FlowCredentialSource } from '../engine.js';
import { registerHttpNodes } from './http-nodes.js';

const P1 = 'com.acme.alpha';
const P2 = 'com.acme.beta';
const P2_HELD = 'pin-slot-p2-held-9c41';
const SIGNATURE = 'x-objectstack-signature';

let server: Server;
let baseUrl: string;
const received: Array<{ path: string; headers: Record<string, unknown>; body: string }> = [];

beforeAll(async () => {
    server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
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

/** Rows by `(flow name, node, key, package)`. */
function channel(rows: Array<{ flow: string; node: string; key: string; packageId: string; value: string }>) {
    const asked: Array<string | undefined> = [];
    const match = (f: string, n: string, k: string, p?: string) =>
        rows.filter((r) => r.flow === f && r.node === n && r.key === k && (p === undefined || r.packageId === p));
    const source: FlowCredentialSource = {
        readsByPackage: true,
        holds: (f, n, k, p) => { asked.push(p); return match(f, n, k, p).length > 0; },
        held: () => [],
        resolve: async (f, n, k, p) => match(f, n, k, p).slice(-1)[0]?.value,
    };
    return { source, asked };
}

/** start → call (http POST to `/<tag>`) → end; both packages' flows share the node id. */
function callout(tag: string) {
    return {
        name: 'f',
        label: 'f',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'call', type: 'http', label: 'Call', config: { url: `${baseUrl}/${tag}`, method: 'POST', body: { a: 1 } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    };
}

function engineWithBoth(source: FlowCredentialSource): AutomationEngine {
    const engine = new AutomationEngine(quiet());
    registerHttpNodes(engine, { logger: quiet(), getService: () => undefined } as any);
    engine.setFlowCredentialSource(source);
    engine.setPackagedFlowSource((name, packageId) =>
        name !== 'f' ? undefined : packageId === undefined ? undefined : [P1, P2].includes(packageId) ? packageId : undefined);
    engine.registerFlow('f', callout('p1') as never, { source: 'package', packageId: P1, holder: P1 });
    engine.registerFlow('f', callout('p2') as never, { source: 'package', packageId: P2, holder: P2 });
    return engine;
}

describe('[#31696] the http node signs with its own package\'s secret when two packages ship the flow\'s name', () => {
    it('a run of P1\'s flow is not signed with P2\'s secret; a run of P2\'s flow is', async () => {
        const held = channel([{ flow: 'f', node: 'call', key: 'signingSecret', packageId: P2, value: P2_HELD }]);
        const engine = engineWithBoth(held.source);

        const one = await engine.executeSlot(P1, 'f');
        expect(one.success).toBe(true);
        expect(received).toHaveLength(1);
        expect(received[0].path).toBe('/p1');
        expect(received[0].headers[SIGNATURE]).toBeUndefined();

        received.length = 0;
        const two = await engine.executeSlot(P2, 'f');
        expect(two.success).toBe(true);
        expect(received[0].path).toBe('/p2');
        expect(received[0].headers[SIGNATURE]).toBe(signHttpBody(received[0].body, P2_HELD));

        // The channel was only ever asked for one package.
        expect(held.asked).toEqual([P1, P2]);
    });

    it('S3: a source that reads by name alone never signs P1\'s request with P2\'s secret: the node is refused, nothing is sent', async () => {
        const held = channel([{ flow: 'f', node: 'call', key: 'signingSecret', packageId: P2, value: P2_HELD }]);
        const { readsByPackage: _scoped, ...byNameAlone } = held.source;
        const engine = engineWithBoth({
            ...byNameAlone,
            // Reads by name alone: every package's rows answer.
            holds: (f, n, k) => byNameAlone.holds(f, n, k),
            resolve: (f, n, k) => byNameAlone.resolve(f, n, k),
        });
        const one = await engine.executeSlot(P1, 'f');
        expect(one.success).toBe(false);
        expect(one.error).toContain('could not be read');
        expect(one.error).toContain(`Flow 'f' of package "${P1}"`);
        expect(received).toEqual([]);
        expect(held.asked).toEqual([]);
    });
});
