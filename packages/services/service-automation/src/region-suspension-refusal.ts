// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { markGuardRefusal } from './guard-refusal.js';

/**
 * The "a structured region body durably suspended" refusal (#18881, ruling D on
 * #15646 — director batch #153 item 1).
 *
 * ## The limit this makes loud
 *
 * An ADR-0031 region body — a `loop` body, a `parallel` branch, a `try_catch`
 * try or catch region, at any depth — runs SYNCHRONOUSLY inside the enclosing
 * run. It cannot park that run on a durable pause. #3267 ruled that limit 禁
 * rather than a gap to be filled, and #18688 landed the authoring-time half in
 * `packages/spec`: `screen` / `wait` / `approval` / `approval_revise` / `end`
 * are refused inside a region body by TYPE.
 *
 * Two node types are deliberately NOT refused there, and they are the reason
 * this module exists. Whether a `map` or a `subflow` pauses is decided by the
 * child flow record its `config.flowName` names — a DIFFERENT metadata record,
 * not in hand at parse — so refusing them by type would also refuse
 * `loop { map(synchronous child) }`, a shape that runs correctly today and that
 * #15616's regression suite pins. The pause is therefore knowable only at RUN
 * time, and only the run can refuse it.
 *
 * ## Why a dedicated error and not the plain `Error` this replaces
 *
 * `runRegion` already converted a region-contained suspension — into a plain
 * `Error`, which is indistinguishable from a node that simply failed. Measured
 * on the card's own reproduction, `loop { try_catch { map(pausing child) } }`:
 * the enclosing `try_catch` read that error as "the try region failed", ran its
 * catch handler, and the RUN REPORTED SUCCESS. The `map`'s progress state
 * (`<nodeId>.$mapState`) stayed behind in the enclosing scope, so iteration 2
 * read `started === collection.length`, ran nothing, and reported success
 * again: `summary.failed = 0` over a sweep that processed nothing. A sweep that
 * reports green having done nothing is the worst available failure.
 *
 * Three properties close that, and each is a property of THIS type rather than
 * of the message text:
 *
 *  1. **It is recognisable.** The container executors (`try_catch`,
 *     `parallel`) test for it and re-throw instead of handling it, so no region
 *     can contain it and no run can report success over it. A plain `Error`
 *     offers nothing to test for short of a regex over its message, which is
 *     the tolerant-consumer shape Prime Directive #12 forbids.
 *  2. **It is un-routable.** It is branded as a #3863 guard refusal, so a
 *     `fault` edge on the enclosing container cannot route it either — the
 *     one-edge switch that would otherwise re-open the same silence.
 *  3. **It NAMES the three things an operator needs**: the region node that
 *     could not carry the pause, the node inside it that suspended, and the
 *     sub-flow whose pause it was. The names are structured FIELDS as well as
 *     message text, so a reader never has to parse the sentence.
 *
 * ⛔ It carries no `error.code` of its own. The closed `ERROR_CODE_LEDGER` that
 * governs that vocabulary (ADR-0112) lives in `packages/spec`, and the step this
 * refusal produces keeps the `EXECUTION_ERROR` code every thrown node failure
 * has always carried — the refusal is named by its TYPE and its fields, which
 * is what the ruling asks for.
 *
 * @see `guard-refusal.ts` — the same idiom (its own module, because both ends
 * need it and `engine.ts` may not be imported back from a built-in executor).
 */
export interface RegionSuspensionRefusalFacts {
    /** The container node whose region body could not carry the pause. */
    readonly regionNodeId: string;
    /** Which body it was: `loop-body`, `parallel-branch`, `try`, `catch`. */
    readonly regionKind: string;
    /** The node inside that body which asked to suspend. */
    readonly suspendedNodeId: string;
    /**
     * The child flow whose pause propagated up — a `map` / `subflow` node's
     * `config.flowName`.
     *
     * `undefined` only when the suspending node names no child flow (a
     * plugin-registered pausing type, invisible to #18688's parse because
     * ADR-0018 leaves the node-type namespace open). Recorded honestly as
     * absent rather than filled in with invented text.
     */
    readonly subFlowName?: string;
}

const REGION_SUSPENSION_REFUSAL: unique symbol = Symbol.for(
    'objectstack.automation.regionSuspensionRefusal',
) as never;

/**
 * The refusal itself — an `Error`, so every existing reader of a failed run
 * (`err instanceof Error ? err.message : String(err)`, the run log's
 * `EXECUTION_ERROR` step, `$error`) keeps working with no arm of its own.
 */
export class FlowRegionSuspensionRefusalError extends Error implements RegionSuspensionRefusalFacts {
    readonly regionNodeId: string;
    readonly regionKind: string;
    readonly suspendedNodeId: string;
    readonly subFlowName?: string;

    constructor(facts: RegionSuspensionRefusalFacts) {
        super(describeRegionSuspensionRefusal(facts));
        this.name = 'FlowRegionSuspensionRefusalError';
        this.regionNodeId = facts.regionNodeId;
        this.regionKind = facts.regionKind;
        this.suspendedNodeId = facts.suspendedNodeId;
        if (facts.subFlowName !== undefined) this.subFlowName = facts.subFlowName;
        Object.defineProperty(this, REGION_SUSPENSION_REFUSAL, {
            value: true,
            enumerable: false,
            configurable: false,
            writable: false,
        });
        markGuardRefusal(this);
    }
}

/**
 * The sentence, built in one place so the three names can never disagree with
 * the fields beside them.
 *
 * It states the limit, then WHY the run is failed rather than continued, then
 * the one move that fixes the flow — the same three parts #18688's parse-time
 * message gives for the node types a parse CAN see, so an author who meets
 * either door reads the same prescription.
 */
function describeRegionSuspensionRefusal(facts: RegionSuspensionRefusalFacts): string {
    const child = facts.subFlowName !== undefined
        ? `sub-flow '${facts.subFlowName}'`
        : 'no sub-flow (the node pauses on its own)';
    return (
        `durable pause inside a structured region: node '${facts.suspendedNodeId}' (${child}) suspended `
        + `inside the '${facts.regionKind}' region of node '${facts.regionNodeId}'. A region body runs `
        + 'synchronously inside the enclosing run and cannot carry a durable pause. The run is FAILED '
        + 'rather than continued: the suspending node has already written its progress state into the '
        + 'enclosing scope, so a contained refusal would leave residue that a later entry reads back as '
        + 'progress — the run would then report success having processed nothing. Move the pausing node '
        + "onto the top-level graph and route the region's exit to it; when the work must repeat per item, "
        + 'make the top-level graph the repeating construct rather than nesting the pause.'
    );
}

/**
 * Refuse a region-contained durable suspension.
 *
 * The one constructor call site outside this module is `runRegion`, which is
 * the single boundary every region body unwinds through.
 */
export function refuseRegionSuspension(
    facts: RegionSuspensionRefusalFacts,
): FlowRegionSuspensionRefusalError {
    return new FlowRegionSuspensionRefusalError(facts);
}

/**
 * True when `err` is this refusal.
 *
 * Duck-typed on a registered symbol rather than `instanceof`, matching
 * `isGuardRefusal` / `isSuspendSignal`: the package ships ESM and CJS builds
 * from one source, and a cross-realm `instanceof` is exactly the check that
 * silently answers `false` — which here would mean a container swallowing the
 * refusal again.
 */
export function isRegionSuspensionRefusal(err: unknown): err is FlowRegionSuspensionRefusalError {
    return (
        !!err
        && typeof err === 'object'
        && (err as Record<PropertyKey, unknown>)[REGION_SUSPENSION_REFUSAL] === true
    );
}
