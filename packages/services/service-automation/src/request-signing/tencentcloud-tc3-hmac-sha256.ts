// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, createHmac } from 'node:crypto';
import type {
    ConnectorRequestSignature,
    ConnectorRequestSigner,
    ConnectorSignableRequest,
} from '@objectstack/spec/integration';
import type { RequestSigningClock } from './clock.js';

/**
 * `tencentcloud-tc3-hmac-sha256` — Tencent Cloud's API 3.0 request signature
 * ("signature method v3", ADR-0143 D2.3, Q4). The vendor's own worked example
 * masks its SecretKey, so it cannot be reproduced; the vectors come from the
 * official Node.js SDK's test suite instead, and
 * `tencentcloud-tc3-hmac-sha256.test.ts` names that SDK and its release.
 *
 * Every request carries:
 *  - `X-TC-Timestamp` (Unix seconds), chosen here, per attempt — the vendor
 *    refuses a timestamp outside its window, so a retry is signed afresh;
 *  - `Authorization: TC3-HMAC-SHA256 Credential=<SecretId>/<date>/<service>/
 *    tc3_request, SignedHeaders=content-type;host, Signature=<hex>`.
 *
 * The canonical request is the upper-case method, the path, the query exactly
 * as sent, the `content-type` and `host` headers, their names, and the hex
 * SHA-256 of the body. The string to sign is `TC3-HMAC-SHA256`, the timestamp,
 * the credential scope `<date>/<service>/tc3_request` and the hashed canonical
 * request; the HMAC key is derived `HMAC("TC3" + SecretKey, date)` →
 * `service` → `"tc3_request"`, the date being the timestamp's UTC day.
 *
 * `<service>` is the first label of the endpoint host
 * (`cvm.tencentcloudapi.com` and `cvm.ap-guangzhou.tencentcloudapi.com` →
 * `cvm`), which is how the vendor names it. The request names its API with the
 * `X-TC-Action`, `X-TC-Version` and `X-TC-Region` headers the caller sends;
 * the scheme does not sign them. A request without a content type is signed
 * and sent with `application/x-www-form-urlencoded`, the type the vendor's SDK
 * sends on a `GET`, so the header the signature covers is the header the
 * upstream reads.
 *
 * ⛔ The SecretKey lives only in the closure of the signer this module
 * returns: no error, log line or returned value carries it.
 */

export const TENCENTCLOUD_TC3_ALGORITHM = 'TC3-HMAC-SHA256';

/** What a request without a `Content-Type` is signed and sent with. */
const DEFAULT_CONTENT_TYPE = 'application/x-www-form-urlencoded';

function sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hmac(key: string | Buffer, message: string): Buffer {
    return createHmac('sha256', key).update(message, 'utf8').digest();
}

/** `YYYY-MM-DD`, the UTC day of a Unix timestamp in seconds — the credential scope's date. */
function utcDate(timestamp: number): string {
    return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

/** Every intermediate of one signature — what the SDK-vector test pins, step by step. */
export interface TencentCloudTc3Computation {
    readonly canonicalRequest: string;
    readonly stringToSign: string;
    readonly signature: string;
    /** Headers the signer adds: `authorization`, `x-tc-timestamp`, and `content-type` when the request had none. */
    readonly headers: Readonly<Record<string, string>>;
}

/**
 * Compute the TC3-HMAC-SHA256 signature of `request` at `timestamp` (Unix
 * seconds). Pure: the same inputs give the same bytes, which is what lets the
 * SDK's vectors pin it.
 */
export function computeTencentCloudTc3Signature(
    request: ConnectorSignableRequest,
    keyId: string,
    secret: string,
    timestamp: number,
): TencentCloudTc3Computation {
    const url = new URL(request.url);
    const service = url.hostname.split('.')[0] ?? '';
    let contentType: string | undefined;
    for (const [name, value] of Object.entries(request.headers)) {
        if (name.toLowerCase() === 'content-type') contentType = value;
    }
    const signedContentType = contentType ?? DEFAULT_CONTENT_TYPE;
    const signedHeaders = 'content-type;host';
    const canonicalRequest = [
        request.method.toUpperCase(),
        url.pathname || '/',
        url.search.slice(1),
        `content-type:${signedContentType}\nhost:${url.hostname}\n`,
        signedHeaders,
        sha256Hex(request.body ?? ''),
    ].join('\n');
    const date = utcDate(timestamp);
    const scope = `${date}/${service}/tc3_request`;
    const stringToSign = `${TENCENTCLOUD_TC3_ALGORITHM}\n${timestamp}\n${scope}\n${sha256Hex(canonicalRequest)}`;
    const signingKey = hmac(hmac(hmac(`TC3${secret}`, date), service), 'tc3_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    return {
        canonicalRequest,
        stringToSign,
        signature,
        headers: {
            ...(contentType === undefined ? { 'content-type': DEFAULT_CONTENT_TYPE } : {}),
            'x-tc-timestamp': String(timestamp),
            authorization: `${TENCENTCLOUD_TC3_ALGORITHM} Credential=${keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
    };
}

/** Bind a TC3-HMAC-SHA256 signer to one instance's SecretId and SecretKey. */
export function createTencentCloudTc3Signer(
    connector: string,
    keyId: string,
    secret: string,
    clock: RequestSigningClock = {},
): ConnectorRequestSigner {
    const now = clock.now ?? (() => new Date());
    return {
        connector,
        scheme: 'tencentcloud-tc3-hmac-sha256',
        async sign(request): Promise<ConnectorRequestSignature> {
            const timestamp = Math.floor(now().getTime() / 1000);
            return { headers: computeTencentCloudTc3Signature(request, keyId, secret, timestamp).headers };
        },
    };
}
