// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationEngine, ConnectorActionContext } from '../engine.js';
import { refuseNode } from '../guard-refusal.js';
import { describeHold } from '../plugin-extension-api.js';
import { resolveValueSlotMap } from './value-slot-map.js';

/**
 * Connector built-in node — `connector_action` (generic integration dispatch).
 *
 * Part of the platform baseline alongside `http` (ADR-0018 §Addendum):
 * where `http` calls *any raw URL*, `connector_action` invokes *any
 * registered connector's action*. The platform ships the generic dispatch node
 * + an (initially empty) connector registry on the engine; concrete connectors
 * — `connector-rest`, `connector-slack`, `connector-salesforce`, … — populate
 * the registry at runtime via `engine.registerConnector()`.
 *
 * Because the registry starts empty, a flow referencing a connector that no
 * plugin has registered fails the *step* with a clear error rather than failing
 * to register — graceful degradation matching `http`'s fail-soft style.
 */
export function registerConnectorNodes(engine: AutomationEngine, ctx: PluginContext): void {
    engine.registerNodeExecutor({
        type: 'connector_action',
        descriptor: defineActionDescriptor({
            type: 'connector_action',
            version: '1.0.0',
            name: 'Connector Action',
            description:
                'Invoke an action on a registered connector (Slack, Salesforce, a REST API, …). '
                + 'The connector itself is contributed by an integration plugin via registerConnector().',
            icon: 'plug',
            category: 'io',
            source: 'builtin',
            supportsRetry: true,
            // Present in both authoring paradigms (ADR-0018 §registry table;
            // workflow_rule retired per ADR-0019).
            paradigms: ['flow', 'approval'],
            // NO configSchema — deliberate, same class as `wait` (#4045). The
            // node's contract is not `config` at all: the executor reads only
            // the declared `FlowNodeSchema.connectorConfig` sibling block.
            // This descriptor used to publish a configSchema declaring
            // `connectorId`/`actionId`/`input` — but a published configSchema
            // by contract describes `node.config` and the Studio inspector
            // derives its property form from it, rooting every field at
            // `config.<key>` and REPLACING the client's hand-written
            // connectorConfig form (with its connector/action pickers). So the
            // schema steered online authoring to keys the executor never
            // reads, and the node refused to dispatch. Since 18 the flow parse
            // refuses those loose keys at authoring, and stored flows that
            // carry the mis-taught shape are healed at rehydration by the
            // retired ADR-0087 D2 conversion 'flow-node-connector-config-lift'.
        }),
        async execute(node, variables, context) {
            const cfg = node.connectorConfig;
            if (!cfg?.connectorId || !cfg?.actionId) {
                return refuseNode(
                    `connector_action '${node.id}': connectorConfig.connectorId and .actionId are required`,
                );
            }

            const handler = engine.resolveConnectorAction(cfg.connectorId, cfg.actionId);
            if (!handler) {
                // A degraded declarative instance (#3017) is registered but has no
                // handlers — say WHY dispatch fails and what recovers it, instead
                // of the generic wiring hint below. The reason names the cause: an
                // unreachable upstream, or (#27237) a credential that is not set or
                // was refused. [#28016] Recovery is automatic only on the backoff:
                // a held instance (a configuration fault met on a retry, a refused
                // credential the platform will not re-send) names its fix instead.
                const degraded = engine.getConnectorDegradedReason(cfg.connectorId);
                if (degraded) {
                    const hold = engine.getConnectorDegradedHold(cfg.connectorId);
                    // A reason that is a full sentence keeps one full stop.
                    const reason = degraded.replace(/\.\s*$/, '');
                    return {
                        success: false,
                        error:
                            `connector_action '${node.id}': connector '${cfg.connectorId}' is degraded — ${reason}. `
                            + (hold
                                ? `Dispatch is unavailable until ${describeHold(hold)} (or the server restarts); the platform does not retry it.`
                                : `Dispatch is unavailable until that is resolved; the platform retries automatically.`),
                    };
                }
                return {
                    success: false,
                    error:
                        `connector_action '${node.id}': no handler for `
                        + `'${cfg.connectorId}.${cfg.actionId}' — is the connector plugin registered?`,
                };
            }

            const handlerCtx: ConnectorActionContext = {
                variables,
                automation: context,
                logger: ctx.logger,
            };

            // #4354 / #4395 — what this step reports depends on what the
            // connector DECLARED the action does upstream, because nothing on
            // this side can observe it.
            //
            // Undeclared was the only answer #4354 could give: `acted: 0` would
            // understate a Salesforce create, `acted: 1` would overstate a
            // lookup and make the broken-sweep alert never fire (the original
            // bug back again), so it reported the honest third answer — this
            // run's `acted` is incomplete. That answer is correct but blind:
            // a connector-driven flow contributed NO signal, neither confirming
            // work nor being flagged for doing none.
            //
            // #4395 lets the action declare `effect`, and this is where the
            // declaration is spent. Resolved BEFORE dispatch so both the
            // success and the failure path read one value.
            const effect = engine.resolveConnectorActionEffect(cfg.connectorId, cfg.actionId);

            // #27327 — `input` is a value-slot map: a top-level CEL envelope is
            // evaluated in the run's scope, every other value handed on as a
            // copy of what was written. Before, the map went to the handler as
            // written, so an envelope reading a record field reached the
            // provider as the object it spells. Resolved BEFORE the `try`: an
            // envelope that faults throws with its source, like every value
            // slot's, and nothing is sent upstream.
            const input = resolveValueSlotMap(engine, cfg.input, variables, 'input', context);

            // #27995 — the action's declared `inputSchema` is a contract, not a
            // hint: the EVALUATED input is judged against it here, after the
            // value slots resolved and before the handler is called, so a call
            // missing a required parameter (or carrying one of the wrong type)
            // fails this step instead of reaching the remote API, whose answer
            // to a malformed call is the remote's to choose. Read from the
            // designer-facing descriptor — `inputSchema` is projected from the
            // stored def unchanged, and it is the very schema an author picks
            // the action by on `GET /connectors`, so what is enforced is what
            // was shown. A `runtime` failure, not a guard: the input can come
            // from run data, so a `fault` edge may handle it.
            const inputSchema = engine
                .getConnectorDescriptors()
                .find((d) => d.name === cfg.connectorId)
                ?.actions.find((a) => a.key === cfg.actionId)?.inputSchema;
            const violations: InputSchemaViolations = { lines: [], textForScalar: false };
            collectInputSchemaViolations(inputSchema, input, '', violations);
            if (violations.lines.length > 0) {
                const shown = violations.lines.slice(0, MAX_NAMED_VIOLATIONS);
                const more = violations.lines.length - shown.length;
                return {
                    success: false,
                    code: 'VALIDATION_ERROR',
                    error:
                        `connector_action '${node.id}': input for '${cfg.connectorId}.${cfg.actionId}' `
                        + `does not match the action's inputSchema — ${shown.join('; ')}`
                        + (more > 0 ? `; and ${more} more` : '')
                        + `. Nothing was sent. Fix connectorConfig.input so it satisfies the inputSchema `
                        + `GET /api/v1/automation/connectors lists for this action.`
                        // Text is never converted here: the executor cannot tell
                        // a provider that serializes a section to strings from
                        // one that sends JSON, so the cast is the author's.
                        + (violations.textForScalar
                            ? ` A text value for an integer, number or boolean parameter is not converted: `
                                + `cast it in a CEL envelope with int(), double() or bool().`
                            : ''),
                };
            }

            try {
                const output = await handler(input, handlerCtx);
                return {
                    success: true,
                    output,
                    // A declared `write` the upstream ACCEPTED is one effect; a
                    // declared `read` never mutates, so its zero is real rather
                    // than a guess. Undeclared stays uncountable — same as the
                    // `http` node's method-derived split (a GET reports 0, an
                    // accepted mutation reports 1).
                    metrics: effect === 'write'
                        ? { acted: 1 }
                        : effect === 'read'
                            ? { acted: 0 }
                            : { unmeasuredEffect: true },
                };
            } catch (err) {
                return {
                    success: false,
                    error: `connector_action(${cfg.connectorId}.${cfg.actionId}) failed: ${(err as Error).message}`,
                    // A handler that threw may still have reached the upstream —
                    // so a declared WRITE falls back to uncountable here rather
                    // than to `acted: 0`, exactly as a rejected mutating `http`
                    // call does. A declared READ is the one case a failure still
                    // answers: it could not have mutated anything either way.
                    metrics: effect === 'read' ? { acted: 0 } : { unmeasuredEffect: true },
                };
            }
        },
    });

    ctx.logger.info('[Connector] 1 built-in node executor registered (connector_action)');
}

