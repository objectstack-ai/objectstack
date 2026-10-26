// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The deployment's default map style: one operator env var, read the same way
 * by both of its readers (#26001, ruling A: operator env only).
 *
 * A map view that names no `mapStyle` of its own falls back to a built-in
 * default whose style, tiles and glyphs all live on a public demo host. A
 * deployment without public internet, or one whose policy forbids a
 * third-party tile host, gets a grey canvas there, and before this env var
 * the only remedy was editing every map view of every app. The operator now
 * names the deployment's own style document once:
 *
 *   OS_CONSOLE_MAP_STYLE_URL=https://tiles.example.com/styles/basic/style.json
 *
 * Two readers act on that one value, and both read it through
 * {@link readConsoleMapStyleUrl} so they cannot believe it on different terms:
 *
 *   - `RuntimeConfigPlugin` serves it as `mapStyleUrl` on
 *     `GET /api/v1/runtime/config`, the deployment's default map style;
 *   - the CLI's Console mount adds its origin to the Console document's
 *     `connect-src`, computed once at boot.
 *
 * It is an operator posture and nothing else: no Setup setting, no settings
 * key, no spec key, and no per-request policy. Widening the Console's
 * `connect-src` is the operator's act alone, so a tenant admin has no door to
 * it. The value is public once set (the runtime-config door is anonymous), so
 * it must not carry credentials.
 *
 * Contract, strict on purpose: the value is an ABSOLUTE `https:` URL whose
 * host is a DNS name, with no user name, password or whitespace. Empty or
 * whitespace-only reads as unset. Anything else refuses the boot, naming the
 * variable, the same way a malformed `OS_CONSOLE_CSP_CONNECT_SRC` entry does:
 * a map style the Console could not load, or a policy that names the wrong
 * origin, is a misconfiguration the operator must see at once, never a
 * quietly grey map.
 */

/** The variable an operator names the deployment's default map style document in. */
export const CONSOLE_MAP_STYLE_URL_ENV = 'OS_CONSOLE_MAP_STYLE_URL';

/**
 * A DNS host name as the WHATWG parser leaves it (lower-cased, punycoded). An
 * IP literal in brackets is left out: a content-security-policy host source
 * cannot name one, so the origin could never be allowed.
 */
const DNS_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

/**
 * The deployment's default map style URL, or `undefined` when the operator set
 * none. The value is returned as written (trimmed), never re-serialised by the
 * parser, so what the operator declared is byte for byte what the Console
 * loads.
 *
 * @throws Error naming {@link CONSOLE_MAP_STYLE_URL_ENV} when the value is set
 *   but is not an absolute `https:` URL on a DNS host without credentials.
 */
export function readConsoleMapStyleUrl(env: Readonly<Record<string, string | undefined>>): string | undefined {
    const value = String(env[CONSOLE_MAP_STYLE_URL_ENV] ?? '').trim();
    if (value === '') return undefined;
    const refuse = (why: string, shown: string = value): never => {
        throw new Error(
            `${CONSOLE_MAP_STYLE_URL_ENV} is ${JSON.stringify(shown)}, which ${why}. Name the map style document `
            + 'as an absolute https: URL on a host name, for example '
            + 'https://tiles.example.com/styles/basic/style.json, or unset it to keep the built-in default style.',
        );
    };
    // The parser would percent-encode it into the path; it is a second value
    // or a typo, never part of one style URL.
    if (/\s/.test(value)) return refuse('contains whitespace');
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return refuse('is not an absolute URL');
    }
    if (parsed.protocol !== 'https:') return refuse(`uses ${parsed.protocol} rather than https:`);
    if (parsed.username !== '' || parsed.password !== '') {
        // Named without the credentials: this message lands in the boot log.
        return refuse(
            'carries a user name or password, which the anonymous runtime-config door would publish',
            `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
        );
    }
    if (!DNS_HOST.test(parsed.hostname)) return refuse('names a host that a content-security-policy cannot allow');
    return value;
}

/**
 * The origin of a map style URL {@link readConsoleMapStyleUrl} accepted: the
 * one host the Console fetches the style document from, for its `connect-src`.
 */
export function consoleMapStyleOrigin(mapStyleUrl: string): string {
    return new URL(mapStyleUrl).origin;
}
