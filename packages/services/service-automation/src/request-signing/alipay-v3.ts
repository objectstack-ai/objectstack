// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createPrivateKey, createPublicKey, createSign, createVerify, randomUUID, type KeyObject } from 'node:crypto';
import type {
    ConnectorRequestSignature,
    ConnectorRequestSigner,
    ConnectorSignableRequest,
    ConnectorSignedResponse,
} from '@objectstack/spec/integration';
import type { RequestSigningClock } from './clock.js';

/**
 * `alipay-v3` — Alipay's OpenAPI v3 request signature and response
 * verification (ADR-0143 D2.3, Q4). Alipay publishes no worked example with a
 * usable key and no official SDK test suite carries a byte-exact vector, so
 * the vectors in `alipay-v3.test.ts` come from the vendor's two official SDKs
 * signing with one placeholder key and agreeing byte for byte (D2.3's dated
 * note of 2026-10-31; the generator is `test-vectors/alipay-v3/`).
 *
 * Every request carries `Authorization: ALIPAY-SHA256withRSA
 * app_id=<app id>,nonce=<nonce>,timestamp=<ms>,sign=<base64>`. The signature is
 * RSA PKCS#1 v1.5 with SHA-256, by the application private key, over
 *
 *     <auth string>\n<METHOD>\n<path and query as sent>\n<body, or "">\n
 *
 * where the auth string is the header's `app_id=…,nonce=…,timestamp=…`. The
 * nonce and the millisecond timestamp are chosen here, per attempt.
 *
 * Alipay signs its responses with its own key: `alipay-timestamp`,
 * `alipay-nonce` and `alipay-signature` over
 *
 *     <alipay-timestamp>\n<alipay-nonce>\n<body as received>\n
 *
 * verified here against the Alipay public key before the body is read
 * ({@link alipayV3ResponseMustVerify} says which responses).
 *
 * Keys are accepted as Alipay's console issues them — the bare base64 body —
 * or as PEM: the private key PKCS#8 or PKCS#1, the public key SPKI.
 * Public-key mode only: certificate mode (`app_cert_sn`) is not implemented.
 *
 * ⛔ The private key lives only in the closure of the signer this module
 * returns: no error, log line or returned value carries it.
 */

export const ALIPAY_V3_ALGORITHM = 'ALIPAY-SHA256withRSA';

function parseKey<T>(text: string, pem: (key: string) => T, der: ReadonlyArray<(key: Buffer) => T>): T {
    const trimmed = text.trim();
    if (trimmed.startsWith('-----BEGIN')) return pem(trimmed);
    const bytes = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
    let last: unknown;
    for (const read of der) {
        try {
            return read(bytes);
        } catch (err) {
            last = err;
        }
    }
    throw last;
}

/** An RSA private key from PEM or bare base64 (PKCS#8, else PKCS#1). Throws without echoing the key. */
export function readAlipayPrivateKey(text: string): KeyObject {
    let key: KeyObject;
    try {
        key = parseKey(text, (k) => createPrivateKey(k), [
            (b) => createPrivateKey({ key: b, format: 'der', type: 'pkcs8' }),
            (b) => createPrivateKey({ key: b, format: 'der', type: 'pkcs1' }),
        ]);
    } catch {
        throw new Error('it is not an RSA private key in PEM or base64 (PKCS#8 or PKCS#1)');
    }
    if (key.asymmetricKeyType !== 'rsa') throw new Error('it is not an RSA private key');
    return key;
}

/** An RSA public key from PEM or bare base64 (SPKI, else PKCS#1). */
export function readAlipayPublicKey(text: string): KeyObject {
    let key: KeyObject;
    try {
        key = parseKey(text, (k) => createPublicKey(k), [
            (b) => createPublicKey({ key: b, format: 'der', type: 'spki' }),
            (b) => createPublicKey({ key: b, format: 'der', type: 'pkcs1' }),
        ]);
    } catch {
        throw new Error('it is not an RSA public key in PEM or base64 (SPKI or PKCS#1)');
    }
    if (key.asymmetricKeyType !== 'rsa') throw new Error('it is not an RSA public key');
    return key;
}

/** Every intermediate of one request signature — what the vector test pins. */
export interface AlipayV3Computation {
    readonly authString: string;
    readonly content: string;
    readonly signature: string;
    readonly headers: Readonly<Record<string, string>>;
}

/**
 * Sign `request` with `privateKey` at `timestamp` (Unix milliseconds) with
 * `nonce`. Pure: RSA PKCS#1 v1.5 is deterministic, so the same inputs give the
 * same bytes, which is what lets the SDK vectors pin it.
 */
