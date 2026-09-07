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

/** One runtime-verification finding (ADR-0038 BuildIssue, layer 'runtime'). */
export interface RuntimeBuildIssue {
    layer: 'runtime';
    severity: 'error' | 'warning';
    /** The artifact whose runtime behaviour is broken. */
    artifact: { type: string; name: string };
    /** What it exercised, when narrower than the artifact (e.g. a widget). */
    ref?: { type: string; name: string; member?: string };
    /**
     * 'seed_not_applied' | 'view_read_failed' | 'object_field_ref_unknown'
     * | 'object_field_ref_rule_failed' | 'empty_query' | 'widget_query_failed'
     * | 'probes_unavailable'
     *
     * [#15494] `object_field_ref_rule_failed` is the odd one out and belongs
     * here anyway: it reports that a PROBE could not run, not that an artifact
     * is broken. A probe plane that can only ever emit findings has no way to
     * say "I was unable to judge this", and the absence of that vocabulary is
     * what let a thrown rule read as a clean object.
     */
    code: string;
    message: string;
    fix?: string;
}

/** Aggregate result of one post-publish probe pass. */
export interface BuildProbeReport {
    /** Findings, empty when every probe passed. */
    issues: RuntimeBuildIssue[];
    /** How many probes actually ran, per plane (0s mean nothing to probe). */
    /**
     * [#15254] `objects` joined the planes because its ABSENCE was the tell.
     * A publish of a package Studio's app builder authored reported
     * `{seeds: 0, views: 0, widgets: 0}` — three zeroes, no `objects` key —
     * and that receipt was accurate: the builder mints no `view` items, so
     * every plane the report carried had genuinely nothing to inspect while
     * the objects it DID publish were probed by nothing. A count that cannot
     * go up is indistinguishable from a plane that found nothing wrong.
     */
    checked: { seeds: number; views: number; widgets: number; objects: number };
}

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
}

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | undefined {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function asArr(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
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

/** True when the object has at least one row (probe read, isSystem). */
async function hasRows(
    engine: ProbeEngine,
    objectName: string,
    organizationId?: string | null,
): Promise<boolean> {
    const rows = await engine.find(objectName, {
        fields: ['id'],
        limit: 1,
        ...(organizationId ? { where: { organization_id: organizationId } } : {}),
        context: { isSystem: true },
    });
    return Array.isArray(rows) && rows.length > 0;
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
export async function runBuildProbes(opts: RunBuildProbesOptions): Promise<BuildProbeReport> {
    const issues: RuntimeBuildIssue[] = [];
    const checked = { seeds: 0, views: 0, widgets: 0, objects: 0 };
    const { engine, getItem, published, analytics, organizationId } = opts;

    // Memoized active-item reads (a dashboard and its widgets share datasets).
    const itemCache = new Map<string, unknown | undefined>();
    const readItem = async (type: string, name: string): Promise<unknown | undefined> => {
        const key = `${type} ${name}`;
        if (itemCache.has(key)) return itemCache.get(key);
        let item: unknown | undefined;
        try {
            item = await getItem(type, name);
        } catch {
            item = undefined;
        }
        itemCache.set(key, item);
        return item;
    };

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
                });
            }
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
            const dataset = asRec(await readItem('dataset', dsName));
            if (!dataset) continue; // dangling dataset is an L1 (graph) finding, not a runtime one
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
                const result = await analytics.queryDataset(dataset, selection, undefined);
                const rows = resultRows(result);
                if (rows.length === 0 && objectName && (await hasRows(engine, objectName, organizationId))) {
                    issues.push({
                        layer: 'runtime',
                        severity: 'error',
                        artifact: { type: 'dashboard', name: p.name },
                        ref: { type: 'dataset', name: dsName, member: widgetId },
                        code: 'empty_query',
                        message: `Dashboard "${p.name}" widget "${widgetId}" returns NO data from dataset "${dsName}" although object "${objectName}" has rows — the widget will render empty for every user.`,
                        fix: `Run the dataset query directly to see the compiled strategy/SQL; check the dataset's measure/dimension field bindings against object "${objectName}".`,
                    });
                }
            } catch (e) {
                issues.push({
                    layer: 'runtime',
                    severity: 'error',
                    artifact: { type: 'dashboard', name: p.name },
                    ref: { type: 'dataset', name: dsName, member: widgetId },
                    code: 'widget_query_failed',
                    message: `Dashboard "${p.name}" widget "${widgetId}" query against dataset "${dsName}" failed: ${String((e as Error)?.message ?? e)}`,
                    fix: `Fix the dataset definition (or the widget's values/dimensions) so the query compiles, then republish.`,
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
        });
    }

    return { issues, checked };
}
