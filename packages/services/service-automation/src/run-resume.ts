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
// The value below (`buildRunTrigger`) is read only inside the function bodies,
// at call time, never while a module is evaluating, so the import cycle with
// ./engine.js is safe under ESM live bindings; the tsup bundle is one file and
// has no cycle.
import {
    buildRunTrigger,
    type AutomationEngine,
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
    readonly recordExpander: AutomationEngine['recordExpander'];
    readonly refuseGatedResume: AutomationEngine['refuseGatedResume'];
    readonly resumeInternal: AutomationEngine['resumeInternal'];
    readonly resolveEffectiveSuspension: AutomationEngine['resolveEffectiveSuspension'];
    readonly resolveSuspendedNodeType: AutomationEngine['resolveSuspendedNodeType'];
    readonly resolveResumeAuthority: AutomationEngine['resolveResumeAuthority'];
    readonly resolveDeclaredResumeAuthority: AutomationEngine['resolveDeclaredResumeAuthority'];
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
}

/** The body of {@link AutomationEngine.resolveRunContext}, moved unedited; that method's docblock is its contract. */
export async function resolveRunContext(this: Pick<RunResumeHost, 'seedRunGrants' | 'logger' | 'expandDeclaredLookups'>, flow: FlowParsed, context?: AutomationContext, runId?: string): Promise<AutomationContext> {
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

/** The body of {@link AutomationEngine.resolveDecisionSegmentContext}, moved unedited; that method's docblock is its contract. */
export async function resolveDecisionSegmentContext(
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
    const refusal = await this.refuseGatedResume(runId, signal);
    if (refusal) return refusal;
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

/** The body of {@link AutomationEngine.refuseGatedResume}, moved unedited; that method's docblock is its contract. */
export async function refuseGatedResume(this: Pick<RunResumeHost, 'resolveEffectiveSuspension' | 'resolveSuspendedNodeType' | 'resolveResumeAuthority' | 'resolveDeclaredResumeAuthority' | 'logger'>, runId: string, signal?: ResumeSignal): Promise<AutomationResult | null> {
    const run = await this.resolveEffectiveSuspension(runId);
    if (!run) return null;

    const nodeType = this.resolveSuspendedNodeType(run);
    if (!nodeType) return null;
    if (this.resolveResumeAuthority(nodeType) !== 'service') return null;
    // The owning service stamped the signal — this resume IS the recorded
    // decision's tail, not a way around it.
    if (signal?.[RESUME_AUTHORITY_SERVICE]) return null;

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
        // (`refuseGatedResume` → `resolveEffectiveSuspension`) → here.
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
