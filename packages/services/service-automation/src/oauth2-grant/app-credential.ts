// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The vendor app-credential exchanges (ADR-0143 D2.2, D4)
 *
 * An `app-credential` instance trades an app id and an app secret for a
 * short-lived access token, non-interactively. That is not an RFC 6749 grant:
 * each vendor spells the request, the response and where the token rides on
 * the outgoing call differently. So each value of the closed
 * `ConnectorAppCredentialVendorSchema` names ONE exchange, implemented here
 * against the vendor's published documentation, and nothing about it is
 * authored (D2.2): the author writes `vendor`, `appId` and the `credentialRef`
 * that names the secret.
 *
 * | vendor | token request | token answer | the token on a call |
 * |:---|:---|:---|:---|
 * | `feishu` | `POST https://accounts.feishu.cn/oauth/v3/token`, form: `grant_type=client_credentials`, `client_id`, `client_secret` | `code` 0, `access_token`, `expires_in` | `Authorization: Bearer` |
 * | `dingtalk` | `POST https://api.dingtalk.com/v1.0/oauth2/accessToken`, JSON `appKey`, `appSecret` | `accessToken`, `expireIn` | header `x-acs-dingtalk-access-token` |
 * | `wecom` | `GET https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=…&corpsecret=…` | `errcode` 0, `access_token`, `expires_in` | query parameter `access_token` |
 *
 * Sources: Feishu "自建应用获取 tenant_access_token"
 * (open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/tenant_access_token);
 * DingTalk "获取企业内部应用的 accessToken" (open.dingtalk.com, the v1.0 API that
 * replaces the legacy `oapi.dingtalk.com/gettoken`); WeCom "获取 access_token"
 * (developer.work.weixin.qq.com/document/path/91039) and its global error codes
 * (developer.work.weixin.qq.com/document/path/90455).
 *
 * **Per dispatch** (D4): the token lives in this module's memory only — never
 * persisted (D3, last bullet: the configured secret re-derives it at any
 * time). It is refreshed before it expires (the seam's skew margin), once on
 * an upstream `401` (`callWithBorrowedCredential` in the provider), and — for
 * a vendor that refuses an early-invalidated token inside a `2xx` answer, as
 * WeCom does with `errcode` 40014 / 42001 — once on that answer
 * ({@link retryOnVendorTokenRefusal}). Concurrent requests share one exchange
 * (single flight). The token belongs to the app, so a run's organization
 * selects nothing.
 *
 * **Failure** follows D4's split: no answer, a timeout, `429` or a `5xx` is
 * `CONNECTOR_UPSTREAM_UNAVAILABLE`, retried on the existing backoff; a refused
 * app id or secret, or an answer without a token, is the connector seam's
 * `503 SERVICE_UNAVAILABLE`, which the instance's configuration fixes.
 *
 * ⛔ No vendor text is carried — a token endpoint that echoes the secret back
 * would carry it into a refusal or a log line. A refusal names the instance,
 * the vendor and, at most, the vendor's error code. WeCom sends the secret in
 * the request URL, so no error here carries the URL or the transport's own
 * error as a cause.
 */

import {
    BORROWED_CREDENTIAL_SKEW_MS,
    connectorCredentialRefusal,
    type BorrowedConnectorAuth,
    type BorrowedConnectorCredential,
    type ConnectorCredentialRequest,
} from '@objectstack/types';
import {
    ConnectorUpstreamUnavailableError,
    type ConnectorAppCredentialVendor,
    type ConnectorMaterializationHandler,
} from '@objectstack/spec/integration';
import type { OAuth2GrantHandle } from './grant-handle.js';
import { DEFAULT_TOKEN_TIMEOUT_MS } from './token-endpoint.js';

/** One exchange's answer, reduced to what the handle keeps. */
export interface AppCredentialToken {
    readonly accessToken: string;
    /** Epoch ms; absent when the vendor did not say. */
    readonly expiresAt?: number;
}

/** What a vendor's exchange is: where the token is asked for, how it is read, and how it rides. */
export interface AppCredentialExchange {
    readonly vendor: ConnectorAppCredentialVendor;
    /** The request that exchanges the app id and secret. */
    request(appId: string, appSecret: string): { readonly url: string; readonly init: RequestInit };
    /**
     * The token in the answer, or the vendor's error code when the answer
     * refuses (`undefined` when it carries none). Called for every status the
     * runner does not read as operational.
     */
    read(status: number, body: unknown): { readonly token: string; readonly expiresInSeconds?: number } | { readonly refused: string | undefined };
    /** How the token rides on an outgoing call. */
    present(token: string): BorrowedConnectorAuth;
    /**
     * Whether a call's result is the upstream refusing the token inside an
     * answer that is not a `401` — an early-invalidated or expired token.
     * Absent for a vendor that answers `401`.
     */
    refusesToken?(result: Record<string, unknown>): boolean;
}

const asRecord = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** A vendor error code fit to name in a refusal: a short word or number, never free text. */
function codeOf(value: unknown): string | undefined {
    const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
    return typeof text === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(text) ? text : undefined;
}

function seconds(value: unknown): number | undefined {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Feishu: the self-built app's `tenant_access_token`, RFC 6749 client credentials on `accounts.feishu.cn` (client_secret_post). */
const FEISHU: AppCredentialExchange = {
    vendor: 'feishu',
    request(appId, appSecret) {
        return {
            url: 'https://accounts.feishu.cn/oauth/v3/token',
            init: {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
                body: new URLSearchParams({ grant_type: 'client_credentials', client_id: appId, client_secret: appSecret }).toString(),
            },
        };
    },
    read(status, body) {
        const b = asRecord(body);
        const code = b.code;
        if (status >= 200 && status < 300 && (code === 0 || code === undefined) && typeof b.access_token === 'string' && b.access_token.length > 0) {
            return { token: b.access_token, expiresInSeconds: seconds(b.expires_in) };
        }
        return { refused: codeOf(code !== 0 ? code : undefined) ?? codeOf(b.error) };
    },
    present: (token) => ({ type: 'bearer', token }),
};

/** DingTalk: the internal app's access token from the v1.0 API, sent in its own header on api.dingtalk.com calls. */
const DINGTALK: AppCredentialExchange = {
    vendor: 'dingtalk',
    request(appId, appSecret) {
        return {
            url: 'https://api.dingtalk.com/v1.0/oauth2/accessToken',
            init: {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({ appKey: appId, appSecret }),
            },
        };
    },
    read(status, body) {
        const b = asRecord(body);
        if (status >= 200 && status < 300 && typeof b.accessToken === 'string' && b.accessToken.length > 0) {
            return { token: b.accessToken, expiresInSeconds: seconds(b.expireIn) };
        }
        return { refused: codeOf(b.code) };
    },
    present: (token) => ({ type: 'api-key', key: token, headerName: 'x-acs-dingtalk-access-token' }),
};

/**
 * WeCom's global error codes for a call whose `access_token` is no longer
 * valid: 40014 "不合法的access_token" and 42001 "access_token已过期". WeCom
 * may invalidate a token before `expires_in` and answers such a call inside
 * an ordinary answer, so these are its `401`.
 */
const WECOM_TOKEN_REFUSED = new Set([40014, 42001]);

/** WeCom: `gettoken` with the corp id and the application secret; the token rides every call as `access_token`. */
const WECOM: AppCredentialExchange = {
    vendor: 'wecom',
    request(appId, appSecret) {
        const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
        url.searchParams.set('corpid', appId);
        url.searchParams.set('corpsecret', appSecret);
        return { url: url.toString(), init: { method: 'GET', headers: { accept: 'application/json' } } };
    },
    read(status, body) {
        const b = asRecord(body);
        if (status >= 200 && status < 300 && b.errcode === 0 && typeof b.access_token === 'string' && b.access_token.length > 0) {
            return { token: b.access_token, expiresInSeconds: seconds(b.expires_in) };
        }
        return { refused: codeOf(b.errcode) };
    },
    present: (token) => ({ type: 'api-key', key: token, headerName: 'access_token', paramName: 'access_token' }),
    refusesToken(result) {
        const errcode = asRecord(result.body).errcode;
        return typeof errcode === 'number' && WECOM_TOKEN_REFUSED.has(errcode);
    },
};

/** The exchange each closed vendor value names. A vendor enters the spec enum together with its row here. */
export const APP_CREDENTIAL_EXCHANGES: Readonly<Record<ConnectorAppCredentialVendor, AppCredentialExchange>> = {
    feishu: FEISHU,
    dingtalk: DINGTALK,
    wecom: WECOM,
};

/** One exchange request. */
export interface AppCredentialTokenRequest {
    readonly connector: string;
    readonly exchange: AppCredentialExchange;
    readonly appId: string;
    readonly appSecret: string;
    readonly timeoutMs?: number;
    readonly fetch?: typeof fetch;
    readonly now?: () => number;
}

/**
 * Run one vendor exchange. Throws `CONNECTOR_UPSTREAM_UNAVAILABLE` when the
 * vendor did not answer usefully now, the seam's `503 SERVICE_UNAVAILABLE`
 * when it refused or answered without a token; never returns a partial answer.
 */
export async function requestAppCredentialToken(request: AppCredentialTokenRequest): Promise<AppCredentialToken> {
    const { connector, exchange } = request;
    const fetchImpl = request.fetch ?? fetch;
    const now = request.now ?? Date.now;
    const subject = `the ${exchange.vendor} token endpoint of connector instance '${connector}'`;
    const { url, init } = exchange.request(request.appId, request.appSecret);
    const sentAt = now();
    let response: Response;
    try {
        response = await fetchImpl(url, {
            ...init,
            // The answer is read here, never followed: a redirect would carry the secret elsewhere.
            redirect: 'error',
            signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS),
        });
    } catch {
        // No cause: the transport's error may carry the request URL, and WeCom's carries the secret.
        throw new ConnectorUpstreamUnavailableError(`${subject} did not answer`);
    }
    if (response.status === 429 || response.status >= 500) {
        throw new ConnectorUpstreamUnavailableError(`${subject} answered HTTP ${response.status}`);
    }
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        body = undefined;
    }
    const answer = exchange.read(response.status, body);
    if ('refused' in answer) {
        throw connectorCredentialRefusal(
            `${subject} refused the exchange (${answer.refused ?? `HTTP ${response.status}`}): check the instance's appId and `
                + 'the app secret its credentialRef names, and that the app is enabled at the vendor',
            'SERVICE_UNAVAILABLE',
            503,
        );
    }
    return {
        accessToken: answer.token,
        // Measured from when the request was SENT, so network time shortens the token's life.
        ...(answer.expiresInSeconds === undefined ? {} : { expiresAt: sentAt + answer.expiresInSeconds * 1000 }),
    };
}

