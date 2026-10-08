// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import {
    defineActionDescriptor,
    GetRecordConfigSchema,
    CreateRecordConfigSchema,
    UpdateRecordConfigSchema,
    DeleteRecordConfigSchema,
    isExpressionEnvelopeShaped,
} from '@objectstack/spec/automation';
import type {
    GetRecordConfigParsed,
    CreateRecordConfigParsed,
    UpdateRecordConfigParsed,
    DeleteRecordConfigParsed,
} from '@objectstack/spec/automation';
import type { AutomationContext, IDataEngine } from '@objectstack/spec/contracts';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import { StandardErrorCode } from '@objectstack/spec/api';
import { isStoredMetadataBodyObject, STORED_METADATA_BODY_PRESCRIPTION } from '@objectstack/spec/kernel';
import {
    collectStoredMetadataFilterFields,
    ephemeralStoredHashDigest,
    redactStoredMetadataRows,
    serveStoredMetadataHashColumnRows,
    storedMetadataBodyPredicateRefusal,
    storedMetadataBodyProjection,
    storedMetadataHashEvaluateRefusal,
    type StoredHashDigest,
} from '@objectstack/metadata-protocol';
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
    // [#20805]
    computed: 'the field is a computed formula — its value is computed each time the record is read, so there is nothing to write (leave it out of the fields map)',
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
 * Resolve a `create_record` / `update_record` `fields` map to the values the
 * write carries (#11182 ruling D — the executor half of the `fields.*` value
 * slot #19938 declares in the expression ledger).
 *
 * Per field, by SHAPE — the rule the ledger resolver and the spec contract
 * (`FlowValueSlotSchema`) draw with the same predicate, imported rather than
 * re-spelled, so "which values does the validator judge" and "which values
 * does the executor evaluate" cannot drift apart:
 *
 *  - an envelope-shaped TOP-LEVEL value ({@link isExpressionEnvelopeShaped} —
 *    a plain object naming a string `dialect`) is a CEL value envelope, and
 *    is EVALUATED by `AutomationEngine.evaluateValueEnvelope`, the call the
 *    `assignment` executor already makes — one evaluator, one scope
 *    (`celScope`), one notion of malformed (`valueEnvelopeRefusals`, the call
 *    `registerFlow` makes). A malformed envelope throws rather than degrading
 *    to a literal; a value that faults on the live variables throws with its
 *    source (ADR-0032 §1c/§1d). Neither is written.
 *  - every other value is a literal — a string, an array, a plain object, an
 *    envelope-shaped object NESTED inside either — and is written as it is.
 *    Since #19939 (the C half of #11182 ruling D) a `{token}` of the retired
 *    template dialect never reaches this point: the executor's
 *    `parseNodeConfig` refuses it through `FlowValueSlotSchema` (the same
 *    judge `registerFlow` and `objectstack validate` call), so a literal here
 *    carries no token — or only the two spellings CEL cannot write yet and
 *    the retirement keeps, the date macros (`{NOW()}`, `{TODAY() + 7}`) and
 *    `{$User.*}`, which `interpolate()` still resolves. On every other
 *    literal `interpolate()` is the identity.
 *
 * Before this, the executor handed the whole map to `interpolate()`, which
 * recursed into an envelope as plain data: a text or JSON column received the
 * literal `{"dialect":"cel","source":"…"}` with the run reporting success, and
 * a number column was refused by the data engine.
 */
function resolveFieldValues(
    engine: AutomationEngine,
    fields: Record<string, unknown> | undefined,
    variables: VariableMap,
    context: AutomationContext,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields ?? {})) {
        out[key] = isExpressionEnvelopeShaped(value)
            ? engine.evaluateValueEnvelope(value, variables, `fields.${key}`)
            : interpolate(value, variables, context);
    }
    return out;
}

/**
 * [#21519] The keyed digest a stored content hash is served under: the data
 * engine's registered crypto provider's (`getKeyedDigest`, read at the moment
 * of use, because a host registers the provider after the kernel starts), else
 * `@objectstack/metadata-protocol`'s process-scoped ephemeral key. The same two
 * sources, in the same order, the generic data door reads, so the hash this
 * node serves is the hash the door serves for the same row: one key, never a
 * second one.
 */
function storedHashDigestOf(data: IDataEngine): StoredHashDigest {
    const accessor = (data as { getKeyedDigest?: () => StoredHashDigest | undefined }).getKeyedDigest;
    const provider = typeof accessor === 'function' ? accessor.call(data) : undefined;
    return provider ?? ephemeralStoredHashDigest;
}

