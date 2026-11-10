// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /automation/hooks/:flowName/:hookId` — the inbound automation hook,
 * reached through the dispatcher (segment 2 of ruling A on #22757, director
 * record `6105447950`; the `/webhooks/redeliver` and `/approvals/act` doors are
 * the precedent this mirrors: one route bridges to one service slot).
 *
 * ## What it serves, and for whom
 *
 * The door a third-party sender (a payment provider, a code host) posts a
 * signed event through to start an `api` flow (ADR-0041 Tier 1). A self-hosted
 * kernel serves it already: `@objectstack/trigger-api`'s `ApiTriggerPlugin`
 * mounts `POST /api/v1/automation/hooks/:flowName/:hookId` straight on the
 * host's raw Hono app. A hosted tenant kernel owns no socket and therefore no
 * raw app, so on that shape the path was the `/automation` domain's and its
 * anonymous floor refused every sender `401 UNAUTHENTICATED`. This module is
 * the hosted door: it forwards the request to the request kernel's
 * `trigger-api` slot — the transport-neutral
 * `ITriggerApiService.handleInboundHook(request, { flowName, hookId })` member —
 * and returns that member's `Response` as it is. The raw-app mount is untouched
 * and is not a caller; nothing here mounts the path a second time on a kernel
 * that has one.
 *
 * ## How the route is reached: through the `/automation` domain, past its floor
 *
 * The `/automation` domain claims every path under `/automation`, and its first
 * statement is the ADR-0056 D2 anonymous floor (`domains/automation.ts`). The
 * floor asks the shared decision with its path and method, and the ADR-0069
 * allow-list's parameterised row (`packages/core`, `auth-gate.ts`) admits
 * exactly this route, `POST` only, and its second row the qualified spelling
 * `POST /automation/hooks/:ns/:flowName/:hookId` (ADR-0150 D5; `:ns` never
 * `runs`), whose qualifier is judged here before the member is called. The domain's very next statement hands the
 * route here, so nothing runs between the allow-list and the verifier: not the
 * run-read gate, not the authoring gate, not the `automation` service probe.
 * Which paths are this route is answered ONCE, by `matchInboundHookRoute`
 * (core) — the same reading the allow-list row matches through — so the floor
 * that admits the route and the branch that serves it cannot disagree on any
 * spelling. Every other `/automation` path, and every other method on this
 * one, stays at the floor exactly as before.
 *
 * ## The signature is the only credential, and the member checks it
 *
 * No session read, no `ExecutionContext` handed on, and ⛔ no look at the
 * signature header here: the member verifies the `x-objectstack-signature`
 * HMAC over the raw body under the hook's own secret, in constant time, before
 * anything is enqueued (ruling A, condition 2: the verifier is the boundary).
 * A pre-check here would be a second verifier that could drift from the first.
 * A signed-in caller is judged exactly as an anonymous one, as on the
 * self-hosted mount, which has no auth gate: the ADR-0069 gate allow-lists the
 * route and `HttpDispatcher.enforceProjectMembership` skips it, both through
 * the same reading.
 *
 * ## The request is forwarded, never read
 *
 * The sender signed its own bytes. This module reads neither the body nor the
 * parsed `body` the transport hands `dispatch()`: the member reads the raw body
 * once, and the request it receives is the transport's own (`context.request`),
 * which the `@objectstack/hono` catch-all leaves unread. A body the transport
 * had already consumed would reach the member empty and be refused as a bad
 * signature — a transport fault shown to the sender as theirs — so it is
 * answered loudly here instead.
 *
 * ## The parameters are decoded here
 *
 * The matcher hands the two segments back raw, as the dispatcher's path carries
 * them; the member takes them decoded, as the self-hosted mount's router hands
 * them (`c.req.param()`). So this module decodes them, as the `/meta` domain
 * decodes its name segments: an escape that does not decode is passed raw,
 * where it names no armed hook and the member answers its ordinary refusal.
 *
 * ## The slot is resolved per request, never at registration
 *
 * The trigger's plugin wires itself at `kernel:ready` (`ApiTriggerPlugin.start`
 * resolves the automation engine, the queue and the HTTP server there), so its
 * service can arrive after the dispatcher is built. A lookup at registration
 * would record an absence the same boot then contradicts (AGENTS.md, "Startup
 * registry reads"), so the slot and its member are read on every request and
 * nothing about their absence is kept.
 *
 * ## Absence is a typed answer, never `ROUTE_NOT_FOUND`
 *
 * `handleInboundHook` is optional on the contract, and the `trigger-api` slot
 * is empty on a stack without the inbound-hook trigger. Either way the route IS
 * mounted and what is missing is the service behind it, so the answer is
 * `501 NOT_IMPLEMENTED` (the `/webhooks/redeliver` and `/approvals/act` answer
 * to the same shape). `ROUTE_NOT_FOUND` would tell the sender the URL is wrong.
 */

import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { admitInboundHookAddress, inboundHookRefusalResponse, type InboundHookRouteMatch } from '@objectstack/core';
import { automationAddressRegistryOf } from './automation-address.js';
import type { ITriggerApiService } from '@objectstack/spec/contracts';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

/** The slot the member lives on — the trigger package's own name (ADR-0041 §2). */
const TRIGGER_API_SLOT = 'trigger-api';

/**
 * One raw path segment, decoded as the self-hosted router decodes a parameter.
 * An escape that does not decode is kept raw rather than thrown on: a malformed
 * segment names no armed hook, and the member gives it its ordinary answer.
 */
function decodeHookSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/**
 * [ADR-0150 D5, child G1] Does the qualified hook's qualifier name the package
 * that ships its flow? The engine's own read (`packagedFlowOwner`) and the
 * registry's namespace table, both from the request kernel, judged by core's
 * one predicate — the one the self-hosted mount asks. A kernel that cannot
 * answer either read admits no namespace (`_env` then reads "no package").
 */
async function isInboundHookAddressAdmitted(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    qualifier: string,
    flowName: string,
): Promise<boolean> {
    const engine = await deps.resolveService(context, 'automation', context.environmentId) as
        { packagedFlowOwner?(name: string): string | undefined } | undefined;
    let registry: ReturnType<typeof automationAddressRegistryOf>;
    try {
        registry = typeof deps.getObjectQL === 'function' ? automationAddressRegistryOf(await deps.getObjectQL(context)) : undefined;
    } catch {
        registry = undefined;
    }
    if (!engine || typeof engine.packagedFlowOwner !== 'function') return false;
    return admitInboundHookAddress({
        qualifier,
        flowOwner: engine.packagedFlowOwner(flowName),
        namespaceOwners: typeof registry?.getNamespaceOwners === 'function' ? registry.getNamespaceOwners(qualifier) ?? [] : [],
    });
}

/**
 * Forward the request to the request kernel's `trigger-api.handleInboundHook`
 * and return its `Response` untouched. `hook` is the route the caller matched,
 * raw — see the module note on decoding.
 */
export async function handleInboundHookRequest(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    hook: InboundHookRouteMatch,
): Promise<HttpDispatcherResult> {
    const service = await deps.resolveService(context, TRIGGER_API_SLOT, context.environmentId) as
        Pick<ITriggerApiService, 'handleInboundHook'> | undefined;
    if (!service) {
        return {
            handled: true,
            response: deps.error(
                'Inbound automation hooks are not available: no trigger-api service is registered. '
                + 'The inbound-hook trigger (@objectstack/trigger-api) serves this route through that '
                + 'service; compose it on the environment that owns the flow.',
                501,
            ),
        };
    }
    if (typeof service.handleInboundHook !== 'function') {
        return {
            handled: true,
            response: deps.error(
                'Inbound automation hooks are not available: the registered trigger-api service '
                + 'does not implement handleInboundHook.',
                501,
            ),
        };
    }

    const request = context.request as Request;
    const logger = deps.logger ?? console;

    // The member verifies its signature over the raw body. A body the
    // transport already read cannot be read again, so the member would refuse
    // a correctly signed post as unsigned — a transport fault shown to the
    // sender as their own. It is a server fault, answered as one and logged.
    if (request?.bodyUsed === true) {
        logger?.error?.(
            '[automation-hooks] the request body was consumed before the inbound-hook route could forward it: '
            + 'the HTTP transport must hand the dispatcher the request with its body unread; the sender was '
            + 'answered 500 rather than the signature refusal the trigger would have given',
        );
        return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
    }

    // [ADR-0150 D5, child G1] THE QUALIFIED HOOK. Served only when its
    // qualifier names the package that ships the flow (core's
    // `admitInboundHookAddress`, over the request kernel's engine and namespace
    // table), judged before the signature is read. An address that does not is
    // answered with the door's one refusal, rendered by core as the trigger
    // renders its own: the same status, header and body as a bad signature on
    // the same hook. It is answered only once its body has been read in full,
    // as the member reads every post's body before it answers (an unknown flow
    // included), so an admitted and an unadmitted address cost the sender the
    // same: a body that never arrives gets no answer on either, and a body the
    // transport cannot deliver is the member's own sanitised 500 on both (the
    // consumed-body 500 above is asked first for the same reason). So neither
    // the answer nor its timing tells an installed namespace from another. The
    // cause goes to the server log only.
    if (hook.qualifier !== undefined) {
        const flowName = decodeHookSegment(hook.flowName);
        const qualifier = decodeHookSegment(hook.qualifier);
        if (!(await isInboundHookAddressAdmitted(deps, context, qualifier, flowName))) {
            try {
                await request.text();
            } catch (err) {
                return memberFaultAnswer(deps, logger, err);
            }
            logger?.warn?.(
                '[automation-hooks] refused an inbound post (unadmitted-address): its qualifier (a namespace, or '
                + '`_env`) does not name the package that ships the flow it names (ADR-0150 D5). The sender got the '
                + 'one answer every unverified post gets; this line is the only record of the cause.',
                { cause: 'unadmitted-address', flowName, qualifier },
            );
            return { handled: true, result: inboundHookRefusalResponse() };
        }
    }

    const params = Object.freeze({
        flowName: decodeHookSegment(hook.flowName),
        hookId: decodeHookSegment(hook.hookId),
    });
    try {
        return { handled: true, result: await service.handleInboundHook(request, params) };
    } catch (err) {
        // As `/webhooks/redeliver` and `/approvals/act`: the member owns the
        // reads and every answer it means to give, so a throw out of it is
        // unattributable here and its message never reaches the sender. The
        // original error goes to the server log.
        return memberFaultAnswer(deps, logger, err);
    }
}

/**
 * The sanitised 500 for a throw while serving an inbound hook: the member's
 * own, or [ADR-0150 D5] the body read of an unadmitted qualified address,
 * which answers what the member's read of the same body would have.
 */
function memberFaultAnswer(
    deps: DomainHandlerDeps,
    logger: DomainHandlerDeps['logger'],
    err: unknown,
): HttpDispatcherResult {
    logger?.error?.(
        '[automation-hooks] the trigger-api service threw while serving an inbound hook; the sender was '
        + 'answered with a sanitised 500: the message is withheld unconditionally, and this line is where '
        + 'the original error is read',
        err instanceof Error ? err : new Error(String(err)),
    );
    return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
}
