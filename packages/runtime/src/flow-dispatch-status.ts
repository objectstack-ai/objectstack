// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The #9378 status table for a flow dispatched through
 * `IAutomationService.execute` — ONE definition, read by every door.
 *
 * | engine exit            | reality          | answer                     |
 * |------------------------|------------------|----------------------------|
 * | flow not found         | never dispatched | `404`                      |
 * | flow disabled          | never dispatched | `409` `FLOW_DISABLED`      |
 * | flow has no start node | never dispatched | `422` `FLOW_NO_START_NODE` |
 * | ran and failed         | ran, rejected    | `400` `FLOW_FAILED`        |
 *
 * ## Why the table is a module and not a mapper inside one route
 *
 * Three doors dispatch a flow through that one service method — the two
 * `trigger` routes (`domains/automation.ts`), the `/actions` route plus the
 * MCP `run_action` bridge (`action-execution.ts`), and declared endpoints
 * (`endpoint-executor.ts`) — and each answered from its own reading of the
 * result. That is how one engine exit got three answers: a DISABLED flow was
 * `409 FLOW_DISABLED` at the trigger door and `400 FLOW_FAILED` at `/actions`
 * — "the flow ran and rejected", a false statement about a dispatch that never
 * happened — while the endpoint door served every outcome as `200`.
 *
 * The maintainer ruled (2026-08-18, verbatim 「同意」 to the triage
 * recommendation on #9446) that this table is a property of the flow-dispatch
 * CONTRACT rather than of the trigger route, converged in stages. A second
 * copy of it is therefore a defect by construction, and each stage is a door
 * deleting its own copy in favour of this one — which is also why this file is
 * a module in `src/` rather than an export of either door: a rule two doors
 * must agree on cannot live inside one of them.
 *
 * ## What this table does NOT answer, and why each door still owns it
 *
 * **The envelope.** The trigger door RETURNS a built response and can carry
 * `errorMessage` / `summary` in `error.details`; `/actions` THROWS, and a
 * throw's structured context is only what `resolveThrownHttpError`
 * (`@objectstack/types`) reads off the thrown value. Status and code are the
 * contract the #9378 ruling settled; the payload beside them is not.
 *
 * **What an UNCLASSIFIED `success: false` means.** {@link classifyFlowRefusal}
 * returns `undefined` for a refusal the producer did not classify, and the two
 * doors answer that differently on purpose: the trigger door leaves it at
 * today's `200` (it never PROMOTES an exit it was not told about), while
 * `/actions` refuses it, because `200 {success:true,data:{success:false}}` is
 * exactly the double envelope #3962 ruled out for that route. Both readings
 * are stated at their door.
 *
 * ## Read the producer's verdict — never sniff (PD #12)
 *
 * `code` says WHY a dispatch was refused; `status: 'failed'` says how a run
 * that started ended. Those two fields are the whole input. `summary`,
 * `durationMs` and the message text are never consulted — a refused dispatch
 * that happens to carry a failed run's incidental fields is still a refused
 * dispatch, and a regex over the engine's prose is the tolerant-consumer shape
 * the platform forbids.
 *
 * ⚠️ **Ordering: the never-dispatched arms come FIRST.** They are exclusive of
 * the `status: 'failed'` arm today (a refused dispatch has no lifecycle
 * verdict), so the order is not load-bearing for correctness — but it states
 * the intended precedence, and it keeps a future producer that stamped both by
 * mistake from being reported as a run that failed, which is the wrong of the
 * two answers.
 */

import type { AutomationResult } from '@objectstack/spec/contracts';

/**
 * The codes this table answers with. All three are ADR-0112 registered under
 * `@objectstack/runtime` in `ERROR_CODE_LEDGER` — ⛔ nothing here mints one,
 * and a fourth row would be a spec-seat widening, never a call-site decision
 * (the #9384 ruling).
 */
export type FlowRefusalCode = 'FLOW_DISABLED' | 'FLOW_NO_START_NODE' | 'FLOW_FAILED';

/** One row of the table, resolved against a real result. */
export interface FlowRefusal {
    /** The HTTP status this row answers with. */
    readonly status: 400 | 409 | 422;
    /** The ADR-0112 `error.code` this row answers with. */
    readonly code: FlowRefusalCode;
    /**
     * The producer's own words when it wrote any, else this row's default.
     * The engine names the flow in its disabled message and does not in its
     * start-node one, so the defaults name it for both — an operator reading a
     * refusal needs to know WHICH flow was refused.
     */
    readonly message: string;
}

/**
 * The table's first row. Answered by a registry probe rather than by reading a
 * result, because the engine's not-found exit carries neither a `code` nor a
 * `status` — telling it apart from any other unclassified refusal would take a
 * regex over its message, which is the one thing this table refuses to do.
 */
export const FLOW_NOT_FOUND_STATUS = 404;

/** The 404 row's message. Named, so the caller knows WHICH name failed to resolve. */
export function flowNotFoundMessage(flowName: string): string {
    return `Flow '${flowName}' not found`;
}

/**
 * Whether this automation service can be asked about `flowName` and answers
 * that it holds no such flow — the SAME optional `getFlow` probe
 * `POST /:name/toggle` (#7535) and `GET /:name` use, so no two doors can
 * disagree about which flows exist.
 *
 * `getFlow` is optional on `IAutomationService`. An implementation that omits
 * it cannot be asked, so this answers `false` — "no evidence of absence" — and
 * the caller dispatches as before rather than inventing a 404 it has no
 * grounds for.
 */
export async function flowIsUnknown(automation: unknown, flowName: string): Promise<boolean> {
    const svc = automation as { getFlow?: (name: string) => Promise<unknown> } | null | undefined;
    if (typeof svc?.getFlow !== 'function') return false;
    return !(await svc.getFlow(flowName));
}

/**
 * The three result-borne rows: which HTTP answer this engine result declares,
 * or `undefined` when the producer classified nothing (see the module note on
 * why that is deliberately not a row).
 *
 * `flowName` is used ONLY to fill a row's default message when the producer
 * wrote none; it never affects the classification.
 */
export function classifyFlowRefusal(
    flowName: string,
    result: AutomationResult | null | undefined,
): FlowRefusal | undefined {
    if (!result || typeof result !== 'object' || result.success !== false) return undefined;
    const message = typeof result.error === 'string' && result.error ? result.error : undefined;

    // ── never dispatched: the producer says WHICH refusal (#9415) ──────────
    if (result.code === 'FLOW_DISABLED') {
        return {
            status: 409,
            code: 'FLOW_DISABLED',
            message: message ?? `Flow '${flowName}' is disabled`,
        };
    }
    if (result.code === 'FLOW_NO_START_NODE') {
        return {
            status: 422,
            code: 'FLOW_NO_START_NODE',
            message: message ?? `Flow '${flowName}' has no start node`,
        };
    }

    // ── dispatched and rejected: the producer's lifecycle verdict (#9378) ──
    if (result.status === 'failed') {
        return { status: 400, code: 'FLOW_FAILED', message: message ?? 'Flow run failed' };
    }

    return undefined;
}