/**
 * [#21519] Run one `get_record` read and serve its answer the way the generic
 * data door serves the same rows.
 *
 * The stored-metadata-body family (`sys_metadata` / `sys_metadata_history`,
 * judged by the family's own predicate, `isStoredMetadataBodyObject`) holds a
 * stored metadata body, credential material included, and a content hash over
 * that whole body. Every door that serves either serves the body as its type's
 * read projection and the hash in keyed form. A flow's read node is such a
 * door: what it reads becomes the run's output, a flow caller is handed that
 * back, and any record the flow writes from it is a copy. Both run identities
 * are served the same way: `runAs: 'system'` reads elevated, so the engine
 * cannot tell this read from the platform's own internal readers, which need
 * the stored form. The rule is therefore applied here, at the node.
 *
 * Built only from the door's own functions (`@objectstack/metadata-protocol`),
 * never a copy: the projection (`storedMetadataBodyProjection`, which adds the
 * `type` column a body-only projection needs to choose its redactor; it is
 * taken back off the served rows), the redactor (`redactStoredMetadataRows`)
 * and the keyed serve (`serveStoredMetadataHashColumnRows`, under
 * {@link storedHashDigestOf}). Any other object is read and returned as is.
 */
async function serveFamilyRead<A>(
    data: IDataEngine,
    objectName: string,
    fields: string[] | undefined,
    read: (fields: string[] | undefined) => Promise<A>,
): Promise<A> {
    if (!isStoredMetadataBodyObject(objectName)) return read(fields);
    const projection = storedMetadataBodyProjection(objectName, fields);
    const answer = await read(projection.fields as string[] | undefined);
    const opts = { dropType: projection.addedType };
    const digest = storedHashDigestOf(data);
    if (Array.isArray(answer)) {
        return (await serveStoredMetadataHashColumnRows(
            objectName,
            redactStoredMetadataRows(objectName, answer, opts),
            digest,
        )) as A;
    }
    if (answer !== null && typeof answer === 'object') {
        const [served] = await serveStoredMetadataHashColumnRows(
            objectName,
            redactStoredMetadataRows(objectName, [answer], opts),
            digest,
        );
        return served as A;
    }
    return answer;
}

/**
 * [#21623] Refuse a node whose filter EVALUATES the stored-metadata family's
 * body or content hash, the way the generic data door refuses the same filter.
 *
 * {@link serveFamilyRead} closes the node's serve and copy exits; this closes
 * its evaluate exit. A filter over the stored body column, or over a stored
 * content-hash column, is evaluated against the stored values row by row, so
 * whether a row comes back answers the predicate even though the row itself
 * is served projected: a guessed prefix of withheld credential material, or a
 * guessed hash, returns the row exactly when it is right (the predicate oracle
 * the family's refusals name). Under `runAs: 'system'` the engine reads
 * elevated and cannot tell this read from the platform's own internal
 * readers, so the rule is applied here, before the engine is asked.
 *
 * Built only from the door's own functions (`@objectstack/metadata-protocol`),
 * in the door's own order, never a copy:
 *  - the columns the filter reads come from the family's ONE filter-field
 *    collector (`collectStoredMetadataFilterFields`): every key's head and
 *    every cross-field `{ $field }` comparand, at any depth;
 *  - the body refusal (`storedMetadataBodyPredicateRefusal`) is asked first,
 *    then the content-hash refusal (`storedMetadataHashEvaluateRefusal`).
 *
 * `query` is the option bag the node hands the engine, so the collector reads
 * exactly the filter the engine would run: the INTERPOLATED one, since a
 * `{token}` can resolve to a whole condition (a `$and` list, a comparand) whose
 * columns the authored template does not show. The node configs declare no
 * sort and no grouping, so the refusals are fed filter fields only.
 *
 * The answer is a guard refusal ({@link refuseNode}: the metadata is wrong,
 * and re-running it unchanged never succeeds) carrying the door's own error
 * code, read off the door's refusal rather than spelled again. `undefined`
 * outside the family ({@link isStoredMetadataBodyObject}) and for a filter that
 * reads neither column.
 */
function storedMetadataFilterRefusal(
    nodeType: string,
    objectName: string,
    query: { where: Record<string, unknown> },
): (ReturnType<typeof refuseNode> & { code: string }) | undefined {
    if (!isStoredMetadataBodyObject(objectName)) return undefined;
    const filterFields = collectStoredMetadataFilterFields(objectName, query);
    const refuse = (refusal: Error) =>
        ({ ...refuseNode(`${nodeType}: ${refusal.message}`), code: (refusal as Error & { code: string }).code });
    const bodyPredicateRefusal = storedMetadataBodyPredicateRefusal(objectName, { filterFields });
    if (bodyPredicateRefusal) return refuse(bodyPredicateRefusal);
    const hashEvaluateRefusal = storedMetadataHashEvaluateRefusal(objectName, { filterFields });
    if (hashEvaluateRefusal) return refuse(hashEvaluateRefusal);
    return undefined;
}

