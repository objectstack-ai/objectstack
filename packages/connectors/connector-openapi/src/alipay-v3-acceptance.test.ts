// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **#26710 acceptance (ADR-0143 Acceptance, `signed` line)**, as the
 * maintainer ruled on 2026-10-31: the local end-to-end run counts as the
 * acceptance, with no live sandbox call owed.
 *
 * A declarative `provider: 'openapi'` instance over an Alipay v3-shaped
 * document (JSON; the `alipay.trade.query` operation as the vendor's document
 * declares it) with `auth: { type: 'signed', scheme: 'alipay-v3', … }`
 * dispatches through a real boot (LiteKernel + AutomationServicePlugin +
 * ConnectorOpenApiPlugin). A local stand-in for the Alipay gateway (the
 * provider's `fetchImpl`) checks the request's `ALIPAY-SHA256withRSA`
 * signature with the app's public key and signs its answer with its own key,
 * as Alipay does. Two key pairs, generated here, keep the roles apart: the app
 * pair signs requests, the "Alipay" pair signs responses.
 *
 *  1. A signed request is accepted by the gateway, and the gateway's signed
 *     response is verified and returned, through a flow `connector_action`.
 *  2. A response altered after the gateway signed it fails the dispatch, and
 *     its body never reaches the flow; so does an unsigned 2xx.
 *  3. The private key appears in no request and no connector descriptor.
 */

import { createSign, createVerify, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { ConnectorOpenApiPlugin } from './connector-openapi-plugin.js';

/** The `alipay.trade.query` operation as Alipay's v3 OpenAPI document declares it, schemas trimmed. */
const alipayV3Document = {
    openapi: '3.0.3',
    info: { title: '支付宝开放平台API', version: '2026-09-23' },
    servers: [{ url: 'https://openapi.alipay.com' }],
    paths: {
        '/v3/alipay/trade/query': {
            post: {
                operationId: 'alipay.trade.query',
                summary: '统一收单交易查询',
                requestBody: {
                    required: false,
                    content: { 'application/json': { schema: { type: 'object', properties: { out_trade_no: { type: 'string' }, trade_no: { type: 'string' } } } } },
                },
                responses: { '200': { description: 'common response' } },
            },
        },
    },
};

/** A key pair as Alipay's console hands them out: bare base64, PKCS#8 and SPKI. */
function keyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
        privateKey,
        publicKey,
        privateText: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
        publicText: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    };
}
const app = keyPair();
const alipay = keyPair();

const TRADE = '{"trade_no":"2013112011001004330000121536","out_trade_no":"20150320010101001","trade_status":"TRADE_SUCCESS"}';

type Mode = 'signed' | 'tampered' | 'unsigned';
type Seen = { url: string; headers: Record<string, string>; requestVerified: boolean };

