// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0038 L3 — runtime probes: after a publish, exercise the published app
// the way a user would (one real read per artifact) and report what is
// actually broken AT RUNTIME. Schema-valid ≠ renders ≠ returns data: the
// 2026-06-10/11 incident set shipped seeds that never materialized, dataset
// queries that returned 0 on populated objects, and "Published!" states the
// runtime couldn't read back — all invisible until something actually
// queried. These probes are that something, run by the build pipeline (not
// the user), generalizing the `seedApplied` pattern to the whole artifact
// graph.
//
// Every finding is a BuildIssue (the ADR-0038 verification contract — same
// shape the cloud L1 graph lint emits) with `layer: 'runtime'`, so agents,
// chat surfaces, and eval harnesses consume one stream regardless of which
// verification plane found the problem.
//
// A finding has two readers, so it carries two channels (ruling records
// 6819749037 and 6929121584, ADR-0038's amendment): `message` and `fix` are
// for the agent that published and stay English; `userMessage` is the
// sentence for the person who asked for the app, composed HERE, by the
// producer, in the request's language (`build-probes.user-text.ts` holds the
// sentences, `userTextLocales` the ladder's candidates). No consumer keeps a
// per-code table of its own.

import type { BuildProbeReport, RuntimeBuildIssue, StandardErrorCode } from '@objectstack/spec/api';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { referenceTargetOf } from '@objectstack/spec/data';
import { collectFlowGraphs } from '@objectstack/spec/automation';
import { PackageScopedNameRefusedError, describePackageScopedHolder, resolveTenantFieldName, type PackageScopedRefusal } from '@objectstack/core';
import { buildProbeUserMessage, buildProbeUserTextLocale } from './build-probes.user-text.js';

/**
 * One runtime-verification finding (ADR-0038 BuildIssue, layer 'runtime'),
 * and the aggregate result of one post-publish probe pass.
 *
 * Both are the spec's own types (`RuntimeBuildIssueSchema`,
 * `BuildProbeReportSchema` in `@objectstack/spec/api`), re-exported rather
 * than declared a second time: `probes` on the publish response is modeled
 * there, so what this module returns and what the response declares are one
 * type and cannot drift.
 *
 * [#15254] `checked.objects` joined the planes because its ABSENCE was the
 * tell. A publish of a package Studio's app builder authored reported
 * `{seeds: 0, views: 0, widgets: 0}` — three zeroes, no `objects` key — and
 * that receipt was accurate: the builder mints no `view` items, so every
 * plane the report carried had genuinely nothing to inspect while the objects
 * it DID publish were probed by nothing. A count that cannot go up is
 * indistinguishable from a plane that found nothing wrong.
 */
export type { BuildProbeReport, RuntimeBuildIssue };

/**
 * The codes a build probe emits, one per kind of finding. Closed here, where
 * the producer and its sentences live (`BUILD_PROBE_USER_TEXT` is keyed by
 * it); `code` stays an open string on the wire (`RuntimeBuildIssueSchema.code`),
 * because a consumer reads it as an id and must not fail on one it has not
 * seen.
 *
 * [#15494] `object_field_ref_rule_failed` is the odd one out and belongs here
 * anyway: it reports that a PROBE could not run, not that an artifact is
 * broken. A probe plane that can only ever emit findings has no way to say
 * "I was unable to judge this", and the absence of that vocabulary is what
 * let a thrown rule read as a clean object.
 */
export type RuntimeBuildIssueCode =
    | 'seed_not_applied'
    | 'view_read_failed'
    | 'object_field_ref_unknown'
    | 'object_field_ref_rule_failed'
    | 'widget_not_probed'
    | 'empty_query'
    | 'widget_query_failed'
    | 'probes_unavailable'
    | 'widget_empty_result'
    | 'rollup_never_computed'
    | 'seed_reference_unresolved'
    | 'flow_connector_action_unresolved';

/**
 * A finding as this module builds it: the wire shape, with the code closed
 * and the user sentence owed. Optional on the wire (an older producer, or a
 * code with no sentence yet, omits it), required here, so an emit site that
 * forgets the person's sentence does not compile.
 */
type ProbeFinding = RuntimeBuildIssue & { code: RuntimeBuildIssueCode; userMessage: string };

/** The single read the probes need from the data engine. */
export interface ProbeEngine {
    find(objectName: string, query: unknown): Promise<Array<Record<string, unknown>>>;
    /**
     * The REGISTERED object definition (the authored body plus the columns the
     * engine injects), which names the column a row's organization is stamped
     * in (`resolveTenantFieldName`). Optional: an engine without it is read as
     * one whose rows carry no organization, so the landed-data probes ask their
     * existence questions unscoped, as the reference audit does for such a row.
     */
    getSchema?(objectName: string): unknown;
}

/** Optional analytics surface — when absent, widget probes degrade to a warning. */
export interface ProbeAnalytics {
    queryDataset(dataset: unknown, selection: unknown, context?: unknown): Promise<unknown>;
}

export interface RunBuildProbesOptions {
    engine: ProbeEngine;
    /** Read an ACTIVE (published) item body by type+name; undefined when absent. */
    getItem: (type: string, name: string) => Promise<unknown | undefined>;
    /** The just-published artifact set (publishPackageDrafts' `published`). */
    published: Array<{ type: string; name: string }>;
    /**
     * The kernel's analytics service, when one is mounted. Widget probes run
     * the SAME `queryDataset` path the dashboard renderer hits — absent
     * service means widgets can't be probed (one aggregate warning, not
     * per-widget noise).
     */
    analytics?: ProbeAnalytics;
    /** Threaded into engine/analytics reads (tenant scoping). */
    organizationId?: string | null;
    /**
     * The PUBLISHING caller's execution context. Widget probes run
     * `queryDataset` as this caller, because that is what the renderer does:
     * a widget is healthy when the person who sees it can read it, so the
     * probe asks read admission the question the dashboard will ask.
     *
     * ⛔ Never substitute a system context when it is absent. A probe that
     * reads as the system reports a widget healthy that its own publisher
     * cannot open, and that is the false clean this plane exists to prevent.
     * Absent, the read goes out context-less and read admission answers for
     * it — a refusal, reported as such.
     */
    context?: unknown;
    /**
     * The locale candidates of every finding's `userMessage`, in ladder
     * order: the request's locale, then the workspace default
     * (`publishPackageDrafts` passes its `request.userTextLocales` through).
     * A candidate that names no platform locale takes the next rung, and
     * `en` answers when none does, which is also the answer when this is
     * absent. It picks the language of the sentence and of the labels the
     * sentence names; `message` and `fix` never read it.
     */
    userTextLocales?: readonly (string | null | undefined)[];
    /**
     * The kernel's automation engine, when one is mounted: the connector lookup
     * a `connector_action` step dispatches through. Absent, or without the
     * lookup, published flows' connector steps are not probed.
     */
    automation?: ProbeAutomation;
    /**
     * The package the published artifacts belong to (`null`: authored in the
     * environment, no package). A `connector_action` step names its connector
     * from its flow's package, so the probe asks the engine for that package.
     */
    packageId?: string | null;
    /**
     * The seed loader's own answer to "which rows did this publish's seeds
     * land on" (`seedApplied.landed`, per object): the ids it created, and
     * the pre-existing ids a seed key matched. The reference probe reads the
     * seeds' rows by these ids. Absent, published seeds' references are not
     * probed.
     */
    seedLanded?: ReadonlyArray<SeedLandedRows>;
}

