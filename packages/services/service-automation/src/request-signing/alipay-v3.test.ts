// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D2.3 vector rule, as its dated note of 2026-10-31 records for
// Alipay: the vendor publishes no worked example with a usable key, and no
// official SDK test suite carries a byte-exact v3 vector (checked: Java v3,
// PHP v3, .NET v3 and the Node SDK). The vectors below are therefore produced
// by the vendor's two official SDKs and agree byte for byte:
//   - com.alipay.sdk:alipay-sdk-java-v3:3.1.89.ALL (`AlipayConfigUtil.sign` /
//     `generateSign` / `verify`) signed the two requests and the response;
//   - alipay-sdk 4.14.0 (Node) replayed each request through its own `curl`
//     with the same nonce and timestamp and sent the identical Authorization,
//     computed the identical response signature, and accepted the Java-signed
//     response (refusing it tampered).
// Both used the PLACEHOLDER test-only RSA-2048 key pair in
// `test-vectors/alipay-v3/`, which belongs to no Alipay app; one pair plays
// both roles (app key and "Alipay" key). Regenerate and re-check with
// `test-vectors/alipay-v3/generate.sh`.

import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
    alipayV3ResponseMustVerify,
    computeAlipayV3Signature,
    createAlipayV3Signer,
    readAlipayPrivateKey,
} from './alipay-v3.js';
import { createConnectorRequestSigner } from './index.js';

const vectors = new URL('../../test-vectors/alipay-v3/', import.meta.url);
const PLACEHOLDER_PRIVATE_KEY = readFileSync(new URL('PLACEHOLDER-test-only-rsa2048-private-key.pkcs8.b64', vectors), 'ascii').trim();
const PLACEHOLDER_PUBLIC_KEY = readFileSync(new URL('PLACEHOLDER-test-only-rsa2048-public-key.spki.b64', vectors), 'ascii').trim();

const APP_ID = '2021000000000000';
const GATEWAY = 'https://openapi.alipay.com';

const POST = {
    request: {
        method: 'POST',
        url: `${GATEWAY}/v3/alipay/trade/query`,
        headers: { 'Content-Type': 'application/json' },
        body: '{"out_trade_no":"20150320010101001"}',
    },
    nonce: '5403e89b-3c6d-4aa6-aa38-ed35f621c7d0',
    timestamp: 1793430044019,
    authorization: 'ALIPAY-SHA256withRSA app_id=2021000000000000,nonce=5403e89b-3c6d-4aa6-aa38-ed35f621c7d0,timestamp=1793430044019,'
        + 'sign=F++vtXgeMf7Ylc4toVFglAtBvKEcOTfcSII90v5nhpbKdHWNDN3H78ozATEXFHVYRBLLWWoWqVOTiSiuGqHpMoI4CaPII191U1U9Lc9L6LE2kq0G8EDTi0TlAA74'
        + 'ynSPcGcLbinGqwp68DdfzSTAbUDPHifcRn319GREDHhT8wP4tOPvYWVNhC8GaDUCuDohn/M2NlhCXMi9AxaLkT1B/b9iqwgqoJvyNLZUINcaSb9EDdmr6wfOnvJSmKIpR'
        + 'w/qAlNbWG4YSjWVybOHnfZU/m4xIE4KpeujZnEt0JQlpB9Fx3cvjErKsJfHBoULhw8UZeumCvqLkfTnIBURCjWPQA==',
};

const GET = {
    request: {
        method: 'GET',
        url: `${GATEWAY}/v3/alipay/user/certify/open/query?certify_id=OC201809253000000393900404029253`,
        headers: {},
    },
    nonce: '8578aa54-0e36-49d9-9b79-70b96f68d061',
    timestamp: 1793430044232,
    authorization: 'ALIPAY-SHA256withRSA app_id=2021000000000000,nonce=8578aa54-0e36-49d9-9b79-70b96f68d061,timestamp=1793430044232,'
        + 'sign=JobNMH8jUuGsYhTwBOMk5k8YABtwfW42iggPERoqWOWTe0KszAUAxqYTZElHgBVda1rqIwGFkhLi5LN7lb6/I6+RbYJ7AzuclzYt+DnlmUyGygTwme5Ysz4r0Uzo'
        + 'UswNZAhszlbzZ16mhCRwuOrkk/GvnApmTGRabAA2nMK5E+jXRFzWnitQg/Qd2P7i1xgqK2LpkN7kwbyQL15WPczDbC3PmAQ6X7lhGIPR/PJcNQ7rKWaOTVo0LV7dEe+nr5'
        + '5lc9mmu+rF//ykizv+fUwckDkNp7cD0Gi/r8iowEfopoMkZT91SsqlqWcU2DB+S+H6b6PzrEfSUvWdoViAjIUMjQ==',
};

