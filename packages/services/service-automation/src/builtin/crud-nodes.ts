// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import {
    defineActionDescriptor,
    GetRecordConfigSchema,
    CreateRecordConfigSchema,
    UpdateRecordConfigSchema,
    DeleteRecordConfigSchema,
} from '@objectstack/spec/automation';
import type {
    GetRecordConfigParsed,
    CreateRecordConfigParsed,
    UpdateRecordConfigParsed,
    DeleteRecordConfigParsed,
} from '@objectstack/spec/automation';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import type { AutomationEngine } from '../engine.js';
import { interpolate, interpolateFilter, type VariableMap } from './template.js';
import { refuseNode } from '../guard-refusal.js';
import { parseNodeConfig } from './parse-config.js';
import { resolveRunDataContext, stampSystemInsertOwner } from '../runtime-identity.js';

/**
 * A filter condition that an author WROTE but that interpolation erased
 * (framework#3810).
 *
 * The flow interpolator expresses "this token did not resolve" as `undefined`.
 * In every other config block that is harmless — an unresolved `{x}` in a
 * message renders as empty text. In a FILTER it is the opposite of harmless:
 * a condition whose value is `undefined` is not a narrower query, it is an
 * ABSENT one, and an absent condition matches MORE rows. When the erased
 * condition was the only one, `{ owner: '{record.ownr}' }` becomes `{}` — and
 * `{}` handed to `deleteMany` is every row in the table.
 *
 * So a single mistyped field name in a `delete_record` node silently emptied
 * the object. Not a hypothetical: `{record.ownr}` (typo), `{someInput}` (an
 * input the run did not receive) and `{record.account.name}` (a lookup hop —
 * the trigger record carries a scalar id) all reach this state, and none of
 * them produced a diagnostic anywhere.
 *
 * The guard below refuses to execute such a node. It is deliberately keyed on
 * "a condition the author wrote is gone", not on "the filter is empty": losing
 * ONE of two conditions still silently widens the blast radius from "my open
 * records" to "all open records".
 */
function erasedFilterConditions(
    before: unknown,
    after: unknown,
    path: string[] = [],
): Array<{ path: string; template: string }> {
    const out: Array<{ path: string; template: string }> = [];
    const at = (p: string[]) => p.join('.') || '(root)';

    if (typeof before === 'string') {
        if (after === undefined && before.includes('{')) {
            out.push({ path: at(path), template: before });
        }
        return out;
    }
    if (Array.isArray(before)) {
        before.forEach((v, i) =>
            out.push(...erasedFilterConditions(v, (after as unknown[] | undefined)?.[i], [...path, String(i)])),
        );
        return out;
    }
    if (before && typeof before === 'object') {
        const afterRec = (after ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(before as Record<string, unknown>)) {
            out.push(...erasedFilterConditions(v, afterRec[k], [...path, k]));
        }
    }
    return out;
}

/**
 * Interpolate a node's filter and refuse the node if any authored condition was
 * erased. Returns either the usable filter or a ready-to-return failure.
 *
 * `verb` names the operation in the error so the message says what WOULD have
 * happened ("would have matched every row and deleted it").
 */
function resolveNodeFilter(
    rawFilter: unknown,
    variables: VariableMap,
    context: Parameters<typeof interpolateFilter>[2],
    nodeType: string,
    consequence: string,
): { filter: Record<string, unknown> } | { error: string } {
    const filter = interpolateFilter(rawFilter ?? {}, variables, context) as Record<string, unknown>;
    const erased = erasedFilterConditions(rawFilter ?? {}, filter);
    if (erased.length > 0) {
        const detail = erased.map((e) => `\`${e.template}\` (at ${e.path})`).join(', ');
        return {
            error:
                `${nodeType}: refusing to run — ${erased.length} filter condition(s) resolved to nothing ` +
                `and were dropped from the query: ${detail}. An absent condition does not narrow a query, ` +
                `it widens it, so this ${consequence}. Check the field name, confirm the flow variable is ` +
                `set on this run, and note that a relation field holds a scalar id — a \`{record.<lookup>.<field>}\` ` +
                `hop needs the relation in the start node's \`config.expand\`.`,
        };
    }
    return { filter };
}