/** [#21624] What each write node would have done, in its refusal's own words. */
const STORED_METADATA_WRITE_VERB = {
    create_record: 'create a record in',
    update_record: 'update',
    delete_record: 'delete from',
} as const;

/**
 * [#21624] Refuse a WRITE node aimed at the stored-metadata family
 * (`sys_metadata` / `sys_metadata_history`, judged by the family's own
 * predicate, {@link isStoredMetadataBodyObject}).
 *
 * The family has one writer for app-authored work: the metadata protocol,
 * where a change is validated and its provenance recorded (the ruling that
 * refuses a hook body bound to these tables, or a body's direct write to them,
 * applied to its own reason: a flow is app-authored automation too). Under
 * `runAs: 'system'` the engine writes elevated and cannot tell this write from
 * the platform's own internal writers, so the rule is applied here, at the
 * node. ⛔ Not routed through the protocol from inside the node: that would be
 * a second write path into the family.
 *
 * Judged on the object name the engine would be handed, before the node
 * resolves its `filter` or its `fields`, so a refused node answers the same
 * whatever it names: its filter is never evaluated against a family table
 * (the write nodes' evaluate exit) and nothing it would write is computed.
 *
 * The answer is a guard refusal ({@link refuseNode}: the metadata is wrong, and
 * re-running it unchanged never succeeds) carrying the standard catalog's
 * `PERMISSION_DENIED`: the code the data door's in-process write path answers
 * a non-platform principal's write to these tables with in a secured
 * composition, and the code the body-write boundary for the same ruling
 * carries. No code is minted. `undefined` for any other object.
 *
 * Its message names the node, the verb and the table, then ends on the
 * family's ONE prescription, `STORED_METADATA_BODY_PRESCRIPTION`, imported from
 * `@objectstack/spec/kernel`: the sentence `FlowSchema`'s save-time refusal of
 * the same node ends on, so the save and the run tell an author the same thing.
 */
function storedMetadataWriteRefusal(
    nodeType: keyof typeof STORED_METADATA_WRITE_VERB,
    objectName: string,
): (ReturnType<typeof refuseNode> & { code: string }) | undefined {
    if (!isStoredMetadataBodyObject(objectName)) return undefined;
    return {
        ...refuseNode(
            `${nodeType}: refusing to ${STORED_METADATA_WRITE_VERB[nodeType]} '${objectName}': it holds stored `
            + 'metadata, and a flow may not write it directly, so the write was not run. '
            + STORED_METADATA_BODY_PRESCRIPTION,
        ),
        code: StandardErrorCode.enum.PERMISSION_DENIED,
    };
}

