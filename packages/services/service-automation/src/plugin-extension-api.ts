// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Plugin Extension API of {@link AutomationEngine}: how a plugin registers
 * a node executor (or a deprecated alias of one), a trigger and a connector,
 * and how a flow's trigger binding is read off its start node.
 *
 * [#25222] Slice 2 of the `engine.ts` split, move-only. Each function here is
 * the body of the `AutomationEngine` method of the same name, moved unedited.
 * The class keeps that method (its name, docblock and position are in the
 * published `.d.ts`) and calls the body with a {@link PluginExtensionHost}
 * literal holding exactly the members the body reads. Two signatures here omit
 * a parameter default the class method declares, so the default is written
 * once: the class resolves it and passes the value.
 *
 * The section's members with bodies of one to five lines stayed in the class,
 * and so did five longer ones. `getConnectorDescriptors` stayed because the
 * spec liveness ledger cites `engine.ts` for the connector properties that body
 * reads, one property at a time. `unregisterNodeExecutor`, `unregisterTrigger`,
 * `activateFlowTrigger` and `deactivateFlowTrigger` stayed because each deletes
 * from one of the engine's maps, and the tenant-audit census can type such a
 * receiver only through the class's own field declarations.
 */

import type { ActionDescriptor, FlowParsed } from '@objectstack/spec/automation';
import { FLOW_RESERVED_NODE_TYPES, defineActionDescriptor, resolveFlowTriggerKind, resolveScheduleOrganization } from '@objectstack/spec/automation';
import type { Connector, ConnectorOrigin } from '@objectstack/spec/integration';
import { ConnectorSchema } from '@objectstack/spec/integration';
import { describeThrownForLog } from './thrown-cause-diagnostics.js';
import type { AutomationEngine, ConnectorActionHandler, FlowTrigger, FlowTriggerBinding, NodeExecutor } from './engine.js';

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those. Methods go as late-bound closures, so a spy or test
 * double set on the instance is still the one called. Fields go by value: each
 * is assigned once, at construction, and never reassigned, so the value passed
 * is the field, including where a body reads it later (inside the executor
 * {@link registerNodeAlias} builds).
 */
export interface PluginExtensionHost {
    readonly nodeExecutors: AutomationEngine['nodeExecutors'];
    readonly logger: AutomationEngine['logger'];
    readonly actionDescriptors: AutomationEngine['actionDescriptors'];
    readonly warnIfResumeAuthorityUndeclared: AutomationEngine['warnIfResumeAuthorityUndeclared'];
    readonly resumeAuthorityOmissionWarned: AutomationEngine['resumeAuthorityOmissionWarned'];
    readonly registerNodeExecutor: AutomationEngine['registerNodeExecutor'];
    readonly triggers: AutomationEngine['triggers'];
    readonly flows: AutomationEngine['flows'];
    readonly boundFlowTriggers: AutomationEngine['boundFlowTriggers'];
    readonly resolveTriggerBinding: AutomationEngine['resolveTriggerBinding'];
    readonly activateFlowTrigger: AutomationEngine['activateFlowTrigger'];
    readonly hookSecretResolver: AutomationEngine['hookSecretResolver'];
    readonly assertSameOriginOrFree: AutomationEngine['assertSameOriginOrFree'];
    readonly connectors: AutomationEngine['connectors'];
}

/** The body of {@link AutomationEngine.registerNodeExecutor}, moved unedited; that method's docblock is its contract. */
export function registerNodeExecutor(this: Pick<PluginExtensionHost, 'nodeExecutors' | 'logger' | 'actionDescriptors' | 'warnIfResumeAuthorityUndeclared'>, executor: NodeExecutor): void {
    for (const type of new Set([executor.type, executor.descriptor?.type])) {
        if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(FLOW_RESERVED_NODE_TYPES, type)) continue;
        throw new Error(
            `Node executor type '${type}' is reserved: it is a retired official flow node name, superseded by `
            + `'${FLOW_RESERVED_NODE_TYPES[type]}' (@objectstack/spec 18, ADR-0018). No node can reach an executor `
            + `registered under it — the flow parse refuses an authored node typed '${type}', and a stored one is `
            + `rewritten to '${FLOW_RESERVED_NODE_TYPES[type]}' before it parses. Register the executor under a `
            + `type of your own (for example a namespaced 'acme_${type}').`,
        );
    }
    if (this.nodeExecutors.has(executor.type)) {
        this.logger.warn(`Node executor '${executor.type}' replaced`);
    }
    this.nodeExecutors.set(executor.type, executor);

    // Publish the ADR-0018 action descriptor into the registry, so the
    // type validates as a legal flow node and appears in the designer
    // palette. A descriptor's `type` should match the executor's; we key
    // on the descriptor's `type` and warn on mismatch rather than silently
    // diverging.
    if (executor.descriptor) {
        const descriptorType = executor.descriptor.type;
        if (descriptorType !== executor.type) {
            this.logger.warn(
                `Node executor '${executor.type}' publishes a descriptor for type '${descriptorType}' — registering under both.`,
            );
        }
        this.actionDescriptors.set(descriptorType, executor.descriptor);
        this.warnIfResumeAuthorityUndeclared(executor.descriptor);
    }

    this.logger.info(`Node executor registered: ${executor.type}`);
}

