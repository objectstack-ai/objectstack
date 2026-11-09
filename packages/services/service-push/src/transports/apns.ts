// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import http2 from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import type { ApnsTransportConfig } from '@objectstack/spec/system';
import type { IPushTransport, PushMessage, PushSendResult } from '../push-service.js';
import { PushCredentialError, resolveRequiredCredential, type PushCredentialResolver } from '../credential.js';

/** The two APNs gateways, by `environment`. */
export const APNS_ORIGINS = {
    production: 'https://api.push.apple.com',
    sandbox: 'https://api.sandbox.push.apple.com',
} as const;

/**
 * How long one provider token is reused. Apple refuses a token older than an
 * hour (`ExpiredProviderToken`) and throttles one refreshed more often than
 * every twenty minutes (`TooManyProviderTokenUpdates`), so it is minted once
 * and kept for fifty.
 */
const PROVIDER_TOKEN_TTL_MS = 50 * 60 * 1000;

/** The reasons APNs gives for a token that will never deliver again. */
const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered']);

/** An APNs device token is hex. Anything else is not one, and never reaches the request path. */
const APNS_TOKEN_SHAPE = /^[0-9a-fA-F]{1,512}$/;

export interface ApnsPushTransportOptions {
    /** The parsed `apns` block of `PushServiceConfigSchema`. */
    config: ApnsTransportConfig;
    /** Resolves `config.credentialRef` to the `.p8` signing key (PEM). */
    resolveCredential: PushCredentialResolver;
    /**
     * The gateway origin. Defaults to the one `config.environment` names; a
     * test points it at a local HTTP/2 server. Not authorable configuration.
     */
    origin?: string;
    /** Per-request timeout. Default 10 s. */
    timeoutMs?: number;
    /** Clock, in epoch milliseconds. */
    now?: () => number;
}

interface ApnsResponse {
    status: number;
    apnsId?: string;
    body: string;
}

/**
 * APNs with token-based authentication, over HTTP/2 (APNs accepts nothing
 * else).
 *
 * Signs an ES256 provider token with the `.p8` key the `credentialRef` names,
 * reuses it for fifty minutes, and posts each push to
 * `/3/device/TOKEN` on one held HTTP/2 session. The payload is the `aps`
 * alert plus the delivery data at the top level beside it (never under a
 * `data` key; `PushDeliveryDataSchema`).
 *
 * Answers: `200` is sent; `BadDeviceToken` / `Unregistered` (or `410`) is
 * `invalid_token`; an `ExpiredProviderToken` re-signs once and retries; `429`
 * and `5xx` are retryable; every other refusal is not.
 */
export class ApnsPushTransport implements IPushTransport {
    readonly vendor = 'apns' as const;
    private readonly origin: string;
    private readonly timeoutMs: number;
    private readonly now: () => number;
    private client?: http2.ClientHttp2Session;
    private providerToken?: { value: string; mintedAt: number };

    constructor(private readonly opts: ApnsPushTransportOptions) {
        this.origin = opts.origin ?? APNS_ORIGINS[opts.config.environment];
        this.timeoutMs = opts.timeoutMs ?? 10_000;
        this.now = opts.now ?? Date.now;
    }

    async send(message: PushMessage): Promise<PushSendResult> {
        if (!APNS_TOKEN_SHAPE.test(message.token)) {
            return { status: 'invalid_token', reason: 'BadDeviceToken: not a hex APNs device token' };
        }
        const payload = JSON.stringify({
            ...message.data,
            aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
        });

        for (let attempt = 1; ; attempt += 1) {
            let jwt: string;
            try {
                jwt = await this.signedProviderToken();
            } catch (err) {
                return { status: 'failed', error: credentialFailure(err, 'APNs'), retryable: false };
            }
            const res = await this.post(`/3/device/${message.token}`, {
                authorization: `bearer ${jwt}`,
                'apns-topic': this.opts.config.topic,
                'apns-push-type': 'alert',
                'apns-priority': '10',
                'content-type': 'application/json',
            }, payload);

            if (res.status === 200) return { status: 'sent', ...(res.apnsId ? { messageId: res.apnsId } : {}) };
            const reason = readReason(res.body) ?? `HTTP ${res.status}`;
            if (DEAD_TOKEN_REASONS.has(reason) || res.status === 410) {
                return { status: 'invalid_token', reason };
            }
            if (res.status === 403 && reason === 'ExpiredProviderToken' && attempt === 1) {
                this.providerToken = undefined;
                continue;
            }
            return {
                status: 'failed',
                error: `APNs answered ${res.status} ${reason}`,
                retryable: res.status === 429 || res.status >= 500,
            };
        }
    }

