// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import type {
    ConnectorRequestSignature,
    ConnectorRequestSigner,
    ConnectorSignableRequest,
} from '@objectstack/spec/integration';
import type { RequestSigningClock } from './clock.js';

/**
 * `aliyun-acs3-hmac-sha256` — Alibaba Cloud's OpenAPI V3 request signature
 * (ADR-0143 D2.3, Q4), implemented from the vendor's "V3 request structure and
 * signature" document and pinned byte for byte against its published worked
 * example (`aliyun-acs3-hmac-sha256.test.ts`).
 *
 * Every request carries:
 *  - `x-acs-date` (ISO 8601 UTC, seconds), `x-acs-signature-nonce` (single
 *    use) and `x-acs-content-sha256` (the hex SHA-256 of the body) — chosen
 *    here, per attempt;
 *  - `Authorization: ACS3-HMAC-SHA256 Credential=<AccessKeyId>,
 *    SignedHeaders=<names>,Signature=<hex HMAC-SHA256>` over the string to
 *    sign `ACS3-HMAC-SHA256 \n hex(SHA-256(canonical request))`.
 *
 * The canonical request is the upper-case method, the canonical URI, the
 * canonical query string, the canonical headers (`host`, `content-type` and
 * every `x-acs-*` header, names lower-cased and sorted, values trimmed), the
 * signed header names and the body hash, joined by newlines. The request names
 * its API with the `x-acs-action` / `x-acs-version` headers the caller sends;
 * they are signed as sent.
 *
 * Because the vendor canonicalises the path and the query with its own
 * percent-encoding (RFC 3986: unreserved characters kept, space as `%20`,
 * `*` as `%2A`), the signer answers the URL in that canonical spelling, so
 * the query the upstream reads is byte for byte the one the signature covers
 * (a WHATWG `URLSearchParams` would send a space as `+`).
 *
 * ⛔ The AccessKey secret lives only in the closure of the signer this module
 * returns: no error, log line or returned value carries it.
 */

export const ALIYUN_ACS3_ALGORITHM = 'ACS3-HMAC-SHA256';

/** RFC 3986 percent-encoding as the vendor specifies it: unreserved kept, everything else `%XX`. */
function percentEncode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The path, one segment at a time, decoded from the URL's spelling and re-encoded canonically. */
function canonicalUri(url: URL): string {
    return url.pathname.split('/').map((segment) => percentEncode(decodeURIComponent(segment))).join('/') || '/';
}

/** Query parameters sorted by name (then value), each name and value canonically encoded. */
function canonicalQueryString(url: URL): string {
    const pairs = [...url.searchParams.entries()];
    pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
    return pairs.map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join('&');
}

/** Every intermediate of one signature — what the worked-example test pins, step by step. */
export interface AliyunAcs3Computation {
    readonly canonicalRequest: string;
    readonly stringToSign: string;
    readonly signature: string;
    /** Headers the signer adds: `authorization` and the three `x-acs-*` values it chose. */
    readonly headers: Readonly<Record<string, string>>;
    /** The URL in the canonical spelling the signature covers. */
    readonly url: string;
}

/**
 * Compute the ACS3-HMAC-SHA256 signature of `request` at the instant and nonce
 * given. Pure: the same inputs give the same bytes, which is what lets the
 * vendor's worked example pin it.
 */
export function computeAliyunAcs3Signature(
    request: ConnectorSignableRequest,
    keyId: string,
    secret: string,
    at: { readonly date: string; readonly nonce: string },
): AliyunAcs3Computation {
    const url = new URL(request.url);
    const hashedPayload = sha256Hex(request.body ?? '');
    const own: Record<string, string> = {
        'x-acs-date': at.date,
        'x-acs-signature-nonce': at.nonce,
        'x-acs-content-sha256': hashedPayload,
    };
    const all = new Map<string, string>();
    for (const [name, value] of Object.entries(request.headers)) all.set(name.toLowerCase(), value);
    for (const [name, value] of Object.entries(own)) all.set(name, value);
    // `fetch` derives `Host` from the URL and refuses to let a caller set it,
    // so the URL is the only truth for the value the upstream checks.
    all.set('host', url.host);

    const signedNames = [...all.keys()]
        .filter((name) => name === 'host' || name === 'content-type' || name.startsWith('x-acs-'))
        .sort();
    const canonicalHeaders = signedNames.map((name) => `${name}:${(all.get(name) ?? '').trim()}\n`).join('');
    const signedHeaders = signedNames.join(';');
    const path = canonicalUri(url);
    const query = canonicalQueryString(url);

    const canonicalRequest = [
        request.method.toUpperCase(),
        path,
        query,
        canonicalHeaders,
        signedHeaders,
        hashedPayload,
    ].join('\n');
    const stringToSign = `${ALIYUN_ACS3_ALGORITHM}\n${sha256Hex(canonicalRequest)}`;
    const signature = createHmac('sha256', secret).update(stringToSign, 'utf8').digest('hex');

    return {
        canonicalRequest,
        stringToSign,
        signature,
        headers: {
            ...own,
            authorization: `${ALIYUN_ACS3_ALGORITHM} Credential=${keyId},SignedHeaders=${signedHeaders},Signature=${signature}`,
        },
        url: `${url.origin}${path}${query ? `?${query}` : ''}`,
    };
}

/** `x-acs-date`: ISO 8601 in UTC to the second, as the vendor's example spells it (`2023-10-26T10:22:32Z`). */
function acsDate(now: Date): string {
    return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Bind an ACS3-HMAC-SHA256 signer to one instance's AccessKey. */
export function createAliyunAcs3Signer(
    connector: string,
    keyId: string,
    secret: string,
    clock: RequestSigningClock = {},
): ConnectorRequestSigner {
    const now = clock.now ?? (() => new Date());
    const nonce = clock.nonce ?? (() => randomBytes(16).toString('hex'));
    return {
        connector,
        scheme: 'aliyun-acs3-hmac-sha256',
        async sign(request): Promise<ConnectorRequestSignature> {
            const { headers, url } = computeAliyunAcs3Signature(request, keyId, secret, {
                date: acsDate(now()),
                nonce: nonce(),
            });
            return { headers, url };
        },
    };
}