/** One object's entry of `seedApplied.landed`, as far as the probes read it. */
export interface SeedLandedRows {
    object: string;
    inserted: { ids: readonly string[] };
    matched: { ids: readonly string[] };
}

/**
 * The slice of the automation engine (`AutomationEngine`, service-automation)
 * the connector probe reads — the same two lookups the `connector_action`
 * executor makes before it dispatches, and the reason it gives for a degraded
 * connector. All optional: a host whose engine lacks one is not probed.
 */
export interface ProbeAutomation {
    resolveConnectorInstanceFor?(connectorId: string, callerPackageId: string | null):
        | { status: 'instance'; packageId: string | null }
        | { status: 'refused'; refusal: { message: string } }
        | { status: 'none' };
    resolveConnectorAction?(connectorId: string, actionId: string, packageId?: string | null): unknown;
    getConnectorDegradedReason?(connectorId: string, packageId?: string | null): string | undefined;
}

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | undefined {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function asArr(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
}

/**
 * `PERMISSION_DENIED`, pinned against the STANDARD catalog — the code the
 * analytics service's read admission throws (ADR-0112 envelope, 403).
 */
const PERMISSION_DENIED: StandardErrorCode = 'PERMISSION_DENIED';

/**
 * The read-admission refusal a widget query can be answered with, judged by
 * the thrown error's ADR-0112 `code` — never by its message text.
 *
 * The analytics service refuses a caller who may not read an object (or a
 * field the dataset reads) with `PERMISSION_DENIED` and names the refused
 * object in `object` (a joined object can be the one refused, so it is read
 * from the error before the dataset's own) and the refused fields in
 * `fields`. That is the caller's access, not the dataset's definition.
 *
 * One `PERMISSION_DENIED` is NOT an access question: a member that is no
 * column reference, refused because the gate cannot tell which fields it
 * reads, carries `member`, and its remedy IS a dataset change — so it keeps
 * the dataset fix.
 */
function readAdmissionRefusal(e: unknown): { object?: string; fields: string[] } | undefined {
    const err = e && typeof e === 'object' ? (e as Rec) : undefined;
    if (!err || err.code !== PERMISSION_DENIED || typeof err.member === 'string') return undefined;
    return {
        object: typeof err.object === 'string' && err.object ? err.object : undefined,
        fields: asArr(err.fields).filter((f): f is string => typeof f === 'string' && f.length > 0),
    };
}

/**
 * `SERVICE_UNAVAILABLE`, pinned against the STANDARD catalog — the code the
 * analytics service throws (ADR-0112 envelope, 503) when a read gate could not
 * reach a verdict: a permission or API-exposure resolver failed.
 */
const SERVICE_UNAVAILABLE: StandardErrorCode = 'SERVICE_UNAVAILABLE';

/**
 * The fault refusal a widget query can be answered with, judged by the thrown
 * error's ADR-0112 `code` — never by its message text.
 *
 * Neither the dataset nor the caller's access is the cause: the server could
 * not decide, so the remedy is the operator's. `object` names the object the
 * server could not decide read access to, when the error carries one.
 */
function serviceUnavailableRefusal(e: unknown): { object?: string } | undefined {
    const err = e && typeof e === 'object' ? (e as Rec) : undefined;
    if (!err || err.code !== SERVICE_UNAVAILABLE) return undefined;
    return { object: typeof err.object === 'string' && err.object ? err.object : undefined };
}

/** Result rows of a queryDataset call, tolerant of {rows}/{data}/array shapes. */
function resultRows(result: unknown): unknown[] {
    if (Array.isArray(result)) return result;
    const r = asRec(result);
    if (!r) return [];
    if (Array.isArray(r.rows)) return r.rows;
    if (Array.isArray(r.data)) return r.data;
    return [];
}

/**
 * True when the object has at least one row. A system read by default; the
 * widget plane passes the caller's context so "the object has rows" is judged
 * over the rows that caller can see — the same rows its dataset query saw.
 */
async function hasRows(
    engine: ProbeEngine,
    objectName: string,
    organizationId?: string | null,
    readContext: unknown = { isSystem: true },
): Promise<boolean> {
    const rows = await engine.find(objectName, {
        fields: ['id'],
        limit: 1,
        ...(organizationId ? { where: { organization_id: organizationId } } : {}),
        context: readContext,
    });
    return Array.isArray(rows) && rows.length > 0;
}

/** Rows sampled from an object by the data probes, and distinct values probed per column. */
const PROBE_SAMPLE_ROWS = 50;

/** The declared fields of an object body, by name, from either the map or the array shape. */
function fieldsOf(body: Rec | undefined): Array<[string, Rec]> {
    const raw = body?.fields;
    if (Array.isArray(raw)) {
        return raw.map(asRec).filter((f): f is Rec => !!f && typeof f.name === 'string').map((f) => [f.name as string, f]);
    }
    const map = asRec(raw);
    return map ? Object.entries(map).flatMap(([n, f]) => (asRec(f) ? [[n, asRec(f)!] as [string, Rec]] : [])) : [];
}

/** The id strings a reference column holds on one row: an expanded `{ id }` and a blank are not ids. */
function idsIn(value: unknown): string[] {
    return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * The identity a landed-data read runs under: the system (the probe judges
 * data, not a caller's grants), kept inside one organization the way the
 * engine's own reference audit keeps its existence probe (#19837,
 * `inspectDanglingReferences`): the organization rides the context's
 * `tenantId`, and the engine applies it to a tenant-scoped object and leaves an
 * object with no tenant column (`sys_user`) unscoped. `null` reads unscoped, as
 * the audit does for a row that carries no organization.
 */
function landedReadContext(organization: string | null): Rec {
    return organization ? { isSystem: true, tenantId: organization } : { isSystem: true };
}

/**
 * The organization column of an object as the engine registered it, or `null`
 * when it has none or the engine does not say (`ProbeEngine.getSchema`).
 */
function organizationColumnOf(engine: ProbeEngine, objectName: string): string | null {
    try {
        return resolveTenantFieldName(engine.getSchema?.(objectName));
    } catch {
        return null;
    }
}

/**
 * The organization a sampled row's references are held to: the publishing
 * organization when the publish names one (every read is already inside it),
 * else the row's own stamped organization, else none (#19837: "a
 * NULL-organization row, or an object with no tenant column, probes
 * unscoped").
 */
function rowOrganization(row: Rec, column: string | null, publishing: string | null): string | null {
    if (publishing) return publishing;
    const stamped = column ? row[column] : undefined;
    return stamped === undefined || stamped === null || stamped === '' ? null : String(stamped);
}

/**
 * The organizations a roll-up's children are judged in, one at a time: the
 * publishing organization when the publish names one; else every
 * organization a bounded read of the object's rows, projected to its tenant
 * column alone, finds stamped; else (no tenant column, or the engine does not
 * say) one unscoped pass, `null`. On an object that has a tenant column, a
 * row stamped with no organization is not judged: an unscoped pass there would
 * read every organization's rows together.
 */
async function probeOrganizations(engine: ProbeEngine, objectName: string, publishing: string | null): Promise<Array<string | null>> {
    if (publishing) return [publishing];
    const column = organizationColumnOf(engine, objectName);
    if (!column) return [null];
    const stamped = asArr(await engine.find(objectName, {
        fields: [column],
        limit: PROBE_SAMPLE_ROWS,
        context: landedReadContext(null),
    })).map(asRec).map((r) => rowOrganization(r ?? {}, column, null));
    return [...new Set(stamped)].filter((o): o is string => o !== null);
}

/** Push `value` under `key` in a map of lists. */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}

/** A measure value that renders as an empty card: no value, or zero. */
const isZeroish = (v: unknown): boolean => v === null || v === undefined || v === 0 || v === '0';

/**
 * Every measure the result carries reads zero or nothing on every row. Judged
 * only on the measure columns the rows actually hold: a result that names none
 * of the asked measures cannot be judged, and answers `false`.
 */
function everyMeasureZero(rows: unknown[], measures: readonly string[]): boolean {
    const recs = rows.map(asRec).filter((r): r is Rec => !!r);
    const visible = measures.filter((m) => recs.some((r) => m in r));
    return visible.length > 0 && recs.every((r) => visible.every((m) => isZeroish(r[m])));
}

/**
 * Run the L3 runtime probes over a just-published artifact set:
 *
 *  • per published `seed` — its target object must have rows now
 *    (`seed_not_applied`: the rows were promised but never materialized);
 *  • per published `view` — a limit-1 read through the same engine the
 *    renderer uses must not throw (`view_read_failed`);
 *  • per published `dashboard` widget — its real dataset selection must
 *    execute (`widget_query_failed`) and must not return empty on an object
 *    that HAS rows (`empty_query` — the four-layer staging incident class);
 *  • per published `object` — the field-name lists it writes about its own
 *    fields must resolve (`object_field_ref_unknown`, #15254). The one plane
 *    that judges rather than reads; see its own note below.
 *
 * All probes are reads (limit-1 / single aggregate); a probe crash is
 * reported, never thrown — verification must not break the publish it
 * verifies.
 */
/**
 * [ADR-0150 D3, #31700] The slice of the metadata protocol
 * {@link publishedItemReader} reads through: the by-name item read, and the
 * caller arm's resolution (`resolveCallerPackageAddress`, #32310), when the
 * protocol offers it.
 */
export interface ProbeItemProtocol {
    getMetaItem(request: { type: string; name: string; packageId?: string }): Promise<unknown>;
    resolveCallerPackageAddress?(request: { type: string; name: string; callerPackageId: string }):
        | { readonly kind: 'package'; readonly packageId: string }
        | { readonly kind: 'environment' };
}

/**
 * [ADR-0150 D3, #31700] The probes' item read for a publish of package
 * `publishingPackageId`: a published artifact by name, and a dataset a widget
 * names RESOLVED FROM the publishing package, the dashboard's own, by the
 * caller arm the dataset doors offer (`?callerPackage=`), then read at the
 * holder's exact address. A dataset name is held once per namespace, so two
 * namespaces may each hold it: each package's publish probes its own
 * dataset, never a read of the bare name, which two holders refuse. A name
 * the publishing package cannot resolve is the caller's refusal
 * (`ambiguous-in-closure`, `outside-closure`), which the widget plane
 * reports as not probed. With no publishing package, or a protocol without
 * the caller arm, the dataset is read by name, as before.
 */
export function publishedItemReader(
    protocol: ProbeItemProtocol,
    publishingPackageId: string | undefined,
): RunBuildProbesOptions['getItem'] {
    return async (type, name) => {
        let packageId: string | undefined;
        if (type === 'dataset' && publishingPackageId && typeof protocol.resolveCallerPackageAddress === 'function') {
            const address = protocol.resolveCallerPackageAddress({ type, name, callerPackageId: publishingPackageId });
            if (address.kind === 'package') packageId = address.packageId;
        }
        const envelope = (await protocol.getMetaItem({ type, name, ...(packageId !== undefined ? { packageId } : {}) })) as
            | { item?: unknown }
            | undefined;
        // [#34560] The by-name read answers a missing item with its envelope,
        // `item` empty, never `undefined`: the body is the envelope's `item`
        // alone, so a dataset nothing holds reads as no body (the widget
        // plane's dangling-dataset skip), never as the envelope itself.
        return envelope?.item;
    };
}

/**
 * [#32072, #31700] Why a widget's dataset was not probed, and the fix: the
 * refusal's own reading. A caller with a package (the publishing package,
 * {@link publishedItemReader}) is refused for its closure, so the fix is that
 * package's; a read with no package is refused for the environment.
 */
function datasetNotProbed(
    refused: PackageScopedRefusal,
    dsName: string,
): { why: string; fix: string; cause: 'outside-closure' | 'ambiguous-in-closure' | 'several-holders' } {
    const holders = refused.candidates.map((h) => (h.kind === 'package' ? h.packageId : describePackageScopedHolder(h)));
    const caller = refused.callerPackageId;
    if (caller !== null && refused.reason === 'outside-closure') {
        return {
            why: `dataset "${dsName}" is held only outside the declared dependencies of package "${caller}" `
                + `(${holders.join(', ')}), so the dashboard's read of it is refused`,
            // [#32967] The runtime sentence's second fix too: a holder that
            // already depends on the caller cannot be declared back (a cycle).
            fix: `Declare package "${caller}"'s dependency on the package whose dataset "${dsName}" the widget means, `
                + `or hold the dataset in "${caller}" itself; if that package already depends on "${caller}", the `
                + 'dependency would be a cycle, so move the dashboard into that package or hold the dataset here. Then republish.',
            cause: 'outside-closure',
        };
    }
    if (caller !== null) {
        return {
            why: `dataset "${dsName}" has ${holders.length} holders package "${caller}" reaches `
                + `(${holders.join(', ')}), so the dashboard's read of it is refused`,
            fix: `Make "${dsName}" mean one dataset from package "${caller}": hold it in "${caller}" itself, `
                + 'or depend on only one of the packages that hold it, then republish.',
            cause: 'ambiguous-in-closure',
        };
    }
    return {
        why: `dataset "${dsName}" has ${holders.length} holders (${holders.join(', ')}), so a read of it by name is refused`,
        fix: `Keep one dataset named "${dsName}": rename or remove the others, then republish.`,
        cause: 'several-holders',
    };
}

export async function runBuildProbes(opts: RunBuildProbesOptions): Promise<BuildProbeReport> {
    const issues: ProbeFinding[] = [];
    const checked = { seeds: 0, views: 0, widgets: 0, objects: 0 };
    const { engine, getItem, published, analytics, organizationId, context } = opts;
    const userTextLocales = opts.userTextLocales ?? [];

    // Memoized active-item reads (a dashboard and its widgets share datasets).
    const itemCache = new Map<string, unknown | undefined>();
    // [#32072] A by-name read of a name two or more packages hold is refused
    // (ADR-0150 D3), so there is no item to probe; the refusal is kept so the
    // widget plane can say it did not probe rather than stay silent.
    const refusals = new Map<string, PackageScopedRefusal>();
    const readItem = async (type: string, name: string): Promise<unknown | undefined> => {
        const key = `${type} ${name}`;
        if (itemCache.has(key)) return itemCache.get(key);
        let item: unknown | undefined;
        try {
            item = await getItem(type, name);
        } catch (e) {
            if (e instanceof PackageScopedNameRefusedError) refusals.set(key, e.refusal);
            item = undefined;
        }
        itemCache.set(key, item);
        return item;
    };

    // ── The person's sentence (`userMessage`) ───────────────────────────────
    //
    // Each finding below carries, beside the agent's `message` / `fix`, the
    // sentence its code has in the catalog, in the language the ladder picks
    // from `userTextLocales`. A sentence names an artifact by its LABEL where
    // the probe can read one: the published body's own `label` (a widget's
    // `title`), resolved for that same language. A body the read does not
    // return, and a body with no label, show the API name. The label reads go
    // through `readItem`, so they are memoized, never throw, and only happen
    // on a finding.
    const userTextLocale = buildProbeUserTextLocale(userTextLocales);
    const say = (code: RuntimeBuildIssueCode, params: Readonly<Record<string, string>>): string =>
        buildProbeUserMessage(code, params, userTextLocales);
    const labelIn = (body: Rec | undefined, name: string, key: 'label' | 'title' = 'label'): string => {
        const label = resolveI18nLabel(body?.[key] as I18nLabel | undefined, userTextLocale);
        return typeof label === 'string' && label.trim() ? label : name;
    };
    const labelOf = async (type: string, name: string): Promise<string> =>
        labelIn(asRec(await readItem(type, name)), name);

    // ── Seeds: rows must exist after publish ────────────────────────────────
    for (const p of published.filter((x) => x.type === 'seed')) {
        const body = asRec(await readItem('seed', p.name));
        const objectName = typeof body?.object === 'string' ? body.object : undefined;
        if (!objectName) continue;
        checked.seeds += 1;
        try {
            if (!(await hasRows(engine, objectName, organizationId))) {
                issues.push({
                    layer: 'runtime',
                    severity: 'error',
                    artifact: { type: 'seed', name: p.name },
                    ref: { type: 'object', name: objectName },
                    code: 'seed_not_applied',
                    message: `Seed "${p.name}" was published but object "${objectName}" has no rows — the sample data never materialized.`,
                    fix: `Check the publish response's seedApplied for the load error, fix the seed rows (field names/types), and republish the seed.`,
                    userMessage: say('seed_not_applied', { object: await labelOf('object', objectName), cause: 'no-rows' }),
                });
            }
        } catch (e) {
            issues.push({
                layer: 'runtime',
                severity: 'error',
                artifact: { type: 'seed', name: p.name },
                ref: { type: 'object', name: objectName },
                code: 'seed_not_applied',
                message: `Seed "${p.name}" probe could not read object "${objectName}": ${String((e as Error)?.message ?? e)}`,
                userMessage: say('seed_not_applied', { object: await labelOf('object', objectName), cause: 'unreadable' }),
            });
        }
    }

    // ── Views: the renderer's read path must not throw ──────────────────────
    for (const p of published.filter((x) => x.type === 'view')) {
        const body = asRec(await readItem('view', p.name));
        const config = asRec(body?.config);
        const dataObj = asRec(config?.data)?.object;
        const objectName =
            typeof body?.object === 'string' ? body.object
            : typeof dataObj === 'string' ? dataObj
            : undefined;
        if (!objectName) continue;
        checked.views += 1;
        try {
            await engine.find(objectName, {
                fields: ['id'],
                limit: 1,
                ...(organizationId ? { where: { organization_id: organizationId } } : {}),
                context: { isSystem: true },
            });
        } catch (e) {
            issues.push({
                layer: 'runtime',
                severity: 'error',
                artifact: { type: 'view', name: p.name },
                ref: { type: 'object', name: objectName },
                code: 'view_read_failed',
                message: `View "${p.name}" cannot read object "${objectName}": ${String((e as Error)?.message ?? e)} — it will render as an error for every user.`,
                fix: `Verify object "${objectName}" published successfully (its table must exist) and that the view's binding is correct.`,
                userMessage: say('view_read_failed', {
                    view: labelIn(body, p.name),
                    object: await labelOf('object', objectName),
                }),
            });
        }
    }

    // ── Objects: the field-name lists an object writes about itself ────────
    //
    // [#15254] The one plane that is NOT a read. Every other probe here
    // exercises the published artifact through the engine, because the class
    // ADR-0038 L3 was written for is "schema-valid but returns nothing at
    // runtime". A dangling `highlightFields` entry is the opposite shape: the
    // read succeeds, the list renders, and the reference is silently dropped
    // — nothing to observe by querying. So this plane re-runs the authoring
    // judgement over what actually landed.
    //
    // It is deliberately NOT the gate: `assertRuntimeAuthoringRules` already
    // refused this write before it was persisted, and probes never fail the
    // publish they verify. What this adds is the receipt — `checked.objects`
    // is the count that makes "no object was inspected" and "every object was
    // clean" different numbers — and a second, non-differential reading of the
    // ACTIVE body. The gate judges only what a write ADDED (#4463 D4, so a
    // stored row in violation never blocks someone else); this reads the
    // published body whole, so an object that arrived carrying a dangling
    // reference before the rule existed is reported here rather than staying
    // invisible forever.
    //
    // The rule is loaded lazily, for the reason the whole module is: it is
    // only reachable when a package actually published an object.
    const publishedObjects = published.filter((x) => x.type === 'object');
    if (publishedObjects.length > 0) {
        let validateObjectFieldRefs:
            | ((stack: Record<string, unknown>) => Array<{ path: string; message: string; hint: string }>)
            | undefined;
        try {
            ({ validateObjectFieldRefs } = await import('@objectstack/lint'));
        } catch {
            validateObjectFieldRefs = undefined;
        }
        for (const p of publishedObjects) {
            if (!validateObjectFieldRefs) break;
            const body = asRec(await readItem('object', p.name));
            if (!body) continue;
            checked.objects += 1;
            // One object is the whole universe the question has: every name in
            // an object-level field-name list resolves against that object's
            // OWN field map, never a sibling's. See the rule's module note.
            let findings: Array<{ path: string; message: string; hint: string }> = [];
            try {
                findings = validateObjectFieldRefs({ objects: [{ ...body, name: p.name }] }) ?? [];
            } catch (e) {
                // [#15494] A rule that THREW is not an object that came back
                // clean — but `findings = []` made the two indistinguishable
                // on the receipt, and `checked.objects` had already counted
                // this object, so the reading was "inspected, nothing wrong":
                // the exact shape a genuinely clean publish produces. This
                // plane exists to be the second, non-differential reading of
                // the ACTIVE body; a silent catch turned it into the very
                // false clean it was added to prevent.
                //
                // The crash that motivated this — a non-record entry in
                // `stack.objects` dereferenced in the shared
                // `indexObjectGraph` seam — is repaired in `@objectstack/lint`
                // in the same change. This half is the standing guarantee that
                // outlives that one bug: whatever the NEXT rule failure is,
                // the receipt says the object was not checked and why. Error
                // severity, because an unverified object on a publish receipt
                // is a gap in the verification contract (ADR-0038), not a
                // property of the artifact — the `fix` says so, so nobody
                // hunts the object for a defect it may not have.
                //
                // Probes still never fail the publish they verify
                // (`protocol.ts`), so this is louder reporting, not a new
                // refusal.
                issues.push({
                    layer: 'runtime',
                    severity: 'error',
                    artifact: { type: 'object', name: p.name },
                    code: 'object_field_ref_rule_failed',
                    message:
                        `Object "${p.name}" was NOT checked: the object field-reference rule threw — ` +
                        `${String((e as Error)?.message ?? e)}. Its field-name lists are unverified.`,
                    fix: `This is a defect in the lint rule, not necessarily in object "${p.name}". Report it with the message above; the object published, but nothing judged its field-name lists.`,
                    userMessage: say('object_field_ref_rule_failed', { object: labelIn(body, p.name) }),
                });
                findings = [];
            }
            for (const f of findings) {
                issues.push({
                    layer: 'runtime',
                    severity: 'error',
                    artifact: { type: 'object', name: p.name },
                    code: 'object_field_ref_unknown',
                    message: `Object "${p.name}" names a field that does not exist (${f.path}): ${f.message}`,
                    fix: f.hint,
                    userMessage: say('object_field_ref_unknown', { object: labelIn(body, p.name) }),
                });
            }
        }
    }

    // ── Roll-ups: a summary field must have been computed where it has children ──
    //
    // [#35146] A roll-up's stored value is written by three paths
    // (`summary-aggregate.ts`): the insert of a parent, a child write that
    // names the parent, and `os migrate summary-nulls`; an install door also
    // materialises a roll-up a package install or upgrade adds
    // (`summary-install-materialise.ts`). A `summary` declared on an object
    // whose children had already landed reaches none of them on its own, so
    // it reads blank on those parents while its definition is correct. Every
    // check above reads the definition; this asks the data. Only parents that
    // HAVE children are judged (a parent with none reads blank truthfully),
    // and only a field left UNSET on all of them: a computed zero is a value.
    // A roll-up with its own `filter` is not judged, since which children it
    // counts is the filter's question.
    //
    // Judged one organization at a time, the way the reference audit keeps its
    // probe (#19837): the publishing organization when the publish names one;
    // else each organization the child object's rows are stamped with (its
    // column named by `resolveTenantFieldName`), found by one read projected
    // to that column alone; else, for an object with no tenant column, one
    // unscoped pass. Inside an organization, two reads under
    // `{ isSystem: true, tenantId }`, each projected to what it judges: a
    // sample of children (their foreign key and the aggregated field), then
    // the parents they name, `id $in` the named ids. The verdict and its count
    // are formed inside that one organization, and the finding names the
    // first organization whose parents all read blank (it quotes no row
    // value, and no organization id).
    for (const p of publishedObjects) {
        const body = asRec(await readItem('object', p.name));
        for (const [fieldName, def] of fieldsOf(body)) {
            const ops = asRec(def.summaryOperations);
            if (def.type !== 'summary' || !ops || ops.filter !== undefined) continue;
            const childObject = typeof ops.object === 'string' ? ops.object : undefined;
            if (!childObject) continue;
            try {
                const fk = typeof ops.relationshipField === 'string' && ops.relationshipField
                    ? ops.relationshipField
                    : childForeignKey(asRec(await readItem('object', childObject)), p.name);
                if (!fk) continue;
                const childField = ops.function !== 'count' && typeof ops.field === 'string' ? ops.field : undefined;
                const organizations = await probeOrganizations(engine, childObject, organizationId ?? null);
                let blank: Rec[] | undefined;
                for (const organization of organizations) {
                    const children = asArr(await engine.find(childObject, {
                        fields: [...new Set(['id', fk, ...(childField ? [childField] : [])])],
                        limit: PROBE_SAMPLE_ROWS,
                        context: landedReadContext(organization),
                    })).map(asRec).filter((r): r is Rec => !!r);
                    const ids = [...new Set(children.flatMap((c) =>
                        childField && (c[childField] === null || c[childField] === undefined) ? [] : idsIn(c[fk])))];
                    if (ids.length === 0) continue;
                    const parents = asArr(await engine.find(p.name, {
                        where: { id: { $in: ids } },
                        fields: ['id', fieldName],
                        limit: ids.length,
                        context: landedReadContext(organization),
                    })).map(asRec).filter((r): r is Rec => !!r);
                    if (parents.length > 0 && parents.every((r) => r[fieldName] === null || r[fieldName] === undefined)) {
                        blank = parents;
                        break;
                    }
                }
                if (!blank) continue;
                // [#15064] The plain run fills `count` and `sum` only; a `min`,
                // `max` or `avg` roll-up is recomputed only when it is named.
                const fillsByDefault = ops.function === 'count' || ops.function === 'sum';
                const command = fillsByDefault
                    ? '`os migrate summary-nulls --apply`'
                    : `\`os migrate summary-nulls --apply --recompute-undefined-on-empty ${p.name}.${fieldName}\``;
                issues.push({
                    layer: 'runtime',
                    severity: 'warning',
                    artifact: { type: 'object', name: p.name },
                    ref: { type: 'object', name: p.name, member: fieldName },
                    code: 'rollup_never_computed',
                    message:
                        `Roll-up "${p.name}.${fieldName}" is empty on all ${blank.length} parent row(s) of one organization that have ` +
                        `"${childObject}" children — the field is configured, but its stored value was never computed for them. A ` +
                        'roll-up is written when a parent is inserted, when a child write names the parent, by `os migrate ' +
                        'summary-nulls`, and by the install door that adds it; one declared after its children landed reaches none ' +
                        'of these on its own.',
                    fix:
                        `Check that "${childObject}" rows carry "${fk}" back to "${p.name}", then fill the stored values: ` +
                        `${command} computes every parent that still reads blank` +
                        (fillsByDefault ? '' : ` (a ${String(ops.function)} roll-up is filled only when named this way)`) +
                        '. A package install or upgrade materialises a roll-up it adds at the install door, and a write to a ' +
                        'child recomputes the parent that child names. Do not present the figure as working while it reads blank.',
                    userMessage: say('rollup_never_computed', {
                        object: labelIn(body, p.name),
                        field: labelIn(def, fieldName),
                        child: await labelOf('object', childObject),
                        cause: fillsByDefault ? 'fills' : 'named',
                    }),
                });
            } catch {
                // A read the engine refused is not a roll-up that never ran:
                // nothing is judged.
            }
        }
    }

    // ── Seed references: a reference column must name rows that exist ──────
    //
    // [#35146] The seed loader resolves what it can and reports the rest on
    // `seedApplied`; this is the backstop over what LANDED. A seed load is a
    // system write, which the engine does not check for references, so a value
    // naming no row lands unchallenged and stays: an edit of the record later
    // is not refused for it (#29062: the write check judges only the references
    // a write ADDS). The finding is the column naming nothing, not a refusal
    // the person will meet; the operator's reference audit
    // (`inspectDanglingReferences`) reports the same rows later.
    //
    // The rows judged are the SEED's own: the ids the loader reports it landed
    // (`seedApplied.landed`), read by `id`, so no row the loader did not land
    // is matched, judged or quoted. Those it created always; those a seed key
    // matched only when the seed's mode wrote them (`upsert`, `update`): under
    // `ignore` a matched row was left as its writer left it, and may be a
    // customer's. `landed` is per object, so two seeds of one object in one
    // publish are judged over the object's landed rows together.
    //
    // Why this is not `ObjectQL.inspectDanglingReferences`: that audit reads
    // the first rows of the whole object (no row filter, so it cannot read the
    // seed's own), and asks one existence probe per value. Here each column's
    // values are pushed into one `id $in` read per organization, projected to
    // `id`, under the audit's scope (#19837): the publishing organization when
    // the publish names one, else each value judged inside the organization
    // its row is stamped with (unscoped for a row with none). One residual is
    // stated, not hidden: under a `group` tenancy posture the audit leaves its
    // probe unscoped, because the write rule's reach is the writer's
    // membership set; this probe stays inside the row's own organization, so a
    // seed row that names a row of a sibling organization would be reported.
    // A seed loads into one organization and resolves its references there.
    const landedByObject = new Map((opts.seedLanded ?? []).map((l) => [l.object, l] as const));
    for (const p of published.filter((x) => x.type === 'seed')) {
        const seed = asRec(await readItem('seed', p.name));
        const objectName = typeof seed?.object === 'string' ? seed.object : undefined;
        if (!objectName) continue;
        const landed = landedByObject.get(objectName);
        if (!landed) continue;
        const mode = typeof seed?.mode === 'string' ? seed.mode : 'ignore';
        const ids = [...new Set([
            ...asArr(landed.inserted?.ids),
            ...(mode === 'upsert' || mode === 'update' ? asArr(landed.matched?.ids) : []),
        ].filter((id): id is string => typeof id === 'string' && id !== ''))].slice(0, PROBE_SAMPLE_ROWS);
        if (ids.length === 0) continue;
        const objectBody = asRec(await readItem('object', objectName));
        const refFields = fieldsOf(objectBody).flatMap(([name, def]) => {
            let target: string | undefined;
            try {
                target = referenceTargetOf(def);
            } catch {
                target = undefined;
            }
            return target ? [{ name, def, target }] : [];
        });
        if (refFields.length === 0) continue;
        const orgColumn = organizationId ? null : organizationColumnOf(engine, objectName);
        let rows: Rec[];
        try {
            rows = asArr(await engine.find(objectName, {
                where: { id: { $in: ids } },
                fields: [...new Set(['id', ...refFields.map((f) => f.name), ...(orgColumn ? [orgColumn] : [])])],
                limit: ids.length,
                context: landedReadContext(organizationId ?? null),
            })).map(asRec).filter((r): r is Rec => !!r);
        } catch {
            continue;
        }
        for (const { name: field, def, target } of refFields) {
            const byOrganization = new Map<string | null, string[]>();
            for (const r of rows) {
                for (const v of idsIn(r[field])) pushTo(byOrganization, rowOrganization(r, orgColumn, organizationId ?? null), v);
            }
            if (byOrganization.size === 0) continue;
            const missing: string[] = [];
            try {
                for (const [organization, list] of byOrganization) {
                    const values = [...new Set(list)];
                    const existing = asArr(await engine.find(target, {
                        where: { id: { $in: values } },
                        fields: ['id'],
                        limit: values.length,
                        context: landedReadContext(organization),
                    })).map(asRec);
                    const found = new Set(existing.map((r) => String(r?.id ?? r?._id)));
                    missing.push(...values.filter((v) => !found.has(v)));
                }
            } catch {
                continue;
            }
            const distinct = [...new Set(missing)];
            if (distinct.length === 0) continue;
            // The values quoted are the landed rows' own column; nothing of
            // the target is read beyond its `id`.
            const shown = distinct.slice(0, 5).map((v) => `"${v}"`).join(', ');
            issues.push({
                layer: 'runtime',
                severity: 'warning',
                artifact: { type: 'seed', name: p.name },
                ref: { type: 'object', name: objectName, member: field },
                code: 'seed_reference_unresolved',
                message:
                    `Reference column "${objectName}.${field}" holds ${distinct.length} value(s) on the rows the seed landed that ` +
                    `name no "${target}" row in their organization: ${shown}${distinct.length > 5 ? ', …' : ''}. The rows landed ` +
                    'as a system write, which is not checked for references, so they point at nothing.',
                fix:
                    `Point "${objectName}.${field}" on those rows at real "${target}" records (in the seed, by a value the loader ` +
                    'resolves), or clear it, then republish the seed.',
                userMessage: say('seed_reference_unresolved', {
                    object: labelIn(objectBody, objectName),
                    field: labelIn(def, field),
                    target: await labelOf('object', target),
                    count: String(distinct.length),
                }),
            });
        }
    }

    // ── Dashboard widgets: the real dataset selection must return data ──────
    const dashboards = published.filter((x) => x.type === 'dashboard');
    let widgetsToProbe = 0;
    for (const p of dashboards) {
        const body = asRec(await readItem('dashboard', p.name));
        const widgets = asArr(body?.widgets).map(asRec).filter((w): w is Rec => !!w);
        const datasetBound = widgets.filter((w) => typeof w.dataset === 'string' && w.dataset);
        widgetsToProbe += datasetBound.length;
        if (!analytics || typeof analytics.queryDataset !== 'function') continue;

        for (const w of datasetBound) {
            const widgetId = String(w.id ?? w.title ?? '?');
            const dsName = w.dataset as string;
            // What the sentence calls this widget and its dashboard: the
            // widget's title and the dashboard's label, else the names the
            // `message` uses.
            const named = { dashboard: labelIn(body, p.name), widget: labelIn(w, widgetId, 'title') };
            const dataset = asRec(await readItem('dataset', dsName));
            if (!dataset) {
                // [#32072] A name the read refused: nothing is probed, and the
                // receipt says so (silence would read as "probed and passed").
                // [#31700] Read from the publishing package, the refusal is
                // that package's, and so is the remedy.
                const refused = refusals.get(`dataset ${dsName}`);
                if (refused) {
                    const { why, fix, cause } = datasetNotProbed(refused, dsName);
                    issues.push({
                        layer: 'runtime',
                        severity: 'warning',
                        artifact: { type: 'dashboard', name: p.name },
                        ref: { type: 'dataset', name: dsName, member: widgetId },
                        code: 'widget_not_probed',
                        message: `Dashboard "${p.name}" widget "${widgetId}" not probed: ${why}.`,
                        fix,
                        // The dataset by its API name: its read was refused,
                        // so there is no body to take a label from, and the
                        // name itself is what two holders share.
                        userMessage: say('widget_not_probed', { ...named, dataset: dsName, cause }),
                    });
                }
                continue; // dangling dataset is an L1 (graph) finding, not a runtime one
            }
            checked.widgets += 1;

            // The widget's own selection when present, else the dataset's
            // first measure — the same default the renderer falls back to.
            const measures = asArr(w.values).filter((v): v is string => typeof v === 'string' && v.length > 0);
            const firstMeasure = asRec(asArr(dataset.measures)[0])?.name;
            const selection = {
                measures: measures.length ? measures : typeof firstMeasure === 'string' ? [firstMeasure] : [],
                dimensions: [],
                limit: 1,
            };
            if (selection.measures.length === 0) continue; // nothing selectable — schema/graph problem

            const objectName = typeof dataset.object === 'string' ? dataset.object : undefined;
            try {
                // [#25484] As the publishing caller — the renderer's path. With
                // no context here, read admission refused every dataset over a
                // permission-gated object, and a correct widget was reported as
                // an error-tier `widget_query_failed`. A caller who genuinely
                // cannot read the dataset is still refused, and still reported.
                const result = await analytics.queryDataset(dataset, selection, context);
                const rows = resultRows(result);
                // "Empty although the object has rows" is judged over the rows
                // THIS caller can see: a system count would call a row-scoped
                // empty answer broken.
                const rowsContext = context && typeof context === 'object' ? context : undefined;
                if (
                    rows.length === 0 && objectName
                    && (await hasRows(engine, objectName, organizationId, rowsContext))
                ) {
                    issues.push({
                        layer: 'runtime',
                        severity: 'error',
                        artifact: { type: 'dashboard', name: p.name },
                        ref: { type: 'dataset', name: dsName, member: widgetId },
                        code: 'empty_query',
                        message: `Dashboard "${p.name}" widget "${widgetId}" returns NO data from dataset "${dsName}" although object "${objectName}" has rows — the widget will render empty for every user.`,
                        fix: `Run the dataset query directly to see the compiled strategy/SQL; check the dataset's measure/dimension field bindings against object "${objectName}".`,
                        userMessage: say('empty_query', {
                            ...named,
                            dataset: labelIn(dataset, dsName),
                            object: await labelOf('object', objectName),
                        }),
                    });
                } else if (everyMeasureZero(rows, selection.measures)) {
                    // [#35146] The query ran and every measure it answered
                    // reads zero or nothing (a dataset filter matching
                    // nothing, a measure over a column no row fills), so the
                    // card the person opens is an empty "0" tile. Zero can be
                    // the truth, so a warning, never an error. A result with
                    // no rows at all is `empty_query`'s question above
                    // (#25484), and `everyMeasureZero` is false on it. A
                    // no-dimension aggregate over an object with no rows the
                    // caller sees answers one row reading `0`, and IS reported
                    // here: the card shows that 0.
                    issues.push({
                        layer: 'runtime',
                        severity: 'warning',
                        artifact: { type: 'dashboard', name: p.name },
                        ref: { type: 'dataset', name: dsName, member: widgetId },
                        code: 'widget_empty_result',
                        message:
                            `Dashboard "${p.name}" widget "${widgetId}" runs its real query (dataset "${dsName}") and gets ` +
                            'only zero/null measure values — the card renders as an empty "0" tile.',
                        fix:
                            `Fix the data dataset "${dsName}" reads (rows its filter matches, values in the measured columns), ` +
                            'adjust the dataset\'s filter or measures, or tell the user why this card reads 0 right now.',
                        userMessage: say('widget_empty_result', { ...named, dataset: labelIn(dataset, dsName) }),
                    });
                }
            } catch (e) {
                // The query runs as the publishing caller, so read admission
                // can refuse a dataset that is correct. That refusal names an
                // access remedy; telling the author to edit the dataset would
                // send them to change something that works. A fault — the
                // server could not decide read access at all — is neither: its
                // remedy is the operator's.
                const refusal = readAdmissionRefusal(e);
                const unavailable = refusal ? undefined : serviceUnavailableRefusal(e);
                const refusedObject = refusal?.object ?? objectName;
                const undecidedObject = unavailable?.object ?? objectName;
                const fix = refusal
                    ? `Dataset "${dsName}" is not the cause and needs no change: read admission refused the publishing caller. ` +
                      `The publisher (or the role this dashboard is for) needs read access to ` +
                      `${refusedObject ? `object "${refusedObject}"` : 'the object this dataset reads'}` +
                      `${refusal.fields.length ? ` and its field(s) ${refusal.fields.join(', ')}` : ''}; grant it, then republish. ` +
                      `The finding is about this caller's access: a viewer who has that access can read the widget.`
                    : unavailable
                    ? `Dataset "${dsName}" is not the cause and needs no change: the server could not decide read access to ` +
                      `${undecidedObject ? `object "${undecidedObject}"` : 'the object this dataset reads'}, ` +
                      `so the query was not run (SERVICE_UNAVAILABLE). This is a server-side fault, not a denial: ` +
                      `check the server log for the permission or API-exposure resolver that failed, then republish once it is healthy.`
                    : `Fix the dataset definition (or the widget's values/dimensions) so the query compiles, then republish.`;
                const saidObject = refusal ? refusedObject : unavailable ? undecidedObject : objectName;
                issues.push({
                    layer: 'runtime',
                    severity: 'error',
                    artifact: { type: 'dashboard', name: p.name },
                    ref: { type: 'dataset', name: dsName, member: widgetId },
                    code: 'widget_query_failed',
                    message: `Dashboard "${p.name}" widget "${widgetId}" query against dataset "${dsName}" failed: ${String((e as Error)?.message ?? e)}`,
                    fix,
                    userMessage: say('widget_query_failed', {
                        ...named,
                        dataset: labelIn(dataset, dsName),
                        // The object the sentence names is the one the `fix`
                        // names: the refused or undecided object when the
                        // error carries one, else the dataset's own. Empty
                        // when there is none, and the sentence says so.
                        // After a refusal, or a read gate that could not
                        // decide, it is named exactly as the `fix` names it,
                        // by the API name: the caller was not admitted to
                        // that object, so the probe reads nothing of it (not
                        // its label either) for this caller's sentence. Only
                        // a query that failed for another reason reads the
                        // dataset's object for its label.
                        object: !saidObject ? '' : refusal || unavailable ? saidObject : await labelOf('object', saidObject),
                        cause: refusal ? (refusal.fields.length ? 'field-access' : 'access') : unavailable ? 'unavailable' : 'query',
                    }),
                });
            }
        }
    }

    // Widgets existed but no analytics service was mounted — say so ONCE
    // (silence would read as "probed and passed", which it was not).
    if (widgetsToProbe > 0 && (!analytics || typeof analytics.queryDataset !== 'function')) {
        issues.push({
            layer: 'runtime',
            severity: 'warning',
            artifact: { type: 'dashboard', name: dashboards.map((d) => d.name).join(', ') },
            code: 'probes_unavailable',
            message: `${widgetsToProbe} dashboard widget(s) could not be probed: no analytics service is mounted on this kernel.`,
            // No name: one finding stands for every dashboard of the publish.
            userMessage: say('probes_unavailable', { count: String(widgetsToProbe) }),
        });
    }

    // ── Flows: a connector step must name a connector and action this kernel has ──
    //
    // [#35146] A `connector_action` step dispatches to whatever the engine
    // resolves for its connector, named from the flow's package, then its
    // action. The flow publishes whichever connector it names; one this
    // environment does not serve fails every run that reaches the step. The
    // probe asks the engine the same questions the step's executor asks, in
    // the same order, with nothing dispatched. An engine without the lookups
    // is not probed.
    const automation = opts.automation;
    const callerPackageId = opts.packageId ?? null;
    if (automation && typeof automation.resolveConnectorAction === 'function') {
        for (const p of published.filter((x) => x.type === 'flow')) {
            const body = asRec(await readItem('flow', p.name));
            if (!body) continue;
            let graphs: ReturnType<typeof collectFlowGraphs>;
            try {
                graphs = collectFlowGraphs(body as Parameters<typeof collectFlowGraphs>[0]);
            } catch {
                continue;
            }
            for (const node of graphs.flatMap((g) => g.nodes as readonly unknown[]).map(asRec)) {
                if (!node || node.type !== 'connector_action') continue;
                const cfg = asRec(node.connectorConfig);
                const connectorId = typeof cfg?.connectorId === 'string' ? cfg.connectorId : undefined;
                const actionId = typeof cfg?.actionId === 'string' ? cfg.actionId : undefined;
                if (!connectorId || !actionId) continue; // the schema's refusal, not a probe's
                const nodeId = typeof node.id === 'string' ? node.id : 'connector_action';
                let cause: 'refused' | 'no-action' | 'degraded' | undefined;
                let why = '';
                try {
                    const instance = typeof automation.resolveConnectorInstanceFor === 'function'
                        ? automation.resolveConnectorInstanceFor(connectorId, callerPackageId)
                        : ({ status: 'instance', packageId: callerPackageId } as const);
                    if (instance.status === 'refused') {
                        cause = 'refused';
                        why = instance.refusal.message;
                    } else {
                        const packageId = instance.status === 'instance' ? instance.packageId : undefined;
                        const handler = packageId === undefined ? undefined : automation.resolveConnectorAction(connectorId, actionId, packageId);
                        if (!handler) {
                            const degraded = packageId === undefined ? undefined : automation.getConnectorDegradedReason?.(connectorId, packageId);
                            cause = degraded ? 'degraded' : 'no-action';
                            why = degraded
                                ? `connector "${connectorId}" is degraded — ${degraded.replace(/\.\s*$/, '')}`
                                : `no connector on this environment serves "${connectorId}.${actionId}"`;
                        }
                    }
                } catch {
                    continue; // a lookup that threw judges nothing
                }
                if (!cause) continue;
                issues.push({
                    layer: 'runtime',
                    severity: 'warning',
                    artifact: { type: 'flow', name: p.name },
                    ref: { type: 'connector', name: connectorId, member: actionId },
                    code: 'flow_connector_action_unresolved',
                    message:
                        `Flow "${p.name}" step "${nodeId}" (connector_action) dispatches "${connectorId}.${actionId}", but ${why} — ` +
                        'every run that reaches the step fails.',
                    fix: cause === 'degraded'
                        ? `Resolve what keeps connector "${connectorId}" degraded (its upstream or its credential), then re-run the flow.`
                        : cause === 'refused'
                        ? `Make "${connectorId}" name one connector from this flow's package (declare the dependency, or hold the connector in the package), then republish.`
                        : `Point the step's connectorConfig at a connector and action this environment has, or install the package or plugin that provides "${connectorId}".`,
                    userMessage: say('flow_connector_action_unresolved', {
                        flow: labelIn(body, p.name),
                        step: labelIn(node, nodeId),
                        connector: connectorId,
                        cause,
                    }),
                });
            }
        }
    }

    return { issues, checked };
}

/**
 * The one field on a child object that points back at `parent`, the
 * foreign key a roll-up resolves when it names no `relationshipField`:
 * a `master_detail` or `lookup` whose target is the parent. Two such fields
 * leave the engine to refuse, so the probe judges neither.
 */
function childForeignKey(child: Rec | undefined, parent: string): string | undefined {
    const candidates = fieldsOf(child).filter(([, def]) => {
        if (def.type !== 'master_detail' && def.type !== 'lookup') return false;
        try {
            return referenceTargetOf(def) === parent;
        } catch {
            return false;
        }
    });
    return candidates.length === 1 ? candidates[0][0] : undefined;
}