const RESPONSE = {
    body: '{"trade_no":"2013112011001004330000121536","out_trade_no":"20150320010101001","trade_status":"TRADE_SUCCESS"}',
    timestamp: '1730359200000',
    nonce: '8d2b6d3c-5f0e-4a8e-9b0a-6b1f2c3d4e5f',
    signature: 'fllDbBuHu1g90OE1GKtKSXEnbIwxfSJO/ysiwCiojDz/YD6Gr1Z08+dvwtCVhFUoCsjCDwmOlgadWwpxeHGpFHrW4iEtCyBQeVcf6w2zSbI3idrUy2OxiVR6auIUDI5f3'
        + 'tjBmE1JP960kQWdsoORq/k6ec8SK3CaMElLkV+aRcCTD3GbvMp57boCsA9u3rZurf/7gENa9rgI21kCnpCYisWM9duNqqBcHr8SktidtrXbZX4cwkclRiVImkqCdQoCTKZx'
        + 'EflQOXqs2oSyuYGZZ5CuXfj2JSWgPyDcduwrqGxHOmI7BNwJ6Oe/6z5VaEkOhoX5iuTYtD69ulvnvYzGqg==',
};

/** A response as the provider hands it to the signer: status, headers, raw body. */
function response(status: number, body: string, headers: Record<string, string>) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { status, body, headers: { get: (name: string) => lower[name.toLowerCase()] ?? null } };
}

const signedHeaders = {
    'alipay-timestamp': RESPONSE.timestamp,
    'alipay-nonce': RESPONSE.nonce,
    'alipay-signature': RESPONSE.signature,
};

const signer = () => createAlipayV3Signer('alipay_pay', APP_ID, PLACEHOLDER_PRIVATE_KEY, PLACEHOLDER_PUBLIC_KEY);

describe('alipay-v3 — the vectors both official SDKs (Java v3 3.1.89, Node 4.14.0) agree on, byte for byte', () => {
    const key = readAlipayPrivateKey(PLACEHOLDER_PRIVATE_KEY);

    it('reproduces the POST (JSON body) request signature', () => {
        const computed = computeAlipayV3Signature(POST.request, APP_ID, key, POST.nonce, POST.timestamp);
        expect(computed.headers.authorization).toBe(POST.authorization);
    });

    it('reproduces the GET (query, no body) request signature', () => {
        const computed = computeAlipayV3Signature(GET.request, APP_ID, key, GET.nonce, GET.timestamp);
        expect(computed.headers.authorization).toBe(GET.authorization);
    });

    it('signs the string the vendor specifies: auth string, method, path and query, body, each line-terminated', () => {
        const computed = computeAlipayV3Signature(GET.request, APP_ID, key, GET.nonce, GET.timestamp);
        expect(computed.content).toBe(
            `app_id=${APP_ID},nonce=${GET.nonce},timestamp=${GET.timestamp}\nGET\n`
                + '/v3/alipay/user/certify/open/query?certify_id=OC201809253000000393900404029253\n\n',
        );
    });

    it('the bound signer answers the same bytes for the same nonce and instant', async () => {
        const bound = createAlipayV3Signer('alipay_pay', APP_ID, PLACEHOLDER_PRIVATE_KEY, PLACEHOLDER_PUBLIC_KEY, {
            now: () => new Date(POST.timestamp),
            nonce: () => POST.nonce,
        });
        expect((await bound.sign(POST.request)).headers.authorization).toBe(POST.authorization);
    });

    it('a wrong key does not produce the vendor signature', () => {
        // CONTROL: the same key in another encoding (PKCS#1 PEM) signs identically.
        const pkcs1 = readAlipayPrivateKey(key.export({ format: 'pem', type: 'pkcs1' }).toString());
        expect(computeAlipayV3Signature(POST.request, APP_ID, pkcs1, POST.nonce, POST.timestamp).headers.authorization).toBe(POST.authorization);
        const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
        const computed = computeAlipayV3Signature(POST.request, APP_ID, wrong, POST.nonce, POST.timestamp);
        expect(computed.headers.authorization).not.toBe(POST.authorization);
    });

    it('accepts the response the Java SDK signed', async () => {
        await expect(signer().verifyResponse!(response(200, RESPONSE.body, signedHeaders))).resolves.toBeUndefined();
    });
});

