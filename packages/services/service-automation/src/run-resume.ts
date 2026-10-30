// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The run context and resume of {@link AutomationEngine}: how a run's context,
 * grants and declared lookups are resolved; how a suspended run is persisted,
 * loaded, gated and resumed, and how one is forgotten or evicted; how a
 * suspended run is failed, settled or cancelled, along with its ancestors; and
 * how a subflow child's parent strand is taken.
 *
 * [#25222] Slices 6 and 8 of the `engine.ts` split, move-only. Each function
 * here is the body of the `AutomationEngine` method of the same name, moved
 * unedited. The class keeps that method (its name, docblock and position are
 * in the published `.d.ts`) and calls the body with a {@link RunResumeHost}
 * literal holding exactly the members the body reads. An async method's stub
 * is no longer `async`: it returns the promise the moved function makes.
 */

import type { FlowParsed, FlowRunSummary } from '@objectstack/spec/automation';
import type { AutomationContext, AutomationResult, ResumeSignal } from '@objectstack/spec/contracts';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { runIsUnscopedUserMode, flowTouchesData, runOrgUserIds, runTriggerUserId, type SeededRunContext } from './runtime-identity.js';
import { refuseNode } from './guard-refusal.js';
import { describeThrownForLog } from './thrown-cause-diagnostics.js';
import { carriedRefusalOfResult, readCarriedRefusal } from './inner-refusal.js';
import { summarizeRun } from './run-summary.js';
import { noteTenantCurrencyReadFault } from './builtin/template.js';
import { mapItemCancelledVariable, type MapItemCancelledMarker } from './builtin/map-node.js';
// The values below (`buildRunTrigger`, `FlowRefusalSignal`, `isRefusalSignal`,
// `isSuspendSignal`, `isRetryableResumeRefusal`, `carriesSubflowChildOutput`,
// `applyResumeSignal` and `engineBuilt`) are read only inside the function bodies, at call
// time, never while a module is evaluating, so the import cycle with
// ./engine.js is safe under ESM live bindings; the tsup bundle is one file and
// has no cycle.
import {
    buildRunTrigger,
    FlowRefusalSignal,
    isRefusalSignal,
    isSuspendSignal,
    isRetryableResumeRefusal,
    carriesSubflowChildOutput,
    applyResumeSignal,
    engineBuilt,
    type AutomationEngine,
    type ChildRunRefusal,
    type ExecutionLogEntry,
    type NodeExecutionResult,
    type StepLogEntry,
    type SubflowParentStrand,
    type SuspendedRun,
    type SuspensionReleaseReason,
} from './engine.js';

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those. Methods go as late-bound closures, so a spy or test
 * double set on the instance is still the one called. A field the class assigns
 * only at its declaration or in its constructor goes by value, so the value
 * passed is the field, including where an async body reads it after an
 * `await`. Four fields go through a getter, because a method reassigns each:
 * `store` (`setSuspendedRunStore`), `userGrantsResolver`
 * (`setUserGrantsResolver`), `recordExpander` (`setRecordExpander`) and
 * `nodeTypeVocabularySealed` (`sealNodeTypeVocabulary`). Each read in the body
 * reads the engine's current value, as it did through `this`.
 */
export interface RunResumeHost {
    readonly seedRunGrants: AutomationEngine['seedRunGrants'];
    readonly logger: AutomationEngine['logger'];
    readonly expandDeclaredLookups: AutomationEngine['expandDeclaredLookups'];
    readonly userGrantsResolver: AutomationEngine['userGrantsResolver'];
    readonly tenantCurrencyResolver: AutomationEngine['tenantCurrencyResolver'];
    readonly recordExpander: AutomationEngine['recordExpander'];
    readonly refuseGatedResume: AutomationEngine['refuseGatedResume'];
    readonly resumeInternal: AutomationEngine['resumeInternal'];
    readonly resolveSuspensionChain: AutomationEngine['resolveSuspensionChain'];
    readonly resolveSuspendedNodeType: AutomationEngine['resolveSuspendedNodeType'];
    readonly resolveResumeAuthority: AutomationEngine['resolveResumeAuthority'];
    readonly resolveDeclaredResumeAuthority: AutomationEngine['resolveDeclaredResumeAuthority'];
    readonly getRun: AutomationEngine['getRun'];
    readonly resolveCanonicalDescriptor: AutomationEngine['resolveCanonicalDescriptor'];
    readonly loadSuspendedRunStrict: AutomationEngine['loadSuspendedRunStrict'];
    readonly store: AutomationEngine['store'];
    readonly suspendedRuns: AutomationEngine['suspendedRuns'];
    readonly cacheOnlySuspensions: AutomationEngine['cacheOnlySuspensions'];
    readonly evictConsumedSuspension: AutomationEngine['evictConsumedSuspension'];
    readonly journalConsumedSuspension: AutomationEngine['journalConsumedSuspension'];
    readonly forgetSuspendedRun: AutomationEngine['forgetSuspendedRun'];
    readonly recordLog: AutomationEngine['recordLog'];
    readonly nodeTypeVocabularySealed: AutomationEngine['nodeTypeVocabularySealed'];
    readonly claimAdvance: AutomationEngine['claimAdvance'];
    readonly loadSuspendedRun: AutomationEngine['loadSuspendedRun'];
    readonly failSuspendedRun: AutomationEngine['failSuspendedRun'];
    readonly consumedSuspensions: AutomationEngine['consumedSuspensions'];
    readonly releaseSuspension: AutomationEngine['releaseSuspension'];
    readonly subflowParentStrands: AutomationEngine['subflowParentStrands'];
    readonly resuming: AutomationEngine['resuming'];
    readonly flows: AutomationEngine['flows'];
    readonly settleUnresumableSuspension: AutomationEngine['settleUnresumableSuspension'];
    readonly creditChildRun: AutomationEngine['creditChildRun'];
    readonly persistSuspendedRun: AutomationEngine['persistSuspendedRun'];
    readonly buildSubflowResumeSignal: AutomationEngine['buildSubflowResumeSignal'];
    readonly refuseInvalidScreenInput: AutomationEngine['refuseInvalidScreenInput'];
    readonly cloneVariablesAtPause: AutomationEngine['cloneVariablesAtPause'];
    readonly resolveDecisionSegmentContext: AutomationEngine['resolveDecisionSegmentContext'];
    readonly executeNode: AutomationEngine['executeNode'];
    readonly traverseNext: AutomationEngine['traverseNext'];
    readonly bubbleToParent: AutomationEngine['bubbleToParent'];
    readonly finishRefusedRun: AutomationEngine['finishRefusedRun'];
    readonly failAncestors: AutomationEngine['failAncestors'];
}

/** The body of {@link AutomationEngine.resolveRunContext}; that method's docblock is its contract. */
export async function resolveRunContext(this: Pick<RunResumeHost, 'seedRunGrants' | 'logger' | 'expandDeclaredLookups' | 'tenantCurrencyResolver'>, flow: FlowParsed, context?: AutomationContext, runId?: string): Promise<AutomationContext> {
    // `flowRunId` is stamped alongside `runAs` because it shares that field's
    // lifetime and its single construction point: set once here, copied into
    // every data node's ObjectQL context by `resolveRunDataContext`, and
    // persisted with a suspended run so it survives pause/resume — including a
    // cold resume after a restart (#3456). Provenance, not authorization.
    const runContext: AutomationContext = {
        ...(context ?? {}),
        runAs: flow.runAs ?? 'user',
        // `flowName` shares the same lifetime and construction point: it feeds
        // audit attribution (`svc:flow:<name>` on ExecutionContext.actor) for
        // runs that resolve no user (#4366).
        flowName: flow.name,
        ...(runId ? { flowRunId: runId } : {}),
    };

    // #3356 (follow-up to #1888) — a `runAs:'user'` run must enforce its data
    // ops as the TRIGGERING user's real authorization. Most trigger surfaces
    // (REST action / trigger endpoint) already resolve the full envelope and
    // forward `permissions`; the ObjectQL record-change hook does NOT — its
    // session carries only a `userId`, so the run used to fall back to a bare
    // member/everyone principal (403 on private objects; silent field strips
    // on public ones) even when the triggering user was fully authorized.
    // When a grants resolver is wired and the trigger left the authz envelope
    // unresolved (no `permissions`), resolve the user's real positions +
    // permission sets here — the single point where every trigger type's run
    // identity is established. Contexts that ALREADY carry `permissions` are
    // left untouched: that includes an ADR-0090 agent principal acting
    // on-behalf-of a user (its scope-derived ceiling is always non-empty), so
    // this never re-broadens a deliberately narrowed identity.
    //
    // The run's peer list (`org_user_ids`) is seeded here too, through the
    // same resolver, whenever the context does not carry one yet — so also
    // for a context whose positions/permissions the door already resolved.
    // No trigger surface forwards it (the REST, action and record-change
    // doors all hand over positions/permissions/tenant at most), so without
    // it every `runAs:'user'` run's `sys_user_org_members` policy compiled
    // `unresolved-variable` and dropped out: the run saw only the acting
    // user's own `sys_user` row while the same user's request saw their
    // organization's members too. Taking ONLY the peer list from a
    // re-resolution leaves the carried positions/permissions verbatim, so an
    // agent ceiling stays narrowed; the list itself is the delegating
    // human's peers in the run's organization, which is what the request
    // path's agent envelope carries as well. A context that already carries
    // one — a `subflow` / `map` child, a resumed leg — keeps it.
    //
    // The user's email is seeded by the same rule. No trigger surface
    // forwards it either, and without it every row policy that reads
    // `current_user.email` dropped out: the run was refused on rows the
    // same user's request reads and writes. A context that already carries
    // an email keeps it verbatim, as the request path keeps a session's.
    await this.seedRunGrants(flow.name, runContext, 'triggering');

    // The organization's default currency, for a text slot's
    // `{{ amount | currency }}` hole with no argument — seeded once here, for
    // every trigger type, like the identity above. A context that already
    // carries one (a `subflow` / `map` child, a resumed leg) keeps it. A failed
    // or empty read leaves it unset: such a hole then refuses by name, and no
    // currency is guessed. [#28056] A FAILED read (the resolver rejected) is
    // noted beside this context, so that refusal is graded a runtime failure,
    // not a guard refusal (`gradeAfterTenantCurrencyReadFault`).
    if (runContext.currency === undefined && this.tenantCurrencyResolver) {
        try {
            const currency = await this.tenantCurrencyResolver(runContext.tenantId);
            if (typeof currency === 'string' && currency !== '') runContext.currency = currency;
        } catch (err) {
            noteTenantCurrencyReadFault(runContext, err);
        }
    }

    if (runIsUnscopedUserMode(runContext) && flowTouchesData(flow)) {
        this.logger.warn(
            `[runAs] flow '${flow.name}' executes with runAs:'user' but its trigger resolved no user ` +
            `— its data operations will be REFUSED. Without a user they would carry no principal: ` +
            `refused by the security plugin where one is composed, unscoped where none is (the fail-open ADR-0049 forbids). ` +
            `Declare runAs:'system' to make the elevation explicit and intended, or arrange ` +
            `for the trigger to supply a user. Note a user-less trigger is NOT only a schedule: a ` +
            `record-change flow fired by a system write carries no user either (ADR-0049).`,
        );
    }

    // #3475 — opt-in single-hop lookup expansion, AFTER identity resolution so
    // the re-read runs as this run's own principal (see helper).
    await this.expandDeclaredLookups(flow, runContext);
    return runContext;
}

/** The body of {@link AutomationEngine.seedRunGrants}, moved unedited; that method's docblock is its contract. */
export async function seedRunGrants(
    this: Pick<RunResumeHost, 'userGrantsResolver' | 'logger'>,
    flowName: string,
    runContext: AutomationContext,
    whose: 'triggering' | 'deciding',
): Promise<void> {
    const needsGrants = !Array.isArray(runContext.permissions);
    const needsPeers = runOrgUserIds(runContext) === undefined;
    const needsEmail = !runContext.email;
    if (
        runContext.runAs !== 'system' &&
        runContext.userId &&
        (needsGrants || needsPeers || needsEmail) &&
        this.userGrantsResolver
    ) {
        try {
            const grants = await this.userGrantsResolver(runContext.userId, runContext.tenantId);
            if (grants) {
                if (needsGrants) {
                    runContext.positions = Array.isArray(grants.positions) ? grants.positions : [];
                    runContext.permissions = Array.isArray(grants.permissions) ? grants.permissions : [];
                    if (grants.tenantId && !runContext.tenantId) runContext.tenantId = grants.tenantId;
                    // The rung the resolver derived from these same grants,
                    // as the user's request carries it. Seeded with them and
                    // only with them: carried grants keep the rung they came
                    // with, so a narrowed ceiling never gains a wider rung.
                    if (grants.posture) (runContext as SeededRunContext).posture = grants.posture;
                }
                if (needsPeers && Array.isArray(grants.org_user_ids)) {
                    (runContext as SeededRunContext).org_user_ids = grants.org_user_ids;
                }
                if (needsEmail && grants.email) runContext.email = grants.email;
            }
        } catch (err) {
            // Fail-safe, never fail-open: on a resolution error the run keeps
            // the user's (unresolved) identity — the data middleware applies
            // its baseline member fallback, NOT elevation — and we warn loudly
            // so the degraded authorization is audible rather than silent.
            //
            // #6499 — the resolver's thrown text (transitively the
            // datasource's) goes to the structured slot; see
            // `forgetSuspendedRun`'s catch above for the full mechanism
            // (#6299). #4632 verdict: FUNCTIONAL — stays `warn`: the
            // degradation is fail-safe as argued above, its symptom is the
            // run's own data-op refusals/strips, and nothing
            // claimed-persisted failed to land.
            //
            // Unresolved peers and email degrade the same way, narrower and
            // never wider: a policy that reads `current_user.org_user_ids`
            // or `current_user.email` drops out, so the run sees its own
            // `sys_user` row and not its organization's members, and no row
            // an email-keyed policy would admit. The sentence names which
            // half applies, and which facts it lost.
            const lost = [
                ...(needsPeers ? ['current_user.org_user_ids'] : []),
                ...(needsEmail ? ['current_user.email'] : []),
            ].join(' or ');
            // Without grants the lost list may be empty (the context carried
            // its peers and email); with grants carried it never is, since
            // one of the two is what sent the run here.
            const consequence = needsGrants
                ? `its data ops fall back to baseline member permissions (not elevated)` +
                  (lost ? `, and every row policy reading ${lost} drops out` : '')
                : `its data ops keep the trigger's positions and permission sets, but every row ` +
                  `policy reading ${lost} drops out (narrower, not elevated)`;
            this.logger.warn(
                `[runAs] flow '${flowName}' could not resolve grants for ${whose} user ` +
                `'${runContext.userId}' — ${consequence}. The resolver's failure is in this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }
}

/** The body of {@link AutomationEngine.resolveDecisionSegmentContext}; that method's docblock is its contract. */
export async function resolveDecisionSegmentContext(
    this: Pick<RunResumeHost, 'seedRunGrants' | 'tenantCurrencyResolver'>,
    run: SuspendedRun,
    signal: ResumeSignal,
): Promise<AutomationContext> {
    return withTenantCurrency.call(this, await deciderSegmentContext.call(this, run, signal));
}

/**
 * A resumed segment's context with the organization's default currency, when
 * the persisted one carries none: a run parked before run setup seeded
 * `currency` would otherwise refuse a `{{ amount | currency }}` hole whose
 * remedy, the setting, is already in place. A copy, never the persisted
 * context; an empty read leaves it as it was. [#28056] A failed read answers a
 * copy noted as such, as at run setup: the note is this segment's, and the
 * persisted context never carries it into a later resume.
 */
async function withTenantCurrency(
    this: Pick<RunResumeHost, 'tenantCurrencyResolver'>,
    context: AutomationContext,
): Promise<AutomationContext> {
    if (context?.currency !== undefined || !this.tenantCurrencyResolver) return context;
    try {
        const currency = await this.tenantCurrencyResolver(context?.tenantId);
        if (typeof currency === 'string' && currency !== '') return { ...(context ?? {}), currency } as AutomationContext;
    } catch (err) {
        const noted = { ...(context ?? {}) } as AutomationContext;
        noteTenantCurrencyReadFault(noted, err);
        return noted;
    }
    return context;
}

async function deciderSegmentContext(
    this: Pick<RunResumeHost, 'seedRunGrants'>,
    run: SuspendedRun,
    signal: ResumeSignal,
): Promise<AutomationContext> {
    const context = run.context;
    const decider = signal[RESUME_AUTHORITY_SERVICE] === true ? signal.resumedBy : undefined;
    if (typeof decider !== 'string' || decider === '') return context;
    if (context?.userId === decider) return context;
    const switched: SeededRunContext = {
        ...(context ?? {}),
        userId: decider,
        triggerUserId: runTriggerUserId(context) ?? null,
    };
    delete switched.positions;
    delete switched.permissions;
    delete switched.org_user_ids;
    // The trigger user's rung is theirs: kept under the decider's id, a
    // platform administrator's submission would hand a member's decision
    // segment the deployment-level rows. Seeded for the decider below.
    delete switched.posture;
    // The trigger user's email is theirs too: kept under the decider's id,
    // it would admit the decider to every row an email-keyed policy grants
    // the submitter. Removed on both postures, and seeded for the decider
    // below like their grants.
    delete switched.email;
    // A system run keeps its elevation: attribution moves, no grant is resolved.
    if (switched.runAs === 'system') return switched;
    await this.seedRunGrants(run.flowName, switched, 'deciding');
    return switched;
}

/** The body of {@link AutomationEngine.expandDeclaredLookups}, moved unedited; that method's docblock is its contract. */
export async function expandDeclaredLookups(this: Pick<RunResumeHost, 'recordExpander' | 'logger'>, flow: FlowParsed, runContext: AutomationContext): Promise<void> {
    if (!this.recordExpander) return;
    const record = runContext.record as Record<string, unknown> | undefined;
    const id = record?.id;
    const object = runContext.object;
    if (!record || id == null || id === '' || !object) return;

    const startNode = flow.nodes.find((n) => n.type === 'start');
    const raw = (startNode?.config as { expand?: unknown } | undefined)?.expand;
    const expandFields =
        typeof raw === 'string'
            ? raw
                ? [raw]
                : []
            : Array.isArray(raw)
                ? raw.filter((f): f is string => typeof f === 'string' && f.length > 0)
                : [];
    if (expandFields.length === 0) return;

    try {
        const full = await this.recordExpander(object, id, expandFields, runContext);
        if (full && typeof full === 'object') {
            for (const field of expandFields) {
                const expanded = (full as Record<string, unknown>)[field];
                // Graft only a genuinely expanded relation (object/array); a
                // scalar means the field is not a resolvable lookup — leave the
                // raw id in place rather than overwrite it.
                if (expanded !== null && typeof expanded === 'object') {
                    record[field] = expanded;
                }
            }
        }
    } catch (err) {
        // #6499 — the expander's thrown text (transitively the
        // datasource's) goes to the structured slot; see
        // `forgetSuspendedRun`'s catch above for the full mechanism
        // (#6299). #4632 verdict: FUNCTIONAL — stays `warn`, per the
        // docblock: expansion is best-effort enrichment that must never
        // break the flow it feeds, and the visible symptom is templates
        // rendering the scalar id.
        this.logger.warn(
            `[expand] flow '${flow.name}' could not expand lookups [${expandFields.join(', ')}] on ` +
            `'${object}#${String(id)}' — templates referencing these relations resolve to the scalar ` +
            `id. The expander's failure is in this record's meta.`,
            describeThrownForLog(err),
        );
    }
}

/** The body of {@link AutomationEngine.resume}, moved unedited; that method's docblock is its contract. */
export async function resume(this: Pick<RunResumeHost, 'refuseGatedResume' | 'resumeInternal'>, runId: string, signal?: ResumeSignal): Promise<AutomationResult> {
    const gated = await this.refuseGatedResume(runId, signal);
    if (gated && 'continueWith' in gated) return this.resumeInternal(runId, gated.continueWith, false);
    if (gated) return gated;
    // An ABSENT signal is an EMPTY caller submission, never an exemption
    // (commit 7307191db). This is the in-process door, and `resume(runId)` used to
    // skip the screen contract that `resume(runId, {})` is held to:
    // `refuseInvalidScreenInput` short-circuited on a falsy signal — a
    // second, unnamed spelling of the exemption the engine already states
    // through `ENGINE_BUILT_SIGNAL`, so a run parked on a screen with an
    // unconditional `required` field proceeded with that variable unbound.
    // The HTTP door has always assembled `{}` for an empty body; this makes
    // the two doors agree, and the only exemption left is the engine's own
    // continuation, which proves itself by BUILDING an engine-built signal.
    // A pause with no screen contract — `wait`, `approval`, a message-only
    // or object-form screen — is untouched: an empty submission against no
    // declared fields is conformant, so the wait node's timer wake
    // (`engine.resume(runId)`) continues exactly as before.
    return this.resumeInternal(runId, signal ?? {}, false);
}

/**
 * [#27877] The code a resume answers when it would advance a `map` past an
 * item whose child run is still suspended — its own member of the contract's
 * closed union, never `RESUME_IN_PROGRESS`, which tells a caller the work is
 * already being done and needs nothing from them. The ONE spelling of it in
 * this package: the refusal below and its pins read this constant.
 *
 * ⛔ Deliberately absent from {@link RETRYABLE_RESUME_REFUSAL_CODES}: that set
 * is what `resumeInternal` answers, and this code is answered only by the
 * public door's gate, before `resumeInternal` is reached.
 */
export const MAP_ITEM_PENDING_REFUSAL_CODE: NonNullable<AutomationResult['code']> = 'RESUME_CHILD_PENDING';

/**
 * [#27971] What the gate hands {@link resume} when a resume may go on past a
 * `map` item whose run was cancelled: the signal to continue with, which tells
 * that map to record the item as cancelled. Not a refusal, and not a plain
 * pass either — the caller's own signal alone would advance the map past the
 * item with nothing recorded.
 */
export interface GatedResumeContinuation {
    readonly continueWith: ResumeSignal;
}

/** The body of {@link AutomationEngine.refuseGatedResume}; that method's docblock is its contract. */
export async function refuseGatedResume(this: Pick<RunResumeHost, 'resolveSuspensionChain' | 'resolveSuspendedNodeType' | 'resolveResumeAuthority' | 'resolveDeclaredResumeAuthority' | 'getRun' | 'logger'>, runId: string, signal?: ResumeSignal): Promise<AutomationResult | GatedResumeContinuation | null> {
    const chain = await this.resolveSuspensionChain(runId);
    const run = chain[chain.length - 1];
    if (!run) return null;

    const nodeType = this.resolveSuspendedNodeType(run);
    // Authority first: an item only its owning service may continue keeps
    // answering 403 at every id that reaches it, the child's own included —
    // naming the child here would send the caller to a door that refuses too.
    // The owning service's stamp IS the recorded decision's tail, not a way
    // around it.
    if (!nodeType || this.resolveResumeAuthority(nodeType) !== 'service' || signal?.[RESUME_AUTHORITY_SERVICE]) {
        return refuseMapItemSkip.call(this, runId, chain) ?? (await continuePastCancelledMapItem.call(this, runId, chain, nodeType, signal));
    }

    // Refusing. Which of the two reasons? A second registry walk, on the
    // refusal path only, so the message can tell a node that deliberately
    // declared `'service'` from one that declared nothing at all.
    const declared = this.resolveDeclaredResumeAuthority(nodeType);
    const direct = run.runId === runId;
    const at = direct ? `'${run.nodeId}'` : `'${run.nodeId}' (linked run '${run.runId}')`;
    const why = declared === 'service'
        ? `which is resumable only through its owning service (resumeAuthority: 'service')`
        : `whose type never declares resumeAuthority, so it is closed to the generic route until it does ` +
          `(an undeclared resumeAuthority resolves to 'service', fail-closed) — declare ` +
          `resumeAuthority: 'any' on its descriptor if this route IS the intended door`;
    this.logger.warn(`[automation] refused resume of run '${runId}': parked on ${nodeType} node ${at}, ${why}`);

    // The fix, identical in both the direct and the linked-run phrasing —
    // what has to change is a descriptor, not the call that just failed.
    const undeclaredFix =
        `and that node type never declares resumeAuthority, so the generic resume route is closed to the ` +
        `pauses it creates: an undeclared resumeAuthority resolves to 'service', fail-closed. If that ` +
        `route IS the intended door — a screen's collected inputs, a ` +
        `signal wait's external producer — declare resumeAuthority: 'any' on its action descriptor; declare ` +
        `'service' if resuming is the tail of a decision some service must authorize and record first`;
    return {
        success: false,
        code: 'PERMISSION_DENIED',
        error: declared === 'service'
            ? direct
                ? `Run '${runId}' is paused at a '${nodeType}' node, which only its owning service may resume — ` +
                  `drive it through that service's API (e.g. an approval decision), not a raw resume`
                : `Run '${runId}' is waiting on run '${run.runId}', which is paused at a '${nodeType}' node that ` +
                  `only its owning service may resume — resuming here would continue past a decision that has not ` +
                  `been made; drive it through that service's API instead`
            : direct
                ? `Run '${runId}' is paused at a '${nodeType}' node, ${undeclaredFix}`
                : `Run '${runId}' is waiting on run '${run.runId}', which is paused at a '${nodeType}' node, ` +
                  `${undeclaredFix}`,
    };
}

/**
 * [#27877] Refuse a resume that would re-run a `map` node past an item whose
 * child run is still suspended — the parent would complete over an item that
 * never ran and leave its suspension orphaned. `null` when the chain holds no
 * such link.
 *
 * The DEEPEST such link names the run to resume: resuming its item either
 * lands on the pause directly or is delegated down `subflow:` links beneath
 * it, and a map nested inside the item answers this same refusal one level
 * down. A `map:` link with no successor in `chain` is an item whose row is
 * gone; there is nothing parked to skip, so it is left to `resumeInternal`.
 * Refused before any state is touched, whatever the signal carries: a skip is
 * not a question of who is asking.
 */
function refuseMapItemSkip(this: Pick<RunResumeHost, 'logger'>, runId: string, chain: readonly SuspendedRun[]): AutomationResult | null {
    for (let i = chain.length - 2; i >= 0; i--) {
        const link = chain[i]!;
        if (typeof link.correlation !== 'string' || !link.correlation.startsWith('map:')) continue;
        const item = chain[i + 1]!;
        const at = link.runId === runId ? `'${link.nodeId}'` : `'${link.nodeId}' (linked run '${link.runId}')`;
        this.logger.warn(
            `[automation] refused resume of run '${runId}': parked on map node ${at}, whose item run ` +
                `'${item.runId}' is still suspended — resuming here would advance the map past that item`,
        );
        return {
            success: false,
            code: MAP_ITEM_PENDING_REFUSAL_CODE,
            error:
                `Run '${runId}' is ${link.runId === runId ? '' : `waiting on run '${link.runId}', which is `}paused at ` +
                `map node '${link.nodeId}' on item run '${item.runId}', which is still suspended — resuming here ` +
                `would advance the map past that item without running it. Resume run '${item.runId}' instead; ` +
                `the map continues when it completes`,
        };
    }
    return null;
}

/**
 * [#27971] The resume of a run whose deepest link is a `map:` one with no
 * successor in `chain` — the map is parked on an item whose suspension row is
 * gone. Re-running the map would advance it past that item, so what the item's
 * run history says decides the answer:
 *
 *  - `cancelled` (an operator's `cancelRun`, which never touches the parent):
 *    the map may go on, and the continuation tells it to record the item's
 *    {@link MapItemCancelledMarker} in its slot;
 *  - anything else — no history row, an unreadable store (`getRun` degrades to
 *    `null`), a run that completed without bubbling, a consumed strand: the map
 *    cannot record what happened to the item, so the resume is refused with
 *    #27877's code before any state is touched.
 *
 * `null` when the chain ends anywhere but on such a link parked at the built-in
 * `map` node (the one executor that reads the handoff; another type that mints
 * a `map:` correlation records nothing from it), and when the caller's signal
 * writes the engine's `$` namespace: that bag is refused `INVALID_SIGNAL` by
 * `resumeInternal` with the run left parked, and folding it into an
 * engine-built signal would exempt it from that guard.
 */
async function continuePastCancelledMapItem(
    this: Pick<RunResumeHost, 'getRun' | 'logger'>,
    runId: string,
    chain: readonly SuspendedRun[],
    nodeType: string | undefined,
    signal?: ResumeSignal,
): Promise<AutomationResult | GatedResumeContinuation | null> {
    const link = chain[chain.length - 1]!;
    if (nodeType !== 'map') return null;
    if (typeof link.correlation !== 'string' || !link.correlation.startsWith('map:')) return null;
    const itemRunId = link.correlation.slice('map:'.length);
    if (!itemRunId) return null;

    const item = await this.getRun(itemRunId);
    if (item?.status !== 'cancelled') {
        const at = link.runId === runId ? `'${link.nodeId}'` : `'${link.nodeId}' (linked run '${link.runId}')`;
        const found = item ? `its run history records '${item.status}', not 'cancelled'` : 'no run history for it can be read';
        this.logger.warn(
            `[automation] refused resume of run '${runId}': parked on map node ${at}, whose item run ` +
                `'${itemRunId}' is no longer suspended and ${found} — resuming here would advance the map past ` +
                `that item with nothing recorded for it`,
        );
        return {
            success: false,
            code: MAP_ITEM_PENDING_REFUSAL_CODE,
            error:
                `Run '${runId}' is ${link.runId === runId ? '' : `waiting on run '${link.runId}', which is `}paused at ` +
                `map node '${link.nodeId}' on item run '${itemRunId}', which is no longer suspended, and ${found}. ` +
                `The map records an item only when it completes or when its run was cancelled, so resuming here ` +
                `would advance the map past that item with nothing recorded for it. Nothing was changed. To end the ` +
                `batch, cancel run '${link.runId}'${link.runId === runId ? '' : ` and run '${runId}', which waits on it`}; ` +
                `if the run history store was unreachable, retry once it is readable`,
        };
    }

    if (signal && applyResumeSignal(new Map(), signal, link.nodeId).length > 0) return null;
    return {
        continueWith: engineBuilt({
            ...(signal ?? {}),
            variables: { ...(signal?.variables ?? {}), [mapItemCancelledVariable(link.nodeId)]: itemRunId },
        }),
    };
}

/** The body of {@link AutomationEngine.refuseUndeclaredSuspension}, moved unedited; that method's docblock is its contract. */
export function refuseUndeclaredSuspension(this: Pick<RunResumeHost, 'resolveCanonicalDescriptor'>, nodeType: string): NodeExecutionResult | null {
    const descriptor = this.resolveCanonicalDescriptor(nodeType);
    // No descriptor ⇒ no declaration ⇒ nothing to enforce (see above).
    if (!descriptor) return null;
    if (descriptor.supportsPause === true) return null;
    return refuseNode(
        `node type '${nodeType}' suspended the run but its action descriptor declares ` +
        `supportsPause: false, so the pause is refused — a run that paused here could not be ` +
        `continued on the generic resume route anyway: a type that declares no pause declares no ` +
        `resumeAuthority either, and an undeclared resumeAuthority resolves to 'service', which the ` +
        `generic route refuses. Declare ` +
        `supportsPause: true on the descriptor together with the resumeAuthority the pauses need ` +
        `('any' if POST /automation/:name/runs/:runId/resume is the intended door, 'service' if ` +
        `resuming is the tail of a decision some service must authorize and record first) — or stop ` +
        `returning suspend: true from execute(). This is a metadata defect, not a runtime one, so a ` +
        `fault edge does not route it.`,
    );
}

/** The body of {@link AutomationEngine.loadSuspendedRun}, moved unedited; that method's docblock is its contract. */
export async function loadSuspendedRun(this: Pick<RunResumeHost, 'loadSuspendedRunStrict' | 'logger'>, runId: string): Promise<SuspendedRun | null> {
    try {
        return await this.loadSuspendedRunStrict(runId);
    } catch (err) {
        // #6230 — the cause goes to `meta`, never into the message. It is
        // the datasource DRIVER's own failure text and we do not control
        // how many lines it has; `ObjectLogger.write()` adds one
        // `<ts> <LEVEL>` head per call, so a newline in it turns this ONE
        // record into several physical lines of which only the first is
        // greppable — the family of #5048 / #5575 / #5636 / #5661 / #5737 /
        // #5912, and cloud#971's shape.
        //
        // This seam is the `warn` half of that family and carries the extra
        // harm the module docblock of ./thrown-cause-diagnostics.ts calls
        // out: `ObjectLogger` routes `warn` to **stdout**, and `serve`'s
        // boot-quiet window wraps `process.stdout.write`, where
        // `BootLogCapture.offer()` retains a physical line only when
        // `classifyBootLogLine` finds a level head on it. Continuation lines
        // are therefore DROPPED outright, not merely misread — and this is
        // live during boot: `plugin.ts` `start()` → `rearmSuspendedWaitTimers`
        // → `engine.resume()` for an overdue run → the gate
        // (`refuseGatedResume` → `resolveSuspensionChain`) → here.
        //
        // SECOND argument, per the `Logger` contract
        // (`packages/spec/src/contracts/logger.ts`): `warn(message, meta?)`.
        // Unlike `error(message, error?, meta?)` (#5912's seam, PR #6228)
        // `warn` has no `Error` slot, so `meta` is the second parameter.
        //
        // Level stays `warn` on purpose. This is a deliberate FUNCTIONAL
        // degradation — the loader's whole contract is "a best-effort answer
        // for incidental readers" and `resumeInternal` uses the strict form
        // when the difference matters — so #4632's durability rule does not
        // apply and raising it to `error` would be that rule's mirror-image
        // misuse, an alarm on every gate lookup during an outage.
        this.logger.warn(
            `[automation] durable suspended-run store unreadable for run '${runId}' — this read is best-effort ` +
                `and DEGRADES to null, so its caller (the resume gate, a screen fetch) sees exactly what it ` +
                `would see if no suspension existed under that id; the run itself is untouched and stays ` +
                `parked. Fix the store failure in this record's meta — a strict read reports it as ` +
                `STORE_UNAVAILABLE instead of degrading.`,
            describeThrownForLog(err),
        );
        return null;
    }
}

/** The body of {@link AutomationEngine.loadSuspendedRunStrict}, moved unedited; that method's docblock is its contract. */
export async function loadSuspendedRunStrict(this: Pick<RunResumeHost, 'store' | 'suspendedRuns' | 'cacheOnlySuspensions' | 'evictConsumedSuspension'>, runId: string): Promise<SuspendedRun | null> {
    if (!this.store) return this.suspendedRuns.get(runId) ?? null;
    const stored = await this.store.load(runId);
    if (stored) return stored;
    // The store has no row. For every run it ever accepted that IS the
    // answer — including the runs this process advanced past, whose stale
    // map entries are the whole defect above. The lone exception is a run
    // whose durable save failed here: the store was never handed that row,
    // so its silence says nothing about it, and `persistSuspendedRun`
    // deliberately keeps such a run resumable in-process (it reports the
    // lost durability at `error`).
    if (this.cacheOnlySuspensions.has(runId)) return this.suspendedRuns.get(runId) ?? null;
    // [#15832] The store ANSWERED, and the answer is "no row". Any entry
    // this process still holds for that run is a run it parked and another
    // replica consumed — the phantom the two listings hand back. This is
    // the definitive per-id evidence the paragraph above already rests on,
    // so the same reading that refuses to serve it here stops publishing it
    // there. A store read that threw never reaches this line.
    this.evictConsumedSuspension(runId);
    return null;
}

/** The body of {@link AutomationEngine.creditChildRun}, moved unedited; that method's docblock is its contract. */
export function creditChildRun(steps: StepLogEntry[], nodeId: string, child: FlowRunSummary | undefined): void {
    if (!child) return;
    for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].nodeId !== nodeId) continue;
        const prior = steps[i].metrics ?? {};
        steps[i] = {
            ...steps[i],
            metrics: {
                selected: (prior.selected ?? 0) + child.selected,
                acted: (prior.acted ?? 0) + child.acted,
                // N uncountable effects in the child collapse to ONE flag on
                // the parent's step: this execution dispatched something the
                // platform cannot count. The child keeps the real count in
                // its own run row, and the question this feeds — "is the
                // parent's `acted` complete?" — is boolean either way.
                ...(prior.unmeasuredEffect || child.unmeasured ? { unmeasuredEffect: true } : {}),
                // #15617 — the pausing item's own contained failures, which
                // the synchronous path reports through the executor's
                // `metrics`. Written only when one of the two sides actually
                // tracked a count: an absent `failures` means "not tracked",
                // and a `0` written here would claim a measurement of a
                // child recorded before the count existed.
                ...(prior.failures !== undefined || child.failed !== undefined
                    ? { failures: (prior.failures ?? 0) + (child.failed ?? 0) }
                    : {}),
            },
        };
        return;
    }
}

/** The body of {@link AutomationEngine.failSuspendedRun}, moved unedited; that method's docblock is its contract. */
export async function failSuspendedRun(
    this: Pick<RunResumeHost, 'journalConsumedSuspension' | 'forgetSuspendedRun' | 'recordLog'>,
    run: SuspendedRun,
    error: string,
    repairableDescendant?: string,
): Promise<void> {
    const consumed = repairableDescendant !== undefined
        ? this.journalConsumedSuspension(run, run.steps.length, error, run.variables)
        : undefined;
    await this.forgetSuspendedRun(run, 'failed');
    this.recordLog({
        id: run.runId,
        flowName: run.flowName,
        flowVersion: run.flowVersion,
        status: 'failed',
        startedAt: run.startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - run.startTime,
        trigger: buildRunTrigger(run.context),
        steps: run.steps,
        error,
    }, run.context, consumed?.run);
}

/**
 * [#26477] The two NEVER-DISPATCHED exits of {@link resumeInternal}, as one
 * read: the registered flow a suspension belongs to and the node it parked on,
 * or — when either is gone — the cause a resume answers `RUN_NOT_FOUND` with.
 *
 * Pure: it reads the flow registry and records nothing. {@link resumeInternal}
 * acts on a cause by settling the run ({@link settleUnresumableSuspension});
 * {@link AutomationEngine.unresumableSuspensionCause} only reports it, so a
 * caller that is about to write a decision of its own can refuse first. One
 * function for both, so the pre-flight and the resume it guards classify the
 * same suspension the same way.
 */
export function resolveResumeTarget(
    flows: AutomationEngine['flows'],
    runId: string,
    run: Pick<SuspendedRun, 'flowName' | 'nodeId'>,
): { flow: FlowParsed; node: FlowParsed['nodes'][number] } | { cause: string } {
    const flow = flows.get(run.flowName);
    if (!flow) return { cause: `Flow '${run.flowName}' not found for run '${runId}'` };
    const node = flow.nodes.find(n => n.id === run.nodeId);
    if (!node) return { cause: `Suspended node '${run.nodeId}' no longer exists in flow '${run.flowName}'` };
    return { flow, node };
}

/** The body of {@link AutomationEngine.settleUnresumableSuspension}, moved unedited; that method's docblock is its contract. */
export async function settleUnresumableSuspension(this: Pick<RunResumeHost, 'nodeTypeVocabularySealed' | 'claimAdvance' | 'evictConsumedSuspension' | 'forgetSuspendedRun' | 'recordLog' | 'logger'>, run: SuspendedRun, cause: string): Promise<AutomationResult> {
    const refusal: AutomationResult = { success: false, code: 'RUN_NOT_FOUND', error: cause };
    if (!this.nodeTypeVocabularySealed) return refusal;
    const claim = await this.claimAdvance(run);
    if (claim.kind === 'lost') {
        // [#15832] The store answered and holds no row where this replica
        // read one, so whatever snapshot this process still holds is stale.
        this.evictConsumedSuspension(run.runId);
        return refusal;
    }
    if (claim.kind === 'unavailable') {
        return {
            success: false,
            code: 'STORE_UNAVAILABLE',
            error:
                `Run '${run.runId}' can never continue (${cause}), but the durable suspended-run store was ` +
                `unreachable while settling it, and whether the store consumed the suspension is UNKNOWN (a ` +
                `failure can arrive after a committed delete), so its record may still read paused. Retry once ` +
                `the store is available: a retry that finds the run still parked settles it, and one that finds ` +
                `the suspension gone answers RUN_NOT_FOUND: ${claim.message}`,
        };
    }
    await this.forgetSuspendedRun(run, 'failed', claim.kind === 'claimed');
    try {
        this.recordLog({
            id: run.runId,
            flowName: run.flowName,
            flowVersion: run.flowVersion,
            status: 'failed',
            startedAt: run.startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - run.startTime,
            trigger: buildRunTrigger(run.context),
            steps: run.steps,
            error: cause,
        }, run.context);
    } catch (bookkeeping) {
        // #4632 verdict: DURABILITY, so `error`. The suspension is consumed
        // and the caller is answered the truthful refusal, so nothing reads
        // as wrong from the outside. But the `failed` row that says why
        // never landed, and nothing retries it. Same sink and same level as
        // the #16274 completion guard. THIRD argument per
        // `error(message, error?, meta?)`; the `Error` slot stays empty
        // (#5575) and the thrown text rides the structured slot (#6499).
        this.logger.error(
            `[Automation] run '${run.runId}' of flow '${run.flowName}' can never continue and its suspension ` +
                `was consumed, but recording its terminal 'failed' history threw, so no history row says why: ` +
                `the caller was answered RUN_NOT_FOUND, the run no longer reads as paused, and nothing retries ` +
                `the write. Fix the history failure in this record's meta.`,
            undefined,
            describeThrownForLog(bookkeeping),
        );
    }
    return refusal;
}

/** The body of {@link AutomationEngine.cancelRun}, moved unedited; that method's docblock is its contract. */
export async function cancelRun(this: Pick<RunResumeHost, 'loadSuspendedRunStrict' | 'logger' | 'forgetSuspendedRun' | 'recordLog'>, runId: string, reason?: string): Promise<boolean> {
    let run: SuspendedRun | null = null;
    try {
        run = await this.loadSuspendedRunStrict(runId);
    } catch (err) {
        // #6299 — same family, same mechanism as `forgetSuspendedRun`
        // above: the driver's uncontrolled text goes to the structured
        // slot so the record stays one physical line.
        //
        // #4632 verdict: DURABILITY — raised from `warn` to `error`. The
        // failed read is silently turned into "no such suspended run"
        // and this method returns `false`, which its own contract
        // documents as idempotent success (already terminal / unknown),
        // so the cancellation is SKIPPED while the call reads clean. The
        // only in-repo caller measures the cost: plugin-approvals'
        // revise-window recall
        // (`packages/plugins/plugin-approvals/src/approval-service.ts`)
        // never reads the boolean at all — it only catches a THROW, and
        // grades that throw `error` with "the run may be stranded"
        // (#4420). A store-read failure produces precisely that stranded
        // run WITHOUT firing that alarm: the request is marked
        // `recalled`, the record lock is released, `resumeError` stays
        // undefined — and the run stays parked in the store, to be
        // re-armed and resumed by the next restart, inside a flow whose
        // approval has already been withdrawn.
        //
        // This is why #6230's verdict must not be copied here.
        // `loadSuspendedRun` is a DECLARED best-effort reader for
        // incidental callers (a gate lookup, a screen fetch), and
        // `resumeInternal` takes the strict form exactly where the
        // difference matters. `cancelRun` has no strict alternative, and
        // its degradation decides a WRITE.
        //
        // THIRD argument (`error(message, error?, meta?)`), `Error` slot
        // deliberately empty (#5575).
        this.logger.error(
            `[automation] cancelRun('${runId}') could not read the durable suspended-run store, so the ` +
                `cancellation was SKIPPED and reported as idempotent success — this call returns false, which ` +
                `its callers read as "no such suspended run". The run is NOT cancelled: if it is parked in the ` +
                `store it stays parked, and the next restart re-arms and resumes it while the caller has ` +
                `already recorded the cancellation. Fix the store failure in this record's meta, then re-issue ` +
                `cancelRun('${runId}').`,
            undefined,
            describeThrownForLog(err),
        );
    }
    if (!run) return false;
    await this.forgetSuspendedRun(run, 'cancelled');
    this.recordLog({
        id: run.runId,
        flowName: run.flowName,
        flowVersion: run.flowVersion,
        status: 'cancelled',
        startedAt: run.startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - run.startTime,
        trigger: buildRunTrigger(run.context),
        steps: run.steps,
        error: reason,
    }, run.context);
    return true;
}

/** The body of {@link AutomationEngine.cloneVariablesAtPause}, moved unedited; that method's docblock is its contract. */
export function cloneVariablesAtPause(this: Pick<RunResumeHost, 'logger'>, run: SuspendedRun, runId: string): SuspendedRun['variables'] {
    try {
        return JSON.parse(JSON.stringify(run.variables)) as SuspendedRun['variables'];
    } catch (err) {
        // #6299 family — the thrown text is not ours to shape, so it rides
        // the structured slot and never the message.
        this.logger.warn(
            `[automation] run '${runId}': could not copy the paused variables before resuming, so if this ` +
                `resume strands the run, the suspension an operator restores may carry state this attempt ` +
                `wrote rather than the state at the pause. The run resumes normally either way.`,
            describeThrownForLog(err),
        );
        return run.variables;
    }
}

/** The body of {@link AutomationEngine.failAncestors}, moved unedited; that method's docblock is its contract. */
export async function failAncestors(
    this: Pick<RunResumeHost, 'loadSuspendedRun' | 'failSuspendedRun' | 'consumedSuspensions'>,
    context: AutomationContext | undefined,
    error: string,
    strandedRunId?: string,
): Promise<void> {
    let parentId = (context as Record<string, unknown> | undefined)?.$parentRunId;
    let below = strandedRunId;
    let hops = 0;
    while (typeof parentId === 'string' && parentId && hops++ < 32) {
        // [#14332] The DEGRADING loader, by deliberate choice: this walk runs
        // inside the catch arm that is already handling a run's failure, so it
        // must not throw, and its recorded posture is exactly
        // `loadSuspendedRun`'s — a store failure reads as "no ancestor here"
        // and stops the walk. What changes is only WHICH suspension is read:
        // the shared store's, not this replica's memory of where the parent
        // was last parked. The old `??` chain had #13617's own harm shape —
        // a stale parent failed at a node it had already left, so
        // `forgetSuspendedRun` released the wrong node's pause. The one thing
        // gained beyond that: the bare `.catch(() => null)` swallowed a store
        // failure in total silence, and the loader records it (at `warn`,
        // its declared best-effort level — no new `error` seam here).
        const parent = await this.loadSuspendedRun(parentId);
        if (!parent) return;
        await this.failSuspendedRun(
            parent,
            `subflow descendant failed: ${error}`,
            // [#15222] Earned, not assumed: only a descendant this process
            // actually holds a snapshot for makes the ancestor's own
            // snapshot a promise the restore verb can keep.
            below !== undefined && this.consumedSuspensions.has(below) ? below : undefined,
        );
        below = parent.runId;
        parentId = (parent.context as Record<string, unknown> | undefined)?.$parentRunId;
    }
}

/** The body of {@link AutomationEngine.persistSuspendedRun}, moved unedited; that method's docblock is its contract. */
export async function persistSuspendedRun(this: Pick<RunResumeHost, 'suspendedRuns' | 'store' | 'cacheOnlySuspensions' | 'logger'>, run: SuspendedRun): Promise<void> {
    // [#16129] THE MAP WRITE IS FIRST, and `cacheOnlySuspensions` is written
    // only after the save below settles => for the whole duration of that
    // await this entry is in the map and is NOT yet qualified. A concurrent
    // per-id `loadSuspendedRunStrict` therefore reads a store that
    // truthfully has no row yet, finds no qualifier, and takes
    // `evictConsumedSuspension` on a run being parked RIGHT NOW. Reachable
    // without out-of-band knowledge of the id, because the map write is what
    // publishes it to `listSuspendedRuns`.
    //
    // Bounded, measured, and pinned in
    // `suspended-run-mid-park-eviction-window.test.ts`: the store-first
    // strict load keeps the run resumable once the save lands, and the cost
    // falls entirely on `listSuspendedRuns`, which merely OMITS the run --
    // inside that listing's declared latitude. Do not widen the marking, add
    // a lock, or move the save above this line without reading that pin's
    // header.
    //
    // [#16151] The ONE compound case that ESCAPED those bounds — an evicting
    // read inside the window, and then the save FAILING, leaving the run
    // with neither a durable row nor a map entry — is closed in the catch
    // below, which re-seats this entry. The base window itself is
    // deliberately unchanged: while the save is still in flight a per-id
    // read still evicts, and bound 1 still carries it.
    this.suspendedRuns.set(run.runId, run);
    if (this.store) {
        try {
            await this.store.save(run);
            // [#13617] The store now holds this pause, so it — not this map
            // — is the answer for it. Cleared here and not only on the
            // failure path: a re-suspend whose save lands after an earlier
            // one failed must stop being read out of memory.
            this.cacheOnlySuspensions.delete(run.runId);
        } catch (err) {
            // [#13617] The store was never given the row, so its "no such
            // run" is silence about this run rather than an answer. This is
            // what lets `loadSuspendedRunStrict` keep serving it from the
            // map — the in-process resumability the message below promises.
            this.cacheOnlySuspensions.add(run.runId);
            // [#16151] RE-SEAT THE MAP ENTRY — the marking above qualifies
            // an entry that may no longer be there. The map write at the
            // top of this method is NOT yet qualified for the whole
            // duration of the await, so a concurrent per-id
            // `loadSuspendedRunStrict` reads a store that truthfully has no
            // row, finds no qualifier, and evicts a run being parked right
            // now. Compound that with THIS save failing and the run was
            // left with neither a durable row nor a map entry:
            // `hasSuspendedRun` answered `false` and `resume` answered
            // `RUN_NOT_FOUND` — the run lost IN-PROCESS, while the record
            // below told the operator it was "kept in memory only" and that
            // they had until the next restart to act.
            //
            // Re-seating restores exactly this method's own write, on the
            // one path where the store refused the row. It cannot resurrect
            // a CONSUMED suspension: consumption goes through
            // `forgetSuspendedRun`, which is reachable only once
            // `loadSuspendedRunStrict` answers for this run, and for the
            // whole of this await it answers `null` for the reason above.
            // Nor can it clobber a NEWER entry: `persistSuspendedRun` is the
            // only writer of this map, and a second park of the same run
            // needs a resume that the same `null` refuses.
            //
            // ⛔ NOT a widening of the cache-only marking, which #16129
            // forbids taking unilaterally because it would weaken #13617's
            // store authority: the marking still happens only after the
            // save has settled, and only when it settled as a FAILURE.
            this.suspendedRuns.set(run.runId, run);
            // #6499 — the cause is the datasource DRIVER's own text, so it
            // goes to the logger's STRUCTURED slot, never spliced into the
            // message; see `forgetSuspendedRun`'s catch below for the full
            // mechanism (#6299) — this seam is its nearest twin, on the
            // same `SuspendedRunStore` driver.
            //
            // #4632 verdict: DURABILITY — the level STAYS `error`, where
            // #4460 put it: the docblock above argues it (#4420 is this
            // exact seam's accident). Third argument per the `Logger`
            // contract (`error(message, error?, meta?)`); the `Error` slot
            // stays empty on purpose (#5575).
            this.logger.error(
                `[automation] failed to persist suspended run '${run.runId}' to the durable store — it is ` +
                    `kept in memory only: this process keeps it resumable, and hasSuspendedRun() and ` +
                    `listSuspendedRuns() both still answer for it — if they do not, this run is already ` +
                    `gone and that is a defect in this engine, not in the store. It will NOT be resumable ` +
                    `after a restart. Fix the store failure in this record's meta.`,
                undefined,
                describeThrownForLog(err),
            );
        }
    }
}

/** The body of {@link AutomationEngine.forgetSuspendedRun}, moved unedited; that method's docblock is its contract. */
export async function forgetSuspendedRun(
    this: Pick<RunResumeHost, 'suspendedRuns' | 'cacheOnlySuspensions' | 'store' | 'logger' | 'releaseSuspension'>,
    run: SuspendedRun,
    reason: SuspensionReleaseReason,
    /**
     * [#14333] Set only by the resume path, and only when
     * {@link claimAdvance} has ALREADY removed the durable row as its
     * compare-and-set. The unconditional delete below would then be a
     * second round-trip that can only re-delete what is gone — while the
     * rest of this choke point (the cache entry, the cache-only
     * qualifier, and the executor's release notification) is still owed
     * exactly once. Nothing else may pass it: for every other consumption
     * the durable row is still there and this method is what removes it.
     */
    durableRecordAlreadyConsumed = false,
): Promise<void> {
    this.suspendedRuns.delete(run.runId);
    // [#13617] The qualifier goes with the entry it qualifies — this is the
    // one choke point every consumption passes through, so nothing can leave
    // a run marked "the store never took this" after its map entry is gone.
    this.cacheOnlySuspensions.delete(run.runId);
    if (this.store && !durableRecordAlreadyConsumed) {
        try {
            await this.store.delete(run.runId);
        } catch (err) {
            // #6299 — the cause goes to the logger's STRUCTURED slot, never
            // spliced into the message: it is the datasource DRIVER's own
            // failure text, we do not control how many lines it has, and
            // `ObjectLogger.write()` adds exactly one `<ts> <LEVEL>` head
            // per call — so a newline in it turns this ONE record into
            // several physical lines of which only the first is greppable.
            // The family of #5048 / #5575 / #5636 / #5661 / #5737 / #5912 /
            // #6230, and cloud#971's shape.
            //
            // #4632 verdict: DURABILITY — raised from `warn` to `error`, and
            // deliberately NOT a copy of #6230's "the level stays warn". The
            // hot cache is dropped on the line ABOVE the try, and this
            // method is the single choke point every consumption of a
            // suspension passes through (resume / terminal failure /
            // cancel), so on this path the suspension is gone in-process
            // while the durable row SURVIVES. Every caller still reports
            // success — `resume()` returns a successful result, `cancelRun()`
            // returns `true`, `recordLog` writes a terminal record — and the
            // surviving row is read straight back out after the next
            // restart: `rearmSuspendedWaitTimers` lists it and `resume()`
            // rehydrates it through `loadSuspendedRunStrict`'s store read,
            // re-running a continuation that has already run. Nothing
            // retries this delete. That is the shape the durability gate's
            // own vocabulary already grades `error` for the metadata store
            // (`deleteMetaItemFromLoader`, #5259: "the surviving row is read
            // straight back out of storage … so the 'deleted' item reappears
            // and survives every restart"). `check:durability-log-level`
            // cannot see it HERE only because `SuspendedRunStore.delete` is
            // not in its declared callee vocabulary — which is exactly why
            // this level is pinned by a test instead.
            //
            // THIRD argument, per the `Logger` contract
            // (`packages/spec/src/contracts/logger.ts`):
            // `error(message, error?, meta?)`. The `Error` slot is left
            // empty on purpose (#5575) — a raw `Error` there ships its stack
            // trace on every record.
            this.logger.error(
                `[automation] suspended run '${run.runId}' was consumed (${reason}) but could NOT be deleted from ` +
                    `the durable store — the in-memory suspension is already gone while the durable row SURVIVES, ` +
                    `so this run reads as terminal now and as still-suspended after the next restart, where ` +
                    `rearmSuspendedWaitTimers lists it and resume() rehydrates it from the store and re-runs a ` +
                    `continuation that has already run. Nothing retries this delete. Fix the store failure in this ` +
                    `record's meta, then delete the row for '${run.runId}' by hand.`,
                undefined,
                describeThrownForLog(err),
            );
        }
    }
    await this.releaseSuspension(run, reason);
}

/** The body of {@link AutomationEngine.evictConsumedSuspension}, moved unedited; that method's docblock is its contract. */
export function evictConsumedSuspension(this: Pick<RunResumeHost, 'store' | 'cacheOnlySuspensions' | 'suspendedRuns'>, runId: string): void {
    if (!this.store) return;
    if (this.cacheOnlySuspensions.has(runId)) return;
    this.suspendedRuns.delete(runId);
}

/** The body of {@link AutomationEngine.takeSubflowParentStrand}, moved unedited; that method's docblock is its contract. */
export function takeSubflowParentStrand(this: Pick<RunResumeHost, 'subflowParentStrands'>, childRunId: string): SubflowParentStrand | undefined {
    const found = this.subflowParentStrands.get(childRunId);
    if (found) this.subflowParentStrands.delete(childRunId);
    return found;
}

/** The body of {@link AutomationEngine.resumeInternal}, moved unedited; that method's docblock is its contract. */
export async function resumeInternal(
    this: Pick<RunResumeHost, 'resuming' | 'loadSuspendedRunStrict' | 'logger' | 'flows' | 'settleUnresumableSuspension' | 'creditChildRun' | 'loadSuspendedRun' | 'resumeInternal' | 'persistSuspendedRun' | 'failSuspendedRun' | 'consumedSuspensions' | 'buildSubflowResumeSignal' | 'refuseInvalidScreenInput' | 'cloneVariablesAtPause' | 'resolveDecisionSegmentContext' | 'claimAdvance' | 'evictConsumedSuspension' | 'forgetSuspendedRun' | 'executeNode' | 'traverseNext' | 'recordLog' | 'bubbleToParent' | 'finishRefusedRun' | 'journalConsumedSuspension' | 'failAncestors'>,
    runId: string,
    // Never `undefined` past the public door: `resume` normalises an
    // absent caller signal to `{}` (commit 7307191db), and the engine's own
    // continuations (subflow delegation / up-bubble, `map` re-entry)
    // always hand over a built signal. Typed so, the chokepoints below
    // cannot grow a falsy-signal branch again.
    signal: ResumeSignal,
    skipBubble: boolean,
    childSummary?: FlowRunSummary,
    childRefusal?: ChildRunRefusal,
): Promise<AutomationResult> {
    // Idempotency guard (set synchronously, before any await): reject a
    // concurrent duplicate resume of the same run so side effects can't run
    // twice. A duplicate that arrives *after* this one finishes finds no
    // suspended run and returns the "no suspended run" error below.
    if (this.resuming.has(runId)) {
        return { success: false, code: 'RESUME_IN_PROGRESS', error: `Run '${runId}' is already being resumed` };
    }
    this.resuming.add(runId);
    try {
        // Hot path: suspended in this process. Cold path: rehydrate from the
        // durable store (e.g. the process restarted since the pause, ADR-0019).
        //
        // Strict load: a store that cannot be READ must not report as
        // "no such run" (#4420). A caller that already persisted a decision
        // needs "retry when the store is back" to be distinguishable from
        // "this run is gone for good" — same failure, opposite remedy.
        let run: SuspendedRun | null;
        try {
            run = await this.loadSuspendedRunStrict(runId);
        } catch (err) {
            const message = (err as Error).message;
            // #5912 — the LOG record's cause goes to `meta`, never into the
            // message. `message` is the datasource DRIVER's own failure text
            // and we do not control how many lines it has;
            // `ObjectLogger.write()` adds one `<ts> <LEVEL>` head per call, so
            // a newline in it turns this ONE record into several physical
            // lines of which only the first is greppable — the family of
            // #5048 / #5575 / #5636 / #5661 / #5737, and cloud#971's shape.
            //
            // Third argument, per the `Logger` contract
            // (`packages/spec/src/contracts/logger.ts`)
            // `error(message, error?, meta?)`. NOT the second: that is the
            // `Error` slot and a raw error there ships its whole stack on
            // every record (#5575). `runId` stays in the message — it is the
            // caller's own handle, the same call the family's other seams
            // make for their ids, not the foreign text this fix is about.
            //
            // Level stays `error`: the run is on disk and the resume did not
            // land, which is #4632's durability degradation exactly.
            this.logger.error(
                `[automation] durable suspended-run store unreachable while resuming '${runId}' — the suspension was ` +
                    `NOT consumed, so the run stays parked and this resume can be retried verbatim once the store is ` +
                    `reachable; the caller was told the same via the STORE_UNAVAILABLE result. The store's own failure ` +
                    `is in this record's meta.`,
                undefined,
                describeThrownForLog(err),
            );
            // The RESULT envelope keeps the cause spliced in, verbatim and
            // deliberately (#5636 made the same call for `degradedReason`):
            // this is a structured return value a caller reads as a whole —
            // over REST it is a JSON string field, never split on newlines —
            // and PR #5911 already made wait-node put it into `meta` intact.
            return {
                success: false,
                code: 'STORE_UNAVAILABLE',
                error: `Durable suspended-run store unreachable for run '${runId}' — retry once the store is available: ${message}`,
            };
        }
        if (!run) {
            return { success: false, code: 'RUN_NOT_FOUND', error: `No suspended run '${runId}'` };
        }
        // [#8684] The two NEVER-DISPATCHED exits, classified HERE rather than
        // guessed at the transport. Both mean the suspension is real but can
        // never continue — the flow it belongs to is no longer registered, or
        // the node it parked on was edited away underneath it. Nothing ran,
        // so neither is a business rejection: they are the same terminal
        // "this pause is gone for good" class as a missing suspension, and a
        // transport answers all three **404**.
        //
        // Code-less until now, which is what forced the route to either
        // answer them 200 (the defect this card is about) or sniff the result
        // for `summary`/`durationMs` to tell them from a run that ran and
        // failed — the tolerant-consumer shape PD #12 forbids. The producer
        // is the only component that knows, so it says so.
        //
        // Deliberately the EXISTING `RUN_NOT_FOUND` rather than a new code:
        // the remedy is identical (this run is finished; start a new one),
        // the consumer branches on the 404 STATUS and not on the code
        // (objectui's `interpretFlowResponse`), and `error` below still names
        // which of the three causes it was, verbatim on the wire. A distinct
        // code would be vocabulary nothing reads — add one the day a caller
        // needs to branch on the difference.
        //
        // [#23963] And the verdict is carried onto the RUN, not only onto
        // the answer: both exits go through
        // {@link settleUnresumableSuspension}, which moves the parked row to
        // `failed` with this same text in `error`. Answering "gone for
        // good" while the row kept `status: 'paused'` left it resumable on
        // every surface that reads the row, and outside retention, whose
        // scope is terminal statuses only.
        //
        // [#26477] The classification itself is {@link resolveResumeTarget},
        // shared with the read-only probe a caller asks BEFORE it writes
        // anything of its own, so the two cannot disagree.
        const target = resolveResumeTarget(this.flows, runId, run);
        if ('cause' in target) return this.settleUnresumableSuspension(run, target.cause);
        const { flow, node } = target;

        // #4354 — up-bubble: the child that just finished did work this run
        // is accountable for. Credit it to the step that suspended awaiting
        // it, before traversal appends anything further.
        this.creditChildRun(run.steps, run.nodeId, childSummary);

        // [#18714] The refusal this run must end on instead of continuing
        // past its `subflow` / `map` node, if any. Seeded from the UP-BUBBLE
        // leg (the child's own frame drove this resume and already knows),
        // and set below by the DELEGATED leg (this frame drives the child
        // and reads its answer). Both legs hand it to the ONE throw site
        // inside the traversal `try` further down, so a refusal leaves this
        // method through the same `finishRefusedRun` chokepoint every other
        // producer uses — see `ChildRunRefusal`.
        let pendingChildRefusal: ChildRunRefusal | undefined = childRefusal;

        // ── Subflow delegation (nested pause): this run is paused at a
        // `subflow` node whose child run itself suspended. The caller's
        // signal is meant for the node the CHILD paused on (its screen /
        // approval / wait), so forward it down. The child resumes with
        // bubbling off — when it completes, *this* invocation continues the
        // parent from the subflow node with the child's output, using the
        // same mapping as the synchronous path.
        if (typeof run.correlation === 'string' && run.correlation.startsWith('subflow:')) {
            const childRunId = run.correlation.slice('subflow:'.length);
            // Capture the child's row BEFORE resuming consumes it — the
            // output-variable mapping rides on the child's context.
            const childRun = await this.loadSuspendedRun(childRunId);
            if (childRun) {
                const childRes = await this.resumeInternal(childRunId, signal, true);
                if (childRes.status === 'paused') {
                    // Child paused again (e.g. the next screen of a wizard).
                    // This run stays suspended; refresh its surfaced screen
                    // so a re-fetch (getSuspendedScreen) shows the new one.
                    if (childRes.screen && childRes.screen !== run.screen) {
                        await this.persistSuspendedRun({ ...run, screen: childRes.screen });
                    }
                    return {
                        success: true,
                        status: 'paused',
                        runId,
                        durationMs: Date.now() - run.startTime,
                        screen: childRes.screen,
                        // THIS run's flow, not the child's: the caller
                        // addressed this run id and its runner names the
                        // flow it launched. The child only lends a screen.
                        flowLabel: flow.label,
                    };
                }
                // [#14379] A child REFUSAL is not a child failure. The
                // codes in {@link RETRYABLE_RESUME_REFUSAL_CODES} are this
                // method's own answers for a resume that never ran: the
                // child's screen contract is checked BEFORE
                // `forgetSuspendedRun` precisely so "a rejected bag leaves
                // the pause live and the legitimate submission still lands"
                // (#4477), so the child is parked exactly where it was.
                //
                // Reading those as a terminal failure consumed the PARENT's
                // pause over a mistyped form field — and the screen-flow
                // path is where a caller holds ONE stable run id, the
                // parent's, and posts every wizard step to it. The run was
                // gone, the still-paused child orphaned with nothing left
                // to bubble into, the caller told `400 FLOW_FAILED` ("it
                // ran and was rejected") for something that never ran, and
                // their corrected retry on that same id answered
                // `RUN_NOT_FOUND`.
                //
                // The child's envelope is answered VERBATIM but for the
                // parent's `durationMs`. Propagating the `code` is half the
                // fix: a code-less envelope is exactly what forced the
                // transport onto `400 FLOW_FAILED`, and leaving both pauses
                // alive while still answering one repairs the state and
                // leaves the caller equally misled. The child's `error` is
                // the actionable half — `Screen field "kind" is required` —
                // where the failure text below names neither the problem
                // nor anything a caller can act on. Nothing else moves:
                // neither pause is consumed, and the parent's surfaced
                // screen needs no refresh because the child did not
                // advance.
                if (!childRes.success && isRetryableResumeRefusal(childRes.code)) {
                    return { ...childRes, durationMs: Date.now() - run.startTime };
                }
                if (!childRes.success) {
                    const error = `subflow run '${childRunId}' (${childRun.flowName}) failed: ${childRes.error ?? 'unknown error'}`;
                    // [#15222] This frame consumes its OWN pause here, and
                    // before this card journalled nothing for it — so a
                    // child that stranded left a repairable leaf under an
                    // ancestor no verb could reach. Journalled exactly when
                    // the child is repairable, asked of the journal rather
                    // than of the child's `status`: a child that itself
                    // cascade-failed from a deeper strand carries no status
                    // word at all (see the return below) and is repairable
                    // all the same, which is what makes a chain deeper than
                    // two levels re-armable by induction.
                    //
                    // ⛔ And the envelope below is UNCHANGED — no status is
                    // stamped on it. `'stranded'` belongs to the run that
                    // consumed its own pause and then threw downstream;
                    // stamping it here would tell an operator to retry a
                    // recovery that cannot succeed, because nothing re-arms
                    // this run by resuming it. What reaches this run is
                    // {@link restoreConsumedSuspension}, through the
                    // journal one line up.
                    await this.failSuspendedRun(
                        run,
                        error,
                        this.consumedSuspensions.has(childRunId) ? childRunId : undefined,
                    );
                    // #27743 — the child's refusal, carried beside the
                    // re-worded `error` exactly as the synchronous `subflow`
                    // arm carries it (`inner-refusal.ts`): this is the leg a
                    // caller holding the PARENT's run id takes, and without it
                    // a refusal met after the child's pause reached that
                    // caller as text only. `{}` for a child that met none.
                    return {
                        success: false,
                        error,
                        durationMs: Date.now() - run.startTime,
                        flowLabel: flow.label,
                        ...carriedRefusalOfResult(childRes),
                    };
                }
                // [#18714] DELEGATED-LEG REFUSAL. The child ran to a
                // refusing terminal — an `end` declaring
                // `outcome: 'refused'`, or a node of its own whose child
                // refused — and answered `{ success: true, status:
                // 'refused' }`, because *a refusal is a successful
                // evaluation that says no*. The branch set above tests only
                // `paused` and `!success`, so until this arm existed a
                // refused child was neither and fell straight through the
                // ordinary success exit below: measured, the parent
                // returned `{ success: true, successMessage: … }`, its run
                // row recorded `completed`, and the node downstream of the
                // `subflow` RAN. That is the identical fail-open shape
                // #18110 / #18555 closed on the synchronous leg, still open
                // on the leg 「the one a screen flow actually takes」.
                //
                // ⛔ NOT folded into the `!childRes.success` arm above. That
                // arm calls `failSuspendedRun` and records the parent
                // `failed`; a refusal is not a failure — it must not be
                // routable by a `fault` edge, must not consume retry budget
                // and must not be counted in `nodes[].failures`, all of
                // which the failure arm would confer. The parent's terminal
                // row must read `refused`, the same word the child's does.
                //
                // Recorded, ⛔ not thrown here. The pause is not consumed
                // yet — `claimAdvance` / `forgetSuspendedRun` are still
                // below — and a refusal that unwound from this position
                // would leave the parent's own suspension live while its
                // run row said terminal. The throw site inside the
                // traversal `try` is past the consumption, which is why
                // both legs converge there.
                //
                // The mapping below still runs, deliberately: the child's
                // declared outputs really were produced and the nodes
                // before its refusal really ran, so the parent's answer
                // must not depend on HOW the child ended — the same call
                // the synchronous `subflow` arm makes when it returns the
                // success envelope PLUS `refuse`.
                if (childRes.status === 'refused') {
                    pendingChildRefusal = { message: childRes.refusalMessage };
                }
                // Child completed — continue below with its output as the
                // resume signal (replaces the caller's signal, which the
                // child already consumed).
                signal = this.buildSubflowResumeSignal(childRun.context, childRes.output);
                // #4354 — down-delegation is the other way a child's work
                // lands under a parent step written at suspend time.
                this.creditChildRun(run.steps, run.nodeId, childRes.summary);
            } else if (carriesSubflowChildOutput(signal)) {
                // The engine-built UP-BUBBLE — the HEALTHY path, and the
                // one this `else` used to describe as a degradation. The
                // child COMPLETED and `bubbleToParent` resumed this run
                // with the child's mapped output, so the miss above is the
                // SUSPENSION lookup missing (a completed run has no
                // suspension), not the child having disappeared, and the
                // parent continues *with* the child's output — which is
                // what the old sentence denied outright.
                //
                // `debug`, for the same reason as the lost-advance-claim
                // record further down: an ordinary outcome logged at `warn`
                // on every healthy subflow completion is the cry-wolf
                // shape — the operator who reads "child run is gone" on
                // each one stops reading the line, and the one time it
                // means what it says is the time it is ignored. Nothing
                // else moves: this branch continues the parent exactly as
                // before, and the degraded branch below keeps its text and
                // its level.
                this.logger.debug(
                    `[automation] run '${runId}' continues from subflow node '${run.nodeId}' with the output of ` +
                        `completed child run '${childRunId}' — carried on the engine-built up-bubble signal ` +
                        `(the child's suspension is consumed, which is why it is not loadable here).`,
                );
            } else {
                // The genuinely degraded case, and the only one the
                // sentence below was ever true of: nothing suspended under
                // the child id AND no carried output, so this run really
                // does continue without the child's output. #4632 verdict:
                // FUNCTIONAL — stays `warn`.
                this.logger.warn(
                    `[automation] run '${runId}' is paused at subflow node '${run.nodeId}' but child run '${childRunId}' ` +
                        `is gone — continuing without child output`,
                );
            }
        }

        // The SCREEN contract (#4477). A run parked on a `screen` node
        // declared exactly which keys it collects and which are required;
        // until this ran, `resume` folded any bag at all straight into the
        // variables, so a caller that skipped the dialog bypassed every
        // `required` the author wrote. Checked here — beside the engine's
        // other resume refusals and BEFORE the suspension is consumed — so
        // a rejected bag leaves the pause live and the legitimate
        // submission still lands.
        const screenRefusal = this.refuseInvalidScreenInput(run, runId, signal);
        if (screenRefusal) return screenRefusal;

        // Restore the variable context and fold the signal in — the ONE
        // place a resume signal reaches the variable map. Runs BEFORE the
        // suspension is consumed, so a rejected signal changes nothing:
        // the pause stays live and the legitimate continuation still lands.
        const variables = new Map<string, unknown>(Object.entries(run.variables));
        const rejected = applyResumeSignal(variables, signal, run.nodeId);
        if (rejected.length) {
            // #6654 — the rejected names are the CALLER's resume-signal
            // keys (nothing constrains them against newlines), so they
            // ride the structured slot, never the message; see
            // `forgetSuspendedRun`'s catch for the full mechanism (#6299).
            // The returned INVALID_SIGNAL envelope below is caller-facing
            // refusal text, not a log record — it keeps naming the
            // variables (the envelope class is ruled elsewhere).
            // #4632: FUNCTIONAL — stays `warn`.
            this.logger.warn(
                `[automation] refused resume of run '${runId}': signal writes engine-internal ` +
                    `variable(s) — the rejected names are in this record's meta.`,
                { rejected },
            );
            return {
                success: false,
                code: 'INVALID_SIGNAL',
                error:
                    `Resume signal may not set engine-internal variables (${rejected.join(', ')}) — ` +
                    `names starting with '$' (or containing '.$') are reserved by the flow engine`,
            };
        }

        // [#13909] How long the step log was AT THE PAUSE, read before
        // anything downstream runs. `steps` below is the SAME array
        // `traverseNext` appends to, so by the time the catch arm builds a
        // restore snapshot the pause's own step log is no longer
        // recoverable from it — this integer is what trims it back. One
        // `int` on every resume and nothing else: the snapshot itself is
        // built only on the failure path.
        //
        // ⛔ Deliberately NOT a change to the ordering. The consumption
        // below still precedes the traversal, `forgetSuspendedRun` is
        // untouched, and `hasSuspendedRun` still answers false for the
        // whole traversal window (pinned in
        // `consumed-suspension-restore.test.ts`). That order is RULED,
        // not inherited: #13937 shape 4 (maintainer 2026-09-01) keeps it
        // for exactly-once across a crash, excludes the flip (shape 2)
        // unless a durable claim/lease lands with it, and excludes
        // consume-then-re-arm (shape 3) outright. The exit from the state
        // it leaves behind is `restoreConsumedSuspension`, and the state
        // itself is named on the result (`status: 'stranded'`, below).
        const stepCountAtPause = run.steps.length;
        // [#15660] …and the variables AT THE PAUSE, for the same reason and
        // at the same moment, because `run.steps.length` is not the only
        // thing the failed attempt can move under the journal.
        //
        // `journalConsumedSuspension` promises its snapshot VERBATIM — "the
        // state at the pause, not the state the failed attempt was working
        // from" — and delivered that only for the TOP-LEVEL keys. The scope
        // the downstream nodes run against is built one line below as
        // `new Map(Object.entries(run.variables))`, which copies the keys
        // and SHARES every value object. A node that holds state in the
        // scope and updates it in place — `map` keeps `<nodeId>.$mapState`
        // and is, by a re-derived census, the only executor that does —
        // therefore writes straight through into the object the journal
        // later hands an operator as the pause.
        //
        // Measured, not read (`consumed-suspension-snapshot-aliasing.test.ts`):
        // the durable row held `started: 1` at the pause and the restore put
        // back `started: 99`. ⛔ And the two placements the card proposed
        // are both refuted by that same measurement:
        //   - "deep copy at SNAPSHOT time" — `InMemorySuspendedRunStore`
        //     already JSON round-trips on save AND load, so this run's
        //     variables ARE a private deep copy before a single downstream
        //     node runs. It reproduces anyway: the aliasing that carries the
        //     mutation is minted HERE, on the resume, not at the suspend.
        //   - "copy at RESTORE time" — the mutation lands before the node
        //     throws, so the journal is already corrupt when it is written;
        //     anything copied at or after that point copies the corruption.
        // The copy has to be taken before the failed attempt runs, which is
        // this line.
        //
        // Cost, measured rather than assumed (the card flagged it NOT
        // MEASURED): 5.8 µs for a typical scope, and one suspend+resume
        // round trip against a configured store already performs FOUR full
        // clones of this same payload (save ×1, load ×2, recordTerminal ×1),
        // so this is a fifth on a path whose production cost is a durable
        // round trip. ⛔ Deliberately NOT the JSON clone the journal's own
        // docblock ruled out: that objection was that it would run INSIDE a
        // catch arm already handling a failure, where a circular value would
        // throw the operator's repair away. Here it is on the happy path,
        // where a throw is just a value we decline to copy.
        const variablesAtPause = this.cloneVariablesAtPause(run, runId);

        // Ruling A on `FlowSchema.runAs`: who runs the nodes after this
        // pause — the decider, when the owning service's signal names one
        // (with their own grants on a `runAs:'user'` run, as the attribution
        // user of a still-elevated `runAs:'system'` run); otherwise the
        // identity the run paused with.
        // Resolved BEFORE the claim, so nothing here can run after the
        // suspension is consumed and leave it consumed with no continuation;
        // the persisted `run.context` is left as it was, and the repair
        // journal therefore still snapshots the pause exactly as it parked.
        const segmentContext = await this.resolveDecisionSegmentContext(run, signal);

        // Consume the suspension *before* running downstream work — a run
        // resumes exactly once per pause, and a duplicate resume after a
        // partial restart must not double-run side effects. (Folding the
        // signal above is pure in-memory work, not downstream work.)
        // This is also where the paused node learns its pause is over and
        // disarms what it armed on entry (#5512) — see forgetSuspendedRun.
        //
        // [#14333] And the consumption is now a CLAIM, not an assertion.
        // `resuming` above answered "is this process already resuming it";
        // this answers "did any process get here first", against the shared
        // store, atomically. Placed exactly where the unconditional consume
        // was: every refusal above it still refuses without consuming, and
        // the ordering #13937 ruled to keep is untouched.
        const claim = await this.claimAdvance(run);
        if (claim.kind === 'lost') {
            // An ORDINARY outcome, not a degradation: this is the guard
            // doing its job, and the caller is told in the result. `debug`
            // rather than `warn` for exactly that reason — a losing racer
            // per approval on a busy any-of level would otherwise be a
            // steady `warn` stream describing correct behaviour.
            this.logger.debug(
                `[automation] resume of run '${runId}' lost the advance claim at node '${run.nodeId}' — ` +
                    `another replica consumed this suspension first; nothing was dispatched here.`,
            );
            // The SAME code the in-process guard answers, deliberately: the
            // observation differs (another process, not this one) but the
            // remedy is identical — a concurrent resume already has this
            // run, the caller's own recorded outcome stands, and nothing
            // here should be retried. `plugin-approvals` already branches
            // on it that way (`resumeRecordedOutcome`), and the transport
            // already maps it to 409. A distinct code would be vocabulary
            // nothing reads — add one the day a caller needs the
            // difference.
            // [#15832] The store's compare-and-set ANSWERED: no row is parked
            // where this replica read it. Whatever snapshot this process
            // still holds for the run is stale by construction — it names a
            // node the run has left — so it stops being published by the two
            // listings. ⛔ NOT `forgetSuspendedRun`: nothing was consumed
            // here, and firing that choke point would tear the pause down a
            // second time in this process on top of the winner's own.
            this.evictConsumedSuspension(runId);
            return {
                success: false,
                code: 'RESUME_IN_PROGRESS',
                error:
                    `Run '${runId}' is already being resumed — another replica consumed its suspension ` +
                    `at node '${run.nodeId}' first`,
            };
        }
        if (claim.kind === 'unavailable') {
            // Same envelope, same reason as the strict load's failure
            // above: existence is UNKNOWN, not "gone for good", and the
            // identical call is expected to work once the store recovers
            // (#4420).
            //
            // The text states only what is KNOWN. The strict load's failure
            // can say the suspension was not consumed, because it fails
            // before anything is consumed; this one cannot — a claim throws
            // just as readily after a committed delete as before one, so
            // "NOT consumed" would be a claim about a fact this seam does
            // not have. What it does know is that this resume did not
            // continue the run, and that a retry settles the rest.
            return {
                success: false,
                code: 'STORE_UNAVAILABLE',
                error:
                    `Durable suspended-run store unreachable while claiming the advance for run '${runId}' — ` +
                    `this resume did NOT continue the run, and whether the store consumed the suspension is ` +
                    `UNKNOWN (a failure can arrive after a committed delete). Retry once the store is ` +
                    `available: a retry that finds the run still parked continues it, and one that finds the ` +
                    `suspension gone answers RUN_NOT_FOUND: ${claim.message}`,
            };
        }
        await this.forgetSuspendedRun(run, 'resumed', claim.kind === 'claimed');

        const steps = run.steps;
        const context = segmentContext;

        try {
            // [#18714] The child this run is parked on REFUSED — on either
            // resumed leg (see `ChildRunRefusal`). Thrown HERE, and the
            // position is the point:
            //
            //  - Past the consumption. `claimAdvance` and
            //    `forgetSuspendedRun` have run, so the parent's own pause is
            //    gone exactly as it is for every other way this resume can
            //    end. A refusal raised before them would record a terminal
            //    run while leaving its suspension live in
            //    `listSuspendedRuns()` — the very leak the up-bubble leg is
            //    filed for, moved one frame up.
            //  - Before the traversal. Nothing downstream of the awaiting
            //    node runs, which is the whole content of "a refusal stops
            //    the run".
            //  - As `FlowRefusalSignal`, so the `catch` below converts it
            //    through `finishRefusedRun` — ONE terminal shape, whichever
            //    producer raised it. ⛔ Deliberately not a second terminal
            //    exit of its own: this file's own history is a list of
            //    outcomes that became a function of WHICH ROUTE a run took.
            //
            // `run.nodeId` is the node that was awaiting the child — the
            // `subflow` / `map` this frame is parked on, the same node the
            // synchronous leg names on its `FlowRefusalSignal`.
            if (pendingChildRefusal) {
                throw new FlowRefusalSignal(run.nodeId, pendingChildRefusal.message);
            }
            // ── Map re-entry (sequential multi-instance, ADR-0037 A2).
            // A run paused at a `map` node (correlation `map:<childRunId>`)
            // does NOT continue past the node on resume — it RE-RUNS the
            // node so the executor can record the just-completed unit and
            // start the next item. The default path continues past the node.
            if (typeof run.correlation === 'string' && run.correlation.startsWith('map:')) {
                await this.executeNode(node, flow, variables, context, steps);
            } else {
                await this.traverseNext(node, flow, variables, context, steps, signal.branchLabel);
            }

            // Collect output variables
            const output: Record<string, unknown> = {};
            if (flow.variables) {
                for (const v of flow.variables) {
                    if (v.isOutput) output[v.name] = variables.get(v.name);
                }
            }
            const durationMs = Date.now() - run.startTime;
            // [#15944] THE RUN IS OVER AND IT SUCCEEDED. Everything from
            // here to the return is BOOKKEEPING ABOUT that fact, and the
            // `catch` below this `try` exists for NODE failures — so a
            // throw out of the history write was handled as though a node
            // had thrown: the arm journalled a repair snapshot, stamped
            // `status: 'stranded'`, answered `success: false`, and
            // {@link restoreConsumedSuspension} then honoured that
            // snapshot and re-armed the pause, so the NEXT resume RE-RAN
            // every node after it. Measured: `tail` ran twice.
            //
            // The guard restores the invariant `recordLog`'s own doc
            // states two screens down — "a history write must NEVER block
            // or break the run that produced it" — which that call was
            // relied upon to keep and did not.
            //
            // Two statements inside `recordLog` reach here on the terminal
            // path, and neither is hypothetical: `store.recordTerminal`,
            // whose SYNCHRONOUS throw escapes because the
            // `void write.catch(...)` beneath it only ever sees a returned
            // promise's rejection (both shipped stores are `async` and
            // cannot; the interface is exported, optional, and
            // host-implementable, and a store returning a non-thenable
            // makes `write.catch` itself a synchronous TypeError), and the
            // run-summary line `this.logger.info(line, meta)`, on by
            // default and calling a HOST-INJECTED logger.
            //
            // ⛔ NOT a widening of anything: no exit gains a status it
            // did not have, the node-failure arm below is untouched, and
            // the failure is REPORTED rather than swallowed — see the
            // catch. ⛔ And ⛔ deliberately not fixed at
            // `restoreConsumedSuspension`: that verb judged correctly on
            // the evidence it was handed; the evidence is what was wrong,
            // and no journal is written for a completed run at all now.
            let logged: ExecutionLogEntry | undefined;
            try {
                logged = this.recordLog({
                    id: runId,
                    flowName: run.flowName,
                    flowVersion: run.flowVersion,
                    status: 'completed',
                    startedAt: run.startedAt,
                    completedAt: new Date().toISOString(),
                    durationMs,
                    trigger: buildRunTrigger(context),
                    steps,
                    output,
                }, context);
            } catch (bookkeeping) {
                // #4632 verdict: DURABILITY, so `error` — the caller is
                // told the truthful thing (the run completed), which is
                // exactly what makes the rest invisible from the outside:
                // the terminal history row never landed, nothing retries
                // it, and no envelope carries a word about it. After the
                // next restart the run is invisible to the Runs surfaces
                // and the approvals sweeps read the hole —
                // `inspectStrandedRequests` reads "no suspension + no
                // terminal row" as a STRANDED request, and
                // `releasePendingForTerminalRuns` reads "no terminal row"
                // as still-alive. Consequence and fix in the first line,
                // per AGENTS.md. Said ONCE per run, not once per failed
                // write.
                //
                // THIRD argument per `error(message, error?, meta?)`; the
                // `Error` slot stays empty on purpose (#5575), and the
                // thrown text goes to the structured slot rather than into
                // the message (#6499).
                this.logger.error(
                    `[Automation] run '${runId}' of flow '${run.flowName}' COMPLETED successfully but its ` +
                        `run-history bookkeeping threw, so its terminal history row never landed — nothing ` +
                        `retries it, the caller is told the run succeeded, and after the next restart this ` +
                        `run is invisible to the Runs surfaces while the approvals sweeps read it as ` +
                        `stranded and never-finished. The run itself is COMPLETE and must NOT be repaired ` +
                        `or re-run. Fix the history failure in this record's meta.`,
                    undefined,
                    describeThrownForLog(bookkeeping),
                );
            }
            // [#15944] Recomputed when the guard above had to abandon
            // `recordLog`: the same pure function of the same steps that
            // `recordLog`'s own first statement runs, so the two spellings
            // cannot disagree. Same shape as the strand arm's below.
            const summary = logged?.summary ?? summarizeRun(steps);

            // ── Subflow up-bubble (nested pause): this run was a subflow
            // child whose parent suspended awaiting it. Auto-resume the
            // parent with our output, mapped like the synchronous path.
            // Skipped when the DELEGATION path drives the chain (it
            // continues the parent itself). Best-effort: the child's own
            // completion stands even if the parent continuation fails.
            if (!skipBubble) {
                await this.bubbleToParent(run, output, summary);
            }

            // Surface the flow's friendly completion message so a screen-flow
            // runner shows it instead of a generic "Done". `summary` (#4354)
            // covers the WHOLE run — the steps before the pause and after it
            // are one log, so a resumed approval reports what it did in total.
            return {
                success: true,
                output,
                durationMs,
                successMessage: flow.successMessage,
                flowLabel: flow.label,
                summary,
            };
        } catch (err: unknown) {
            // [#15788] A resumed run reached a refusing `end` — the SECOND
            // producer, and the one a screen flow actually takes: a wizard
            // that collects an answer and then refuses on it leaves through
            // here, never through `execute()`'s exit. Tested first, beside
            // the re-suspend, for the same reason it is tested first there.
            if (isRefusalSignal(err)) {
                const refused = this.finishRefusedRun({
                    runId,
                    flowName: run.flowName,
                    flowVersion: run.flowVersion,
                    startedAt: run.startedAt,
                    durationMs: Date.now() - run.startTime,
                    steps, flow, variables,
                    refusalMessage: err.message, context,
                });
                // [#18714] UP-BUBBLE LEG. This run is terminal and the
                // caller holds ITS id — but if it was a subflow CHILD, some
                // ancestor is still parked at the `subflow` / `map` node
                // that started it, and nothing else in the engine will ever
                // move that ancestor: `bubbleToParent` was called on the
                // completion path alone, so a child resumed to a refusal
                // returned from here having resolved exactly one of the two
                // runs it is responsible for. Measured: the child row read
                // `refused` while its parent stayed `paused` and stayed in
                // `listSuspendedRuns()` indefinitely — a leaked run, not a
                // wrong answer, which is why it fails DIFFERENTLY from the
                // delegated leg above and needs its own arm.
                //
                // The same call the completion path makes, with the refusal
                // attached: the parent is genuinely resumed — it consumes
                // its pause, records its own terminal row and bubbles to
                // ITS parent in turn, so a chain of any depth resolves by
                // the same induction completions already rely on. ⛔ Not a
                // direct walk like `failAncestors`: that verb exists for a
                // cascade in which no ancestor can be resumed at all, and
                // it records them `failed` — the wrong word here.
                //
                // `output` and `summary` are the refused run's own, for the
                // reason `finishRefusedRun` collects them: the nodes before
                // the refusal really ran, and a parent that refuses must
                // still be able to report what its child did.
                //
                // `skipBubble` is honoured exactly as on the completion
                // path — under the DELEGATED leg the parent's frame is the
                // caller, and it raises its own refusal at the throw site
                // above. Bubbling here as well would resume the parent
                // twice.
                if (!skipBubble) {
                    await this.bubbleToParent(
                        run,
                        (refused.output ?? {}) as Record<string, unknown>,
                        refused.summary,
                        { message: err.message },
                    );
                }
                return refused;
            }
            // Re-suspended at a downstream node: persist a fresh continuation.
            if (isSuspendSignal(err)) {
                const durationMs = Date.now() - run.startTime;
                // #7639 — the re-suspend half of the same rule as the
                // initial-execution site above: one snapshot, both consumers.
                // A multi-stage approval re-pauses HERE on every stage but the
                // first, so covering only the other site would leave every
                // stage after stage 1 — the ones an operator actually needs to
                // inspect — unreadable.
                const variablesSnapshot = Object.fromEntries(variables);
                await this.persistSuspendedRun({
                    ...run,
                    // The segment's identity, not the one the run parked
                    // with last time: after a decision switch (ruling A on
                    // `FlowSchema.runAs`) the next pause must continue as
                    // the decider, whatever resumes it — never fall back to
                    // the trigger user. Identical to `run.context` when no
                    // switch happened.
                    context,
                    nodeId: err.nodeId,
                    nodeType: err.nodeType,
                    variables: variablesSnapshot,
                    steps,
                    correlation: err.correlation,
                    screen: err.screen,
                });
                this.recordLog({
                    id: runId,
                    flowName: run.flowName,
                    flowVersion: run.flowVersion,
                    status: 'paused',
                    startedAt: run.startedAt,
                    durationMs,
                    trigger: buildRunTrigger(context),
                    steps,
                    variables: variablesSnapshot,
                }, context);
                return { success: true, status: 'paused', runId, durationMs, screen: err.screen, flowLabel: flow.label };
            }

            const errorMessage = err instanceof Error ? err.message : String(err);
            const durationMs = Date.now() - run.startTime;
            // [#13909] THE seam this card is about. The pause was consumed
            // above, this node merely threw, and the record below makes the
            // run terminal — so from here on nothing in the engine can move
            // it: `resume` answers RUN_NOT_FOUND, `cancelRun` is a no-op on
            // it, and no other public method takes it anywhere EXCEPT the
            // deliberate operator exit, {@link restoreConsumedSuspension}.
            // Journal the suspension that was consumed so that exit has
            // something to put back.
            //
            // ⛔ Not a repair, and nothing here re-arms anything: the run
            // stays `failed`, no suspension exists after this line, and the
            // ordering above is untouched. It is the evidence a repair
            // needs, written at the only moment it still exists.
            const consumed = this.journalConsumedSuspension(
                run,
                stepCountAtPause,
                errorMessage,
                variablesAtPause,
            );
            // [#15555] From the line above, "this run is repairable" is a
            // FACT: a snapshot exists and `restoreConsumedSuspension` puts
            // it back. Everything from here to the `status: 'stranded'`
            // stamp below is BOOKKEEPING ABOUT that fact — and none of it
            // may be allowed to delete the fact by throwing.
            //
            // It could, and the direction is the dangerous one. The stamp
            // is the ONLY thing that tells a consumer the run is
            // repairable (`plugin-approvals` derives its operator-facing
            // `repairable` from it verbatim: `status === 'stranded'`), and
            // two statements in here throw out of the whole arm. Both live
            // in `recordLog`'s terminal path: the run-summary line
            // (`logger.info`, on by default) and `store.recordTerminal`,
            // whose SYNCHRONOUS throw escapes — the `void write.catch(...)`
            // beneath that call only ever sees a returned promise's
            // rejection. Then `failAncestors` awaits a walk that can throw.
            // A throw anywhere in that window replaced a truthful
            // `repairable: true` with `false`, which does not merely lose
            // information: it tells an operator NOT to attempt a repair
            // that succeeds. A false negative on a repair instruction is
            // worse than silence, and it is the opposite of the direction
            // everybody checks for.
            //
            // [#15944] THE SAME TWO STATEMENTS HAVE A SECOND CONSEQUENCE,
            // and it is the direction everybody DOES check for. On the
            // COMPLETION path above, a throw out of the same `recordLog`
            // fell into this arm on a run whose nodes ALL succeeded — a
            // false `true`: a journal and a `stranded` stamp for a run
            // that finished, whose "repair" re-armed it and re-ran every
            // node after the pause. That half is guarded at its own site
            // (see the completion path), NOT here: this arm stays the
            // node-failure arm, and reaching it at all was the defect.
            //
            // ⛔ This is NOT "assume repairable when the failure is
            // unknown" — that would invert the honest default and promise
            // a repair for a lost run. The guard opens AFTER the journal,
            // so only a run that demonstrably HAS a snapshot can reach the
            // stamp: a throw from `journalConsumedSuspension` itself still
            // propagates, and every exit above the consumption point is
            // untouched and still carries no status at all.
            //
            // ⛔ And the journal is NOT moved down to sit beside the stamp
            // instead. `recordLog` is what carries the snapshot into the
            // durable row, so journalling after it would leave a
            // `recordLog` failure with NO snapshot anywhere — converting
            // this false negative into a TRUE one by destroying the repair
            // rather than by reporting it.
            let logged: ExecutionLogEntry | undefined;
            try {
                logged = this.recordLog({
                    id: runId,
                    flowName: run.flowName,
                    flowVersion: run.flowVersion,
                    status: 'failed',
                    startedAt: run.startedAt,
                    completedAt: new Date().toISOString(),
                    durationMs,
                    trigger: buildRunTrigger(context),
                    steps,
                    error: errorMessage,
                }, context, consumed.run);
                // Subflow chain: a child failing terminally fails every
                // ancestor awaiting it — they can never be resumed otherwise.
                // The delegation path handles its own level (skipBubble).
                if (!skipBubble) {
                    // [#15222] `runId` names the run that stranded two
                    // statements above, so the walk journals every ancestor
                    // whose pause this cascade consumes and the chain is
                    // re-armable to its full depth, leaf-first.
                    await this.failAncestors(run.context, errorMessage, runId);
                }
            } catch (bookkeeping) {
                // #4632 verdict: DURABILITY, so `error` — the caller is
                // told a truthful, actionable thing (the run stranded, and
                // it is repairable), which is exactly what makes the rest
                // invisible from the outside: the terminal history row
                // never landed and/or the ancestor cascade stopped
                // part-way, nothing retries either, and no envelope
                // carries a word about it. Consequence and fix in the
                // first line, per AGENTS.md. Said ONCE per stranded run,
                // not once per failed write.
                //
                // THIRD argument per `error(message, error?, meta?)`; the
                // `Error` slot stays empty on purpose (#5575), and the
                // thrown text goes to the structured slot rather than into
                // the message (#6499).
                this.logger.error(
                    `[Automation] run '${runId}' of flow '${run.flowName}' is STRANDED and its ` +
                        `post-strand bookkeeping threw, so its terminal history row never landed ` +
                        `and/or its subflow ancestors were not failed — nothing retries either, and ` +
                        `the run reads healthy to the Runs surfaces and the approvals sweeps. The ` +
                        `strand itself IS reported and repairable right now: restore it with ` +
                        `restoreConsumedSuspension('${runId}') before this process restarts, which ` +
                        `drops the in-memory journal this repair rides on. Fix the failure in this ` +
                        `record's meta.`,
                    undefined,
                    describeThrownForLog(bookkeeping),
                );
            }
            // Surface the flow's friendly error message (the raw error stays
            // in `error` for logs/diagnostics).
            return {
                success: false,
                error: errorMessage,
                durationMs,
                // [#13937] STRANDED, said by the producer that knows — the
                // services half of the shape-4 ruling (maintainer
                // 2026-09-01): the ordering stays, and the condition it
                // leaves behind carries the platform-level name #14384 put
                // on the contract. Stamped HERE and on no other exit,
                // because this is the one exit that journalled a snapshot
                // two statements up: the pause a durable decision was
                // waiting on is gone, the run is recorded `failed`, and it
                // can be re-armed only by {@link restoreConsumedSuspension}
                // — never by `resume` (which now answers RUN_NOT_FOUND),
                // never automatically. Terminal exactly like `'failed'`
                // and distinct from it on purpose: `'failed'` says the run
                // ran and was rejected; this says a recorded continuation
                // stopped mid-flight and an operator has something to
                // repair. The verdict and the journal are one fact stated
                // twice — `stranded-run-status.test.ts` holds them equal.
                //
                // ⚠️ The run's RECORDED status — the log entry above and
                // the durable history row — stays `'failed'`: that is
                // `ExecutionStatus` (`@objectstack/spec`,
                // `automation/execution.zod.ts`), a vocabulary the ruling
                // did not widen; the durable discriminator for this
                // condition is the snapshot the terminal row carries.
                //
                // ⛔ The cascade-failed ancestors above are NOT stranded:
                // `failSuspendedRun` consumes their pauses and journals
                // nothing, so no verb can re-arm them. A different (and
                // worse) condition, which this stamp must not claim.
                status: 'stranded',
                errorMessage: flow.errorMessage,
                flowLabel: flow.label,
                // [#15555] Recomputed when the guard above had to abandon
                // `recordLog`: the same pure function of the same steps
                // that `recordLog`'s own first statement runs, so the two
                // spellings cannot disagree.
                summary: logged?.summary ?? summarizeRun(steps),
                // [#24914, ruling B′] As `execute()`'s failure exit: the refusal
                // the node after the consumed pause met, off the throw's brand. The
                // screen-flow leg (a write behind a screen) reaches its caller HERE.
                ...readCarriedRefusal(err),
            };
        }
    } finally {
        this.resuming.delete(runId);
    }
}
