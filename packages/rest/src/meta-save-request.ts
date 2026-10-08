// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22141] What a `PUT /meta/:type/:name` request asks of `saveMetaItem`
 * beyond the item itself — the ADR-0008 precondition and the ADR-0033
 * lifecycle — read ONCE, here, for both doors that serve that route:
 * `RestServer`'s `PUT` and the runtime dispatcher's `/meta` domain, which is
 * the only answer on a host that mounts just `@objectstack/hono`'s
 * `${prefix}/*` catch-all.
 *
 * The dispatcher's door read neither. It handed `saveMetaItem` no
 * `parentVersion` and no `mode`, so through the catch-all a stale `If-Match`
 * wrote (`200`, not `409`), `If-None-Match: *` over an existing row wrote, and
 * a `?mode=draft` save landed ACTIVE — a draft went live without a publish,
 * past ADR-0033's gate, with a `200` the client read as success. Both doors now
 * call this one mapping, so they cannot answer the same request differently.
 *
 * What travels is the decision and nothing transport-shaped: each door hands
 * in its own request members ({@link MetaSaveRequestHttp}), spreads
 * `request` into its `saveMetaItem` literal, and writes a refusal on its own
 * wire, in its own envelope — the split `metaRequestLocale` makes. Every key
 * of `request` is ABSENT unless the caller asked for it, so an unguarded,
 * active save reaches `saveMetaItem` exactly as before.
 *
 * ## The precondition (moved here unchanged from `RestServer`, #22114)
 *
 * `parentVersion` is the `If-Match` token (ETag-style quotes stripped), `null`
 * for `If-None-Match: *` ("no row of this lifecycle is here", the first-write
 * pin the protocol has always declared), or absent for neither (unpinned,
 * last-write-wins).
 *
 * `If-None-Match` is read with a CLOSED value set, `*` alone (AGENTS.md
 * 〈Route & surface ownership〉 rule 5's reason, one carrier over): a header
 * read for the values it knows and dropped otherwise would write a caller
 * unguarded who asked for a guard. Measured before it landed: no first-party
 * client sends `If-None-Match` on a `PUT` (the SDK sends it only on its cached
 * `GET`, objectui's ETag hook has no caller). Two refusals, both `400`:
 *
 *  - a value other than `*` — an entity-tag list asks "write unless the head is
 *    one of these", a condition no `/meta` client has and neither door
 *    evaluates;
 *  - `If-None-Match` beside `If-Match` — the pair can never hold (RFC 9110
 *    §13.2.2 evaluates both: `If-Match` true needs a current row, `*` true
 *    needs none), and a `409` would send the caller round a re-read that
 *    serves a token it would pair with `*` again.
 *
 * ## The lifecycle
 *
 * `?mode=draft` (any case) is `mode: 'draft'`: the save stages a draft row and
 * leaves the active row alone. Any other value is an active save, as it has
 * always been on `RestServer`.
 *
 * `query.mode` is read as the string a door has already judged for
 * multiplicity. `RestServer` calls this AFTER `refuseRepeatedQueryParams`,
 * which refuses a repeated `mode` and unwraps one occurrence encoded as an
 * array; the `@objectstack/hono` catch-all flattens its query from the URL, one
 * string per name. ⛔ So call it after your own multiplicity gate, never
 * before: an array reaching here is not read as a draft.
 */

import type { SaveMetaItemRequest } from '@objectstack/spec/api';

/** The two request members a save's precondition and lifecycle are read from — each door hands in its own. */
export interface MetaSaveRequestHttp {
    /** A `Headers`-like (`get`) — the Fetch `Request` the catch-all hands on — or a plain header record. */
    readonly headers?: unknown;
    readonly query?: Readonly<Record<string, unknown>>;
}

/** The `saveMetaItem` members {@link metaSaveRequestOptions} answers, each present only when the request asked for it. */
export type MetaSaveRequestMembers = Pick<SaveMetaItemRequest, 'parentVersion' | 'mode'>;

/** {@link metaSaveRequestOptions}'s answer: the members to spread into the save, or the sentence of a `400`. */
export type MetaSaveRequestOptions =
    | { readonly ok: true; readonly request: MetaSaveRequestMembers }
    | { readonly ok: false; readonly message: string };

/**
 * One request header, read from either shape a door hands in. `Headers.get`
 * answers `null` for an absent header; that is folded to `undefined`, the
 * record shape's absence, so both shapes ask the same question below.
 */
function requestHeader(headers: unknown, lower: string, canonical: string): unknown {
    if (!headers || typeof headers !== 'object') return undefined;
    const h = headers as { get?: unknown } & Record<string, unknown>;
    if (typeof h.get === 'function') return (h.get as (name: string) => unknown).call(headers, lower) ?? undefined;
    return h[lower] ?? h[canonical];
}

/**
 * [#22141] The precondition and lifecycle a `PUT /meta/:type/:name` request
 * asks `saveMetaItem` for — see this module's header.
 */
export function metaSaveRequestOptions(http: MetaSaveRequestHttp): MetaSaveRequestOptions {
    const ifMatch = requestHeader(http.headers, 'if-match', 'If-Match');
    const ifNoneMatch = requestHeader(http.headers, 'if-none-match', 'If-None-Match');
    let parentVersion: string | null | undefined;
    if (ifNoneMatch !== undefined) {
        if (ifMatch !== undefined) {
            return {
                ok: false,
                message: 'Send If-Match or If-None-Match, not both. If-Match: <version> saves only over that '
                    + 'version; If-None-Match: * saves only where no row of this lifecycle exists. A row '
                    + 'cannot both exist and not exist, so this pair can never be honoured.',
            };
        }
        if (typeof ifNoneMatch !== 'string' || ifNoneMatch.trim() !== '*') {
            return {
                ok: false,
                message: 'If-None-Match on this route takes "*" alone (save only if no row of this lifecycle '
                    + 'exists). To pin a save to the version you read, send it as If-Match: <version>.',
            };
        }
        parentVersion = null;
    } else if (typeof ifMatch === 'string') {
        parentVersion = ifMatch.replace(/^"|"$/g, '');
    }
    const mode = http.query?.mode;
    const draft = typeof mode === 'string' && mode.toLowerCase() === 'draft';
    return {
        ok: true,
        request: {
            ...(parentVersion !== undefined ? { parentVersion } : {}),
            ...(draft ? { mode: 'draft' as const } : {}),
        },
    };
}