describe('alipay-v3 — response verification', () => {
    it('refuses a tampered body, a tampered nonce and a missing signature on a 2xx', async () => {
        await expect(signer().verifyResponse!(response(200, `${RESPONSE.body} `, signedHeaders))).rejects.toThrow(/does not verify/);
        await expect(signer().verifyResponse!(response(200, RESPONSE.body, { ...signedHeaders, 'alipay-nonce': 'x' }))).rejects.toThrow(/does not verify/);
        const { 'alipay-signature': _s, ...unsigned } = signedHeaders;
        await expect(signer().verifyResponse!(response(200, RESPONSE.body, unsigned))).rejects.toThrow(/carries no complete Alipay signature/);
    });

    it('refuses an unsigned empty 2xx: every status below 400 is verified (Node SDK 4.14.0; Java v3 3.1.89 skips it)', async () => {
        await expect(signer().verifyResponse!(response(204, '', {}))).rejects.toThrow(/HTTP 204/);
    });

    it('verifies an error response that carries a signature (Java SDK), and passes an unsigned one as the failure it is', async () => {
        await expect(signer().verifyResponse!(response(400, `${RESPONSE.body} `, signedHeaders))).rejects.toThrow(/does not verify/);
        await expect(signer().verifyResponse!(response(400, '{"code":"invalid-parameter"}', {}))).resolves.toBeUndefined();
    });

    it('decides which responses must verify in one place', () => {
        expect([200, 204, 302, 399].map((s) => alipayV3ResponseMustVerify(s, false))).toEqual([true, true, true, true]);
        expect([400, 500].map((s) => alipayV3ResponseMustVerify(s, false))).toEqual([false, false]);
        expect([400, 500].map((s) => alipayV3ResponseMustVerify(s, true))).toEqual([true, true]);
    });

    it('never puts the body or the signature in its refusal', async () => {
        const refusal = await signer().verifyResponse!(response(200, `${RESPONSE.body} `, signedHeaders)).catch((e: Error) => e.message);
        expect(refusal).not.toContain(RESPONSE.signature);
        expect(refusal).not.toContain('trade_no');
    });
});

describe('alipay-v3 — beyond the vectors', () => {
    it('chooses a fresh nonce and instant on every request, so a retry is signed afresh', async () => {
        const bound = signer();
        const first = await bound.sign(POST.request);
        const second = await bound.sign(POST.request);
        expect(first.headers.authorization).not.toBe(second.headers.authorization);
        expect(first.headers.authorization).toMatch(/^ALIPAY-SHA256withRSA app_id=2021000000000000,nonce=[0-9a-f-]{36},timestamp=\d{13},sign=[A-Za-z0-9+/]+=*$/);
    });

    it('reads the keys as Alipay issues them (bare base64) and as PEM', async () => {
        const pem = readAlipayPrivateKey(PLACEHOLDER_PRIVATE_KEY).export({ format: 'pem', type: 'pkcs8' }).toString();
        const bound = createAlipayV3Signer('alipay_pay', APP_ID, pem, PLACEHOLDER_PUBLIC_KEY, { now: () => new Date(POST.timestamp), nonce: () => POST.nonce });
        expect((await bound.sign(POST.request)).headers.authorization).toBe(POST.authorization);
    });

    it('refuses to bind a key that is not an RSA key, without echoing it', () => {
        expect(() => createAlipayV3Signer('alipay_pay', APP_ID, 'not-a-key', PLACEHOLDER_PUBLIC_KEY)).toThrow(/credentialRef names cannot sign/);
        expect(() => createAlipayV3Signer('alipay_pay', APP_ID, PLACEHOLDER_PRIVATE_KEY, 'not-a-key')).toThrow(/vendorPublicKeyRef names cannot verify/);
        let message = '';
        try {
            createAlipayV3Signer('alipay_pay', APP_ID, 'not-a-key-26710', PLACEHOLDER_PUBLIC_KEY);
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).not.toContain('not-a-key-26710');
    });
});

describe('createConnectorRequestSigner — alipay-v3', () => {
    const auth = {
        type: 'signed', scheme: 'alipay-v3', keyId: APP_ID, credentialRef: 'ALIPAY_APP_PRIVATE_KEY', vendorPublicKeyRef: 'ALIPAY_PUBLIC_KEY',
    } as const;

    it('binds the scheme to both keys: it signs and it verifies', async () => {
        const bound = createConnectorRequestSigner('alipay_pay', auth, { key: PLACEHOLDER_PRIVATE_KEY, vendorPublicKey: PLACEHOLDER_PUBLIC_KEY }, {
            now: () => new Date(POST.timestamp),
            nonce: () => POST.nonce,
        });
        expect([bound.connector, bound.scheme]).toEqual(['alipay_pay', 'alipay-v3']);
        expect((await bound.sign(POST.request)).headers.authorization).toBe(POST.authorization);
        await expect(bound.verifyResponse!(response(200, RESPONSE.body, signedHeaders))).resolves.toBeUndefined();
    });

    it('refuses to bind without the Alipay public key: no response is accepted unverified', () => {
        expect(() => createConnectorRequestSigner('alipay_pay', auth, { key: PLACEHOLDER_PRIVATE_KEY })).toThrow(/vendorPublicKeyRef names is empty/);
    });

    it('never carries a key in what it hands back', async () => {
        const bound = createConnectorRequestSigner('alipay_pay', auth, { key: PLACEHOLDER_PRIVATE_KEY, vendorPublicKey: PLACEHOLDER_PUBLIC_KEY });
        const signature = await bound.sign(POST.request);
        expect(JSON.stringify({ bound, signature })).not.toContain(PLACEHOLDER_PRIVATE_KEY.slice(40, 120));
    });
});