/** What one judgment found: each violation as a sentence, and whether any was text where a number or boolean is declared. */
interface InputSchemaViolations {
    lines: string[];
    textForScalar: boolean;
}

/** How many violations one refusal names before it summarises the rest as a count. */
const MAX_NAMED_VIOLATIONS = 5;

/** JSON Schema `type` names this check can judge; any other name leaves the value unjudged. */
const JUDGED_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** The value's JSON kind, or `undefined` for one with no JSON spelling to judge (a `Date`, a `Map`, …). */
function jsonKindOf(value: unknown): string | undefined {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (isPlainRecord(value)) return 'object';
    if (typeof value === 'bigint') return 'number';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return typeof value;
    return undefined;
}

function matchesType(type: string, value: unknown, kind: string): boolean {
    if (type === 'integer') return typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value));
    return type === kind;
}

/**
 * Collect where `value` breaks `schema` (#27995), each as a sentence naming the
 * parameter by its dotted path. Judges a deliberate SUBSET of JSON Schema —
 * `required`, `type` (with OpenAPI 3.0 `nullable`), and descent through
 * `properties` and `items` — because the schemas reaching here are not ours:
 * an OpenAPI document's operation (which may keep an unresolved `$ref`), an
 * MCP server's `tools/list` entry (any draft), or a code connector's literal.
 * A keyword outside the subset (`$ref`, `oneOf`/`anyOf`/`allOf`, `enum`,
 * `format`, bounds, `additionalProperties`, …) never refuses a call: the
 * remote still judges those, as it did before. A missing piece is the narrow
 * direction on purpose — a call this check refuses is one the declared
 * schema itself says is wrong under every draft. `null` on an optional
 * property counts as absent (see the property loop), and text is never
 * coerced to the number or boolean a parameter declares.
 */
