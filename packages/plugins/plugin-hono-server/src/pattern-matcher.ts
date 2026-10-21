// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { isDevelopmentBoot } from '@objectstack/core';

/**
 * CORS origin pattern matching utilities.
 *
 * Supports the same wildcard syntax as better-auth's `trustedOrigins`:
 * - `*`                         → matches any origin
 * - `https://*.example.com`     → matches any subdomain
 * - `http://localhost:*`        → matches any port
 * - Comma-separated list of the above
 *
 * What a door ADMITS is decided one level up, in `resolveCorsAdmission`
 * (`cors-admission.ts`); these helpers only answer whether an origin matches.
 *
 * These helpers are shared between the Hono plugin's CORS middleware and
 * consumers that need to apply CORS headers outside the Hono request
 * pipeline (e.g., the Vercel serverless entrypoint's preflight
 * short-circuit in `apps/objectos` — that app lives in the separate
 * `objectstack-ai/cloud` repo, not in this one). Keeping a single
 * implementation ensures both paths stay consistent — divergence caused
 * bug where wildcard `CORS_ORIGIN` values worked locally but produced
 * browser CORS errors on Vercel.
 */

/**
 * Returns true when the origin points to localhost (any port, http or https).
 *
 * Matches:
 * - `http://localhost`
 * - `http://localhost:3000`
 * - `https://localhost:8443`
 * - `http://127.0.0.1:5173`
 * - `http://[::1]:3000`
 */
export function isLocalhostOrigin(origin: string): boolean {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

/**
 * Check if an origin matches a pattern with wildcards — the pattern, and
 * nothing else. A loopback origin matches only a pattern that names it
 * (`http://localhost:*`); the development-boot convenience that admits one
 * beside any list lives in {@link createOriginMatcher}, where the boot is known.
 *
 * @param origin The origin to check (e.g., `https://app.example.com`)
 * @param pattern The pattern to match against (supports `*` wildcard)
 * @returns true if origin matches the pattern
 */
export function matchOriginPattern(origin: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === origin) return true;

    // Convert wildcard pattern to regex:
    // 1. Escape regex special chars EXCEPT `*`
    // 2. Replace `*` with `.*`
    const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(origin);
}

/**
 * A pattern whose HOST part is the bare `*` wildcard: `*` itself, and a
 * `scheme://*` pattern with or without a port — `https://*`, `*://*`,
 * `http://*:*`, `https://*:8443`. {@link matchOriginPattern} expands each of
 * them to match every host, which is what `'*'` does, so a door treats them
 * as it treats `'*'`: refused while credentials are on.
 *
 * Deliberately narrow. A pattern that names any part of the host
 * (`https://*.example.com`, `http://localhost:*`) is not one.
 */
const ALL_HOST_PATTERN = /^(?:[^:/]+:\/\/)?\*+(?::(?:\d+|\*))?$/;

export function isAllHostOriginPattern(pattern: string): boolean {
    return ALL_HOST_PATTERN.test(pattern.trim());
}

/**
 * Normalize a single string / comma-separated string / array into a
 * trimmed array of non-empty patterns.
 */
export function normalizeOriginPatterns(patterns: string | string[]): string[] {
    if (Array.isArray(patterns)) {
        return patterns.map(p => p.trim()).filter(Boolean);
    }
    return patterns.includes(',')
        ? patterns.split(',').map(s => s.trim()).filter(Boolean)
        : [patterns.trim()].filter(Boolean);
}

export interface OriginMatcherOptions {
    /**
     * Whether this is a development boot. On one, a loopback origin
     * (`localhost`, `127.0.0.1`, `[::1]`, any port) is admitted beside a
     * non-empty list; on any other boot only what the list names is.
     *
     * Omitted, it is read once, when the matcher is created, from
     * `isDevelopmentBoot` (`@objectstack/core`) — the reading the CORS doors
     * use — so a consumer that applies these answers outside the Hono
     * pipeline (the serverless preflight short-circuit) gives the same
     * answer as the door on the same boot without passing anything.
     */
    developmentBoot?: boolean;
}

/**
 * Create a CORS origin matcher function that supports wildcard patterns.
 *
 * The returned function follows Hono's `cors({ origin })` contract:
 * given the request's `Origin` header, it returns the origin to echo
 * back in `Access-Control-Allow-Origin`, or `null` if the origin is not
 * allowed.
 *
 * @param patterns Single pattern, array of patterns, or comma-separated patterns
 */
export function createOriginMatcher(
    patterns: string | string[],
    options: OriginMatcherOptions = {},
): (origin: string) => string | null {
    const patternList = normalizeOriginPatterns(patterns);
    // An empty list admits nothing, loopback included, as it always has.
    const admitLoopback = patternList.length > 0
        && (options.developmentBoot ?? isDevelopmentBoot(undefined));

    return (requestOrigin: string) => {
        if (!requestOrigin) return null;
        if (admitLoopback && isLocalhostOrigin(requestOrigin)) return requestOrigin;
        for (const pattern of patternList) {
            if (matchOriginPattern(requestOrigin, pattern)) {
                return requestOrigin;
            }
        }
        return null;
    };
}

/**
 * True if any pattern in the given list contains a `*` wildcard.
 */
export function hasWildcardPattern(patterns: string | string[]): boolean {
    const list = Array.isArray(patterns) ? patterns : [patterns];
    return list.some(p => p.includes('*'));
}