/**
 * #3407 — render a data-layer strip event as a step warning. The write itself
 * SUCCEEDED; the warning tells the flow author which requested fields never
 * landed and why, so the run trace is not a silent 3ms `success` (#3356's
 * masked approval stage write-backs). `readonlyWhen` wording covers the bulk
 * "locked in ≥1 matched row" semantics too — a multi-row update drops a
 * conditionally-locked field for the whole batch.
 */
const DROPPED_REASON_LABEL: Record<DroppedFieldsEvent['reason'], string> = {
    readonly: 'the field is read-only (readonly: true)',
    readonly_when: 'the field is conditionally read-only (readonlyWhen; on multi-row updates: locked in ≥1 matched row)',
    // [#6437] The map is `Record<DroppedFieldsEvent['reason'], string>` on
    // purpose: a reason added in `packages/spec` fails THIS file's typecheck
    // until it is worded, which is how the flow author keeps getting a true
    // sentence instead of a fall-through label. Keep it exhaustive.
    primary_key: "the field is the object's primary key and the value sent is not an identifier — the row(s) are identified by the id argument or the filter, so writing it would have overwritten their primary key (pass a scalar id, or put an id set in the filter)",
};

function droppedFieldsWarning(nodeType: string, e: DroppedFieldsEvent): string {
    return `${nodeType}(${e.object}): requested field(s) [${e.fields.join(', ')}] were NOT written — ${DROPPED_REASON_LABEL[e.reason] ?? e.reason}. The write succeeded without them.`;
}

/**
 * How many rows an `update` / `delete` actually touched (#4354).
 *
 * The data engine returns a DIFFERENT shape per route, by design: a bulk write
 * lands on `driver.updateMany` / `deleteMany`, whose contract is
 * `Promise<number>` (the row count), while a by-id write returns the updated
 * record — or, for delete, whatever the driver reports (typically a boolean).
 * The executor is the only place that knows which route it asked for, which is
 * exactly why {@link NodeExecutionResult.metrics} is declared by the node and
 * not sniffed by the engine.
 *
 * `null` / `false` / `undefined` ⇒ nothing was written. Anything else the driver
 * hands back that is neither a count nor a list is one row — the write returned,
 * so a row was touched.
 */
function writtenRowCount(result: unknown): number {
    if (typeof result === 'number') return Number.isFinite(result) && result > 0 ? Math.trunc(result) : 0;
    if (Array.isArray(result)) return result.length;
    if (result === null || result === undefined || result === false) return 0;
    return 1;
}

/**
 * CRUD built-in nodes — `get_record` / `create_record` / `update_record` /
 * `delete_record`, wired to the runtime data layer (ObjectQL / IDataEngine).
 * Part of the platform baseline, so the core {@link AutomationServicePlugin}
 * seeds them directly (ADR-0018) rather than shipping a separate plugin.
 *
 * Each executor:
 *  1. Interpolates `{var}` / `{var.path}` / `{$User.*}` / `{NOW()}` tokens in
 *     `node.config` against the running flow's variable context.
 *  2. Calls the resolved data engine via `ctx.getService('data')`.
 *  3. Writes the result back to the variable context under `outputVariable`
 *     (or under `<nodeId>.id` / `<nodeId>.records` by default), so downstream
 *     nodes can reference fields like `{leadRecord.company}`.
 *
 * If no data engine is registered, executors degrade to a no-op success so
 * test environments without ObjectQL still complete the flow without errors.
 */
