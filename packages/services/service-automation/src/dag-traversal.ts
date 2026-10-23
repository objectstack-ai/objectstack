// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The DAG traversal of {@link AutomationEngine}: how a run executes a node,
 * follows its out-edges, runs a region, runs one attempt, seeds a run's
 * variables, and evaluates a condition or a value envelope.
 *
 * [#25222] Slices 3 and 4 of the `engine.ts` split, move-only. Each function
 * here is the body of the `AutomationEngine` method of the same name, moved
 * unedited. The class keeps that method (its name, docblock and position are
 * in the published `.d.ts`) and calls the body with a {@link DagTraversalHost}
 * literal holding exactly the members the body reads; a body that reads no
 * member is called directly. An async method's stub is no longer `async`: it
 * returns the promise the moved function makes.
 */

import type { FlowParsed, FlowNodeParsed, FlowEdgeParsed, FlowRegionParsed } from '@objectstack/spec/automation';
import { findRegionEntry } from '@objectstack/spec/automation';
import type { AutomationContext, AutomationResult } from '@objectstack/spec/contracts';
import { isGuardRefusal } from './guard-refusal.js';
import { attachCarriedRefusal, readCarriedRefusal } from './inner-refusal.js';
import { summarizeRun } from './run-summary.js';
import { describeThrownForLog } from './thrown-cause-diagnostics.js';
// The values below (`AutomationEngine` for its public static
// `MAX_NODE_REENTRIES`) are read only inside the function bodies, at call time,
// never while a module is evaluating, so the import cycle with ./engine.js is
// safe under ESM live bindings; the tsup bundle is one file and has no cycle.
import {
    AutomationEngine,
    buildRunTrigger,
    DEFAULT_BRANCH_LABEL,
    FlowRefusalSignal,
    FlowSuspendSignal,
    isRefusalSignal,
    isSuspendSignal,
    type ExecutionLogEntry,
    type NodeExecutionResult,
    type StepLogEntry,
} from './engine.js';
import { createEvalUser, type EvalUserParsed } from '@objectstack/spec/identity';
import { structuralConditionRefusal } from '@objectstack/spec/automation';
// [#15137] The `value`-role half of the ledger. Both halves of "is this envelope
// well-formed?" are IMPORTED, never re-spelled here: the shape rule is
// `FlowValueSlotSchema` (spec, #14149; slot-neutral since #19938 — it refuses a
// non-`cel` dialect and the `{ dialect: 'cel' }` with no `source` that
// `validateExpression` reads as "not authored"), and the CEL rule is
// `validateExpression('value', …)` (formula). `registerFlow` and the run-time
// evaluator call the SAME composition
// ({@link AutomationEngine.valueEnvelopeRefusals}), so a flow that registers can
// never be refused at run time and vice versa — for every value slot the ledger
// declares (`assignment.assignments.*`, `create_record` / `update_record`
// `fields.*`).
import { FlowValueSlotSchema, VALUE_ENVELOPE_REFUSAL } from '@objectstack/spec/automation';
// Static import (not a lazy `require`): the engine ships as ESM ("type":"module"),
// where a CommonJS `require('@objectstack/formula')` resolves to tsup's throwing
// `__require` stub. That threw on every CEL evaluation and the catch below
// silently returned `false`, so EVERY start-node / edge condition (record-change
// `previous.*`, `budget > 100000`, …) skipped its flow. A static import binds the
// engine at module load in both ESM and CJS builds.
import { ExpressionEngine, validateExpression } from '@objectstack/formula';
import { readPartialSteps } from './partial-steps.js';
import { isRegionSuspensionRefusal, refuseRegionSuspension } from './region-suspension-refusal.js';

/**
 * The value the flow CEL scope binds as `current_user` for a run (#19939 —
 * the maintainer's ruling on its second pass, Q1 A and Q2 A): the run's
 * `EvalUser` when the run has a user, else `null`.
 *
 * Built through `createEvalUser`, the one factory every surface builds the
 * canonical user with (ADR-0068), from what the run context holds and
 * nothing else: `id` from `userId`, `positions`, and `organizationId` from
 * `tenantId`; `isPlatformAdmin` is derived from the positions there. Neither
 * an email nor a name is bound (Q2 A enumerates the four above). A
 * `runAs:'user'` run's context does carry the user's email
 * (`AutomationContext.email`, seeded at run setup), but for its data
 * operations' row policies, which read it as `current_user.email` through
 * `resolveRunDataContext`; it is not a CEL fact here, and a `runAs:'system'`
 * run carries none. A flow that needs either reads the user record
 * (`current_user.id`).
 *
 * A run with no user — a schedule, a record change made by a system write, a
 * caller that passed no context — answers `null`, never a pseudo-user
 * (ADR-0118 D1, D4): `current_user.id` then fails the run loudly, and the
 * author's guard `current_user != null ? current_user.id : null` can be
 * written.
 */
export function runUserOf(context: AutomationContext | undefined): EvalUserParsed | null {
    const userId = context?.userId;
    if (typeof userId !== 'string' || userId === '') return null;
    return createEvalUser({
        id: userId,
        positions: Array.isArray(context?.positions) ? context.positions : [],
        ...(typeof context?.tenantId === 'string' ? { organizationId: context.tenantId } : {}),
    });
}

/**
 * Does this `decision` take EVERY out-edge whose condition holds (#15429)?
 * Only an explicit `config.mode: 'inclusive'` says so; an omitted `mode` and
 * `'exclusive'` both mean the first true edge in declaration order wins. Any
 * other value never reaches here — {@link AutomationEngine.registerFlow}
 * refuses it with the spec's prescription.
 */
function decisionTakesEveryBranch(node: FlowNodeParsed): boolean {
    const config = node.config as { mode?: unknown } | undefined;
    return config?.mode === 'inclusive';
}

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those. Methods go as late-bound closures, so a spy or test
 * double set on the instance is still the one called. Fields go by value: each
 * is assigned once, at construction, and never reassigned, so the value passed
 * is the field, including where an async body reads it after an `await`.
 */
export interface DagTraversalHost {
    readonly renderRefusalMessage: AutomationEngine['renderRefusalMessage'];
    readonly nodeExecutors: AutomationEngine['nodeExecutors'];
    readonly executeWithTimeout: AutomationEngine['executeWithTimeout'];
    readonly setNodeError: AutomationEngine['setNodeError'];
    readonly executeNode: AutomationEngine['executeNode'];
    readonly refuseUndeclaredSuspension: AutomationEngine['refuseUndeclaredSuspension'];
    readonly traverseNext: AutomationEngine['traverseNext'];
    readonly logger: AutomationEngine['logger'];
    readonly evaluateCondition: AutomationEngine['evaluateCondition'];
    readonly valueEnvelopeRefusals: AutomationEngine['valueEnvelopeRefusals'];
    readonly celScope: AutomationEngine['celScope'];
    readonly seedDeclaredVariables: AutomationEngine['seedDeclaredVariables'];
    readonly flows: AutomationEngine['flows'];
    readonly isFlowEnabled: AutomationEngine['isFlowEnabled'];
    readonly describeDisabledFlow: AutomationEngine['describeDisabledFlow'];
    readonly nextRunId: AutomationEngine['nextRunId'];
    readonly seedRunVariables: AutomationEngine['seedRunVariables'];
    readonly resolveRunContext: AutomationEngine['resolveRunContext'];
    readonly validateNodeInputSchemas: AutomationEngine['validateNodeInputSchemas'];
    readonly recordLog: AutomationEngine['recordLog'];
    readonly finishRefusedRun: AutomationEngine['finishRefusedRun'];
    readonly persistSuspendedRun: AutomationEngine['persistSuspendedRun'];
}

/** The body of {@link AutomationEngine.executeNode}, moved unedited; that method's docblock is its contract. */
export async function executeNode(
    this: Pick<DagTraversalHost, 'renderRefusalMessage' | 'nodeExecutors' | 'executeWithTimeout' | 'setNodeError' | 'executeNode' | 'refuseUndeclaredSuspension' | 'traverseNext'>,
    node: FlowNodeParsed,
    flow: FlowParsed,
    variables: Map<string, unknown>,
    context: AutomationContext,
    steps: StepLogEntry[],
): Promise<void> {
    if (node.type === 'end') {
        // [#15788] …unless the author declared a REFUSAL here (#14945
        // ruling 2′). `end` has no executor and no descriptor — it is
        // structural (`FLOW_STRUCTURAL_NODE_TYPES`), which is why this
        // method opens by returning on it — so this is the one place the
        // outcome can be read, and until now nothing read it: a flow
        // declaring `outcome: 'refused'` ran as a plain completion and the
        // author's reason reached nobody.
        //
        // The config arrives PARSED. `EndConfigSchema` is applied by
        // `FlowNodeSchema`'s own transform (`parseEndNodeConfig`, spec
        // lane 1), which runs on every node including the ones nested in a
        // region, so `outcome` is defaulted and a `refused` without a
        // `message` was already refused at the flow parse. ⛔ No second
        // door, no `??` default, no re-parse: this reads a contract that is
        // already enforced rather than defending against it.
        const endConfig = node.config as { outcome?: string; message?: string } | undefined;
        if (endConfig?.outcome === 'refused') {
            throw new FlowRefusalSignal(
                node.id,
                // The SAME rendering a screen `description` gets — the
                // ruling's words, one implementation (`renderTextSlot`, the
                // `{{ }}` text renderer since #22110).
                // Rendered HERE, against the live variable map, because
                // that is what makes the text per-record; a template on the
                // wire would put the rendering in every runner.
                // [#22450] …in the run's language: the TEMPLATE is picked
                // before it is rendered, because the run stores the
                // rendered text and nothing downstream can translate it.
                this.renderRefusalMessage(flow.name, node.id, endConfig.message, variables, context),
            );
        }
        return;
    }

    // ADR-0044 runaway guard: declared back-edges make re-entering a node
    // legal, so a misauthored unconditional loop could otherwise spin
    // forever. Count this node's prior *top-level* visits in the run's step
    // log (region body steps carry `parentNodeId` and are excluded — a
    // 200-iteration `loop` region is legitimate) and fail the run loudly
    // past the cap. Product-level guards (e.g. an approval node's
    // `maxRevisions`) terminate far earlier; this is the engine backstop.
    //
    // A `skipped` step is NOT a visit (#4354): those entries record a gate
    // that closed in FRONT of a node, so counting them would let a flow whose
    // gate refuses often abort itself as a runaway — a new observability
    // signal changing execution semantics, which it must never do.
    const priorVisits = steps.reduce(
        (n, s) =>
            s.nodeId === node.id && s.parentNodeId === undefined && s.status !== 'skipped'
                ? n + 1
                : n,
        0,
    );
    if (priorVisits >= AutomationEngine.MAX_NODE_REENTRIES) {
        throw new Error(
            `Node '${node.id}' was entered ${priorVisits} times in one run — aborting as a runaway loop ` +
            `(back-edge cycles must terminate; see ADR-0044)`,
        );
    }

    const stepStart = Date.now();
    const stepStartedAt = new Date().toISOString();

    // Find executor
    const executor = this.nodeExecutors.get(node.type);
    if (!executor) {
        // start node without executor is fine — just skip
        if (node.type !== 'start') {
            steps.push({
                nodeId: node.id,
                nodeType: node.type,
                status: 'failure',
                startedAt: stepStartedAt,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - stepStart,
                error: { code: 'NO_EXECUTOR', message: `No executor registered for node type '${node.type}'` },
            });
            throw new Error(`No executor registered for node type '${node.type}'`);
        }
        // Log start node step
        steps.push({
            nodeId: node.id,
            nodeType: node.type,
            status: 'success',
            startedAt: stepStartedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stepStart,
        });
    } else {
        // Execute node with optional timeout
        let result: NodeExecutionResult;
        try {
            if (node.timeoutMs && node.timeoutMs > 0) {
                result = await this.executeWithTimeout(
                    executor.execute(node, variables, context),
                    node.timeoutMs,
                    node.id,
                );
            } else {
                result = await executor.execute(node, variables, context);
            }
        } catch (execErr: unknown) {
            const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
            // [#18881] ONE region refusal is ONE failure. The refusal names
            // the region node whose body could not carry the pause, and
            // that node's own frame records it exactly as any other thrown
            // failure does. Every ENCLOSING container the unwind passes
            // through — the `loop` around the `try_catch` in the card's
            // reproduction — records nothing: it did not fail, it is the
            // frame a failure is travelling out through, and a step for it
            // would make `summary.failed` count the NESTING DEPTH rather
            // than the fault. `summary.failed` is `Σ nodes[].failures`
            // (#14456), so a second step here reads as a second lost row to
            // every operator and every #4354 reader.
            //
            // Keyed on the refusal's OWN `regionNodeId` rather than on a
            // mutable "already reported" flag: the identity is decided once
            // at the boundary that raised it and cannot drift as the error
            // travels.
            const enclosingFrameOfRegionRefusal =
                isRegionSuspensionRefusal(execErr) && execErr.regionNodeId !== node.id;
            if (!enclosingFrameOfRegionRefusal) {
                steps.push({
                    nodeId: node.id,
                    nodeType: node.type,
                    status: 'failure',
                    startedAt: stepStartedAt,
                    completedAt: new Date().toISOString(),
                    durationMs: Date.now() - stepStart,
                    error: { code: 'EXECUTION_ERROR', message: errMsg },
                });
            }

            // #13803 — a structured container that DIED mid-body still did
            // whatever its completed iterations did, and those writes are
            // already in the database. Fold the body steps it carried out
            // on the throw into the run log, in the same position the
            // success path splices `childSteps`: right behind the
            // container's own step, ahead of any `fault` handler's steps.
            //
            // Without this the record was lost twice over — the run log
            // kept no trace of the completed iterations, and the #4354
            // summary folded over that log reported `acted: 0` for a sweep
            // that had genuinely written rows. `acted: 0` on a failed run
            // reads as "nothing happened, safe to re-run", so the summary
            // was wrong in the one direction that causes double-execution.
            //
            // Purely additive to the record: the error is rethrown below
            // untouched, so which failures route, what `$error` holds and
            // what the run reports as its error are all unchanged. Every
            // step folded here carries a `parentNodeId` (set by
            // `runRegion`'s tagger), so the ADR-0044 runaway guard — which
            // counts only top-level visits — cannot see them either.
            const carriedSteps = readPartialSteps(execErr);
            if (carriedSteps?.length) {
                steps.push(...carriedSteps);
            }

            // #14955 — publish the failure BEFORE deciding whether it
            // routes, exactly as the returned-failure arm below does.
            //
            // This write used to sit inside `if (faultEdge)`, and no reason
            // for that was ever recorded: both arms were written in one
            // commit, and only this one conflated "publish the failure" with
            // "route the failure" — the arm below already separated them.
            // The consequence was invisible rather than loud. A node inside a
            // region never has a `fault` edge of its own (the region's
            // synthetic sub-flow carries only the region's own edges — see
            // {@link AutomationEngine.runRegion}), so EVERY thrown failure
            // inside a region left `$error` naming an earlier, unrelated
            // failure. The first reader that cared about `$error`'s freshness
            // — `try_catch`'s `code` binding (commit c5a7448d5) — met it immediately
            // and bound a message and a code that came from two different
            // failures: `{ code: 'DUPLICATE_RECORD', message: "Node 'mk'
            // timed out after 20ms" }`, swallowed by a catch region reading
            // it as "the row is already there", the run reporting success.
            //
            // `{ nodeId, message }` and nothing more: there is no
            // `NodeExecutionResult` on this path, so no `output` and no
            // classified `code` exist to carry — and that absence is the
            // correct answer for a throw, not a reason to leave a stale
            // `code` standing. This is what the documented contract already
            // promised — `{$error}` names the most recent failure
            // (`content/docs/automation/flows.mdx`) — and now holds.
            //
            // Publishing is not routing: the guard-refusal rule below is
            // untouched and still decides, alone, which failures a `fault`
            // edge may carry. Nor is the thrown value touched — `execErr` is
            // rethrown below exactly as caught.
            //
            // [#18881] …and it is published for the SAME frames that record
            // a step, for the same reason: an enclosing container the
            // region refusal is travelling out through did not fail, so
            // `{$error}` naming it would be a false sentence about which
            // node produced the run's failure. The region node's own frame
            // publishes, as any failing node does.
            if (!enclosingFrameOfRegionRefusal) {
                variables.set('$error', { nodeId: node.id, message: errMsg });
                this.setNodeError(variables, node.id, errMsg);
            }

            // #3863 — a guard that THROWS is as un-routable as one that
            // returns: `UnscopedRunDataAccessError` (ADR-0049/#1888) reports
            // that the metadata would run unscoped, and rerouting it would
            // let a `fault` edge disable the elevation check.
            const faultEdge = isGuardRefusal(execErr)
                ? undefined
                : flow.edges.find(e => e.source === node.id && e.type === 'fault');
            if (faultEdge) {
                const faultTarget = flow.nodes.find(n => n.id === faultEdge.target);
                if (faultTarget) {
                    await this.executeNode(faultTarget, flow, variables, context, steps);
                    return;
                }
            }
            throw execErr;
        }

        // #6667 — declared = enforced for `supportsPause`, at the ONE seam
        // every suspension passes through.
        //
        // Placed here rather than beside the `throw new FlowSuspendSignal`
        // below on purpose: converting the mismatch into an ordinary guard
        // refusal *before* the success bookkeeping means the run records a
        // `failure` step for the offending node (not a `success` step
        // followed by an unexplained failed run), sets `$error` like any
        // other refusal, and inherits #3863's un-routability — a `fault`
        // edge must not be able to swallow a declaration defect, since
        // re-running the flow unchanged can never fix one.
        //
        // Exactly once, and nothing bypasses it: this is the only call site
        // of any `executor.execute()` that the engine acts on — the ADR-0018
        // alias path delegates and RETURNS its target's result here rather
        // than suspending on its own, `resume()` re-enters through
        // {@link executeNode}, and region bodies ({@link runRegion}) do too.
        if (result.success && result.suspend === true) {
            result = this.refuseUndeclaredSuspension(node.type) ?? result;
        }

        if (!result.success) {
            const errMsg = result.error ?? 'Unknown error';
            steps.push({
                nodeId: node.id,
                nodeType: node.type,
                status: 'failure',
                startedAt: stepStartedAt,
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - stepStart,
                error: { code: 'NODE_FAILURE', message: errMsg },
                ...(result.warnings?.length ? { warnings: result.warnings } : {}),
                // #4354 — a node that failed PART WAY may still have written
                // rows; dropping its counts would understate what the run did.
                ...(result.metrics ? { metrics: result.metrics } : {}),
            });

            // #14184 — the returned-failure half of #13803's fold. A
            // container that RETURNS its failure (rather than throwing it)
            // never reached the splice below, because that one runs only
            // after a successful result. `try_catch` with no `catch` region
            // is exactly that shape: it catches the try region's failure and
            // returns it, so its completed try-region steps were dropped on
            // the floor and the #4354 summary reported `acted: 0` over rows
            // that had genuinely been written.
            //
            // Same position as the throw arm's fold and the success path's
            // splice: right behind the container's own step, ahead of any
            // `fault` handler's steps. #13803 left this branch alone because
            // no executor then returned `childSteps` on a failing result;
            // `try_catch` is that producer, and it is still the only one.
            //
            // Additive to the record only — the failure step above, the
            // `$error` write below, the guard-refusal routing rule and the
            // rethrow are all untouched. Every folded step carries a
            // `parentNodeId` (set by `runRegion`'s tagger), so the ADR-0044
            // runaway guard, which counts only top-level visits, cannot see
            // them either.
            if (result.childSteps?.length) {
                steps.push(...result.childSteps);
            }

            // Write error output to variable context for downstream nodes.
            // Commit c5a7448d5 — carry the executor's classified `code` (when it set
            // one) alongside `message`, so a `fault` edge handler reading
            // `{$error.code}` can branch on it; a `try_catch` region reads
            // this same node-level `$error` before its OWN `errorVariable`
            // write can shadow it (see try-catch-node.ts).
            variables.set('$error', {
                nodeId: node.id,
                message: errMsg,
                output: result.output,
                ...(result.code ? { code: result.code } : {}),
            });
            this.setNodeError(variables, node.id, errMsg);

            // #3863 — only a `runtime` failure may be routed. A `guard`
            // refusal says the METADATA is wrong (#3810 erased a filter
            // condition, a data node names no object); rerouting it would
            // make a single `fault` edge a switch that turns the guard off
            // while the run still reports success.
            const faultEdge = result.errorClass === 'guard'
                ? undefined
                : flow.edges.find(e => e.source === node.id && e.type === 'fault');
            if (faultEdge) {
                const faultTarget = flow.nodes.find(n => n.id === faultEdge.target);
                if (faultTarget) {
                    await this.executeNode(faultTarget, flow, variables, context, steps);
                    return;
                }
            }
            // [#24914, ruling B′] The text is unchanged — it is the run's
            // diagnostic, read by the run log, `failAncestors`, approvals
            // and every door's `message`. What the node's data call met is
            // carried BESIDE it, on a brand (`inner-refusal.ts`), to the
            // terminal exit that builds the run's result.
            throw attachCarriedRefusal(new Error(`Node '${node.id}' failed: ${errMsg}`), result);
        }

        // Log successful step (#3407: advisory executor warnings ride along
        // so a legal-but-partial outcome never reads as a clean success;
        // #4354: the executor's own record counts ride along too, so the run
        // summary can tell a sweep that had nothing to do from one that did
        // nothing).
        steps.push({
            nodeId: node.id,
            nodeType: node.type,
            status: 'success',
            startedAt: stepStartedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stepStart,
            ...(result.warnings?.length ? { warnings: result.warnings } : {}),
            ...(result.metrics ? { metrics: result.metrics } : {}),
        });

        // #1479: fold a structured-region container's body/branch/handler
        // steps into the run log, right after the container's own step.
        if (result.childSteps?.length) {
            steps.push(...result.childSteps);
        }

        // Write back output variables
        if (result.output) {
            for (const [key, value] of Object.entries(result.output)) {
                variables.set(`${node.id}.${key}`, value);
            }
        }

        // [#18110 / #18555] Terminal refusal: the node evaluated and the
        // answer is no. Thrown from HERE — the position the suspend signal
        // below is thrown from — and that position is the point of the
        // design, not a convenience: the node's success step is already
        // pushed, its `childSteps` are already folded and its output is
        // already written back, so a refusing `subflow` / `map` keeps the
        // child's #4354 rollup (`selected` / `acted` / `unmeasuredEffect`)
        // in the run summary. An unwind that began any earlier would drop
        // exactly those counts — a refusing child really can have written
        // rows before it said no.
        //
        // The step stays a SUCCESS on purpose: the node did evaluate, and
        // what it evaluated to is the run's outcome, not this step's. The
        // three terminal exits (`execute` / `resumeInternal` /
        // `executeWithoutRetry`) already convert the signal into a
        // `refused` run through the one `finishRefusedRun` chokepoint, so
        // nothing downstream of here needed a second arm.
        //
        // Ahead of `suspend` deliberately — see `NodeExecutionResult.refuse`
        // for why a result carrying both refuses rather than pausing.
        if (result.refuse) {
            throw new FlowRefusalSignal(node.id, result.refusalMessage);
        }

        // ADR-0019 durable pause: the node did its on-entry work and asked to
        // suspend here. Output is already written above; unwind the recursion
        // up to execute()/resume(), which persists a continuation. Traversal
        // of this node's out-edges happens on resume, not now.
        if (result.suspend) {
            throw new FlowSuspendSignal(node.id, result.correlation, result.screen, node.type);
        }

        // #3447 P2: an executor may pick its own out-edge without suspending
        // (e.g. an approval node auto-approving an empty slate walks its
        // `approve` edge directly). The field predates this — it was declared
        // on NodeExecutionResult "for decision nodes" but never consumed on
        // the synchronous path; only resume() honoured its signal twin. On a
        // labelled-edge node, falling through to the unlabelled traversal
        // would walk EVERY unconditional out-edge (approve AND reject), so
        // the label must be honoured here.
        if (result.branchLabel) {
            await this.traverseNext(node, flow, variables, context, steps, result.branchLabel);
            return;
        }
    }

    // Continue to the node's successors.
    await this.traverseNext(node, flow, variables, context, steps);
}

/** The body of {@link AutomationEngine.traverseNext}, moved unedited; that method's docblock is its contract. */
export async function traverseNext(
    this: Pick<DagTraversalHost, 'logger' | 'evaluateCondition' | 'executeNode'>,
    node: FlowNodeParsed,
    flow: FlowParsed,
    variables: Map<string, unknown>,
    context: AutomationContext,
    steps: StepLogEntry[],
    branchLabel?: string,
): Promise<void> {
    // Find next nodes — separate conditional, default and unconditional edges
    const allOutEdges = flow.edges.filter(
        e => e.source === node.id && e.type !== 'fault',
    );
    let outEdges = allOutEdges;

    // Branch selection: prefer edges tagged with the decision label.
    if (branchLabel) {
        let claimed = outEdges.filter(e => e.label === branchLabel);
        // The `default` sentinel is also claimed by the BPMN default edge, so
        // "none of my conditions matched" routes to the declared fallback
        // without the author having to ALSO label that edge 'default'.
        if (claimed.length === 0 && branchLabel === DEFAULT_BRANCH_LABEL) {
            claimed = outEdges.filter(e => e.isDefault);
        }
        if (claimed.length > 0) {
            outEdges = claimed;
        } else {
            // #4414 — do not fall back silently. The node computed a branch
            // and no out-edge claims it, so every out-edge is about to be
            // considered: the guard the author wrote is not guarding.
            //
            // #6654 — the computed branch label is potentially
            // RECORD-DERIVED and the edge labels are FLOW-AUTHOR metadata
            // (neither is schema-constrained against newlines), so both
            // ride the structured slot, never the message; see
            // `forgetSuspendedRun`'s catch for the full mechanism (#6299).
            // #4632: FUNCTIONAL — stays `warn`.
            this.logger.warn(
                // `flow.name` is absent on the synthetic view `runRegion` builds.
                `Flow '${flow.name ?? '(region)'}' node '${node.id}' (${node.type}) selected a branch, ` +
                `but no out-edge carries that label — the computed branch and the out-edge labels are ` +
                `in this record's meta. The branch selection is IGNORED and every out-edge is ` +
                `evaluated instead, so unconditional siblings run regardless of the decision. ` +
                `Make an out-edge's \`label\` match the branch, or mark the fallback edge ` +
                `\`isDefault: true\`.`,
                {
                    branchLabel,
                    outEdges: allOutEdges.map(e => ({ id: e.id, label: e.label ?? null })),
                },
            );
        }
    }

    const conditionalEdges: FlowEdgeParsed[] = [];
    const defaultEdges: FlowEdgeParsed[] = [];
    const unconditionalEdges: FlowEdgeParsed[] = [];
    for (const edge of outEdges) {
        if (edge.condition) {
            conditionalEdges.push(edge);
        } else if (edge.isDefault) {
            defaultEdges.push(edge);
        } else {
            unconditionalEdges.push(edge);
        }
    }

    // #4354 — a gate that did not open leaves a trace. Record it: this is
    // THE event that had no trace anywhere, and the reason #4347 shipped
    // three inert production flows. A closed gate inside a loop body is
    // logged once per iteration (region tagging in `runRegion` attaches the
    // container + iteration), so the run summary can say "selected 30,
    // acted 0, skipped 30 by <gate>" instead of reporting a green run that
    // did nothing.
    //
    // The step is `skipped`, never a run: the re-entrancy guard, per-node
    // `runs` counts and node status all exclude it, so recording a
    // non-event stays a non-event to execution.
    const recordSkipped = (nextNode: FlowNodeParsed, edge: FlowEdgeParsed): void => {
        const at = new Date().toISOString();
        steps.push({
            nodeId: nextNode.id,
            nodeType: nextNode.type,
            ...(nextNode.label ? { nodeLabel: nextNode.label } : {}),
            status: 'skipped',
            startedAt: at,
            completedAt: at,
            durationMs: 0,
            skippedBy: {
                nodeId: node.id,
                ...(edge.id ? { edgeId: edge.id } : {}),
                ...(edge.label ? { label: edge.label } : {}),
            },
        });
    };

    // Conditional edges: evaluated sequentially, in the order the flow's
    // `edges` array declares them — `FlowSchema.parse` and every conversion
    // are copy-on-write maps that never reorder, so declaration order here
    // IS the author's.
    //
    // On a `decision` node they are the gateway's branches, and the gateway
    // is EXCLUSIVE unless it declares `config.mode: 'inclusive'` (#15429,
    // maintainer ruling 「跟主流对齐」): the FIRST edge whose condition holds
    // is the branch — the BPMN exclusive gateway, Salesforce Flow's
    // Decision, n8n's Switch default — and its later siblings are not
    // evaluated at all; they record the same `skipped` step a closed gate
    // does, so the run log says which branch won and which were passed
    // over. Until this change every true edge ran, one after another, under
    // a comment calling that "mutually exclusive": hotcrm#1555 rendered a
    // refusal screen AND ran the conversion in one execution. Authored
    // sources written against that behaviour are carried across by the
    // ADR-0087 conversion `flow-decision-mode-inclusive-explicit` (`os
    // migrate meta --from 17`), which writes the inclusive declaration onto
    // them — see `CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION` for why this seam
    // does not. A flow stored in `sys_metadata` arrives here as stored and
    // takes THIS reading (maintainer ruling letter C on #15429: no
    // stored-row rewrite, no read-path completion); `os migrate meta
    // --stored` lists such decisions for an operator to review.
    //
    // `mode: 'inclusive'` is the BPMN inclusive gateway: every edge whose
    // condition holds runs, one successor at a time (never `Promise.all` —
    // that fan-out belongs to the UNCONDITIONAL bucket below alone).
    //
    // Scoped to `decision` on purpose: `mode` is a decision-config key, and
    // conditioned out-edges of any other node type keep the traversal they
    // had — every one whose condition holds, sequentially. The ruling and
    // its migration cover the gateway, and nothing else was measured to
    // carry two conditioned out-edges (the corpus census on #15429).
    const exclusive = node.type === 'decision' && !decisionTakesEveryBranch(node);
    let anyConditionMet = false;
    for (const edge of conditionalEdges) {
        const nextNode = flow.nodes.find(n => n.id === edge.target);
        if (exclusive && anyConditionMet) {
            // A sibling already won: passed over, not evaluated.
            if (nextNode) recordSkipped(nextNode, edge);
            continue;
        }
        if (this.evaluateCondition(edge.condition!, variables, context)) {
            anyConditionMet = true;
            if (nextNode) {
                await this.executeNode(nextNode, flow, variables, context, steps);
            }
        } else if (nextNode) {
            recordSkipped(nextNode, edge);
        }
    }

    // Default edges (BPMN default flow, #4414): the fallback, taken only
    // when NO conditional sibling matched. `isDefault` is what makes this an
    // "otherwise" rather than a second unconditional path — without it the
    // author's only spelling of "otherwise" was to hand-write the negation
    // of every sibling condition, and forgetting to do that ran both
    // branches. A default edge passed over because a real branch won records
    // the same `skipped` trace a closed gate does (#4354).
    for (const edge of defaultEdges) {
        const nextNode = flow.nodes.find(n => n.id === edge.target);
        if (!anyConditionMet) {
            if (nextNode) {
                await this.executeNode(nextNode, flow, variables, context, steps);
            }
        } else if (nextNode) {
            const at = new Date().toISOString();
            steps.push({
                nodeId: nextNode.id,
                nodeType: nextNode.type,
                ...(nextNode.label ? { nodeLabel: nextNode.label } : {}),
                status: 'skipped',
                startedAt: at,
                completedAt: at,
                durationMs: 0,
                skippedBy: {
                    nodeId: node.id,
                    ...(edge.id ? { edgeId: edge.id } : {}),
                    ...(edge.label ? { label: edge.label } : {}),
                },
            });
        }
    }

    // Unconditional edges: execute in parallel (Promise.all)
    if (unconditionalEdges.length > 0) {
        const parallelTasks = unconditionalEdges
            .map(edge => flow.nodes.find(n => n.id === edge.target))
            .filter((n): n is FlowNodeParsed => n != null)
            .map(nextNode => this.executeNode(nextNode, flow, variables, context, steps));

        await Promise.all(parallelTasks);
    }
}

/** The body of {@link AutomationEngine.runRegion}, moved unedited; that method's docblock is its contract. */
export async function runRegion(
    this: Pick<DagTraversalHost, 'executeNode'>,
    region: FlowRegionParsed,
    variables: Map<string, unknown>,
    context: AutomationContext,
    grouping?: { parentNodeId: string; iteration?: number; branch?: number; regionKind?: string; retryAttempt?: number },
    partialSteps?: StepLogEntry[],
): Promise<StepLogEntry[]> {
    const entryId = findRegionEntry(region);
    const entry = region.nodes.find(n => n.id === entryId);
    if (!entry) {
        throw new Error(`region entry node '${entryId}' not found`);
    }
    // A synthetic flow view — executeNode/traverseNext only read `nodes`/`edges`.
    const subFlow = { nodes: region.nodes, edges: region.edges ?? [] } as unknown as FlowParsed;
    const regionSteps: StepLogEntry[] = [];
    // Tag this region's steps with their container. Shared by the success
    // and failure paths (#7546) so a failed attempt's steps are
    // indistinguishable in SHAPE from a successful one's — they differ only
    // in their own `status`.
    //
    // #15230 splits what "innermost wins" governs, because the two halves
    // answer different questions:
    //
    //   IDENTITY (`parentNodeId` / `regionKind` / `retryAttempt`) answers
    //   WHICH REGION RAN THIS STEP. Innermost wins outright: a step a
    //   nested region already claimed keeps naming that region, and an
    //   enclosing region must never relabel it.
    //
    //   INDEX (`iteration` / `branch`) answers WHICH PASS OF WHICH REGION.
    //   Nested regions contribute DIFFERENT indices — the loop's row and
    //   the parallel's branch are both true of the same step — so an
    //   enclosing region fills the index the inner one left undefined
    //   instead of being skipped along with the identity fields. That skip
    //   is the defect: `loop { parallel }` used to record the branch and
    //   discard the row.
    //
    // Still "only fills what is undefined" in both halves, so an index a
    // nested region DID set wins: for `loop { loop }` the inner loop's
    // `iteration` stands, exactly as before.
    const tag = (): void => {
        if (!grouping) return;
        for (const step of regionSteps) {
            if (step.parentNodeId === undefined) {
                step.parentNodeId = grouping.parentNodeId;
                if (grouping.regionKind !== undefined) step.regionKind = grouping.regionKind;
                if (grouping.retryAttempt !== undefined) step.retryAttempt = grouping.retryAttempt;
            }
            if (grouping.iteration !== undefined && step.iteration === undefined) {
                step.iteration = grouping.iteration;
            }
            if (grouping.branch !== undefined && step.branch === undefined) {
                step.branch = grouping.branch;
            }
        }
    };
    try {
        await this.executeNode(entry, subFlow, variables, context, regionSteps);
    } catch (err) {
        // #7546: surface what the failed attempt DID get through before
        // rethrowing. Tagged first so the caller receives finished records,
        // and pushed into the caller's sink rather than returned because
        // this path's contract is (still) to throw.
        tag();
        partialSteps?.push(...regionSteps);
        // [#18881] A refusal raised at an INNER region boundary is already
        // the named one, and it is re-thrown untouched. Re-wrapping it here
        // would rename the region: for `loop { try_catch { map } }` the
        // author's fault is the try region, and the loop is only the frame
        // the unwind passes through. Tested before the suspend arm because
        // this error is not a suspend signal and must not reach the generic
        // rethrow below with an enclosing region's identity stamped on it.
        if (isRegionSuspensionRefusal(err)) throw err;
        // [#18881] The runtime half of #15646's ruling D: a region body
        // cannot carry a durable pause, and the refusal is now NAMED
        // (region node, suspending node, sub-flow) instead of a plain
        // `Error` that an enclosing `try_catch` read as an ordinary region
        // failure and handed to its catch handler. See
        // `region-suspension-refusal.ts` for the measurement that is.
        //
        // The sub-flow is read off the suspending node's own `config`
        // (`map` / `subflow` name their child there). The node is looked up
        // in THIS region's `nodes` because this is the innermost boundary
        // the signal crosses — a deeper suspension was already converted by
        // the arm above, so `err.nodeId` always names a node of this body.
        if (isSuspendSignal(err)) {
            const suspended = region.nodes.find(n => n.id === err.nodeId);
            const flowName = (suspended?.config as { flowName?: unknown } | undefined)?.flowName;
            throw refuseRegionSuspension({
                regionNodeId: grouping?.parentNodeId ?? entryId,
                regionKind: grouping?.regionKind ?? 'region',
                suspendedNodeId: err.nodeId,
                ...(typeof flowName === 'string' && flowName ? { subFlowName: flowName } : {}),
            });
        }
        // [#15788] The refusing `end` node's signal, converted at exactly
        // the same boundary and for the same reason: a control signal must
        // not cross a region edge silently. It would not merely leak — the
        // `try_catch` executor's own `catch (err)` arm would read it as the
        // try region FAILING and hand it to the catch handler, so an
        // author's refusal would run the error path and the run would
        // record `completed`. That is the pre-#15788 silence with an extra
        // step, which is worse than a refusal that says so.
        //
        // ⛔ Not a narrowing of anything an author had: today an `end` in a
        // region is a no-op whatever its `outcome`, so the shape being made
        // loud has never once been honoured. Whether a refusal should
        // instead PROPAGATE out of a region and terminate the run is a real
        // question and ⛔ not one this lane rules on — the #14945 ruling
        // says nothing about regions, and "prefer failing to falling back"
        // decides the interim.
        //
        // [#18110 / #18555] The sentence NAMES the node that carried the
        // refusal and nothing more, because there are now two producers: an
        // `end` declaring the refusal itself, and a `subflow` / `map` whose
        // CHILD run refused. Hard-wired to the first, it told an author
        // inside a region to go find an `end` node that is not in their
        // region at all, and handed them a prescription they could not
        // follow. ⛔ TEXT only — region SEMANTICS are untouched (#18112's
        // option B is not implemented, no container is taught to rethrow),
        // and the authoring-time half of this boundary is #15646's, ⛔ not
        // this change's.
        if (isRefusalSignal(err)) {
            throw new Error(
                `a refusal inside a structured region (node '${err.nodeId}') is not supported — a ` +
                `refusal terminates the RUN, and a region body cannot end one. The refusing node is ` +
                `either an 'end' declaring outcome: 'refused', or a node whose own child run refused ` +
                `(a 'subflow' / 'map'). Move that node onto the top-level graph and route the ` +
                `region's exit to it.`,
            );
        }
        throw err;
    }
    tag();
    return regionSteps;
}

/** The body of {@link AutomationEngine.executeWithTimeout}, moved unedited; that method's docblock is its contract. */
export async function executeWithTimeout(
    promise: Promise<NodeExecutionResult>,
    timeoutMs: number,
    nodeId: string,
): Promise<NodeExecutionResult> {
    let guard: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        guard = setTimeout(() => {
            reject(new Error(`Node '${nodeId}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(guard);
    }
}

/** The body of {@link AutomationEngine.celScope}, moved unedited; that method's docblock is its contract. */
export function celScope(
    variables: Map<string, unknown>,
    context?: AutomationContext,
): { extra: Record<string, unknown> } {
    const vars: Record<string, unknown> = {};
    for (const [key, value] of variables) {
        // Convert "step.result" keys into nested object paths.
        const segs = key.split('.');
        let cursor = vars;
        for (let i = 0; i < segs.length - 1; i++) {
            if (typeof cursor[segs[i]] !== 'object' || cursor[segs[i]] === null) {
                cursor[segs[i]] = {};
            }
            cursor = cursor[segs[i]] as Record<string, unknown>;
        }
        cursor[segs[segs.length - 1]] = value;
    }
    // [#22642] No `record` slot: `record` is bound by the spread when the
    // run holds one, and unbound otherwise (see the docblock).
    return { extra: { ...vars, vars, current_user: runUserOf(context) } };
}

/** The body of {@link AutomationEngine.valueEnvelopeRefusals}, moved unedited; that method's docblock is its contract. */
export function valueEnvelopeRefusals(value: unknown): { message: string; source: string }[] {
    // [#16439] Presence, asked before either primitive, because neither can
    // answer it (see rule 0 above). It is stated HERE and not as a guard in
    // {@link evaluateValueEnvelope} deliberately: a reject reason living
    // only on the evaluation side would end the property this method exists
    // for — registration and evaluation refuse ONE set, derived by one call
    // — and the docblock that says so would stop being true.
    //
    // REFUSED rather than admitted, and the asymmetry with the predicate
    // side is deliberate, not an oversight to harmonise away:
    // `structuralConditionRefusal` admits `null` / `undefined` because the
    // condition FIELD is optional, so absence there means "the author wrote
    // no predicate". A value slot's envelope IS the value, so an absent one
    // is a caller handing nothing where a value was required: there is
    // nothing to compute, and — per this method's own ADR-0032 §1c
    // argument — no falsy default for it to hide behind.
    //
    // Measured, so the registration half is not an assumption: the
    // value-role feeder (`resolveFlowNodeExpressions`) emits ONLY
    // envelope-shaped objects and `isExpressionEnvelopeShaped` is false for
    // both shapes, so `registerFlow` never presents a nullish value here.
    // An authored `null` in an `assignments` slot stays what it always was
    // — a literal that parses (`FlowSchema.parse` accepts it) and still
    // registers. This adds nothing to the registration reject set.
    if (value == null) {
        return [{
            message:
                `${VALUE_ENVELOPE_REFUSAL} no envelope was passed: the argument is `
                + `\`${value === null ? 'null' : 'undefined'}\`, so there is nothing to evaluate. An absent `
                + 'envelope is not "not authored" — the predicate side admits absence because the condition '
                + "field is optional, but a value slot's envelope IS the value. Write "
                + "`{ dialect: 'cel', source: '…' }`.",
            source: '',
        }];
    }
    const source = (value as { source?: unknown })?.source;
    const sourceText = typeof source === 'string' ? source : '';
    const shape = FlowValueSlotSchema.safeParse(value);
    if (!shape.success) {
        // Already prefixed with the refusal sentence by the spec's own
        // `superRefine` — re-prefixing would say it twice.
        return shape.error.issues.map((issue) => ({ message: issue.message, source: sourceText }));
    }
    const parsed = validateExpression('value', value as { dialect?: string; source?: string });
    return parsed.errors.map((e) => ({
        message: `${VALUE_ENVELOPE_REFUSAL} ${e.message}`,
        source: e.source,
    }));
}

/** The body of {@link AutomationEngine.evaluateValueEnvelope}, moved unedited; that method's docblock is its contract. */
export function evaluateValueEnvelope(
    this: Pick<DagTraversalHost, 'valueEnvelopeRefusals' | 'celScope'>,
    envelope: { dialect?: string; source?: string; ast?: unknown },
    variables: Map<string, unknown>,
    where: string,
    context?: AutomationContext,
): unknown {
    const refusals = this.valueEnvelopeRefusals(envelope);
    if (refusals.length > 0) {
        throw new Error(
            `${where}: ${refusals.map((r) => r.message).join(' ')} — source: \`${refusals[0].source}\``,
        );
    }
    const source = envelope.source ?? '';
    const result = ExpressionEngine.evaluate({ dialect: 'cel', source }, this.celScope(variables, context));
    if (!result.ok) {
        // Reached by the shapes the two validators above cannot judge — an
        // `ast`-only envelope (`ExpressionSchema` accepts `source`-or-`ast`;
        // the CEL engine evaluates `source` only) and a source that parses
        // but faults on the live values. Loud, with the source attached.
        throw new Error(
            `${where}: value expression failed to evaluate as CEL: ${result.error?.message ?? 'unknown error'} — ` +
            `source: \`${source}\`.`,
        );
    }
    return result.value;
}

/** The body of {@link AutomationEngine.evaluateCondition}, moved unedited; that method's docblock is its contract. */
export function evaluateCondition(
    this: Pick<DagTraversalHost, 'celScope'>,
    expression: string | { dialect?: string; source?: string; ast?: unknown },
    variables: Map<string, unknown>,
    context?: AutomationContext,
): boolean {
    const shapeRefusal = structuralConditionRefusal(expression);
    if (shapeRefusal) {
        // ADR-0032 §1d — the error carries its source. `structuralConditionRefusal`
        // attributes an empty one for the shape it is refusing here (a non-string
        // `source` cannot be the attribution), which is its documented choice.
        throw new Error(
            `condition evaluation error: ${shapeRefusal.message} — source: \`${shapeRefusal.source}\``,
        );
    }

    const isEnvelope = typeof expression === 'object' && expression != null && 'dialect' in expression;
    const dialect = isEnvelope ? (expression as { dialect?: string }).dialect : undefined;
    const exprStr = typeof expression === 'string' ? expression : ((expression as { source?: string })?.source ?? '');

    if (dialect === 'template' || dialect === 'flow') {
        // [#19939] The legacy `{var}` template dialect is deleted (see the
        // doc comment): the same set `registerFlow` refuses at every
        // condition slot, refused here for a caller that skipped it.
        throw new Error(
            `condition evaluation error: a condition is CEL, and the \`${dialect}\` dialect is not evaluated — ` +
            `source: \`${exprStr}\`. Write the predicate as CEL without \`{…}\` template braces ` +
            `(e.g. \`record.status == 'open'\`), as bare text or as \`{ dialect: 'cel', source }\`.`,
        );
    }
    if (isEnvelope && dialect && dialect !== 'cel') {
        // Other dialects (cron, js) are not boolean predicates here.
        return false;
    }

    // An absent / empty condition is not a predicate to evaluate. Callers that
    // mean "unconditional" guard before calling; this is the one that does not
    // (a `decision` node whose `conditions[]` entry has no `expression`), and
    // an unauthored branch must not open.
    if (exprStr.trim() === '') return false;

    // Bind the `vars` scope, so a `$`-named variable or a node output's
    // flat dotted key is read as `vars["…"]`.
    try {
        const result = ExpressionEngine.evaluate(
            { dialect: 'cel', source: exprStr },
            this.celScope(variables, context),
        );
        // ADR-0032 §Decision 1c — NO silent fallback. A non-`ok` result is a
        // real fault (malformed predicate, or — pre build-validation — a
        // `{…}` template mistakenly written into a CEL condition). Surfacing
        // it as a thrown, attributed error makes execute()'s catch record a
        // loud flow failure, instead of the old `return false` that made a
        // broken condition indistinguishable from "condition not met" (#1491).
        if (!result.ok) {
            throw new Error(
                `condition failed to evaluate as CEL: ${result.error?.message ?? 'unknown error'} — ` +
                `source: \`${exprStr}\`. Conditions are bare CEL (e.g. \`record.rating >= 4\`); ` +
                `do not wrap field references in \`{…}\` template braces.`,
            );
        }
        return Boolean(result.value);
    } catch (err) {
        // Re-throw with the source attached (ADR-0032 §1d — errors written
        // for self-correction). Never swallow to `false`.
        const msg = (err as Error)?.message ?? String(err);
        throw new Error(
            msg.includes('source:') ? msg : `condition evaluation error: ${msg} — source: \`${exprStr}\``,
        );
    }
}

/** The body of {@link AutomationEngine.seedDeclaredVariables}, moved unedited; that method's docblock is its contract. */
export function seedDeclaredVariables(
    flow: FlowParsed,
    context?: AutomationContext,
): Map<string, unknown> {
    const variables = new Map<string, unknown>();
    if (!flow.variables) return variables;
    for (const v of flow.variables) {
        const supplied = v.isInput ? context?.params?.[v.name] : undefined;
        if (supplied !== undefined) {
            variables.set(v.name, supplied);
        } else if (v.defaultValue !== undefined) {
            variables.set(v.name, v.defaultValue);
        }
    }
    return variables;
}

/** The body of {@link AutomationEngine.seedRunVariables}, moved unedited; that method's docblock is its contract. */
export function seedRunVariables(
    this: Pick<DagTraversalHost, 'seedDeclaredVariables'>,
    flow: FlowParsed,
    flowName: string,
    context: AutomationContext | undefined,
    runId: string,
): Map<string, unknown> {
    const variables = this.seedDeclaredVariables(flow, context);
    if (context?.record) {
        variables.set('$record', context.record);
        variables.set('record', context.record);
        for (const [k, v] of Object.entries(context.record)) {
            if (!variables.has(k)) variables.set(k, v);
        }
    }
    variables.set('previous', context?.previous ?? null);
    variables.set('$runId', runId);
    variables.set('$flowName', flowName);
    variables.set('$flowLabel', flow.label ?? flowName);
    return variables;
}

/** The body of {@link AutomationEngine.executeWithoutRetry}, moved unedited; that method's docblock is its contract. */
export async function executeWithoutRetry(
    this: Pick<DagTraversalHost, 'flows' | 'isFlowEnabled' | 'describeDisabledFlow' | 'nextRunId' | 'seedRunVariables' | 'resolveRunContext' | 'validateNodeInputSchemas' | 'executeNode' | 'recordLog' | 'logger' | 'finishRefusedRun' | 'persistSuspendedRun'>,
    flowName: string,
    context?: AutomationContext,
): Promise<AutomationResult> {
    const startTime = Date.now();
    const flow = this.flows.get(flowName);

    if (!flow) {
        return { success: false, error: `Flow '${flowName}' not found` };
    }
    if (!this.isFlowEnabled(flowName)) {
        // [#9415] Classified like `execute()`'s own disabled exit, for the
        // same reason #9378 classified this method's failure exit: a
        // selective classification is the one a later reader mistakes for
        // a rule.
        //
        // ⚠️ Defensive, and unreachable through `execute()` today — the
        // outer guard fires first, and `retryExecution` is only entered
        // after it passed. That is exactly why no test pins it: a test
        // driving a disabled flow with `strategy: 'retry'` returns from the
        // OUTER guard and would stay green with this line unclassified.
        // Reachability is what a future change would have to establish;
        // the spelling is already right.
        //
        // [ADR-0126 §7.2] Shares `execute()`'s message builder for the same
        // parity reason: two spellings of one refusal is what #9378 was.
        return { success: false, code: 'FLOW_DISABLED', error: this.describeDisabledFlow(flowName) };
    }

    // [#9704] The SAME environment attempt 1 runs in — seeded through the
    // same chokepoint `execute()` uses. This method used to seed only the
    // declared variables and `$record`, so every retry attempt ran in a
    // strictly smaller environment than the first: `record` and its
    // flattened fields, `previous`, `$runId`, `$flowName` and `$flowLabel`
    // were all absent. Under strict CEL an unbound name ABORTS the
    // predicate rather than yielding false (#4697), so a start condition or
    // edge predicate reading `previous` (#3427) or a bare record field
    // failed on the retry for a reason attempt 1 never hit — a flaky flow,
    // to its author — and a pausing node on a retry attempt had no `$runId`
    // to map its external state back to this run with (ADR-0019).
    const runId = this.nextRunId();
    const variables = this.seedRunVariables(flow, flowName, context, runId);
    const startedAt = new Date().toISOString();
    const steps: StepLogEntry[] = [];

    // ADR-0049 / #1888 — establish the run's effective execution identity
    // from flow.runAs (see execute() / resolveRunContext); threaded below.
    // `flowRunId` is stamped here too (#3456).
    const runContext = await this.resolveRunContext(flow, context, runId);

    try {
        const startNode = flow.nodes.find(n => n.type === 'start');
        if (!startNode) {
            // [#9415] Same classification as `execute()`'s start-node exit,
            // for the reason the disabled exit above states.
            return { success: false, code: 'FLOW_NO_START_NODE', error: 'Flow has no start node' };
        }

        // [#9889] The SAME definition-level guard attempt 1 runs under —
        // the sixth instance of this method drifting from `execute()`
        // (#9378, #9415, #9414, #9510, #9704 before it), and the first
        // that skipped a GUARD rather than an exit or the environment.
        // Without this call, a flow whose node config violates its own
        // declared `inputSchema` under `errorHandling.strategy: 'retry'`
        // was refused on attempt 1 (the guard throws before any node
        // executes) and then RUN FOR REAL on attempts 2..N, because the
        // retry handoff lives in `execute()`'s catch and every retry
        // attempt comes back through here — a refusal that holds only
        // until the flow is retried, i.e. `retry` as a way past
        // authoring-time validation. The guard's verdict is a pure
        // function of the flow definition (`_variables` is unused), so
        // re-running it cannot refuse anything attempt 1 would have
        // allowed; the throw lands in this method's generic failure arm
        // below, so each refused attempt still consumes retry budget and
        // retry accounting is unchanged. Same chokepoint discipline as
        // `seedRunVariables` (#9704): ONE method holds the rules, both
        // attempt paths call it — `input-schema-retry-parity.test.ts`
        // pins the per-attempt refusal so this call cannot be dropped
        // silently.
        this.validateNodeInputSchemas(flow, variables);

        await this.executeNode(startNode, flow, variables, runContext, steps);

        const output: Record<string, unknown> = {};
        if (flow.variables) {
            for (const v of flow.variables) {
                if (v.isOutput) {
                    output[v.name] = variables.get(v.name);
                }
            }
        }

        const durationMs = Date.now() - startTime;
        // [#16274] The SECOND initial-execution instance of the guard
        // above in `execute()` — the retry path's own completion site, and
        // the one where the consequence was measured worst. This method IS
        // a retry attempt (it is only ever reached from
        // {@link retryExecution}), so a `failed` answer here does not just
        // mislead a caller: it is read by the loop that drives this method,
        // which re-enters it for the next attempt. An attempt whose every
        // node SUCCEEDED and whose only failure was its own history write
        // therefore burned the rest of the budget re-running the flow,
        // `1 + maxRetries` times in total, each attempt writing one more
        // `failed` row for work that had already completed.
        //
        // ⚠️ Fixing `execute()` alone would NOT have closed that: a flow
        // under `strategy: 'retry'` whose attempt 2 completes leaves
        // through THIS exit and never crosses `execute()`'s again — the
        // seventh instance of this method's documented drift from
        // `execute()` (#9378, #9415, #9414, #9510, #9704, #9889 before it),
        // and the same chokepoint discipline applies: one shape, both
        // attempt paths.
        //
        // The reachable statements, the invariant and the sink ruling's (commit e238c79f0) reading
        // are all stated at the `execute()` site; this is the same guard,
        // not a second design.
        let logged: ExecutionLogEntry | undefined;
        try {
            logged = this.recordLog({
                id: runId,
                flowName,
                flowVersion: flow.version,
                status: 'completed',
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs,
                trigger: buildRunTrigger(context),
                steps,
                output,
            }, context);
        } catch (bookkeeping) {
            // #4632 verdict: DURABILITY, so `error` — see the `execute()`
            // site for why this is outside the sink ruling's (commit e238c79f0) class. The message
            // names the ATTEMPT, because the run id an operator finds in
            // the Runs surfaces is this attempt's own and not the failed
            // attempt's. Said ONCE per run, not once per failed write.
            this.logger.error(
                `[Automation] run '${runId}' of flow '${flowName}' COMPLETED successfully on a RETRY ` +
                    `attempt but its run-history bookkeeping threw, so its terminal history row never ` +
                    `landed — nothing retries it, the caller is told the run succeeded, and after the next ` +
                    `restart this run is invisible to the Runs surfaces while the approvals sweeps read it ` +
                    `as never-finished. The run itself is COMPLETE and must NOT be re-run or retried. Fix ` +
                    `the history failure in this record's meta.`,
                undefined,
                describeThrownForLog(bookkeeping),
            );
        }
        // [#16274] The same recomputation as the `execute()` site's: one
        // pure function of the same steps, so the abandoned `recordLog`
        // costs the caller no counts.
        const summary = logged?.summary ?? summarizeRun(steps);

        // #4354 — a retried run reports its own attempt's counts, not the
        // failed one's: `retryExecution` returns THIS result on success.
        //
        // [#9414] …and because `retryExecution` returns THIS result, this
        // is the exit a run that succeeded on attempt 2+ leaves through.
        // The author's completion text has to be produced here as well, or
        // `successMessage` would be a function of which attempt happened to
        // work — the same route-dependent shape the fix is removing.
        return { success: true, output, durationMs, successMessage: flow.successMessage, flowLabel: flow.label, summary };
    } catch (err: unknown) {
        // [#15788] The THIRD producer: an attempt that reached a refusing
        // `end`. A flow under `errorHandling.strategy: 'retry'` is handed
        // off to `retryExecution` and every one of its attempts leaves
        // through this method, so a repair that stopped at `execute()`
        // would record a refusal as a completion for exactly the flows most
        // likely to carry one — the same route-dependent shape #9414 and
        // #9510 each had to close on this very exit.
        //
        // ⚠️ The ladder stops here, and `retryExecution` needs no arm of
        // its own for it: a refusal is `success: true`, which that loop
        // already reads as "this attempt did not fail, stop retrying" — the
        // true sentence about a successful evaluation that said no. ⛔ A
        // refusal must never consume retry budget: re-running the flow
        // would re-execute every node before the `end` in the hope of a
        // different answer to a decision the author already made.
        if (isRefusalSignal(err)) {
            return this.finishRefusedRun({
                runId, flowName, flowVersion: flow.version,
                startedAt, durationMs: Date.now() - startTime,
                steps, flow, variables,
                refusalMessage: err.message, context,
            });
        }
        // [#9510] A node asked to suspend the run (ADR-0019 durable pause)
        // — here, on a RETRY attempt, the only way this method is ever
        // reached. Tested FIRST and answered exactly as `execute()`'s own
        // catch answers it, because it is the same event: A PAUSE IS NOT A
        // FAILURE (`execute()`'s arm says so in those words, and ADR-0019
        // is the contract). A restoration of a stated contract on the one
        // path that never got it — not a new capability, and the
        // `AutomationResult.status` vocabulary it returns is unchanged.
        //
        // Without this arm the signal fell through to the generic failure
        // path below and four halves of the pause were lost at once:
        //
        //  1. `persistSuspendedRun` never ran, so THE CONTINUATION WAS
        //     NEVER STORED and the run could not be resumed by anyone,
        //     ever — the headline harm, and why the pins for this are
        //     written against the store and a real `resume()` rather than
        //     against the status string;
        //  2. the run log recorded `failed` for a run that asked to pause;
        //  3. the caller got `status: 'failed'`, with the signal
        //     stringified into `error` (`FlowSuspendSignal` is not an
        //     `Error`);
        //  4. `retryExecution` reads `result.success`, so the pause counted
        //     as one more failed attempt: the loop burned the rest of the
        //     budget, and every further attempt re-entered the pausing node
        //     and orphaned another suspension.
        //
        // ⛔ Deliberately NOT an authoring-time refusal of
        // `errorHandling.strategy: 'retry'` combined with a pausing node.
        // That refusal over-refuses (a pausing node can sit on a branch the
        // retrying path never reaches), under-refuses (a pausing node
        // behind a runtime condition is not statically decidable), and
        // would ban the ordinary shape this defect is reached through: a
        // flaky HTTP/connector call followed by an `approval` or `screen`
        // node — retry is what an author reaches for on the flaky half and
        // the approval is what the business needs on the other.
        //
        // Every field is THIS attempt's own run bookkeeping (`runId`,
        // `startedAt`, `steps`, `runContext`, `startTime`), never the
        // failed attempt's, so the continuation is keyed by the run id this
        // method returns — the only id `resume()` can be called with.
        if (isSuspendSignal(err)) {
            const durationMs = Date.now() - startTime;
            // #7639 — ONE snapshot expression feeding BOTH consumers: the
            // continuation the run will resume from, and the `paused` log
            // entry run-detail serves. Same object, so what an operator
            // reads can never disagree with what the run holds.
            const variablesSnapshot = Object.fromEntries(variables);
            await this.persistSuspendedRun({
                runId,
                flowName,
                flowVersion: flow.version,
                nodeId: err.nodeId,
                nodeType: err.nodeType,
                variables: variablesSnapshot,
                steps,
                context: runContext,
                startedAt,
                startTime,
                correlation: err.correlation,
                screen: err.screen,
            });
            this.recordLog({
                id: runId,
                flowName,
                flowVersion: flow.version,
                status: 'paused',
                startedAt,
                durationMs,
                trigger: buildRunTrigger(context),
                steps,
                variables: variablesSnapshot,
            }, context);
            return {
                success: true,
                status: 'paused',
                runId,
                durationMs,
                screen: err.screen,
                flowLabel: flow.label,
            };
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;
        // [#17562] The SECOND initial-execution instance of the guard above
        // in `execute()` — this path's own failure arm, one per RETRY
        // attempt. The reachable statements, the invariant and the sink ruling's (commit e238c79f0)
        // reading are all stated at the `execute()` site; this is the same
        // guard, not a second design.
        //
        // ⚠️ Fixing `execute()` alone would NOT have closed it, and the
        // reachability is the opposite way round from #16274's: this method
        // is only ever entered from {@link retryExecution}, which
        // `execute()`'s catch reaches AFTER its own failed row. So a store
        // that starts refusing mid-run (the first row lands, the driver's
        // connection then drops) puts the throw in THIS arm and nowhere
        // else, and the throw rejected out through `retryExecution` and
        // `execute()` both — taking the remaining retry budget with it.
        // The eighth instance of this method's documented drift from
        // `execute()` (#9378, #9415, #9414, #9510, #9704, #9889, #16274
        // before it), and the same chokepoint discipline applies: one
        // shape, both attempt paths.
        let logged: ExecutionLogEntry | undefined;
        try {
            logged = this.recordLog({
            id: runId,
            flowName,
            flowVersion: flow.version,
            status: 'failed',
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs,
            trigger: buildRunTrigger(context),
            steps,
            error: errorMessage,
        }, context);
        } catch (bookkeeping) {
            // #4632 verdict: DURABILITY, so `error` — see the `execute()`
            // site for why this is outside the sink ruling's (commit e238c79f0) class and why a failure
            // handed to the caller does not exempt it. The message names
            // the ATTEMPT, because the run id an operator finds in the Runs
            // surfaces is this attempt's own and not the first attempt's.
            // Said ONCE per abandoned write.
            this.logger.error(
                `[Automation] run '${runId}' of flow '${flowName}' FAILED on a RETRY attempt and its ` +
                    `run-history bookkeeping threw, so that attempt's terminal 'failed' row never ` +
                    `landed — nothing retries the write, and after the next restart the attempt is ` +
                    `invisible to the Runs surfaces while the approvals sweeps read it as ` +
                    `never-finished. Neither the retry budget nor the caller's answer is affected: the ` +
                    `loop still runs its remaining attempts and still answers status 'failed' carrying ` +
                    `the node's error. Fix the history failure in this record's meta.`,
                undefined,
                describeThrownForLog(bookkeeping),
            );
        }
        // [#9378] The retry loop reads only `result.success` and this
        // result never escapes `retryExecution` on its own, but it is the
        // same ran-and-failed exit as the two above and is classified the
        // same: a selective classification is the one a later reader
        // mistakes for a rule.
        //
        // [#9414] `errorMessage: flow.errorMessage` rides along on the same
        // argument, and note the two names are NOT the same thing here:
        // the local `errorMessage` is the raw thrown text, `flow.errorMessage`
        // is what the author wrote for a human to read.
        return {
            success: false,
            error: errorMessage,
            durationMs,
            status: 'failed',
            errorMessage: flow.errorMessage,
            flowLabel: flow.label,
            // [#17562] Recomputed when the guard above had to abandon
            // `recordLog`: the same pure function of the same steps that
            // `recordLog`'s own first statement runs, so the two spellings
            // cannot disagree. Same shape as #15555's.
            summary: logged?.summary ?? summarizeRun(steps),
            // [#24914, ruling B′] As `execute()`'s failure exit, per attempt;
            // `retryExecution` reports the LAST attempt's members with its text.
            ...readCarriedRefusal(err),
        };
    }
}
