// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/ui` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-3).
 * Serves rendered view metadata from the `protocol` service.
 *
 * Routes (path is the sub-path after `/ui`):
 *   GET /view/:object[/:type]   → getUiView (type also accepted as ?type=)
 *
 * ADR-0138 D2: the anonymous decision is this domain's FIRST statement
 * (`shouldDenyAnonymous`), taken once for every face — ahead of the path
 * parse and the protocol probe, so a face added here later is behind it from
 * the day it lands, and an unauthenticated caller is answered 401 whatever it
 * names. No D2 door class is served from this domain.
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
// [#15238] The DECLARED protocol contract this domain's ONE request literal is
// compiled against. Imported, never restated: a hand-written `getUiView(...)`
// signature here would silently drift from the one the spec declares and
// `ObjectStackProtocolImplementation` states it `implements` — which is the
// whole reason `UiDomainProtocol` below is `Pick`ed rather than written out.
// Same move `domains/packages.ts` (#13598) and `domains/mcp.ts` (commit e783e163d) make.
import type { MetadataProtocol } from '@objectstack/spec/api';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import { capabilityUnavailable } from './unavailable.js';
// [#23214] The repo's one sentence for a repeated single-valued parameter.
import { repeatedQueryParamMessage } from '@objectstack/rest';

/**
 * [#15238] The `protocol` service slot **as this domain reaches it** — one
 * verb, `Pick`ed from the DECLARED contract.
 *
 * ## What was wrong with the seam
 *
 * `deps.resolveService(context, 'protocol')` answers `any`. That is not an
 * oversight — {@link DomainHandlerDeps.resolveService} types its return from
 * `ServiceSlotContracts`, and `protocol` is deliberately left unmapped there
 * ("real services with no written contract, so they keep today's `any` rather
 * than being given a shape here that nothing verifies"). The `any` is honest
 * about the SLOT. What it also did, silently, was hand this domain's single
 * request literal an unchecked call target: `getUiView` and its
 * `GetUiViewRequest` are BOTH declared in `packages/spec`, and the one call
 * below still compiled against nothing at all — neither the verb's spelling
 * nor the two keys it sends.
 *
 * ## Why the type is here and not on the slot
 *
 * Mapping `'protocol'` in `ServiceSlotContracts` would type every consumer at
 * once, but it is a `packages/spec` change that would state that a filled slot
 * IS a `MetadataProtocol`, whose members are mostly REQUIRED — the shape the
 * guard below exists to deny — and it would have to answer for the verbs no
 * contract declares at all. So the narrowing happens at the consumer, once.
 *
 * ## ⛔ Every member is OPTIONAL, and the runtime guard STAYS
 *
 * A host may occupy this slot with a partial object — that is the documented
 * reason the `typeof protocol.getUiView === 'function'` probe exists, and it
 * survives this change unchanged in meaning. `Partial<…>` is what makes the
 * type agree with the probe instead of contradicting it: tightening the type
 * and then deleting the probe would trade a compile-time improvement for a
 * runtime crash. The type answers "is this key declared?"; the probe answers
 * "did THIS host bring the verb?". Two different questions, both still asked.
 * `Partial` is not redundant with the spec's own `getUiView?`: it keeps the
 * invariant true here even if the declaration upstream is ever tightened.
 */
export type UiDomainProtocol = Partial<Pick<MetadataProtocol, 'getUiView'>>;

/**
 * [#15238] Resolve the `protocol` slot as {@link UiDomainProtocol}.
 *
 * THE one narrowing point for this file, mirroring `domains/packages.ts`'s
 * `resolveProtocol`. `resolveService` answers `any` for this name, so the
 * widening happens here and nowhere else — a second call site added later gets
 * the type by construction rather than by remembering to write one.
 *
 * ⛔ Not a guard and not a replacement for one: it neither probes for verbs nor
 * rejects a partial host. `undefined` still means "no protocol service", and
 * the caller still asks its own `typeof … === 'function'` capability question.
 */
async function resolveProtocol(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<UiDomainProtocol | undefined> {
    return await deps.resolveService(context, 'protocol');
}

export function createUiDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/ui',
        handler: (req, context) =>
            handleUiRequest(deps, req.path.substring(3), req.query, context),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleUi`. */
export async function handleUiRequest(
    deps: DomainHandlerDeps,
    path: string,
    query: any,
    _context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // ANONYMOUS BASELINE — the domain's FIRST statement (ADR-0138 D2: the
    // decision is taken once per domain, never face by face). This domain made
    // no anonymous decision of its own, so whether an unauthenticated caller
    // was refused depended on what the face it reached happened to do. Decided
    // here, before the path is parsed or the protocol slot resolved, the caller
    // learns nothing about the object it named or the deployment, and a face
    // added below inherits the refusal.
    //
    // This handler takes no method: every face it serves is a read, and the
    // registry hands it every verb, so the decision is asked of the caller
    // alone. Asked about the user id alone, as the `/data` floor is: a caller
    // on the wire arrives as a user or as the guest, never as `isSystem`.
    if (shouldDenyAnonymous({ userId: _context.executionContext?.userId })) {
        return {
            handled: true,
            response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
        };
    }

    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // GET /ui/view/:object (with optional type param)
    if (parts[0] === 'view' && parts[1]) {
        const objectName = parts[1];
        // Support both path param /view/obj/list AND query param /view/obj?type=list
        // [#23214] `?type=` is read only when the path names no type, and it is
        // ONE view type: a repeat reached `getUiView` as an array. Refused with
        // the multiplicity sentence; a one-element array is one occurrence.
        let queryType = query?.type;
        if (!parts[2] && Array.isArray(queryType)) {
            if (queryType.length > 1) {
                return {
                    handled: true,
                    response: deps.error(repeatedQueryParamMessage('type', queryType.length), 400, { code: 'VALIDATION_ERROR' }),
                };
            }
            queryType = queryType[0];
        }
        const type = parts[2] || queryType || 'list';

        const protocol = await resolveProtocol(deps, _context);

        if (protocol && typeof protocol.getUiView === 'function') {
            try {
                const result = await protocol.getUiView({ object: objectName, type });
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        } else {
            // 501, not the 503 this used to answer: 503 claims the condition
            // is temporary, but an uninstalled MetadataPlugin does not become
            // installed by retrying. The message now names that remedy, and is
            // the same sentence discovery reports for the slot (#4146).
            return capabilityUnavailable(deps, 'ui');
        }
    }

    return { handled: false };
}