export function registerCrudNodes(engine: AutomationEngine, ctx: PluginContext): void {
        const getData = (): IDataEngine | undefined => {
            try {
                return ctx.getService<IDataEngine>('data') ?? ctx.getService<IDataEngine>('objectql');
            } catch {
                return undefined;
            }
        };

        // ── get_record ────────────────────────────────────────
        engine.registerNodeExecutor({
            type: 'get_record',
            descriptor: defineActionDescriptor({
                type: 'get_record', version: '1.0.0', name: 'Get Records',
                description: 'Query records from an object.',
                icon: 'search', category: 'data', source: 'builtin',
                // Structured designer form (ADR-0018, #3304) — mirrors objectui's
                // hardcoded `get_record` field group. `filter` is a free-form
                // string-keyed map (JSON-Schema `additionalProperties`), which the
                // designer renders with its flat keyValue editor; values stay
                // `true`-permissive because real metadata carries operator objects
                // (e.g. `{"$ne": null}`) alongside `{var}` templates and literals.
                configSchema: {
                    type: 'object',
                    properties: {
                        objectName: { type: 'string', title: 'Object', xRef: { kind: 'object' } },
                        filter: { type: 'object', additionalProperties: true, title: 'Filter', description: 'Field/value pairs to match (e.g. status → active). Operator values like {"$ne": null} are preserved.' },
                        // Declared in #4045: the executor has always passed this
                        // straight into find/findOne as the projection, but no
                        // form offered it — authorable only by hand until now.
                        fields: {
                            type: 'array', items: { type: 'string' }, title: 'Fields',
                            description: 'Field projection — only these fields are read (default: all).',
                        },
                        limit: { type: 'integer', title: 'Limit' },
                        outputVariable: { type: 'string', title: 'Output variable' },
                    },
                    required: ['objectName'],
                },
            }),
            async execute(node, variables, context) {
                // `filters` → `filter` and `object` → `objectName` are handled at
                // load by the ADR-0087 D2 conversion layer ('flow-node-crud-filter-alias',
                // 'flow-node-crud-object-alias'), so the parse sees canonical keys
                // (PD #12 fallbacks retired). Parsed BEFORE interpolation: every
                // typed slot the contract declares beyond strings is read raw by
                // this executor too (`limit` never honored a template), so a
                // template in one was already dead config — now it is loud.
                const parsed = parseNodeConfig<GetRecordConfigParsed>('get_record', node.id, GetRecordConfigSchema, node.config);
                if (!parsed.ok) return parsed.refusal;
                const cfg = parsed.config;
                const objectName = cfg.objectName;
                if (!objectName) return refuseNode('get_record: objectName required');

                const filterResult = resolveNodeFilter(
                    cfg.filter, variables, context, 'get_record',
                    'would have read rows the filter was written to exclude',
                );
                if ('error' in filterResult) return refuseNode(filterResult.error);
                const filter = filterResult.filter;
                const fields = cfg.fields;
                const limit = cfg.limit;
                const outputVariable = cfg.outputVariable;

                const data = getData();
                if (!data) {
                    ctx.logger.warn(`[get_record] no data engine; skipping ${objectName}`);
                    return { success: true, output: { records: [], object: objectName }, metrics: { selected: 0 } };
                }

                // #1888 — honor flow.runAs: read under the run's effective identity
                // (system → RLS-bypassing; user → the triggering user).
                const dataCtx = resolveRunDataContext(context);
                try {
                    if (limit && limit > 1) {
                        const records = await data.find(objectName, { where: filter, fields, limit, context: dataCtx });
                        if (outputVariable) variables.set(outputVariable, records);
                        // #4354 — the `selected` half of the broken-sweep signal:
                        // this is the count that made #4347 diagnosable at all
                        // ("found every stalled deal and nudged nobody").
                        return {
                            success: true,
                            output: { records, object: objectName },
                            metrics: { selected: Array.isArray(records) ? records.length : 0 },
                        };
                    }
                    const record = await data.findOne(objectName, { where: filter, fields, context: dataCtx });
                    if (outputVariable) variables.set(outputVariable, record);
                    return {
                        success: true,
                        output: { record, id: record?.id, object: objectName },
                        metrics: { selected: record ? 1 : 0 },
                    };
                } catch (err) {
                    return { success: false, error: `get_record(${objectName}) failed: ${(err as Error).message}` };
                }
            },
        });

        // ── create_record ─────────────────────────────────────
        engine.registerNodeExecutor({
            type: 'create_record',
            descriptor: defineActionDescriptor({
                type: 'create_record', version: '1.0.0', name: 'Create Record',
                description: 'Insert a new record into an object.',
                icon: 'plus-circle', category: 'data', source: 'builtin',
                // Designer form (ADR-0018, #3304) — see get_record for the
                // keyValue-map rationale.
                configSchema: {
                    type: 'object',
                    properties: {
                        objectName: { type: 'string', title: 'Object', xRef: { kind: 'object' } },
                        fields: { type: 'object', additionalProperties: true, title: 'Field values', description: 'Field values to write on the new record.' },
                        outputVariable: { type: 'string', title: 'Output variable' },
                    },
                    required: ['objectName'],
                },
            }),
            async execute(node, variables, context) {
                const parsed = parseNodeConfig<CreateRecordConfigParsed>('create_record', node.id, CreateRecordConfigSchema, node.config);
                if (!parsed.ok) return parsed.refusal;
                const cfg = parsed.config;
                const objectName = cfg.objectName;
                if (!objectName) return refuseNode('create_record: objectName required');

                const fields = interpolate(cfg.fields ?? {}, variables, context) as Record<string, unknown>;
                const outputVariable = cfg.outputVariable;

                const data = getData();
                if (!data) {
                    ctx.logger.warn(`[create_record] no data engine; skipping ${objectName}`);
                    const mockId = `mock-${objectName}-${Date.now()}`;
                    if (outputVariable) variables.set(outputVariable, { id: mockId });
                    // `acted: 0` — the mock id is a placeholder for downstream
                    // templates, not a row. A summary that counted it would
                    // report writes that never happened (#4354).
                    return { success: true, output: { id: mockId, object: objectName }, metrics: { acted: 0 } };
                }

                // #1888 — honor flow.runAs (system → RLS-bypassing; user → trigger user).
                // #5494 — a BORN row must not escape the platform stamps. The run
                // context now carries the trigger's user + org even under system
                // elevation (so the audit hook stamps `created_by` and the driver's
                // tenant machinery fills `organization_id`, exactly like a user-path
                // insert); the ownership anchor has no such engine-side channel for
                // system writes — the security middleware that stamps it
                // short-circuits on `isSystem` — so the writer fills it here.
                // Fill-only — flow-authored `fields` win. Policy + rationale live
                // beside `resolveRunDataContext` in runtime-identity.ts.
                const dataCtx = resolveRunDataContext(context);
                stampSystemInsertOwner(fields, dataCtx, data, objectName);
                try {
                    // #3407 — symmetric with update_record. Today the engine's
                    // insert path strips nothing (INSERT is readonly-exempt and
                    // FLS write denial throws), so this listener never fires;
                    // wired anyway so a future insert-side strip surfaces here
                    // automatically instead of going silent.
                    const dropped: DroppedFieldsEvent[] = [];
                    const created = await data.insert(objectName, fields, {
                        context: dataCtx,
                        onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); },
                    });
                    const createdRecord = Array.isArray(created) ? created[0] : created;
                    const insertedId =
                        createdRecord && typeof createdRecord === 'object'
                            ? (createdRecord as Record<string, unknown>).id
                            : createdRecord;
                    if (outputVariable) {
                        // #1873 — expose the created RECORD so later nodes can reference
                        // `{var.id}` (and other fields), not just the bare id string. When the
                        // driver returns a bare id, wrap it as `{ id }` so `{var.id}` still works.
                        variables.set(
                            outputVariable,
                            createdRecord && typeof createdRecord === 'object' ? createdRecord : { id: insertedId },
                        );
                    }
                    const droppedFields = dropped.flatMap((e) => e.fields);
                    return {
                        success: true,
                        output: {
                            id: insertedId,
                            record: createdRecord,
                            object: objectName,
                            ...(droppedFields.length > 0 ? { droppedFields } : {}),
                        },
                        ...(dropped.length > 0
                            ? { warnings: dropped.map((e) => droppedFieldsWarning('create_record', e)) }
                            : {}),
                        metrics: { acted: 1 },
                    };
                } catch (err) {
                    return { success: false, error: `create_record(${objectName}) failed: ${(err as Error).message}` };
                }
            },
        });

        // ── update_record ─────────────────────────────────────
        engine.registerNodeExecutor({
            type: 'update_record',
            descriptor: defineActionDescriptor({
                type: 'update_record', version: '1.0.0', name: 'Update Records',
                description: 'Update records matching a filter.',
                icon: 'edit', category: 'data', source: 'builtin',
                // Designer form (ADR-0018, #3304) — see get_record for the
                // keyValue-map rationale.
                configSchema: {
                    type: 'object',
                    properties: {
                        objectName: { type: 'string', title: 'Object', xRef: { kind: 'object' } },
                        filter: { type: 'object', additionalProperties: true, title: 'Filter', description: 'Field/value pairs identifying the record(s) to update (e.g. id → {recordId}).' },
                        fields: { type: 'object', additionalProperties: true, title: 'Field values', description: 'Field values to write.' },
                        // #5393 — the author's bulk DECLARATION. Off (default)
                        // the engine accepts only a write that names one row by
                        // scalar id; a predicate update is refused rather than
                        // silently narrowed or silently widened.
                        multi: {
                            type: 'boolean', title: 'Update every matching record',
                            description: 'Declare bulk intent: update EVERY record the filter matches. Off (default) means the filter must name one record by id — a predicate update without this is refused by the data engine.',
                        },
                    },
                    required: ['objectName'],
                },
            }),
            async execute(node, variables, context) {
                const parsed = parseNodeConfig<UpdateRecordConfigParsed>('update_record', node.id, UpdateRecordConfigSchema, node.config);
                if (!parsed.ok) return parsed.refusal;
                const cfg = parsed.config;
                const objectName = cfg.objectName;
                if (!objectName) return refuseNode('update_record: objectName required');

                // `filters` → `filter` converted at load (ADR-0087 D2); read canonical.
                const filterResult = resolveNodeFilter(
                    cfg.filter, variables, context, 'update_record',
                    'would have matched — and overwritten — rows the filter was written to exclude',
                );
                if ('error' in filterResult) return refuseNode(filterResult.error);
                const filter = filterResult.filter;
                // `fields` is the single canonical write-map key — no alias (the wrong key
                // `fieldValues` is corrected at the authoring source + rejected by graph-lint).
                const fields = interpolate(cfg.fields ?? {}, variables, context) as Record<string, unknown>;

                const data = getData();
                if (!data) {
                    ctx.logger.warn(`[update_record] no data engine; skipping ${objectName}`);
                    return { success: true, metrics: { acted: 0 } };
                }

                // #1888 — honor flow.runAs (system → RLS-bypassing; user → trigger user).
                const dataCtx = resolveRunDataContext(context);
                try {
                    // #3407 — collect the data layer's silently-stripped write
                    // fields (readonly / readonlyWhen). The strip is LEGAL — the
                    // update still succeeds — but the step must say which
                    // requested fields never landed instead of reporting a clean
                    // success while the DB truth stayed unchanged.
                    const dropped: DroppedFieldsEvent[] = [];
                    const result = await data.update(objectName, fields, {
                        where: filter,
                        // #5393 — the author's declared bulk intent, forwarded
                        // to the engine's own word for it. Stated on EVERY call
                        // rather than spread in when true: `multi: false` is the
                        // half of the contract that makes the engine refuse a
                        // predicate update, and a reader of this call should see
                        // which half was asked for without inferring it from an
                        // absent key.
                        multi: cfg.multi === true,
                        context: dataCtx,
                        onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); },
                    });
                    const droppedFields = dropped.flatMap((e) => e.fields);
                    return {
                        success: true,
                        output: {
                            result,
                            object: objectName,
                            // Structured list for downstream nodes ({<nodeId>.droppedFields}).
                            ...(droppedFields.length > 0 ? { droppedFields } : {}),
                        },
                        ...(dropped.length > 0
                            ? { warnings: dropped.map((e) => droppedFieldsWarning('update_record', e)) }
                            : {}),
                        metrics: { acted: writtenRowCount(result) },
                    };
                } catch (err) {
                    return { success: false, error: `update_record(${objectName}) failed: ${(err as Error).message}` };
                }
            },
        });

        // ── delete_record ─────────────────────────────────────
        engine.registerNodeExecutor({
            type: 'delete_record',
            descriptor: defineActionDescriptor({
                type: 'delete_record', version: '1.0.0', name: 'Delete Records',
                description: 'Delete records matching a filter.',
                icon: 'trash', category: 'data', source: 'builtin',
                // Designer form (ADR-0018, #3304) — see get_record for the
                // keyValue-map rationale.
                configSchema: {
                    type: 'object',
                    properties: {
                        objectName: { type: 'string', title: 'Object', xRef: { kind: 'object' } },
                        filter: { type: 'object', additionalProperties: true, title: 'Filter', description: 'Field/value pairs identifying the record(s) to delete.' },
                        // #5393 — see update_record. Highest-stakes declaration
                        // the flow language has: without it a predicate delete
                        // is refused by the engine, with it every matched row
                        // goes, and `multi` + no filter is the whole object.
                        multi: {
                            type: 'boolean', title: 'Delete every matching record',
                            description: 'Declare bulk intent: delete EVERY record the filter matches. Off (default) means the filter must name one record by id — a predicate delete without this is refused by the data engine.',
                        },
                    },
                    required: ['objectName'],
                },
            }),
            async execute(node, variables, context) {
                const parsed = parseNodeConfig<DeleteRecordConfigParsed>('delete_record', node.id, DeleteRecordConfigSchema, node.config);
                if (!parsed.ok) return parsed.refusal;
                const cfg = parsed.config;
                const objectName = cfg.objectName;
                if (!objectName) return refuseNode('delete_record: objectName required');

                // `filters` → `filter` converted at load (ADR-0087 D2); read canonical.
                // The highest-stakes of the three: an erased condition here is the
                // difference between deleting one row and emptying the object.
                const filterResult = resolveNodeFilter(
                    cfg.filter, variables, context, 'delete_record',
                    'would have matched every remaining row and deleted it',
                );
                if ('error' in filterResult) return refuseNode(filterResult.error);
                const filter = filterResult.filter;

                const data = getData();
                if (!data) return { success: true, metrics: { acted: 0 } };

                // #1888 — honor flow.runAs (system → RLS-bypassing; user → trigger user).
                const dataCtx = resolveRunDataContext(context);
                try {
                    // #5393 — `multi` is the author's declaration, forwarded to
                    // the engine's own word for it (see update_record above).
                    const result = await data.delete(objectName, { where: filter, multi: cfg.multi === true, context: dataCtx });
                    return {
                        success: true,
                        output: { result, object: objectName },
                        metrics: { acted: writtenRowCount(result) },
                    };
                } catch (err) {
                    return { success: false, error: `delete_record(${objectName}) failed: ${(err as Error).message}` };
                }
            },
        });

        ctx.logger.info('[CRUD Nodes] 4 built-in node executors registered (data-backed)');
}
