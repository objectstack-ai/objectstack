// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0143 D4 / D5 — which endpoint an `oauth2` instance may send its secrets
 * to. The token request carries the client secret (HTTP Basic) and the refresh
 * token, and the authorization URL is where an administrator's browser is sent,
 * so both must be `https:`. The spec admits any URL (`z.string().url()`), so the
 * server holds the line: plain `http:` is accepted only to a loopback host,
 * where nothing crosses a network, and every other scheme is refused.
 */

/** The `oauth2` endpoint fields this check covers, in the order a reason names them. */
export const OAUTH2_ENDPOINT_FIELDS = ['tokenUrl', 'authorizationUrl'] as const;

/** True for `localhost`, a `*.localhost` name, any `127.0.0.0/8` address and `[::1]`. */
function isLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '[::1]') return true;
    return /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
}

/**
 * True when `url` is an endpoint an `oauth2` instance may send its secrets to:
 * `https:`, or `http:` to a loopback host. A value that does not parse is not.
 */
export function isSecureOAuth2Endpoint(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
}

/**
 * The endpoint fields of `auth` that {@link isSecureOAuth2Endpoint} refuses,
 * by name. The URLs themselves are never echoed: a reason names the field.
 */
export function insecureOAuth2EndpointFields(auth: Partial<Record<(typeof OAUTH2_ENDPOINT_FIELDS)[number], unknown>>): string[] {
    return OAUTH2_ENDPOINT_FIELDS.filter((field) => {
        const value = auth[field];
        return typeof value === 'string' && !isSecureOAuth2Endpoint(value);
    });
}
