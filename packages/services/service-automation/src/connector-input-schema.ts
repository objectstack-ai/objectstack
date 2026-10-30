// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connector action input check (#27995, #28040) — ONE judgment, shared by
 * every door that dispatches a connector action: the `connector_action` flow
 * node (`builtin/connector-nodes.ts`) and the connector pull door
 * (`connector-pull.ts`). The action's declared `inputSchema` is a contract,
 * not a hint: a call missing a required parameter (or carrying one of the
 * wrong type) is refused before the handler is called, instead of reaching
 * the remote API, whose answer to a malformed call is the remote's to choose.
 *
 * The schema is read from the designer-facing descriptor —
 * `inputSchema` is projected from the stored def unchanged, and it is the very
 * schema an author picks the action by on `GET /connectors`, so what is
 * enforced is what was shown. Each door words its own refusal around the
 * sentence {@link judgeConnectorInput} returns.
 */

import type { ConnectorDescriptor } from '@objectstack/spec/integration';

/** Where a door reads an action's declared `inputSchema` — the automation engine's descriptor list. */
export interface ConnectorInputSchemaSource {
    getConnectorDescriptors(): ConnectorDescriptor[];
}

/** What one judgment found: the violations as one sentence, and whether any was text where a number or boolean is declared. */
export interface ConnectorInputVerdict {
    /** Up to {@link MAX_NAMED_VIOLATIONS} violations joined by `; `, then `; and N more` when there are others. */
    violations: string;
    /** A text value met an `integer` / `number` / `boolean` parameter — the door appends {@link TEXT_FOR_SCALAR_HINT}. */
    textForScalar: boolean;
}

/**
 * The cast hint a refusal appends when {@link ConnectorInputVerdict.textForScalar}
 * is set. Text is never converted here: the check cannot tell a provider that
 * serializes a section to strings from one that sends JSON, so the cast is the
 * author's.
 */
export const TEXT_FOR_SCALAR_HINT =
    ` A text value for an integer, number or boolean parameter is not converted: `
    + `cast it in a CEL envelope with int(), double() or bool().`;

/** The `inputSchema` `connectorId.actionId` declares, or `undefined` when it declares none (or is not registered). */
export function findConnectorActionInputSchema(
    source: ConnectorInputSchemaSource,
    connectorId: string,
    actionId: string,
): unknown {
    return source
        .getConnectorDescriptors()
        .find((d) => d.name === connectorId)
        ?.actions.find((a) => a.key === actionId)?.inputSchema;
}

/**
 * Judge `input` — the input the door is about to hand the handler, after
 * every value it adds — against `inputSchema`. `undefined` means nothing is
 * wrong (or the action declares no schema), so the call may be dispatched.
 */
export function judgeConnectorInput(inputSchema: unknown, input: unknown): ConnectorInputVerdict | undefined {
    const found: InputSchemaViolations = { lines: [], textForScalar: false };
    collectInputSchemaViolations(inputSchema, input, '', found);
    if (found.lines.length === 0) return undefined;
    const shown = found.lines.slice(0, MAX_NAMED_VIOLATIONS);
    const more = found.lines.length - shown.length;
    return {
        violations: shown.join('; ') + (more > 0 ? `; and ${more} more` : ''),
        textForScalar: found.textForScalar,
    };
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
