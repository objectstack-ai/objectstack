// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27908 — maintainer ruling 6513869839 on #27681, parameter 3] The action
 * doors' half of the `action_invocation` audit row: "The audit row of an
 * action run through MCP records the surface, so an administrator can tell an
 * agent's call from a click without a second log."
 *
 * Both action doors — the REST `POST /actions/:object/:action` door
 * (`domains/actions.ts`) and the `/mcp` bridge's `run_action`
 * (`invokeBusinessAction`) and `resume_run` (`resumeActionRun`) — call
 * {@link recordActionInvocation} once per call that cleared the door's
 * admission gates and reached its branch (script, api, flow, declarative
 * update), whatever the branch then answered. A call a gate refused ahead of
 * that (not found, the `sys_*` / `ai.exposed` / ADR-0066 D4 / ADR-0126
 * activation gates, the param contract, the confirmation gate) writes no row:
 * nothing ran.
 *
 * ## The surface is the door's, never the caller's
 *
 * {@link withActionSurface} sets `ExecutionContext.surface` on a COPY of the
 * caller's envelope, from the door's own identity, overwriting whatever an
 * earlier hop left there. Nothing read off the request — no header, no body
 * member, no upstream envelope value — reaches it. In particular the `api`
 * branch's forward mark (`API_FORWARD_MARK_HEADER`) carries no trust: any
 * outside caller can send it, and its only effect is the loop refusal.
 *
 * ## Why the forward needs no surface header
 *
 * The `api` branch forwards in-process and the target re-authenticates the
 * caller from its credentials, so the TARGET's envelope never carries what
 * this door knew. The row does not need it to: it is written HERE, after the
 * forward answered, from this door's own envelope, which the hop never
 * replaces. The row therefore names the true door on the `api` branch exactly
 * as on the other three.
 *
 * ## The writer
 *
 * `@objectstack/plugin-audit` owns the row shape and registers the writer on
 * the `audit` service slot (`recordActionInvocation`, beside
 * `recordAuthEvent`). It is reached through the structural surface below,
 * so neither package depends on the other. A host with no audit plugin has
 * no ledger at all, so the call is skipped silently — the same as every other
 * ledger row on such a host. ⛔ The `console.info [action-audit]` line the
 * script branch prints is NOT this row and is not replaced by it.
 *
 * Attribution only: nothing here gates, narrows or widens what a door runs.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveThrownHttpError } from '@objectstack/types';
import type { HttpProtocolContext } from './http-dispatcher.js';

/** The door an action invocation came through — `ExecutionContext.surface`. */
export type ActionSurface = NonNullable<ExecutionContext['surface']>;

/** The dispatcher the invocation reached; `update` is the declarative write. */
export type ActionInvocationBranch = 'script' | 'api' | 'flow' | 'update';

/** The event the doors hand the `audit` slot's `recordActionInvocation`. */
export interface ActionInvocationAuditEvent {
    /** The invocation's envelope, `surface` set by the door. */
    context: ExecutionContext | undefined;
    actionName: string;
    objectName?: string;
    recordId?: string;
    branch: ActionInvocationBranch;
    outcome: 'succeeded' | 'failed';
    status?: number;
    errorCode?: string;
    runId?: string;
}

/** The `audit` slot member this file calls — declared locally, structurally. */
interface ActionInvocationAuditSurface {
    recordActionInvocation(event: ActionInvocationAuditEvent): Promise<void>;
}

/** The service resolution the two doors' deps both offer. */
interface AuditSlotLookup {
    resolveService(context: HttpProtocolContext, name: string, environmentId?: string): any;
}

/**
 * The caller's envelope as THIS door's invocation: a copy with `surface` set
 * from the door's identity. A copy, so the request's own envelope — which the
 * gates and the dispatch read — is left exactly as identity resolution built
 * it.
 */
export function withActionSurface(ec: unknown, surface: ActionSurface): ExecutionContext {
    const base = ec && typeof ec === 'object' ? (ec as ExecutionContext) : ({} as ExecutionContext);
    return { ...base, surface };
}

/** The branch an admitted action dispatches to, read in the doors' order. */
export function actionInvocationBranch(action: any, isDeclarativeUpdate: boolean): ActionInvocationBranch {
    if (isDeclarativeUpdate) return 'update';
    if (action?.type === 'api') return 'api';
    if (action?.type === 'flow') return 'flow';
    return 'script';
}

/**
 * A thrown refusal's HTTP status and machine code, read by the ONE shared
 * resolver the doors' envelopes are built from (`resolveThrownHttpError`),
 * never re-derived here. A thrower that declares no status reads as 500.
 */
export function actionInvocationFailure(err: unknown): { status: number; errorCode?: string } {
    const { status, code } = resolveThrownHttpError(err, 500);
    return typeof code === 'string' && code.length > 0 ? { status, errorCode: code } : { status };
}

/**
 * Hand one invocation to the `audit` slot. Never throws and never changes the
 * door's answer: the writer reports its own lost rows (`plugin-audit`).
 */
export async function recordActionInvocation(
    deps: AuditSlotLookup,
    requestContext: HttpProtocolContext,
    environmentId: string | undefined,
    event: ActionInvocationAuditEvent,
): Promise<void> {
    let sink: Partial<ActionInvocationAuditSurface> | undefined;
    try {
        sink = await deps.resolveService(requestContext, 'audit', environmentId);
    } catch {
        return; // no audit slot on this kernel: no ledger to write to
    }
    if (!sink || typeof sink.recordActionInvocation !== 'function') return;
    try {
        await sink.recordActionInvocation(event);
    } catch {
        // The writer never throws by contract; a host's own sink that does
        // must not turn an answered action into a failed one.
    }
}
