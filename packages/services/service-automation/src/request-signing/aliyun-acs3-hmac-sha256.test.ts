// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D2.3 vector rule: Alibaba Cloud publishes a complete worked example
// of its V3 signature, so the signer reproduces it byte for byte — every
// intermediate, not only the final value. Source: "V3 request structure and
// signature" (help.aliyun.com document 2593177; mirrored at
// https://www.alibabacloud.com/help/zh/sdk/product-overview/v3-request-structure-and-signature),
// section "Signature example" with its fixed parameter values. The key pair in
// it is the document's own placeholder (`YourAccessKeyId` / `YourAccessKeySecret`).

import { describe, it, expect } from 'vitest';
import { computeAliyunAcs3Signature, createAliyunAcs3Signer } from './aliyun-acs3-hmac-sha256.js';
import { createConnectorRequestSigner } from './index.js';

const VENDOR_KEY_ID = 'YourAccessKeyId';
const VENDOR_SECRET = 'YourAccessKeySecret';
const VENDOR_DATE = '2023-10-26T10:22:32Z';
const VENDOR_NONCE = '3156853299f313e23d1673dc12e1703d';

const vendorRequest = {
    method: 'POST',
    url: 'https://ecs.cn-shanghai.aliyuncs.com/?ImageId=win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd&RegionId=cn-shanghai',
    headers: { 'x-acs-action': 'RunInstances', 'x-acs-version': '2014-05-26' },
};

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const VENDOR_CANONICAL_REQUEST = [
    'POST',
    '/',
    'ImageId=win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd&RegionId=cn-shanghai',
    'host:ecs.cn-shanghai.aliyuncs.com',
    'x-acs-action:RunInstances',
    `x-acs-content-sha256:${EMPTY_SHA256}`,
    'x-acs-date:2023-10-26T10:22:32Z',
    'x-acs-signature-nonce:3156853299f313e23d1673dc12e1703d',
    'x-acs-version:2014-05-26',
    '',
    'host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version',
    EMPTY_SHA256,
].join('\n');
const VENDOR_STRING_TO_SIGN = 'ACS3-HMAC-SHA256\n7ea06492da5221eba5297e897ce16e55f964061054b7695beedaac1145b1e259';
const VENDOR_SIGNATURE = '06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0';
const VENDOR_AUTHORIZATION = 'ACS3-HMAC-SHA256 Credential=YourAccessKeyId,'
    + 'SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,'
    + `Signature=${VENDOR_SIGNATURE}`;