export interface AppCredentialHandleDeps {
    readonly connector: string;
    readonly vendor: ConnectorAppCredentialVendor;
    readonly appId: string;
    /** The resolved app secret. */
    readonly appSecret: string;
    readonly timeoutMs?: number;
    readonly fetch?: typeof fetch;
    readonly now?: () => number;
}

/**
 * The per-dispatch credential handle of one `app-credential` instance. It
 * carries the connect door's `seed` / `forget` only so the plugin keeps one
 * handle type: an app credential is never connected, so `seed` does nothing.
 */
export function createAppCredentialHandle(deps: AppCredentialHandleDeps): OAuth2GrantHandle {
    const exchange = APP_CREDENTIAL_EXCHANGES[deps.vendor];
    const now = deps.now ?? Date.now;
    let held: AppCredentialToken | undefined;
    let inflight: Promise<AppCredentialToken> | undefined;
    const fresh = (token: AppCredentialToken | undefined): token is AppCredentialToken =>
        token !== undefined && (token.expiresAt === undefined || token.expiresAt - BORROWED_CREDENTIAL_SKEW_MS > now());
    const fill = (): Promise<AppCredentialToken> => {
        inflight ??= requestAppCredentialToken({
            connector: deps.connector,
            exchange,
            appId: deps.appId,
            appSecret: deps.appSecret,
            ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
            ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
            now,
        }).then((token) => { held = token; return token; }).finally(() => { inflight = undefined; });
        return inflight;
    };
    const toCredential = (token: AppCredentialToken): BorrowedConnectorCredential => ({
        auth: exchange.present(token.accessToken),
        ...(token.expiresAt === undefined ? {} : { expiresAt: token.expiresAt }),
    });
    return {
        connector: deps.connector,
        async get() {
            return toCredential(fresh(held) ? held : await fill());
        },
        async refresh() {
            // A refresh already in flight is the one this caller shares.
            if (!inflight) held = undefined;
            return toCredential(await fill());
        },
        seed() { /* an app credential is never connected */ },
        forget() { held = undefined; },
    };
}