/** The body of {@link AutomationEngine.warnIfResumeAuthorityUndeclared}, moved unedited; that method's docblock is its contract. */
export function warnIfResumeAuthorityUndeclared(this: Pick<PluginExtensionHost, 'resumeAuthorityOmissionWarned' | 'logger'>, descriptor: ActionDescriptor): void {
    if (descriptor.supportsPause !== true) return;
    if (descriptor.resumeAuthority !== undefined) return;
    if (this.resumeAuthorityOmissionWarned.has(descriptor.type)) return;
    this.resumeAuthorityOmissionWarned.add(descriptor.type);
    this.logger.warn(
        `[automation] node type '${descriptor.type}' declares supportsPause but never declares ` +
        `resumeAuthority, so the resume-authority gate REFUSES every pause it creates on the generic route ` +
        `(POST /automation/:name/runs/:runId/resume) — an undeclared resumeAuthority resolves to ` +
        `'service', fail-closed, because guessing 'any' is how a raw resume once walked past an approval ` +
        `decision no service had recorded. ` +
        `Declare it on the descriptor: 'any' if that route IS the intended door (a screen's collected ` +
        `inputs, a signal wait's external producer), or 'service' if resuming is the tail of a decision ` +
        `some service must authorize and record first. Declaring 'any' is what RESTORES the generic ` +
        `route for this type. Reported once per node type per engine.`,
    );
}

/** The body of {@link AutomationEngine.registerNodeAlias}, moved unedited; that method's docblock is its contract. */
export function registerNodeAlias(
    this: Pick<PluginExtensionHost, 'registerNodeExecutor' | 'logger' | 'nodeExecutors'>,
    alias: string,
    canonicalType: string,
    meta?: { name?: string; category?: ActionDescriptor['category']; paradigms?: ActionDescriptor['paradigms']; needsOutbox?: boolean },
): void {
    const engine = this;
    let warned = false;
    this.registerNodeExecutor({
        type: alias,
        descriptor: defineActionDescriptor({
            type: alias,
            version: '1.0.0',
            name: meta?.name ?? alias,
            description: `Deprecated alias of '${canonicalType}' (ADR-0018 M3). Author new flows with '${canonicalType}'.`,
            category: meta?.category ?? 'io',
            source: 'builtin',
            paradigms: meta?.paradigms ?? ['flow', 'approval'],
            supportsRetry: true,
            needsOutbox: meta?.needsOutbox ?? false,
            deprecated: true,
            aliasOf: canonicalType,
        }),
        async execute(node, variables, context) {
            if (!warned) {
                warned = true;
                engine.logger.warn(
                    `Node type '${alias}' is deprecated; use '${canonicalType}' (ADR-0018 M3). Existing flows keep running via the alias.`,
                );
            }
            const target = engine.nodeExecutors.get(canonicalType);
            if (!target) {
                return {
                    success: false,
                    error: `alias '${alias}' → '${canonicalType}': canonical executor not registered`,
                };
            }
            return target.execute(node, variables, context);
        },
        // Delegated for the same reason `resolveResumeAuthority` walks the
        // alias to its canonical: a pause created through the old type name
        // must not lose a capability the canonical declares. Without this,
        // aliasing a pausing type would silently stop it disarming what it
        // armed on entry (#5512) — the alias's own executor implements
        // nothing. No alias of a pausing type exists today; this keeps it
        // from becoming a hole the day one does.
        async onSuspensionReleased(release) {
            await engine.nodeExecutors.get(canonicalType)?.onSuspensionReleased?.(release);
        },
    });
    this.logger.info(`Node alias registered: ${alias} → ${canonicalType} (deprecated)`);
}

/** The body of {@link AutomationEngine.registerTrigger}, moved unedited; that method's docblock is its contract. */
export function registerTrigger(this: Pick<PluginExtensionHost, 'triggers' | 'logger' | 'flows' | 'boundFlowTriggers' | 'resolveTriggerBinding' | 'activateFlowTrigger'>, trigger: FlowTrigger): void {
    this.triggers.set(trigger.type, trigger);
    this.logger.info(`Trigger registered: ${trigger.type}`);
    // A trigger may be registered *after* its flows (e.g. AutomationServicePlugin
    // pulls flows at start(); a trigger plugin wires up on kernel:ready, which
    // fires later). Activate any already-registered flow that maps to this type.
    // [ADR-0126 §7.2] A flow that may not run is skipped by
    // `activateFlowTrigger`'s own enablement gate, so the flows the ledger
    // hydration left unbound stay unbound here — ⛔ no second check in this
    // loop: the gate is shared so no arming path can go without it.
    for (const name of this.flows.keys()) {
        if (this.boundFlowTriggers.has(name)) continue;
        const resolved = this.resolveTriggerBinding(name);
        if (resolved?.triggerType === trigger.type) {
            this.activateFlowTrigger(name);
        }
    }
}