describe("aliyun-acs3-hmac-sha256 — Alibaba Cloud's published worked example, byte for byte", () => {
    const computed = computeAliyunAcs3Signature(vendorRequest, VENDOR_KEY_ID, VENDOR_SECRET, {
        date: VENDOR_DATE,
        nonce: VENDOR_NONCE,
    });

    it('reproduces the canonical request', () => {
        expect(computed.canonicalRequest).toBe(VENDOR_CANONICAL_REQUEST);
    });

    it('reproduces the string to sign (the hashed canonical request)', () => {
        expect(computed.stringToSign).toBe(VENDOR_STRING_TO_SIGN);
    });

    it('reproduces the signature and the Authorization header', () => {
        expect(computed.signature).toBe(VENDOR_SIGNATURE);
        expect(computed.headers).toEqual({
            authorization: VENDOR_AUTHORIZATION,
            'x-acs-date': VENDOR_DATE,
            'x-acs-signature-nonce': VENDOR_NONCE,
            'x-acs-content-sha256': EMPTY_SHA256,
        });
    });

    it('the bound signer answers the same bytes for the same instant and nonce', async () => {
        const signer = createAliyunAcs3Signer('aliyun_ecs', VENDOR_KEY_ID, VENDOR_SECRET, {
            now: () => new Date('2023-10-26T10:22:32.000Z'),
            nonce: () => VENDOR_NONCE,
        });
        const signature = await signer.sign(vendorRequest);
        expect(signature.headers.authorization).toBe(VENDOR_AUTHORIZATION);
        expect(signature.url).toBe(vendorRequest.url);
    });

    it('a wrong key does not produce the vendor signature', () => {
        const wrong = computeAliyunAcs3Signature(vendorRequest, VENDOR_KEY_ID, 'NotYourAccessKeySecret', {
            date: VENDOR_DATE,
            nonce: VENDOR_NONCE,
        });
        expect(wrong.stringToSign).toBe(VENDOR_STRING_TO_SIGN);
        expect(wrong.signature).not.toBe(VENDOR_SIGNATURE);
        expect(wrong.signature).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('aliyun-acs3-hmac-sha256 — canonicalisation beyond the example', () => {
    const at = { date: VENDOR_DATE, nonce: VENDOR_NONCE };

    it('signs the body hash and the content type when the request carries them', () => {
        const body = '{"RegionId":"cn-shanghai"}';
        const computed = computeAliyunAcs3Signature({
            method: 'post',
            url: 'https://ecs.cn-shanghai.aliyuncs.com/',
            headers: { 'Content-Type': 'application/json', 'X-Acs-Action': 'DescribeRegions', 'x-acs-version': '2014-05-26', accept: 'application/json' },
            body,
        }, VENDOR_KEY_ID, VENDOR_SECRET, at);
        const lines = computed.canonicalRequest.split('\n');
        expect(lines[0]).toBe('POST');
        expect(lines).toContain('content-type:application/json');
        expect(lines).toContain('x-acs-action:DescribeRegions');
        expect(lines).not.toContain('accept:application/json');
        expect(lines.at(-1)).toMatch(/^[0-9a-f]{64}$/);
        expect(lines.at(-1)).not.toBe(EMPTY_SHA256);
        expect(computed.headers['x-acs-content-sha256']).toBe(lines.at(-1));
        expect(lines.at(-2)).toBe('content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version');
    });

    it('sorts the query and answers the URL in the canonical encoding the signature covers', () => {
        const computed = computeAliyunAcs3Signature({
            method: 'GET',
            url: "https://ecs.aliyuncs.com/a b/c*d?Z=1&Name=x+y&A=it's",
            headers: {},
        }, VENDOR_KEY_ID, VENDOR_SECRET, at);
        const [, path, query] = computed.canonicalRequest.split('\n');
        expect(path).toBe('/a%20b/c%2Ad');
        expect(query).toBe('A=it%27s&Name=x%20y&Z=1');
        expect(computed.url).toBe('https://ecs.aliyuncs.com/a%20b/c%2Ad?A=it%27s&Name=x%20y&Z=1');
    });

    it('chooses a fresh nonce and the current instant on every request', async () => {
        const signer = createAliyunAcs3Signer('aliyun_ecs', VENDOR_KEY_ID, VENDOR_SECRET);
        const first = await signer.sign(vendorRequest);
        const second = await signer.sign(vendorRequest);
        expect(first.headers['x-acs-signature-nonce']).toMatch(/^[0-9a-f]{32}$/);
        expect(first.headers['x-acs-signature-nonce']).not.toBe(second.headers['x-acs-signature-nonce']);
        expect(first.headers['x-acs-date']).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
        expect(first.headers.authorization).not.toBe(second.headers.authorization);
    });
});

describe('createConnectorRequestSigner — the signer registry', () => {
    const auth = { type: 'signed', scheme: 'aliyun-acs3-hmac-sha256', keyId: VENDOR_KEY_ID, credentialRef: 'ALIYUN_SECRET' } as const;

    it('binds the scheme the instance names to its key', async () => {
        const signer = createConnectorRequestSigner('aliyun_ecs', auth, VENDOR_SECRET, {
            now: () => new Date('2023-10-26T10:22:32Z'),
            nonce: () => VENDOR_NONCE,
        });
        expect([signer.connector, signer.scheme]).toEqual(['aliyun_ecs', 'aliyun-acs3-hmac-sha256']);
        expect((await signer.sign(vendorRequest)).headers.authorization).toBe(VENDOR_AUTHORIZATION);
    });

    it('refuses an empty key before any request, without echoing a key', () => {
        expect(() => createConnectorRequestSigner('aliyun_ecs', auth, '')).toThrow(/signing key its credentialRef names is empty/);
    });

    it('never carries the key in what it hands back', async () => {
        const signer = createConnectorRequestSigner('aliyun_ecs', auth, VENDOR_SECRET);
        const signature = await signer.sign(vendorRequest);
        expect(JSON.stringify({ signer, signature })).not.toContain(VENDOR_SECRET);
    });
});
