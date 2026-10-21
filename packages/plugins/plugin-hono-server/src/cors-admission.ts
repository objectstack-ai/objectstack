// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CORS admission rule — the ONE answer to "which cross-origin callers does
 * this door admit?", read by every door that mounts CORS:
 * `HonoServerPlugin` (the server `os serve` / `os dev` / `os start` mount) and
 * `@objectstack/hono`'s `createHonoApp`. Two doors that mount the same policy
 * must answer the same configuration the same way, so the rule lives here once
 * and each door only maps its own option names onto it.
 *
 * The governing text is `docs/HARDENING.md` § CORS: never `'*'` with
 * credentials, and an explicit origin list. So the answer follows what was
 * configured, and nothing else:
 *
 *  - a list (the door's origin option, else `OS_CORS_ORIGIN`) — exactly that
 *    list, through {@link createOriginMatcher}; on a development boot a
 *    loopback origin is admitted beside it;
 *  - no list — no cross-origin caller. Nothing needs the host's own origin: a
 *    browser applies CORS to cross-origin requests only. On a development boot
 *    a loopback origin is admitted;
 *  - an entry that admits every host — `'*'`, or a pattern whose host part is
 *    the bare `*` ({@link isAllHostOriginPattern}) — while credentials are on:
 *    refused, by throwing, so the door's boot fails with the remedy named.
 *
 * "A development boot" is `isDevelopmentBoot` from `@objectstack/core` (`NODE_ENV`
 * exactly `development`), the reading the auth secret's development fallback
 * uses, read once when the rule is resolved.
 */

import { isDevelopmentBoot } from '@objectstack/core';
import { readEnvWithDeprecation } from '@objectstack/types';

import {
    createOriginMatcher,
    isAllHostOriginPattern,
    isLocalhostOrigin,
    normalizeOriginPatterns,
} from './pattern-matcher';

/** The door asking — named in the refusal, so the operator knows what to edit. */
export interface CorsAdmissionDoor {
    /** The package that mounts the middleware, e.g. `@objectstack/plugin-hono-server`. */
    readonly name: string;
    /** That door's own origin-list option, e.g. `cors.origins`. */
    readonly originsOption: string;
}

export interface CorsAdmissionInput {
    readonly door: CorsAdmissionDoor;
    /** The door's origin-list option. Wins over `OS_CORS_ORIGIN` when set. */
    readonly origins?: string | string[];
    /** The door's credentials option. Else `OS_CORS_CREDENTIALS !== 'false'`, i.e. on. */
    readonly credentials?: boolean;
    /** Whether this is a development boot. Else `isDevelopmentBoot(undefined)`. */
    readonly developmentBoot?: boolean;
}

export interface CorsAdmission {
    /**
     * `hono/cors`'s `origin`: the request origin to echo in
     * `Access-Control-Allow-Origin`, or `null`. Always a function, so the
     * middleware never sees a bare `'*'` of its own.
     */
    readonly origin: (requestOrigin: string) => string | null;
    /** Whether `Access-Control-Allow-Credentials: true` is sent. */
    readonly credentials: boolean;
    /** What is admitted, for the door's boot log: the list, or the default's label. */
    readonly admits: string | string[];
}

/**
 * Resolve what a door admits from its own options and the `OS_CORS_*`
 * environment. Throws when an entry that admits every host meets credentials.
 */
export function resolveCorsAdmission(input: CorsAdmissionInput): CorsAdmission {
    // `undefined` = nobody named a list: the default described above.
    let configured: string | string[] | undefined;
    if (input.origins) {
        configured = input.origins;
    } else {
        const fromEnv = readEnvWithDeprecation('OS_CORS_ORIGIN', 'CORS_ORIGIN', { silent: true });
        if (fromEnv) configured = normalizeOriginPatterns(fromEnv);
    }

    const credentials = input.credentials
        ?? (readEnvWithDeprecation('OS_CORS_CREDENTIALS', 'CORS_CREDENTIALS', { silent: true }) !== 'false');
    const developmentBoot = input.developmentBoot ?? isDevelopmentBoot(undefined);

    if (configured === undefined) {
        return {
            origin: (requestOrigin: string) =>
                developmentBoot && isLocalhostOrigin(requestOrigin) ? requestOrigin : null,
            credentials,
            admits: developmentBoot ? 'loopback origins only (development boot)' : 'no cross-origin caller',
        };
    }

    if (credentials) {
        const everyHost = normalizeOriginPatterns(configured).find(isAllHostOriginPattern);
        if (everyHost !== undefined) {
            throw new Error(
                `${input.door.name} refuses CORS origin '${everyHost}' with credentials: it admits every `
                + 'host, so together they admit every origin for credentialed cross-origin requests. Name the '
                + 'origins that may call with credentials (OS_CORS_ORIGIN=https://app.example.com, '
                + `comma-separated, or the \`${input.door.originsOption}\` option), or set `
                + 'OS_CORS_CREDENTIALS=false (or `cors.credentials: false`) to serve it without credentials.',
            );
        }
    }

    return {
        origin: createOriginMatcher(configured, { developmentBoot }),
        credentials,
        admits: configured,
    };
}