/** The organization a dispatch runs in, as the host's handler context carries it. */
function organizationOf(ctx: unknown): string | undefined {
    const tenantId = (ctx as { automation?: { tenantId?: unknown } } | null | undefined)?.automation?.tenantId;
    return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined;
}

/**
 * D4's refresh-once rule for a vendor that refuses a token inside an ordinary
 * answer rather than with a `401` ({@link AppCredentialExchange.refusesToken}
 * — WeCom's early invalidation): a result the vendor reads as a refused token
 * refreshes the handle once and repeats the call once; a second refusal ends
 * in the seam's `503` naming the instance, never the vendor's text. The
 * provider's own `401` rule is untouched. A vendor without the predicate gets
 * `handlers` back unchanged.
 */
export function retryOnVendorTokenRefusal(
    connector: string,
    vendor: ConnectorAppCredentialVendor,
    handle: Pick<OAuth2GrantHandle, 'refresh'>,
    handlers: Record<string, ConnectorMaterializationHandler>,
): Record<string, ConnectorMaterializationHandler> {
    const refuses = APP_CREDENTIAL_EXCHANGES[vendor].refusesToken;
    if (!refuses) return handlers;
    const wrapped: Record<string, ConnectorMaterializationHandler> = {};
    for (const [key, handler] of Object.entries(handlers)) {
        wrapped[key] = async (input, ctx) => {
            const first = await handler(input, ctx);
            if (!refuses(first)) return first;
            const request: ConnectorCredentialRequest = {};
            const organizationId = organizationOf(ctx);
            await handle.refresh(organizationId === undefined ? request : { organizationId });
            const second = await handler(input, ctx);
            if (!refuses(second)) return second;
            throw connectorCredentialRefusal(
                `the ${vendor} upstream of connector instance '${connector}' refused its access token, and refused it again `
                    + 'after it was obtained afresh. Check that the app the instance\'s appId names may call this API.',
                'SERVICE_UNAVAILABLE',
                503,
            );
        };
    }
    return wrapped;
}