function collectInputSchemaViolations(schema: unknown, value: unknown, path: string, out: InputSchemaViolations): void {
    if (!isPlainRecord(schema)) return;
    const kind = jsonKindOf(value);
    if (kind === undefined) return;
    const declared = typeof schema.type === 'string' ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
    const types = declared.filter((t): t is string => typeof t === 'string');
    const judgeable = types.length > 0 && types.length === declared.length && types.every((t) => JUDGED_TYPES.has(t));
    if (
        judgeable
        && !(kind === 'null' && schema.nullable === true)
        && !types.some((t) => matchesType(t, value, kind))
    ) {
        out.lines.push(`'${path || 'input'}' must be ${types.join(' or ')}, got ${kind}`);
        if (kind === 'string' && types.some((t) => t === 'integer' || t === 'number' || t === 'boolean')) {
            out.textForScalar = true;
        }
        return;
    }
    if (kind === 'object') {
        const record = value as Record<string, unknown>;
        const properties = isPlainRecord(schema.properties) ? schema.properties : undefined;
        const required = new Set(
            Array.isArray(schema.required) ? schema.required.filter((k): k is string => typeof k === 'string') : [],
        );
        for (const key of required) {
            if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) {
                const at = path ? `${path}.${key}` : key;
                // A missing required SECTION names the parameters it requires
                // too, so the first refusal already carries the parameter.
                const sub = properties?.[key];
                const inner = isPlainRecord(sub) && Array.isArray(sub.required)
                    ? sub.required.filter((k): k is string => typeof k === 'string').map((k) => `'${at}.${k}'`)
                    : [];
                out.lines.push(`missing required '${at}'${inner.length > 0 ? ` (with ${inner.join(', ')})` : ''}`);
            }
        }
        if (properties) {
            for (const [key, sub] of Object.entries(properties)) {
                if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) continue;
                // `null` on an OPTIONAL property is read as absent: a provider
                // that serializes a section drops it, so the wire equals
                // omission, which the schema permits. On a REQUIRED property
                // it is still judged — it would be sent as a placeholder.
                if (record[key] === null && !required.has(key)) continue;
                collectInputSchemaViolations(sub, record[key], path ? `${path}.${key}` : key, out);
            }
        }
    } else if (kind === 'array' && isPlainRecord(schema.items)) {
        (value as unknown[]).forEach((item, i) => collectInputSchemaViolations(schema.items, item, `${path}[${i}]`, out));
    }
}