/** The body of {@link AutomationEngine.deriveTriggerBinding}, moved unedited; that method's docblock is its contract. */
export function deriveTriggerBinding(
    this: Pick<PluginExtensionHost, 'hookSecretResolver'>,
    flowName: string,
    flow: FlowParsed,
): { triggerType: string; binding: FlowTriggerBinding } | undefined {
    const startNode = flow.nodes.find(n => n.type === 'start');
    const config = (startNode?.config ?? {}) as Record<string, unknown>;
    const condition = (config.condition as FlowTriggerBinding['condition']) ?? undefined;

    // Array-form triggerType (e.g. ['record-after-create', 'record-after-delete']).
    // Multi-event unions are deliberately unsupported (#3457). But a non-string
    // triggerType would otherwise fall through every branch below and resolve to
    // `undefined` — the flow silently becomes a manual/screen flow that never
    // fires, invisible to the binding audit (#3481). Route it to the record-change
    // trigger, exactly as an unmappable single token does, so the trigger rejects
    // it LOUDLY at bind time (a warn naming the flow) instead of vanishing. The
    // authoring-time lint gate (validate-flow-trigger-readiness) is the primary
    // catch; this keeps runtime behavior consistent with the typo-token path. The
    // raw array is preserved in `config` so the trigger can tailor its message;
    // `event` is a joined string so the trigger's single-token mapper reports it
    // verbatim and maps it to no hook.
    //
    // [#14328] This stays an explicit pre-check BEFORE `resolveFlowTriggerKind`,
    // and that is the ONE deliberate divergence between the two — documented in
    // that resolver's own header. It resolves array form to NO kind on purpose:
    // reading it as "asks for a record-change trigger" would have `defineStack`
    // demand a capability for a flow that can never use it and would widen the
    // lint rule's auto-triggered set. The route below is a DIAGNOSTIC route, not
    // a trigger the flow could fire on; folding it into the shared resolver would
    // delete a standing decision and turn a loud refusal into silence. Pre-check
    // ordering also preserves this method's own precedence exactly: array form
    // outranks `timeRelative`/`schedule`, which the resolver — blind to it —
    // would otherwise answer for a start node carrying both.
    if (
        Array.isArray(config.triggerType) &&
        config.triggerType.some((t) => typeof t === 'string' && (t as string).startsWith('record-'))
    ) {
        return {
            triggerType: 'record_change',
            binding: {
                flowName,
                object: typeof config.objectName === 'string' ? config.objectName : undefined,
                event: config.triggerType.filter((t) => typeof t === 'string').join(','),
                condition,
                config,
            },
        };
    }

    const kind = resolveFlowTriggerKind(flow);
    if (!kind) return undefined;

    switch (kind) {
        case 'record_change':
            return {
                triggerType: kind,
                binding: {
                    flowName,
                    object: typeof config.objectName === 'string' ? config.objectName : undefined,
                    // A `record-*` kind means `config.triggerType` IS that string
                    // token — the resolver read it to answer; the narrowing is
                    // re-stated because the answer does not carry it back.
                    event: typeof config.triggerType === 'string' ? config.triggerType : undefined,
                    condition,
                    config,
                },
            };

        // Declarative time-relative sweep (#1874): a start node carrying a
        // `timeRelative` descriptor is swept on a schedule and launched once per
        // record whose date field falls in the window. The resolver ranks it
        // BEFORE `schedule` for the same reason this method did — such a flow
        // ALSO carries a `schedule` cadence (the sweep interval), and without
        // that precedence it would bind to the plain schedule trigger and fire
        // once with no record instead of once per record.
        case 'time_relative': {
            const tr = (config.timeRelative ?? {}) as Record<string, unknown>;
            return {
                triggerType: kind,
                binding: {
                    flowName,
                    object:
                        typeof tr.object === 'string'
                            ? tr.object
                            : typeof config.objectName === 'string'
                              ? config.objectName
                              : undefined,
                    schedule: config.schedule,
                    // [commit ecdfc9411] Lifted beside `schedule`, for the same
                    // reason `schedule` is lifted: it is a BINDING fact the
                    // trigger acts on, not a config value it interprets.
                    // `config` still carries it verbatim below, so a
                    // trigger built against the older binding shape reads
                    // the same declaration from the same place.
                    organization: resolveScheduleOrganization(flow),
                    condition,
                    config,
                },
            };
        }

        case 'schedule':
            return {
                triggerType: kind,
                // [commit ecdfc9411] `organization` rides beside `schedule`: the two
                // together ARE a scheduled flow's binding — when it fires,
                // and which organization it fires as.
                binding: {
                    flowName,
                    schedule: config.schedule,
                    organization: resolveScheduleOrganization(flow),
                    condition,
                    config,
                },
            };

        // Inbound HTTP (ADR-0041 Tier 1): an `api` flow waits for an external
        // POST. The concrete trigger (`@objectstack/trigger-api`) mounts the
        // endpoint and enqueues; the binding's `config` carries the hook
        // details (`hookId`, and a packaged flow's literal `secret`) from
        // the start node. [#20790] A secret the credential channel holds is
        // not in `config`: `resolveSecret` reads it at verification time.
        case 'api': {
            const resolveSecret = this.hookSecretResolver(flowName, startNode?.id, config);
            return {
                triggerType: kind,
                binding: { flowName, condition, config, ...(resolveSecret ? { resolveSecret } : {}) },
            };
        }

        default: {
            // [#14328] Exhaustive over `FlowTriggerKind`, and that is the point:
            // a kind added to the spec resolver makes `kind` no longer `never`
            // here, so THIS package's type-check fails until the binding shape
            // for it is written — the drift is caught at the commit that opens
            // it instead of showing up as a flow that arms nowhere. At run time
            // (a spec build ahead of this one) fall back to today's behaviour —
            // no binding — rather than throwing inside the boot audit.
            const unhandledKind: never = kind;
            void unhandledKind;
            return undefined;
        }
    }
}