/**
 * CRUD built-in nodes — `get_record` / `create_record` / `update_record` /
 * `delete_record`, wired to the runtime data layer (ObjectQL / IDataEngine).
 * Part of the platform baseline, so the core {@link AutomationServicePlugin}
 * seeds them directly (ADR-0018) rather than shipping a separate plugin.
 *
 * Each executor:
 *  1. Interpolates `{var}` / `{var.path}` / `{$User.*}` / `{NOW()}` tokens in
 *     `node.config` against the running flow's variable context — except in
 *     the `create_record` / `update_record` `fields` map, a value slot, where
 *     a CEL value envelope is evaluated to the value written and the `{…}`
 *     dialect is retired (#19939; {@link resolveFieldValues}).
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

                // [#21623] A filter that evaluates the stored-metadata family's
                // body or content hash is refused before the engine is asked,
                // with the data door's own code, under either run identity. It
                // reads the interpolated filter, in the `where` slot both
                // engine reads below hand it in.
                const familyRefusal = storedMetadataFilterRefusal('get_record', objectName, { where: filter });
                if (familyRefusal) return familyRefusal;

                const data = getData();
                if (!data) {
                    ctx.logger.warn(`[get_record] no data engine; skipping ${objectName}`);
                    return { success: true, output: { records: [], object: objectName }, metrics: { selected: 0 } };
                }

                // #1888 — honor flow.runAs: read under the run's effective identity
                // (system → RLS-bypassing; user → the triggering user).
                const dataCtx = resolveRunDataContext(context);
                // [#21519] A read of the stored-metadata family is served the
                // data door's way under either identity: body projected, hash keyed.
                try {
                    if (limit && limit > 1) {
                        const records = await serveFamilyRead(data, objectName, fields, (projection) =>
                            data.find(objectName, { where: filter, fields: projection, limit, context: dataCtx }));
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
                    const record = await serveFamilyRead(data, objectName, fields, (projection) =>
                        data.findOne(objectName, { where: filter, fields: projection, context: dataCtx }));
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
                // [#21624] A stored-metadata family target is refused before
                // anything is resolved or written, under either run identity.
                const familyRefusal = storedMetadataWriteRefusal('create_record', objectName);
                if (familyRefusal) return familyRefusal;

                // #19938 / #11182 ruling D — a CEL value envelope in `fields.*` is
                // evaluated; every other value is a literal (#19939 retired the
                // `{…}` dialect there — `parseNodeConfig` above refused it).
                const fields = resolveFieldValues(engine, cfg.fields, variables, context);
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
                    // #3407 — symmetric with update_record, and LIVE since
                    // #14147. It was wired in #3407 against an insert path that
                    // stripped nothing (INSERT was readonly-exempt; FLS write
                    // denial throws), i.e. for a signal it could not then
                    // receive — the maintainer ruling of 2026-09-03 put the
                    // static-`readonly` strip inside `engine.insert` under an
                    // `isSystem` gate, so a flow WITHOUT `runAs: 'system'` that
                    // seeds a readonly column now lands here: `output.dropped-
                    // Fields` plus a node warning, instead of a clean success
                    // over a column that never landed. Driven end to end in
                    // `create-record-readonly-drop.test.ts`.
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
                    // Commit c5a7448d5 — `engine.insert` (#14095) raises `DuplicateRecordError`
                    // for a unique-constraint violation, carrying the ADR-0112
                    // `code: 'DUPLICATE_RECORD'` this executor used to throw away by
                    // folding every failure into one opaque string. Surfacing it here
                    // (beside the existing `errorClass`) is what lets a `try_catch`
                    // catch region or a `fault` edge handler branch on `{$error.code}`
                    // — "the row is already there" vs. "the store is down" vs. any
                    // other reason — instead of only ever seeing "create_record(...)
                    // failed: <message>".
                    //
                    // Reading the classified `code` off the thrown value — never
                    // importing `@objectstack/objectql`'s `DuplicateRecordError`
                    // CLASS — is deliberate, not a shortcut: `objectql` is this
                    // package's devDependency (tests only; `check:undeclared-dep-imports`
                    // refuses it as a runtime one), because this executor runs against
                    // ANY `IDataEngine`, not a concrete engine. The class's own header
                    // prescribes exactly this shape anyway ("branch on `code ===
                    // 'DUPLICATE_RECORD'` … rather than a dialect's code or message, so
                    // the handling survives a change of store") — `code` IS the
                    // envelope's public contract, and `StandardErrorCode` is the
                    // platform-wide vocabulary it is drawn from (already a real
                    // dependency here via `@objectstack/spec`).
                    //
                    // Deliberately narrow to THIS verb: `update_record` / `delete_record`
                    // collapse identically; `engine.update` gained the same `DUPLICATE_RECORD`
                    // envelope for a unique violation (commit 9d7f7259f), but those node results
                    // are untouched here — this repair was scoped to `create_record` alone.
                    const rawCode =
                        err && typeof err === 'object' && 'code' in err
                            ? (err as { code?: unknown }).code
                            : undefined;
                    const code = rawCode === StandardErrorCode.enum.DUPLICATE_RECORD ? rawCode : undefined;
                    return {
                        success: false,
                        error: `create_record(${objectName}) failed: ${(err as Error).message}`,
                        ...(code ? { code } : {}),
                    };
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
                // [#21624] Before the filter is resolved, so a family target's
                // filter is never evaluated, under either run identity.
                const familyRefusal = storedMetadataWriteRefusal('update_record', objectName);
                if (familyRefusal) return familyRefusal;

                // `filters` → `filter` converted at load (ADR-0087 D2); read canonical.
                const filterResult = resolveNodeFilter(
                    cfg.filter, variables, context, 'update_record',
                    'would have matched — and overwritten — rows the filter was written to exclude',
                );
                if ('error' in filterResult) return refuseNode(filterResult.error);
                const filter = filterResult.filter;
                // `fields` is the single canonical write-map key — no alias (the wrong key
                // `fieldValues` is corrected at the authoring source + rejected by graph-lint).
                // #19938 / #11182 ruling D — a CEL value envelope in `fields.*` is
                // evaluated; every other value is a literal (#19939 retired the
                // `{…}` dialect there — `parseNodeConfig` above refused it).
                const fields = resolveFieldValues(engine, cfg.fields, variables, context);

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
                // [#21624] Before the filter is resolved, so a family target's
                // filter is never evaluated, under either run identity.
                const familyRefusal = storedMetadataWriteRefusal('delete_record', objectName);
                if (familyRefusal) return familyRefusal;

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
