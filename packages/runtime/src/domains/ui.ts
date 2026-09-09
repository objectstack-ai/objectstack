// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/ui` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-3).
 * Serves rendered view metadata from the `protocol` service.
 *
 * Routes (path is the sub-path after `/ui`):
 *   GET /view/:object[/:type]   → getUiView (type also accepted as ?type=)
 */

// [#15238] The DECLARED protocol contract this domain's ONE request literal is
// compiled against. Imported, never restated: a hand-written `getUiView(...)`
// signature here would silently drift from the one the spec declares and
// `ObjectStackProtocolImplementation` states it `implements` — which is the
// whole reason `UiDomainProtocol` below is `Pick`ed rather than written out.
// Same move `domains/packages.ts` (#13598) and `domains/mcp.ts` (#8726) make.
import type { MetadataProtocol } from '@objectstack/spec/api';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import { capabilityUnavailable } from './unavailable.js';

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
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // GET /ui/view/:object (with optional type param)
    if (parts[0] === 'view' && parts[1]) {
        const objectName = parts[1];
        // Support both path param /view/obj/list AND query param /view/obj?type=list
        const type = parts[2] || query?.type || 'list';

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