/** The local Alipay gateway: verifies the request signature, answers signed (or, by `mode`, not). */
function alipayGateway(appPublicKey: KeyObject, alipayPrivateKey: KeyObject, mode: { current: Mode }) {
    const seen: Seen[] = [];
    const impl = (async (url: string, init: RequestInit) => {
        const headers = Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
        const target = new URL(url);
        const auth = /^ALIPAY-SHA256withRSA (app_id=[^,]+,nonce=[^,]+,timestamp=\d+),sign=(.+)$/.exec(headers.authorization ?? '');
        const content = auth ? `${auth[1]}\n${init.method}\n${target.pathname}${target.search}\n${(init.body as string | undefined) ?? ''}\n` : '';
        const requestVerified = auth !== null && createVerify('RSA-SHA256').update(content, 'utf8').verify(appPublicKey, auth[2]!, 'base64');
        seen.push({ url, headers, requestVerified });
        if (!requestVerified) {
            return new Response('{"code":"invalid-signature","message":"验签出错"}', { status: 401, headers: { 'content-type': 'application/json' } });
        }
        const timestamp = String(Date.now());
        const nonce = randomUUID();
        const signature = createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${TRADE}\n`, 'utf8').sign(alipayPrivateKey, 'base64');
        const body = mode.current === 'tampered' ? TRADE.replace('TRADE_SUCCESS', 'TRADE_CLOSED') : TRADE;
        const signedHeaders = mode.current === 'unsigned'
            ? {}
            : { 'alipay-timestamp': timestamp, 'alipay-nonce': nonce, 'alipay-signature': signature };
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json', ...signedHeaders } });
    }) as unknown as typeof fetch;
    return { impl, seen };
}

async function boot(mode: { current: Mode }) {
    const gateway = alipayGateway(app.publicKey, alipay.privateKey, mode);
    const declared = [{
        name: 'alipay_pay',
        label: 'Alipay',
        type: 'api',
        provider: 'openapi',
        providerConfig: { spec: alipayV3Document },
        auth: {
            type: 'signed',
            scheme: 'alipay-v3',
            keyId: '2021000000000000',
            credentialRef: 'ALIPAY_APP_PRIVATE_KEY_26710',
            vendorPublicKeyRef: 'ALIPAY_PUBLIC_KEY_26710',
        },
    }];
    const references: Record<string, string> = { ALIPAY_APP_PRIVATE_KEY_26710: app.privateText, ALIPAY_PUBLIC_KEY_26710: alipay.publicText };
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin({ credentialResolver: (ref) => references[ref] }));
    kernel.use(new ConnectorOpenApiPlugin({ fetchImpl: gateway.impl }));
    kernel.use({
        name: 'test.metadata',
        type: 'standard',
        version: '1.0.0',
        dependencies: [],
        async init(ctx: { registerService(name: string, service: unknown): void }) {
            ctx.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? declared : []) } });
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    return { engine: kernel.getService<AutomationEngine>('automation'), seen: gateway.seen, kernel };
}

async function queryTradeByFlow(engine: AutomationEngine, flow: string) {
    engine.registerFlow(flow, {
        name: flow, label: flow, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'query', type: 'connector_action', label: 'Query trade',
                connectorConfig: { connectorId: 'alipay_pay', actionId: 'alipay.trade.query', input: { body: { out_trade_no: '20150320010101001' } } },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'query' }, { id: 'e2', source: 'query', target: 'end' }],
    } as never);
    return engine.execute(flow, {} as never);
}

describe('#26710 acceptance — an openapi instance over the Alipay v3 document, signed and verified end to end', () => {
    it('1. the gateway accepts the signed request, and its signed response is verified and returned', async () => {
        const { engine, seen, kernel } = await boot({ current: 'signed' });
        try {
            expect(engine.getConnectorDegradedReason('alipay_pay')).toBeUndefined();
            const result = await queryTradeByFlow(engine, 'query_trade');
            expect(result.success, result.error).toBe(true);
            expect(seen).toHaveLength(1);
            expect(seen[0]!.requestVerified).toBe(true);
            expect(seen[0]!.url).toBe('https://openapi.alipay.com/v3/alipay/trade/query');
            expect(seen[0]!.headers.authorization).toMatch(/^ALIPAY-SHA256withRSA app_id=2021000000000000,nonce=[0-9a-f-]{36},timestamp=\d{13},sign=/);

            const query = engine.resolveConnectorAction('alipay_pay', 'alipay.trade.query')!;
            expect(await query({ body: { out_trade_no: '20150320010101001' } }, {} as never)).toEqual({
                status: 200, ok: true, body: JSON.parse(TRADE),
            });
            expect(seen[1]!.requestVerified).toBe(true);
            // Every call is signed afresh.
            expect(seen[1]!.headers.authorization).not.toBe(seen[0]!.headers.authorization);
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });

    it('2. a response altered after Alipay signed it, or an unsigned 2xx, fails the dispatch and its body never reaches the flow', async () => {
        const mode: { current: Mode } = { current: 'tampered' };
        const { engine, seen, kernel } = await boot(mode);
        try {
            const tampered = await queryTradeByFlow(engine, 'query_tampered');
            expect(tampered.success).toBe(false);
            expect(tampered.error).toContain('does not verify against the public key its vendorPublicKeyRef names');
            expect(JSON.stringify(tampered)).not.toContain('TRADE_CLOSED');
            expect(seen[0]!.requestVerified).toBe(true);

            mode.current = 'unsigned';
            const unsigned = await queryTradeByFlow(engine, 'query_unsigned');
            expect(unsigned.success).toBe(false);
            expect(unsigned.error).toContain('carries no complete Alipay signature');
            expect(JSON.stringify(unsigned)).not.toContain('TRADE_SUCCESS');

            // CONTROL: the same instance, answered signed, succeeds.
            mode.current = 'signed';
            expect((await queryTradeByFlow(engine, 'query_signed')).success).toBe(true);
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });

    it('3. the private key is in no request and no connector descriptor', async () => {
        const { engine, seen, kernel } = await boot({ current: 'signed' });
        try {
            await queryTradeByFlow(engine, 'query_trade');
            const fragment = app.privateText.slice(64, 160);
            expect(JSON.stringify(seen)).not.toContain(fragment);
            expect(JSON.stringify(engine.getConnectorDescriptors())).not.toContain(fragment);
        } finally {
            await kernel.shutdown().catch(() => {});
        }
    });
});