    async close(): Promise<void> {
        const client = this.client;
        this.client = undefined;
        if (client && !client.closed) await new Promise<void>((resolve) => client.close(() => resolve()));
    }

    /** The ES256 provider token, minted from the `.p8` key and reused for {@link PROVIDER_TOKEN_TTL_MS}. */
    private async signedProviderToken(): Promise<string> {
        const now = this.now();
        if (this.providerToken && now - this.providerToken.mintedAt < PROVIDER_TOKEN_TTL_MS) {
            return this.providerToken.value;
        }
        const pem = await resolveRequiredCredential(this.opts.resolveCredential, this.opts.config.credentialRef, 'APNs');
        let key;
        try {
            key = createPrivateKey(pem);
        } catch {
            throw new PushCredentialError(
                `credential_unusable: the APNs credentialRef '${this.opts.config.credentialRef}' does not name a .p8 signing key`,
            );
        }
        const header = base64url(JSON.stringify({ alg: 'ES256', kid: this.opts.config.keyId }));
        const claims = base64url(JSON.stringify({ iss: this.opts.config.teamId, iat: Math.floor(now / 1000) }));
        const input = `${header}.${claims}`;
        let signature: Buffer;
        try {
            signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
        } catch {
            throw new PushCredentialError(
                `credential_unusable: the APNs credentialRef '${this.opts.config.credentialRef}' does not name an ES256 (P-256) key`,
            );
        }
        const value = `${input}.${base64url(signature)}`;
        this.providerToken = { value, mintedAt: now };
        return value;
    }

    private session(): http2.ClientHttp2Session {
        if (this.client && !this.client.closed && !this.client.destroyed) return this.client;
        const client = http2.connect(this.origin);
        // A session-level error is reported by the request it fails; the
        // listener only keeps it from becoming an unhandled 'error' event.
        client.on('error', () => {});
        client.on('close', () => {
            if (this.client === client) this.client = undefined;
        });
        client.on('goaway', () => {
            if (this.client === client) this.client = undefined;
        });
        // The held session never keeps the process alive on its own.
        client.unref();
        this.client = client;
        return client;
    }

    private post(path: string, headers: Record<string, string>, body: string): Promise<ApnsResponse> {
        return new Promise((resolve, reject) => {
            const req = this.session().request({ ':method': 'POST', ':path': path, ...headers });
            let status = 0;
            let apnsId: string | undefined;
            let data = '';
            req.setEncoding('utf8');
            req.on('response', (h) => {
                status = Number(h[':status']);
                const id = h['apns-id'];
                apnsId = typeof id === 'string' ? id : undefined;
            });
            req.on('data', (chunk: string) => { data += chunk; });
            req.on('end', () => resolve({ status, apnsId, body: data }));
            req.on('error', reject);
            req.setTimeout(this.timeoutMs, () => {
                req.close(http2.constants.NGHTTP2_CANCEL);
                reject(new Error(`APNs did not answer within ${this.timeoutMs} ms`));
            });
            req.end(body);
        });
    }
}

function base64url(value: string | Buffer): string {
    return Buffer.from(value).toString('base64url');
}

function readReason(body: string): string | undefined {
    try {
        const reason = (JSON.parse(body) as { reason?: unknown })?.reason;
        return typeof reason === 'string' && reason ? reason : undefined;
    } catch {
        return undefined;
    }
}

/** A credential failure's message; any other error is reported as unusable without its text. */
export function credentialFailure(err: unknown, vendor: string): string {
    if (err instanceof PushCredentialError) return err.message;
    return `credential_unusable: the ${vendor} credential could not be used`;
}
