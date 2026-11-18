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
import { PackageScopedNameRefusedError, describePackageScopedHolder, type PackageScopedRefusal } from '@objectstack/core';
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

/** The `where` a probe read scopes to the publishing organization, beside its own clause. */
function scoped(organizationId: string | null | undefined, where: Rec = {}): Rec | undefined {
    const merged = organizationId ? { ...where, organization_id: organizationId } : where;
    return Object.keys(merged).length > 0 ? merged : undefined;
}

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
    // [#35146] A roll-up is recomputed when a CHILD row is written, so a
    // `summary` whose definition is correct still reads blank on every parent
    // when it was declared after the children landed, or the children carry
    // no foreign key back. Every check above reads the definition, which is
    // fine; this asks the data. Only parents that HAVE children are judged
    // (a parent with none reads blank truthfully), and only a field left
    // UNSET on all of them: a computed zero is a value. A roll-up with its
    // own `filter` is not judged, since which children it counts is the
    // filter's question.
    const SYSTEM_READ = { isSystem: true };
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
                const children = await engine.find(childObject, {
                    limit: PROBE_SAMPLE_ROWS,
                    ...(scoped(organizationId) ? { where: scoped(organizationId) } : {}),
                    context: SYSTEM_READ,
                });
                const parentIds = [...new Set(asArr(children).map(asRec).flatMap((c) =>
                    c && (!childField || (c[childField] !== null && c[childField] !== undefined)) ? idsIn(c[fk]) : []))];
                if (parentIds.length === 0) continue;
                const parents = asArr(await engine.find(p.name, {
                    where: { id: { $in: parentIds } },
                    limit: parentIds.length,
                    context: SYSTEM_READ,
                })).map(asRec).filter((r): r is Rec => !!r);
                if (parents.length === 0 || parents.some((r) => r[fieldName] !== null && r[fieldName] !== undefined)) continue;
                issues.push({
                    layer: 'runtime',
                    severity: 'warning',
                    artifact: { type: 'object', name: p.name },
                    ref: { type: 'object', name: p.name, member: fieldName },
                    code: 'rollup_never_computed',
                    message:
                        `Roll-up "${p.name}.${fieldName}" is empty on all ${parents.length} parent row(s) that have "${childObject}" ` +
                        'children — the field is configured, but the engine has never computed it. A roll-up recalculates only ' +
                        'when a child row is written, so one declared after the children loaded stays blank until a child changes.',
                    fix:
                        `Check that "${childObject}" rows carry "${fk}" back to "${p.name}", then write one child row (any change) ` +
                        'to trigger the recompute. Do not present the figure as working while it reads blank.',
                    userMessage: say('rollup_never_computed', {
                        object: labelIn(body, p.name),
                        field: labelIn(def, fieldName),
                        child: await labelOf('object', childObject),
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
    // system write, which the engine does not re-check for references, so a
    // value naming no row lands unchallenged, and the first one to notice is
    // the person whose edit form refuses to save the record
    // (`reference_not_found`). One sample read of the object, then one
    // `id $in` read per reference column. A blank is not a dangle, and a read
    // that fails judges nothing.
    for (const p of published.filter((x) => x.type === 'seed')) {
        const seed = asRec(await readItem('seed', p.name));
        const objectName = typeof seed?.object === 'string' ? seed.object : undefined;
        if (!objectName) continue;
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
        let rows: Rec[];
        try {
            rows = asArr(await engine.find(objectName, {
                limit: PROBE_SAMPLE_ROWS,
                ...(scoped(organizationId) ? { where: scoped(organizationId) } : {}),
                context: SYSTEM_READ,
            })).map(asRec).filter((r): r is Rec => !!r);
        } catch {
            continue;
        }
        for (const { name: field, def, target } of refFields) {
            const values = [...new Set(rows.flatMap((r) => idsIn(r[field])))].slice(0, PROBE_SAMPLE_ROWS);
            if (values.length === 0) continue;
            let found: Set<string>;
            try {
                const existing = asArr(await engine.find(target, {
                    where: { id: { $in: values } },
                    limit: values.length,
                    context: SYSTEM_READ,
                })).map(asRec);
                found = new Set(existing.map((r) => String(r?.id ?? r?._id)));
            } catch {
                continue;
            }
            const missing = values.filter((v) => !found.has(v));
            if (missing.length === 0) continue;
            const shown = missing.slice(0, 5).map((v) => `"${v}"`).join(', ');
            issues.push({
                layer: 'runtime',
                severity: 'warning',
                artifact: { type: 'seed', name: p.name },
                ref: { type: 'object', name: objectName, member: field },
                code: 'seed_reference_unresolved',
                message:
                    `Reference column "${objectName}.${field}" holds ${missing.length} value(s) that name no "${target}" row: ` +
                    `${shown}${missing.length > 5 ? ', …' : ''}. The edit form submits the whole record and the engine re-checks ` +
                    `every reference in it, so those records cannot be saved (\`${field}: reference_not_found\`), whichever field the user changed.`,
                fix:
                    `Point "${objectName}.${field}" on those rows at real "${target}" records (in the seed, by a value the loader ` +
                    'resolves), or clear it, then republish the seed.',
                userMessage: say('seed_reference_unresolved', {
                    object: labelIn(objectBody, objectName),
                    field: labelIn(def, field),
                    target: await labelOf('object', target),
                    count: String(missing.length),
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
                    // reads zero or nothing (a condition matching nothing,
                    // rows dated outside the widget's window), so the card
                    // the person opens is an empty "0" tile. Zero can be the
                    // truth, so a warning, never an error. No rows at all is
                    // `empty_query`'s question above, judged over the rows
                    // this caller sees (#25484): an empty answer to a caller
                    // who sees no rows is not reported here either.
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
                            'Fix the data the widget reads (seed rows inside the widget\'s time window, rows its condition matches), ' +
                            'adjust the widget or its dataset\'s filter, or tell the user why this card reads 0 right now.',
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
