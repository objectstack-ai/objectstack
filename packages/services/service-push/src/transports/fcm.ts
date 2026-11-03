// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createPrivateKey, sign } from 'node:crypto';
import type { FcmTransportConfig } from '@objectstack/spec/system';
import type { IPushTransport, PushMessage, PushSendResult } from '../push-service.js';
import { PushCredentialError, resolveRequiredCredential, type PushCredentialResolver } from '../credential.js';
import { credentialFailure } from './apns.js';

/** The FCM HTTP v1 origin. */
export const FCM_ORIGIN = 'https://fcm.googleapis.com';

/** Google's OAuth 2.0 token endpoint, used when the service account names none. */
export const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** The one scope the HTTP v1 send needs. */
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** An access token is refreshed this long before Google says it expires. */
const ACCESS_TOKEN_MARGIN_MS = 60 * 1000;

export interface FcmPushTransportOptions {
    /** The parsed `fcm` block of `PushServiceConfigSchema`. */
    config: FcmTransportConfig;
    /** Resolves `config.credentialRef` to the service-account JSON. */
    resolveCredential: PushCredentialResolver;
    /** The FCM origin. Defaults to {@link FCM_ORIGIN}; a test points it at a local server. Not authorable. */
    origin?: string;
    /**
     * The OAuth token endpoint. Defaults to the service account's `token_uri`,
     * else {@link GOOGLE_TOKEN_URI}; a test points it at a local server. Not authorable.
     */
    tokenUri?: string;
    /** Per-request timeout. Default 10 s. */
    timeoutMs?: number;
    /** Clock, in epoch milliseconds. */
    now?: () => number;
    /** `fetch`, injectable for a test. */
    fetch?: typeof fetch;
}

interface ServiceAccount {
    clientEmail: string;
    privateKey: string;
    tokenUri: string;
}

interface FcmError {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<{ '@type'?: string; errorCode?: string }>;
}

/**
 * FCM over the HTTP v1 API, authenticated by a service account.
 *
 * Signs an RS256 assertion with the service account's private key (the JSON
 * the `credentialRef` names), exchanges it for an OAuth access token, keeps
 * that token until a minute before it expires, and posts each push to
 * `/v1/projects/PROJECT/messages:send` with the delivery data in
 * `message.data` (`PushDeliveryDataSchema`).
 *
 * Answers: `200` is sent; `UNREGISTERED` (or `404 NOT_FOUND`) is
 * `invalid_token`; a `401` refreshes the access token once and retries;
 * `429` and `5xx` are retryable; every other refusal is not.
 */
export class FcmPushTransport implements IPushTransport {
    readonly vendor = 'fcm' as const;
    private readonly origin: string;
    private readonly timeoutMs: number;
    private readonly now: () => number;
    private readonly fetch: typeof fetch;
    private accessToken?: { value: string; expiresAt: number };

    constructor(private readonly opts: FcmPushTransportOptions) {
        this.origin = (opts.origin ?? FCM_ORIGIN).replace(/\/+$/, '');
        this.timeoutMs = opts.timeoutMs ?? 10_000;
        this.now = opts.now ?? Date.now;
        this.fetch = opts.fetch ?? fetch;
    }

    async send(message: PushMessage): Promise<PushSendResult> {
        const url = `${this.origin}/v1/projects/${encodeURIComponent(this.opts.config.projectId)}/messages:send`;
        const body = JSON.stringify({
            message: {
                token: message.token,
                notification: { title: message.title, body: message.body },
                data: { ...message.data },
            },
        });

        for (let attempt = 1; ; attempt += 1) {
            let token: string;
            try {
                token = await this.oauthAccessToken();
            } catch (err) {
                if (err instanceof PushCredentialError) return { status: 'failed', error: err.message, retryable: false };
                throw err;
            }
            const res = await this.fetch(url, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            const text = await res.text();
            if (res.status === 200) {
                const name = readJson<{ name?: unknown }>(text)?.name;
                return { status: 'sent', ...(typeof name === 'string' && name ? { messageId: name } : {}) };
            }
            const error = readJson<{ error?: FcmError }>(text)?.error ?? {};
            const errorCode = error.details?.find((d) => typeof d?.errorCode === 'string')?.errorCode;
            if (errorCode === 'UNREGISTERED' || (res.status === 404 && error.status === 'NOT_FOUND')) {
                return { status: 'invalid_token', reason: errorCode ?? 'NOT_FOUND' };
            }
            if (res.status === 401 && attempt === 1) {
                this.accessToken = undefined;
                continue;
            }
            return {
                status: 'failed',
                error: `FCM answered ${res.status} ${errorCode ?? error.status ?? ''}`.trim(),
                retryable: res.status === 429 || res.status >= 500,
            };
        }
    }

    /** The OAuth access token, exchanged for a signed assertion and kept until it nears expiry. */
    private async oauthAccessToken(): Promise<string> {
        const now = this.now();
        if (this.accessToken && now < this.accessToken.expiresAt) return this.accessToken.value;

        const account = await this.serviceAccount();
        const tokenUri = this.opts.tokenUri ?? account.tokenUri;
        const iat = Math.floor(now / 1000);
        const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
        const claims = base64url(JSON.stringify({ iss: account.clientEmail, scope: FCM_SCOPE, aud: tokenUri, iat, exp: iat + 3600 }));
        const input = `${header}.${claims}`;
        let signature: Buffer;
        try {
            signature = sign('RSA-SHA256', Buffer.from(input), createPrivateKey(account.privateKey));
        } catch (err) {
            throw new PushCredentialError(credentialFailure(err, 'FCM service-account private key'));
        }

        const res = await this.fetch(tokenUri, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: `${input}.${base64url(signature)}`,
            }).toString(),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        const answer = readJson<{ access_token?: unknown; expires_in?: unknown }>(await res.text());
        if (!res.ok || typeof answer?.access_token !== 'string') {
            if (res.status === 400 || res.status === 401 || res.status === 403) {
                throw new PushCredentialError(
                    `credential_refused: the FCM token endpoint refused the service account (HTTP ${res.status})`,
                );
            }
            throw new Error(`the FCM token endpoint answered HTTP ${res.status}`);
        }
        const expiresIn = typeof answer.expires_in === 'number' ? answer.expires_in : 3600;
        this.accessToken = {
            value: answer.access_token,
            expiresAt: now + expiresIn * 1000 - ACCESS_TOKEN_MARGIN_MS,
        };
        return this.accessToken.value;
    }

    private async serviceAccount(): Promise<ServiceAccount> {
        const ref = this.opts.config.credentialRef;
        const raw = await resolveRequiredCredential(this.opts.resolveCredential, ref, 'FCM');
        const parsed = readJson<Record<string, unknown>>(raw);
        const clientEmail = parsed?.client_email;
        const privateKey = parsed?.private_key;
        if (typeof clientEmail !== 'string' || typeof privateKey !== 'string') {
            throw new PushCredentialError(
                `credential_unusable: the FCM credentialRef '${ref}' does not name a service-account JSON `
                + '(client_email and private_key)',
            );
        }
        const tokenUri = typeof parsed?.token_uri === 'string' && parsed.token_uri.startsWith('https://')
            ? parsed.token_uri
            : GOOGLE_TOKEN_URI;
        return { clientEmail, privateKey, tokenUri };
    }
}

function base64url(value: string | Buffer): string {
    return Buffer.from(value).toString('base64url');
}

function readJson<T>(text: string): T | undefined {
    try {
        return JSON.parse(text) as T;
    } catch {
        return undefined;
    }
}
