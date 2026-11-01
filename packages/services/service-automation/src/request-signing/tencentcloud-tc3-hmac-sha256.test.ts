// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D2.3 vector rule: Tencent Cloud's own worked example of its API 3.0
// signature masks the SecretKey, so it cannot be reproduced. The vectors come
// from the vendor's official SDK test suite instead: `tencentcloud-sdk-nodejs`
// release 4.1.336, `test/common/sign.test.ts`, describe "sign3" — the POST
// (`application/json`) and GET (`application/x-www-form-urlencoded`) cases,
// with that suite's own placeholder key pair (`test-secret-id` /
// `test-secret-key`), timestamp 1640995200 and service `cvm`. Its multipart
// case is not carried: a signed request's body is text here
// (`connectorFetchOptions` refuses any other), so this signer has no multipart
// path to pin.

import { describe, it, expect } from 'vitest';
import { computeTencentCloudTc3Signature, createTencentCloudTc3Signer } from './tencentcloud-tc3-hmac-sha256.js';
import { createConnectorRequestSigner } from './index.js';

const SDK_SECRET_ID = 'test-secret-id';
const SDK_SECRET_KEY = 'test-secret-key';
const SDK_TIMESTAMP = 1640995200;
const SDK_URL = 'https://cvm.tencentcloudapi.com';
// The suite's `payload: { Action: "DescribeInstances", Version: "2017-03-12" }`,
// as the SDK serialises it for the body it hashes.
const SDK_BODY = '{"Action":"DescribeInstances","Version":"2017-03-12"}';
// The suite sends this header on both cases; the scheme does not sign it.
const SDK_TRACE_HEADER = { 'X-TC-TraceId': 'test-trace-id' };

const SDK_POST_AUTHORIZATION = 'TC3-HMAC-SHA256 Credential=test-secret-id/2022-01-01/cvm/tc3_request, '
    + 'SignedHeaders=content-type;host, Signature=96473b50fe407833672a5d6d067238d88bb44c8abcc39ef83baa3132afbfadd3';
const SDK_GET_AUTHORIZATION = 'TC3-HMAC-SHA256 Credential=test-secret-id/2022-01-01/cvm/tc3_request, '
    + 'SignedHeaders=content-type;host, Signature=39ce411ac32014b7d814118b33f82d3445be566f67e1f4b369ccdc3791ce9a13';