export function computeAlipayV3Signature(
    request: ConnectorSignableRequest,
    appId: string,
    privateKey: KeyObject,
    nonce: string,
    timestamp: number,
): AlipayV3Computation {
    const url = new URL(request.url);
    const authString = `app_id=${appId},nonce=${nonce},timestamp=${timestamp}`;
    const content = `${authString}\n${request.method.toUpperCase()}\n${url.pathname}${url.search}\n${request.body ?? ''}\n`;
    const signature = createSign('RSA-SHA256').update(content, 'utf8').sign(privateKey, 'base64');
    return {
        authString,
        content,
        signature,
        headers: { authorization: `${ALIPAY_V3_ALGORITHM} ${authString},sign=${signature}` },
    };
}

/**
 * Which responses must carry a valid Alipay signature. A deliberate choice
 * where the vendor's two official SDKs disagree (seat ruling on #26710,
 * 2026-10-31), taking the stricter of the two in each case:
 *  - status below 400, whatever the body (an empty one included): verified,
 *    and a missing signature fails. The Node SDK (alipay-sdk 4.14.0) verifies
 *    every such response; the Java v3 SDK (3.1.89) skips an empty 2xx body.
 *  - status 400 and above: verified when it carries `alipay-signature` (the
 *    Java SDK's rule; the Node SDK never verifies one), and an unsigned one
 *    passes as the failure it already is.
 */
export function alipayV3ResponseMustVerify(status: number, signed: boolean): boolean {
    return status < 400 || signed;
}

/** The string Alipay signs over a response. */
export function alipayV3ResponseContent(timestamp: string, nonce: string, body: string): string {
    return `${timestamp}\n${nonce}\n${body}\n`;
}

/**
 * Verify Alipay's signature over `response` with `publicKey`, as
 * {@link alipayV3ResponseMustVerify} requires. Throws naming the instance and
 * the status, never the body or the signature.
 */
export function verifyAlipayV3Response(connector: string, response: ConnectorSignedResponse, publicKey: KeyObject): void {
    const signature = response.headers.get('alipay-signature');
    if (!alipayV3ResponseMustVerify(response.status, signature !== null && signature !== '')) return;
    const timestamp = response.headers.get('alipay-timestamp');
    const nonce = response.headers.get('alipay-nonce');
    if (!signature || timestamp === null || nonce === null) {
        throw new Error(
            `connector instance '${connector}': the response (HTTP ${response.status}) carries no complete Alipay signature `
                + '(alipay-signature, alipay-timestamp, alipay-nonce), so it is not accepted as Alipay\'s',
        );
    }
    const verified = createVerify('RSA-SHA256')
        .update(alipayV3ResponseContent(timestamp, nonce, response.body), 'utf8')
        .verify(publicKey, signature, 'base64');
    if (!verified) {
        throw new Error(
            `connector instance '${connector}': the response's Alipay signature (HTTP ${response.status}) does not verify `
                + 'against the public key its vendorPublicKeyRef names, so it is not accepted as Alipay\'s',
        );
    }
}

/**
 * Bind an `alipay-v3` signer to one instance's app id, application private key
 * and Alipay public key. Throws when either key cannot be read, before any
 * request is made; never with a key in the message.
 */
export function createAlipayV3Signer(
    connector: string,
    appId: string,
    privateKeyText: string,
    publicKeyText: string,
    clock: RequestSigningClock = {},
): ConnectorRequestSigner {
    let privateKey: KeyObject;
    let publicKey: KeyObject;
    try {
        privateKey = readAlipayPrivateKey(privateKeyText);
    } catch (err) {
        throw new Error(`connector instance '${connector}': the signing key its credentialRef names cannot sign: ${(err as Error).message}`);
    }
    try {
        publicKey = readAlipayPublicKey(publicKeyText);
    } catch (err) {
        throw new Error(`connector instance '${connector}': the key its vendorPublicKeyRef names cannot verify: ${(err as Error).message}`);
    }
    const now = clock.now ?? (() => new Date());
    const nonce = clock.nonce ?? (() => randomUUID());
    return {
        connector,
        scheme: 'alipay-v3',
        async sign(request): Promise<ConnectorRequestSignature> {
            return { headers: computeAlipayV3Signature(request, appId, privateKey, nonce(), now().getTime()).headers };
        },
        async verifyResponse(response): Promise<void> {
            verifyAlipayV3Response(connector, response, publicKey);
        },
    };
}
