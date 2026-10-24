// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flow definitions of {@link AutomationEngine}: how a stored or authored
 * flow is canonicalised, unregistered, refused and rolled back; how its runtime
 * states and trigger bindings are reported; and the function,
 * connector-provider and credential surfaces a flow reads.
 *
 * [#25222] Slice 7 of the `engine.ts` split, move-only. Each function here is
 * the body of the `AutomationEngine` method of the same name, moved unedited.
 * The class keeps that method (its name, docblock and position are in the
 * published `.d.ts`) and calls the body with a {@link FlowDefinitionsHost}
 * literal holding exactly the members the body reads.
 */

import type { ConnectorProviderFactory } from '@objectstack/spec/integration';
import type { FlowUnboundCause } from '@objectstack/spec/contracts';
import type { ConversionNotice, ConversionTodoNotice } from '@objectstack/spec';
import { applyConversionsToFlow } from '@objectstack/spec';
import { FLOW_HOOK_SECRET_KEY, flowCredentialClassLabel, flowCredentialPositions } from './flow-credential-projection.js';
import type { FlowParsed } from '@objectstack/spec/automation';
import { API_TRIGGER_SECRET_REF_KEY, FlowSchema, apiTriggerSecretRefOf, validateControlFlow } from '@objectstack/spec/automation';
import { FlowCredentialUnresolvableError } from './flow-credential-channel.js';
// The values below (`CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION`,
// `flowRegistrationTodo` and `graftConditionEnvelopes`) are read only inside
// the function bodies, at call time, never while a module is evaluating, so the
// import cycle with ./engine.js is safe under ESM live bindings; the tsup
// bundle is one file and has no cycle.
import {
    CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION,
    flowRegistrationTodo,
    graftConditionEnvelopes,
    type AutomationEngine,
    type FlowContender,
    type FlowCredentialHolding,
    type FlowFunctionRegistration,
} from './engine.js';

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those. Methods go as late-bound closures, so a spy or test
 * double set on the instance is still the one called. A field the class assigns
 * only at its declaration or in its constructor goes by value, so the value
 * passed is the field. Two fields go through a getter, because a method
 * reassigns each: `functionResolver` (`setFunctionResolver`) and
 * `flowCredentialSource` (`setFlowCredentialSource`). Each read in the body
 * reads the engine's current value, as it did through `this`.
 */
export interface FlowDefinitionsHost {
    readonly functionResolver: AutomationEngine['functionResolver'];
    readonly connectorProviders: AutomationEngine['connectorProviders'];
    readonly logger: AutomationEngine['logger'];
    readonly canonicalizeFlow: AutomationEngine['canonicalizeFlow'];
    readonly registrationCheckRefusals: AutomationEngine['registrationCheckRefusals'];
    readonly detectCycles: AutomationEngine['detectCycles'];
    readonly flows: AutomationEngine['flows'];
    readonly isPackagedFlow: AutomationEngine['isPackagedFlow'];
    readonly packagedSubflowCallers: AutomationEngine['packagedSubflowCallers'];
    readonly refuseUnderReachingCallers: AutomationEngine['refuseUnderReachingCallers'];
    readonly withdrawFlow: AutomationEngine['withdrawFlow'];
    readonly flowRefusals: AutomationEngine['flowRefusals'];
    readonly resolveTriggerBinding: AutomationEngine['resolveTriggerBinding'];
    readonly flowShadowing: AutomationEngine['flowShadowing'];
    readonly describeUnboundReason: AutomationEngine['describeUnboundReason'];
    readonly isFlowEnabled: AutomationEngine['isFlowEnabled'];
    readonly boundFlowTriggers: AutomationEngine['boundFlowTriggers'];
    readonly policyDisabledFlows: AutomationEngine['policyDisabledFlows'];
    readonly subflowDeclinedFlows: AutomationEngine['subflowDeclinedFlows'];
    readonly triggers: AutomationEngine['triggers'];
    readonly flowCredentialSource: AutomationEngine['flowCredentialSource'];
    readonly flowVersionHistory: AutomationEngine['flowVersionHistory'];
    readonly credentialResolver: AutomationEngine['credentialResolver'];
}

/** The body of {@link AutomationEngine.resolveFunction}, moved unedited; that method's docblock is its contract. */
export function resolveFunction(this: Pick<FlowDefinitionsHost, 'functionResolver'>, name: string): FlowFunctionRegistration | undefined {
    const resolved = this.functionResolver?.(name);
    if (!resolved) return undefined;
    if (typeof resolved === 'function') return { handler: resolved };
    return typeof resolved.handler === 'function' ? resolved : undefined;
}

/** The body of {@link AutomationEngine.registerConnectorProvider}, moved unedited; that method's docblock is its contract. */
export function registerConnectorProvider(this: Pick<FlowDefinitionsHost, 'connectorProviders' | 'logger'>, providerKey: string, factory: ConnectorProviderFactory): void {
    if (this.connectorProviders.has(providerKey)) {
        this.logger.warn(`Connector provider '${providerKey}' replaced`);
    }
    this.connectorProviders.set(providerKey, factory);
    this.logger.info(`Connector provider registered: ${providerKey}`);
}

/** The body of {@link AutomationEngine.canonicalizeStoredFlow}, moved unedited; that method's docblock is its contract. */
export function canonicalizeStoredFlow(this: Pick<FlowDefinitionsHost, 'canonicalizeFlow' | 'registrationCheckRefusals'>, name: string, definition: unknown, options: { includeRetired?: boolean } = {}): {
    parsed: FlowParsed;
    storable: unknown;
    notices: ConversionNotice[];
    todos: ConversionTodoNotice[];
} {
    const { parsed, storable, notices, todos: chainTodos } = this.canonicalizeFlow(name, definition, options);
    // The registration checks run when `todos` is first READ, once: the
    // stored pass reads it, and the doors that only want `parsed` or
    // `storable` (the save door, a package duplication, the sync's
    // "already held?" comparison) pay nothing for a listing they discard.
    const listRegistrationRefusals = (): ConversionTodoNotice[] => {
        const todos = [...chainTodos];
        // One listing per site: a site a conversion TODO names (the value-slot
        // refusal the spec lists under its D3 entry) keeps that TODO, which
        // names the retirement; the registration check's line for it is the
        // same refusal and is not repeated.
        const listed = new Set(chainTodos.map((todo) => todo.path));
        for (const refusal of this.registrationCheckRefusals(name, parsed)) {
            for (const site of refusal.sites) {
                if (listed.has(site.path)) continue;
                todos.push(flowRegistrationTodo(name, site));
            }
        }
        return todos;
    };
    let listedTodos: ConversionTodoNotice[] | undefined;
    return {
        parsed,
        storable,
        notices,
        get todos(): ConversionTodoNotice[] {
            listedTodos ??= listRegistrationRefusals();
            return listedTodos;
        },
    };
}

/** The body of {@link AutomationEngine.canonicalizeFlow}, moved unedited; that method's docblock is its contract. */
export function canonicalizeFlow(this: Pick<FlowDefinitionsHost, 'logger' | 'detectCycles'>, name: string, definition: unknown, options: { includeRetired?: boolean } = {}): {
    parsed: FlowParsed;
    storable: unknown;
    notices: ConversionNotice[];
    todos: ConversionTodoNotice[];
} {
    // ADR-0087 D2 — the runtime load seam. A stored flow authored against an
    // old shape (a `webhook`/`http_request` callout node, a `delete_record`
    // with `config.filters`) is canonicalized on rehydration, BEFORE parse +
    // execution, so the executor only ever sees the canonical shape and a
    // dropped-alias upgrade never silently changes behavior (e.g. an empty
    // `filter` deleting a whole table). No live executor registry is handed
    // to the pass: the one open-namespace rename, the callout rename,
    // reserves its old names instead (#23543 F5-http), and
    // `registerNodeExecutor` refuses an executor under one, so (#24001) the
    // conversion-conflict channel it used to feed is gone.
    //
    // `includeRetired` (#3903): this seam rehydrates DATA AT REST — flows
    // stored in `sys_metadata` outlive any load window, and a row written
    // under protocol N has no author for a tombstone to teach. When a flow
    // conversion graduates to `retiredFromLoadPath` (retiring at N+1), the
    // stored flows that still carry the old shape must keep canonicalizing
    // here or the retirement would silently change their behavior — the
    // exact hazard this seam exists to prevent. Authored sources keep
    // window semantics at their own seam (`normalizeStackInput` applies
    // live-window entries only; the schema tombstones the retired shape).
    // [#23775] The one caller that closes the window is the metadata save
    // door, for a flow with no stored row (an authored body, not one at
    // rest), through `canonicalizeStoredFlow`'s option; the rehydration
    // passes none and replays the full chain, as it always has.
    //
    // `excludeConversionIds`: the retired window is opened for a CLASS of
    // caller, and one kind of entry inside it is not a rescue but a
    // reinterpretation — a DEFAULT FLIP, whose old shape still parses and
    // now means something else. This seam cannot say a body predates such
    // a flip, so it refuses those entries by id, each with its reason on
    // `CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION`.
    const notices: ConversionNotice[] = [];
    const todos: ConversionTodoNotice[] = [];
    const converted = applyConversionsToFlow(definition, {
        includeRetired: options.includeRetired ?? true,
        excludeConversionIds: CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION,
        onNotice: (n) => {
            notices.push(n);
            this.logger.warn(`[flow '${name}'] ${n.code}: ${n.message}`);
        },
        // Collected, not logged: a site listed here is one `registerFlow`
        // refuses below with its own located message.
        onTodo: (t) => {
            todos.push(t);
        },
    });
    // #4347 / #4415 — one call, canonical at every depth. `FlowNodeSchema`
    // parses its own ADR-0031 regions (`FlowNodeSchema.transform` →
    // `parseFlowNodeRegions`), so what comes back here is already normalized
    // inside `loop.config.body`, `parallel.config.branches[]` and
    // `try_catch.config.try`/`.catch` — recursively. Until #4415 that needed
    // a second, separately-remembered call to `normalizeControlFlowRegions`
    // right here, and every consumer that took a `FlowParsed` without making
    // it held a half-parsed flow that looked finished.
    const parsed = FlowSchema.parse(converted);

    // DAG cycle detection
    this.detectCycles(parsed);

    // ADR-0031 — validate structured control-flow constructs (loop bodies,
    // parallel branches, try/catch regions) are well-formed (single-entry/
    // single-exit, acyclic). Reject the malformed before it can run.
    validateControlFlow(parsed);

    return {
        parsed,
        storable: graftConditionEnvelopes(converted, parsed),
        notices,
        todos,
    };
}

/** The body of {@link AutomationEngine.unregisterFlow}, moved unedited; that method's docblock is its contract. */
export function unregisterFlow(this: Pick<FlowDefinitionsHost, 'flows' | 'isPackagedFlow' | 'packagedSubflowCallers' | 'refuseUnderReachingCallers' | 'withdrawFlow'>, name: string): void {
    const flow = this.flows.get(name);
    if (flow && this.isPackagedFlow(name)) {
        const callers = this.packagedSubflowCallers(name);
        if (callers.length > 0) this.refuseUnderReachingCallers(name, 'remove', callers, new Map());
    }
    this.withdrawFlow(name);
}

/** The body of {@link AutomationEngine.recordFlowRefusal}, moved unedited; that method's docblock is its contract. */
export function recordFlowRefusal(this: Pick<FlowDefinitionsHost, 'flows' | 'flowRefusals'>, name: string, error: unknown): void {
    if (this.flows.has(name)) return;
    const thrown = (error ?? {}) as { code?: unknown; message?: unknown };
    this.flowRefusals.set(name, {
        ...(typeof thrown.code === 'string' ? { code: thrown.code } : {}),
        message: typeof thrown.message === 'string' ? thrown.message : String(error),
    });
}

/** The body of {@link AutomationEngine.getFlowRuntimeStates}, moved unedited; that method's docblock is its contract. */
export function getFlowRuntimeStates(this: Pick<FlowDefinitionsHost, 'flows' | 'resolveTriggerBinding' | 'flowShadowing' | 'describeUnboundReason' | 'isFlowEnabled' | 'boundFlowTriggers'>): Array<{
    name: string;
    enabled: boolean;
    bound: boolean;
    status?: string;
    triggerType?: string;
    object?: string;
    reason?: string;
    unboundCause?: FlowUnboundCause;
    armedFrom?: FlowContender;
    shadowed?: FlowContender[];
}> {
    return [...this.flows.keys()].map((name) => {
        const resolved = this.resolveTriggerBinding(name);
        // [#11997] Attach the shadowing receipt to the row an admin already
        // reads. This map holds ONE entry per bare name, so without these
        // two fields a displaced contender leaves no trace on this surface.
        const shadowing = this.flowShadowing.get(name);
        const unbound = this.describeUnboundReason(name, resolved);
        return {
            name,
            enabled: this.isFlowEnabled(name),
            bound: this.boundFlowTriggers.has(name),
            status: (this.flows.get(name) as { status?: string } | undefined)?.status,
            triggerType: resolved?.triggerType,
            object: resolved?.binding.object,
            // Absent, not `undefined`-valued: a row that is bound, disabled
            // or trigger-less has no reason to carry, and `reason: null` on
            // the wire would read as "we looked and found nothing".
            // [#23842] `unboundCause` rides the SAME spread, so the pair is
            // present together or absent together by construction.
            ...(unbound === undefined
                ? {}
                : { reason: unbound.reason, unboundCause: unbound.cause }),
            ...(shadowing
                ? { armedFrom: shadowing.armed, shadowed: shadowing.shadowed }
                : {}),
        };
    });
}

/** The body of {@link AutomationEngine.describeUnboundReason}, moved unedited; that method's docblock is its contract. */
export function describeUnboundReason(
    this: Pick<FlowDefinitionsHost, 'isFlowEnabled' | 'boundFlowTriggers' | 'policyDisabledFlows' | 'subflowDeclinedFlows' | 'triggers'>,
    name: string,
    resolved: { triggerType: string } | undefined,
): { reason: string; cause: FlowUnboundCause } | undefined {
    if (!resolved) return undefined; // manual / screen flow — nothing to bind
    if (!this.isFlowEnabled(name)) return undefined;
    if (this.boundFlowTriggers.has(name)) return undefined;
    const policyReason = this.policyDisabledFlows.get(name);
    if (policyReason !== undefined) return { reason: policyReason, cause: 'deployment_policy' };
    // [#20725, ADR-0126 §7.3] The arming gate declined it onto a disabled
    // packaged subflow — read from the record, for the policy line's
    // reason, and ahead of the trigger branches for the gate's: with the
    // child off, the trigger would not arm it either.
    const declined = this.subflowDeclinedFlows.get(name);
    if (declined !== undefined) return { reason: declined, cause: 'disabled_subflow' };
    return this.triggers.has(resolved.triggerType)
        ? {
            reason: `trigger '${resolved.triggerType}' is registered but binding failed — see earlier warnings`,
            cause: 'binding_failure',
        }
        : {
            reason: `no '${resolved.triggerType}' trigger is registered — add requires: ['triggers'] (record_change/schedule/time_relative/api ship in @objectstack/trigger-*)`,
            cause: 'missing_trigger',
        };
}

/** The body of {@link AutomationEngine.getTriggerBindingAudit}, moved unedited; that method's docblock is its contract. */
export function getTriggerBindingAudit(this: Pick<FlowDefinitionsHost, 'flows' | 'resolveTriggerBinding' | 'describeUnboundReason'>): Array<{ flowName: string; triggerType: string; reason: string }> {
    const audit: Array<{ flowName: string; triggerType: string; reason: string }> = [];
    for (const name of this.flows.keys()) {
        const resolved = this.resolveTriggerBinding(name);
        // [#18235] The eligibility rules (enabled, unbound, declares a
        // trigger) and the three-branch vocabulary both live in
        // `describeUnboundReason` now, so this audit and the status door
        // report the SAME sentence for the same flow by construction.
        const unbound = this.describeUnboundReason(name, resolved);
        if (unbound === undefined || !resolved) continue;
        audit.push({ flowName: name, triggerType: resolved.triggerType, reason: unbound.reason });
    }
    return audit;
}

/** The body of {@link AutomationEngine.flowCredentialHoldings}, moved unedited; that method's docblock is its contract. */
export function flowCredentialHoldings(this: Pick<FlowDefinitionsHost, 'flows' | 'flowCredentialSource'>, name: string): FlowCredentialHolding[] {
    const flow = this.flows.get(name);
    if (!flow) return [];
    const out: FlowCredentialHolding[] = [];
    const seen = new Set<string>();
    for (const position of flowCredentialPositions(flow)) {
        const id = JSON.stringify([position.nodeId, position.key]);
        if (position.form === 'value') {
            seen.add(id);
            out.push({ nodeId: position.nodeId, key: position.key, label: flowCredentialClassLabel(position.key), held: 'literal' });
        }
    }
    for (const { nodeId, key } of this.flowCredentialSource?.held(name) ?? []) {
        const id = JSON.stringify([nodeId, key]);
        if (seen.has(id)) continue;
        out.push({ nodeId, key, label: flowCredentialClassLabel(key), held: 'channel' });
    }
    return out;
}

/** The body of {@link AutomationEngine.hookSecretResolver}, moved unedited; that method's docblock is its contract. */
export function hookSecretResolver(
    this: Pick<FlowDefinitionsHost, 'flowCredentialSource' | 'credentialResolver'>,
    flowName: string,
    startNodeId: string | undefined,
    config: Record<string, unknown>,
): (() => Promise<string | undefined>) | undefined {
    const source = this.flowCredentialSource;
    const written = Object.prototype.hasOwnProperty.call(config, FLOW_HOOK_SECRET_KEY);
    // A secret NAMED by `config.secretRef`: the deployment fills the name, and
    // it is read through the credential resolver at every post — never the
    // channel, whose row for this position the save door removes once the
    // definition names its secret instead. A name with no value refuses that
    // post as unavailable; a reference the spec does not accept (or one beside
    // a literal, which `FlowSchema` refuses) yields no reader, so the flow is
    // refused at registration rather than armed on a guess.
    if (Object.prototype.hasOwnProperty.call(config, API_TRIGGER_SECRET_REF_KEY)) {
        const ref = apiTriggerSecretRefOf(config);
        if (ref === undefined || written) return undefined;
        const resolve = this.credentialResolver;
        return async () => {
            const value = await resolve(ref);
            if (typeof value === 'string' && value.trim() !== '') return value;
            throw new FlowCredentialUnresolvableError(
                `Flow '${flowName}': its inbound hook secret is named by \`config.secretRef\` '${ref}', which resolved `
                    + 'to no value, so every post is refused until the deployment fills it. Set the '
                    + `'${ref}' environment variable, or serve '${ref}' from the host's credential resolver `
                    + '(AutomationServicePluginOptions.credentialResolver).',
            );
        };
    }
    const literal = typeof config.secret === 'string' && config.secret.trim() !== '' ? config.secret : undefined;
    if (written && literal === undefined) return undefined;
    if (!source || startNodeId === undefined) {
        return literal === undefined ? undefined : async () => literal;
    }
    if (literal === undefined && !source.holds(flowName, startNodeId, FLOW_HOOK_SECRET_KEY)) return undefined;
    return async () => {
        if (literal !== undefined && !source.holds(flowName, startNodeId, FLOW_HOOK_SECRET_KEY)) return literal;
        return (await source.resolve(flowName, startNodeId, FLOW_HOOK_SECRET_KEY)) ?? literal;
    };
}

/** The body of {@link AutomationEngine.rollbackFlow}, moved unedited; that method's docblock is its contract. */
export function rollbackFlow(this: Pick<FlowDefinitionsHost, 'flowVersionHistory' | 'flows' | 'logger'>, name: string, version: number): void {
    const history = this.flowVersionHistory.get(name);
    if (!history) {
        throw new Error(`Flow '${name}' has no version history`);
    }
    const entry = history.find(h => h.version === version);
    if (!entry) {
        throw new Error(`Version ${version} not found for flow '${name}'`);
    }
    this.flows.set(name, entry.definition);
    this.logger.info(`Flow '${name}' rolled back to version ${version}`);
}