const postRequest = {
    method: 'POST',
    url: SDK_URL,
    headers: { ...SDK_TRACE_HEADER, 'Content-Type': 'application/json' },
    body: SDK_BODY,
};
// The SDK hashes its payload on a GET too, so the vector's GET carries the body.
const getRequest = {
    method: 'GET',
    url: SDK_URL,
    headers: { ...SDK_TRACE_HEADER, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: SDK_BODY,
};

describe('tencentcloud-tc3-hmac-sha256 — the tencentcloud-sdk-nodejs 4.1.336 sign3 vectors, byte for byte', () => {
    it('reproduces the POST (application/json) case', () => {
        const computed = computeTencentCloudTc3Signature(postRequest, SDK_SECRET_ID, SDK_SECRET_KEY, SDK_TIMESTAMP);
        expect(computed.headers.authorization).toBe(SDK_POST_AUTHORIZATION);
        expect(computed.headers['x-tc-timestamp']).toBe('1640995200');
    });

    it('reproduces the GET (application/x-www-form-urlencoded) case', () => {
        const computed = computeTencentCloudTc3Signature(getRequest, SDK_SECRET_ID, SDK_SECRET_KEY, SDK_TIMESTAMP);
        expect(computed.headers.authorization).toBe(SDK_GET_AUTHORIZATION);
    });

    it('signs the canonical request the vendor specifies: method, path, query, content-type and host, body hash', () => {
        const computed = computeTencentCloudTc3Signature(postRequest, SDK_SECRET_ID, SDK_SECRET_KEY, SDK_TIMESTAMP);
        const lines = computed.canonicalRequest.split('\n');
        expect(lines.slice(0, 7)).toEqual([
            'POST',
            '/',
            '',
            'content-type:application/json',
            'host:cvm.tencentcloudapi.com',
            '',
            'content-type;host',
        ]);
        expect(lines[7]).toMatch(/^[0-9a-f]{64}$/);
        expect(computed.stringToSign.split('\n').slice(0, 3)).toEqual(['TC3-HMAC-SHA256', '1640995200', '2022-01-01/cvm/tc3_request']);
    });

    it('the bound signer answers the same bytes at the same instant', async () => {
        const signer = createTencentCloudTc3Signer('tencent_cvm', SDK_SECRET_ID, SDK_SECRET_KEY, {
            now: () => new Date(SDK_TIMESTAMP * 1000 + 999),
        });
        const { headers } = await signer.sign(postRequest);
        expect(headers.authorization).toBe(SDK_POST_AUTHORIZATION);
        expect(headers['x-tc-timestamp']).toBe('1640995200');
    });

    it('a wrong key does not produce the vendor signature', () => {
        const computed = computeTencentCloudTc3Signature(postRequest, SDK_SECRET_ID, 'not-the-test-secret-key', SDK_TIMESTAMP);
        expect(computed.headers.authorization).not.toBe(SDK_POST_AUTHORIZATION);
        expect(computed.headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    });
});

describe('tencentcloud-tc3-hmac-sha256 — beyond the vectors', () => {
    it('leaves the unsigned API headers (X-TC-Action / -Version / -Region) out of the signature, as the SDK does', () => {
        const withApiHeaders = {
            ...postRequest,
            headers: { ...postRequest.headers, 'X-TC-Action': 'DescribeInstances', 'X-TC-Version': '2017-03-12', 'X-TC-Region': 'ap-guangzhou' },
        };
        const computed = computeTencentCloudTc3Signature(withApiHeaders, SDK_SECRET_ID, SDK_SECRET_KEY, SDK_TIMESTAMP);
        expect(computed.headers.authorization).toBe(SDK_POST_AUTHORIZATION);
    });

    it('signs and sends application/x-www-form-urlencoded when the request names no content type', () => {
        const { 'Content-Type': _ct, ...noContentType } = getRequest.headers;
        const computed = computeTencentCloudTc3Signature({ ...getRequest, headers: noContentType }, SDK_SECRET_ID, SDK_SECRET_KEY, SDK_TIMESTAMP);
        expect(computed.headers['content-type']).toBe('application/x-www-form-urlencoded');
        expect(computed.headers.authorization).toBe(SDK_GET_AUTHORIZATION);
        // CONTROL: a request that names its type is not given another.
        expect('content-type' in computeTencentCloudTc3Signature(postRequest, SDK_SECRET_ID, SDK_SECRET_KEY, SDK_TIMESTAMP).headers).toBe(false);
    });

    it('names the service by the first label of the host, regional endpoints included', () => {
        const computed = computeTencentCloudTc3Signature(
            { ...postRequest, url: 'https://cvm.ap-guangzhou.tencentcloudapi.com' }, SDK_SECRET_ID, SDK_SECRET_KEY, SDK_TIMESTAMP,
        );
        expect(computed.headers.authorization).toContain('Credential=test-secret-id/2022-01-01/cvm/tc3_request');
        expect(computed.canonicalRequest).toContain('host:cvm.ap-guangzhou.tencentcloudapi.com\n');
    });

    it('signs the query exactly as it is sent', () => {
        const computed = computeTencentCloudTc3Signature(
            { method: 'GET', url: 'https://cvm.tencentcloudapi.com/?Limit=1&Offset=0', headers: {} }, SDK_SECRET_ID, SDK_SECRET_KEY, SDK_TIMESTAMP,
        );
        expect(computed.canonicalRequest.split('\n').slice(0, 3)).toEqual(['GET', '/', 'Limit=1&Offset=0']);
    });

    it('chooses the current instant on every request, so a retry is signed afresh', async () => {
        let t = SDK_TIMESTAMP * 1000;
        const signer = createTencentCloudTc3Signer('tencent_cvm', SDK_SECRET_ID, SDK_SECRET_KEY, { now: () => new Date((t += 1000)) });
        const first = await signer.sign(postRequest);
        const second = await signer.sign(postRequest);
        expect(first.headers['x-tc-timestamp']).not.toBe(second.headers['x-tc-timestamp']);
        expect(first.headers.authorization).not.toBe(second.headers.authorization);
    });
});

describe('createConnectorRequestSigner — tencentcloud-tc3-hmac-sha256', () => {
    const auth = { type: 'signed', scheme: 'tencentcloud-tc3-hmac-sha256', keyId: SDK_SECRET_ID, credentialRef: 'TENCENT_SECRET' } as const;

    it('binds the scheme the instance names to its key', async () => {
        const signer = createConnectorRequestSigner('tencent_cvm', auth, { key: SDK_SECRET_KEY }, { now: () => new Date(SDK_TIMESTAMP * 1000) });
        expect([signer.connector, signer.scheme]).toEqual(['tencent_cvm', 'tencentcloud-tc3-hmac-sha256']);
        expect((await signer.sign(postRequest)).headers.authorization).toBe(SDK_POST_AUTHORIZATION);
    });

    it('never carries the key in what it hands back', async () => {
        const signer = createConnectorRequestSigner('tencent_cvm', auth, { key: SDK_SECRET_KEY });
        const signature = await signer.sign(postRequest);
        expect(JSON.stringify({ signer, signature })).not.toContain(SDK_SECRET_KEY);
    });
});