/** The body of {@link AutomationEngine.registerConnector}, moved unedited; that method's docblock is its contract. */
export function registerConnector(
    this: Pick<PluginExtensionHost, 'assertSameOriginOrFree' | 'connectors' | 'logger'>,
    def: Connector,
    handlers: Record<string, ConnectorActionHandler>,
    origin: ConnectorOrigin,
): void {
    const parsed = ConnectorSchema.parse(def);
    for (const action of parsed.actions ?? []) {
        if (typeof handlers[action.key] !== 'function') {
            throw new Error(
                `Connector '${parsed.name}': action '${action.key}' is declared but no handler was provided`,
            );
        }
    }
    this.assertSameOriginOrFree(parsed.name, origin);
    this.connectors.set(parsed.name, { def: parsed, handlers, origin, state: 'ready' });
    this.logger.info(
        `Connector registered: ${parsed.name} (${Object.keys(handlers).length} action handlers, origin: ${origin})`,
    );
}

/** The body of {@link AutomationEngine.registerDegradedConnector}, moved unedited; that method's docblock is its contract. */
export function registerDegradedConnector(
    this: Pick<PluginExtensionHost, 'assertSameOriginOrFree' | 'connectors' | 'logger'>,
    def: Connector,
    reason: string,
    origin: ConnectorOrigin,
    cause?: unknown,
): void {
    const parsed = ConnectorSchema.parse(def);
    this.assertSameOriginOrFree(parsed.name, origin);
    this.connectors.set(parsed.name, { def: parsed, handlers: {}, origin, state: 'degraded', degradedReason: reason });
    // `warn(message, meta?)` per the `Logger` contract — no `Error` slot
    // below `error`, so the cause belongs in argument TWO here.
    this.logger.warn(
        `Connector registered DEGRADED: ${parsed.name} (origin: ${origin}) — no actions and no handlers ` +
            `until its upstream is reachable; a connector_action dispatching to it fails with the stored ` +
            `reason, and the materializer retries with backoff.`,
        cause === undefined
            ? { degradedReason: reason }
            : { degradedReason: reason, ...describeThrownForLog(cause) },
    );
}

/** The body of {@link AutomationEngine.assertSameOriginOrFree}, moved unedited; that method's docblock is its contract. */
export function assertSameOriginOrFree(this: Pick<PluginExtensionHost, 'connectors' | 'logger'>, name: string, origin: ConnectorOrigin): void {
    const existing = this.connectors.get(name);
    if (!existing) return;
    if (existing.origin !== origin) {
        const describe = (o: ConnectorOrigin) =>
            o === 'plugin'
                ? 'a plugin (engine.registerConnector)'
                : 'a declarative provider-bound `connectors:` instance';
        throw new Error(
            `Connector name conflict: '${name}' is already registered by ${describe(existing.origin)} ` +
                `and cannot also be registered by ${describe(origin)}. A declarative provider-bound instance and a ` +
                `plugin-registered connector must not share a name — there is no silent precedence (ADR-0097 §4). ` +
                `Rename one of them.`,
        );
    }
    this.logger.warn(`Connector '${name}' replaced`);
}
