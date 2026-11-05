// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// Ported from the cloud eval harness under the cloud#3600 D2 ruling (structural-score.ts).

/**
 * Deterministic structural scorer for a built metadata graph — the "shape"
 * half of the scenario library's scoring.
 *
 * Two scorers over one graph:
 *
 *  - {@link scoreGraph} matches a scenario's expectations by EXACT api-name
 *    (`object:invoice`, `lookup:invoice_line.invoice->invoice`). Right when the
 *    names are part of the scenario.
 *  - {@link scoreGraphShape} scores the SHAPE instead — counts, options present,
 *    references resolve, the app covers every object — so a correct build whose
 *    author chose different names still passes. {@link deriveShape} turns a
 *    name-coupled expectation into that name-agnostic one.
 *
 * Pure and deterministic: no model call, no network, no label-language
 * dependence. The graph comes from {@link artifactToEvalGraph}
 * (`scenario-graph.ts`), never from a live environment.
 *
 * ## Where this differs from the cloud source, and why
 *
 * The discrimination self-test (`scenario-score.test.ts`) degrades each golden
 * corpus build one defect at a time and requires a strictly lower score. Run
 * against the code as ported, two degradations scored exactly as high as the
 * intact build — which is the "every build scores 1.00" blind spot of
 * cloud#2146 reproduced locally. Both are closed here, each at the check that
 * was blind:
 *
 *  1. `nav:<target>->exists` asked whether an object/dashboard/app of that name
 *     EXISTS — not whether any app navigates to it. A build whose app nav
 *     dangled (or that had no app at all) passed it. The check now passes only
 *     when an app nav entry targets the name and resolves, and every app nav
 *     entry is additionally scored for resolving (`nav-resolves:<target>`), as
 *     the shape scorer already did.
 *  2. A widget bound to a dataset the graph does not carry passed the measure
 *     check (`!dataset ||`). The cloud graph was read from a live environment
 *     whose datasets were scoped differently from its objects, so leniency there
 *     was deliberate; a local artifact IS the whole build, so a binding that
 *     names no dataset in it dangles and now fails — in both scorers.
 *
 * Two smaller deviations: the field's reference target is `reference` (the
 * spec's key) rather than `reference_to`, and a reference resolves to the
 * platform by the `sys_` / `ai_` prefixes only — `cloud_` names no object an
 * open-source runtime serves.
 */

import { REFERENCE_VALUE_TYPES } from '@objectstack/spec/data';

/**
 * What a scenario expects of a build, by name.
 *
 * ⛔ Field-for-field the scenario card's `expect` block (sibling card #30289
 * owns that contract). Mirrored here rather than imported so this module takes
 * no dependency on the package that parses scenario cards; a change there is a
 * change here, in the same shape.
 */
export interface ScenarioExpectation {
  objects: string[];
  minFieldsPerObject?: number;
  selectFields?: { object: string; field: string; minOptions: number }[];
  lookups?: { object: string; field: string; to: string }[];
  dashboards?: string[];
  appNavTargets?: string[];
}

export interface EvalGraphField {
  name: string;
  type: string;
  required?: boolean;
  options?: ReadonlyArray<{ value: string; label?: string }>;
  /**
   * The AUTHOR-CHOSEN target of a reference-typed field. Absent on a type whose
   * target is fixed by the type itself (`user` → `sys_user`): a check on a
   * constant can only pass, and counting it would pad every score.
   */
  reference?: string;
}

export interface EvalGraphNavEntry {
  target: string;
  /** Whether the target names something the build carries. Absent ⇒ judged by name against the graph. */
  resolves?: boolean;
}

export interface EvalGraph {
  objects: ReadonlyArray<{ name: string; fields: ReadonlyArray<EvalGraphField> }>;
  dashboards?: ReadonlyArray<{ name: string; widgets?: ReadonlyArray<{ dataset?: string; measure?: string }> }>;
  apps?: ReadonlyArray<{ name: string; nav?: ReadonlyArray<EvalGraphNavEntry> }>;
  datasets?: ReadonlyArray<{ name: string; measures?: ReadonlyArray<string> }>;
}

export interface CheckResult {
  check: string;
  pass: boolean;
  detail?: string;
}

export interface ScoreResult {
  /** passed / total, in [0,1]. A graph that raised no check scores 1. */
  score: number;
  total: number;
  passed: number;
  checks: CheckResult[];
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Object names a build may reference without declaring: the platform's own
 * objects. Shared by the reference and nav checks so the two cannot disagree on
 * what "resolves to the platform" means.
 */
export const PLATFORM_OBJECT_PREFIX = /^(sys_|ai_)/;

function findObject(graph: EvalGraph, name: string) {
  return graph.objects.find((o) => norm(o.name) === norm(name));
}

function findField(graph: EvalGraph, object: string, field: string): EvalGraphField | undefined {
  return findObject(graph, object)?.fields.find((f) => norm(f.name) === norm(field));
}

/** Every name a nav entry may target: objects, dashboards, apps. */
function navTargets(graph: EvalGraph): Set<string> {
  const t = new Set<string>();
  for (const o of graph.objects) t.add(norm(o.name));
  for (const d of graph.dashboards ?? []) t.add(norm(d.name));
  for (const a of graph.apps ?? []) t.add(norm(a.name));
  return t;
}

function navEntryResolves(entry: EvalGraphNavEntry, targets: Set<string>): boolean {
  return entry.resolves ?? targets.has(norm(entry.target));
}

/**
 * One check per widget measure: the measure must exist on the dataset the
 * widget binds, and the dataset must exist in the graph (deviation 2 above).
 * Exported for the capability-tag checks (`scenario-tags.ts`), so a dashboard
 * tag and these scorers judge a measure by one rule.
 */
export function measureChecks(graph: EvalGraph, label: (dashboard: string, measure: string, dataset: string) => string): CheckResult[] {
  const out: CheckResult[] = [];
  for (const d of graph.dashboards ?? []) {
    for (const w of d.widgets ?? []) {
      if (!w.measure || !w.dataset) continue;
      const ds = (graph.datasets ?? []).find((x) => norm(x.name) === norm(w.dataset!));
      const known = !!ds && (ds.measures ?? []).map(norm).includes(norm(w.measure));
      out.push({
        check: label(d.name, w.measure, w.dataset),
        pass: known,
        ...(known ? {} : { detail: ds ? `dataset ${w.dataset} has no measure ${w.measure}` : `no dataset ${w.dataset}` }),
      });
    }
  }
  return out;
}

function result(checks: CheckResult[]): ScoreResult {
  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  return { score: total === 0 ? 1 : passed / total, total, passed, checks };
}

/**
 * Score a built metadata graph against a scenario's expectations, by exact
 * name.
 */
export function scoreGraph(graph: EvalGraph, expect: ScenarioExpectation): ScoreResult {
  const checks: CheckResult[] = [];
  const add = (check: string, pass: boolean, detail?: string) =>
    checks.push(detail === undefined ? { check, pass } : { check, pass, detail });

  for (const name of expect.objects) {
    const obj = findObject(graph, name);
    add(`object:${name}`, !!obj);
    if (obj && expect.minFieldsPerObject != null) {
      add(
        `object:${name}:minFields>=${expect.minFieldsPerObject}`,
        obj.fields.length >= expect.minFieldsPerObject,
        `has ${obj.fields.length}`,
      );
    }
  }

  // A select with no usable options is an unusable form control.
  for (const sel of expect.selectFields ?? []) {
    const f = findField(graph, sel.object, sel.field);
    const n = f?.options?.length ?? 0;
    add(`select:${sel.object}.${sel.field}>=${sel.minOptions}opts`, n >= sel.minOptions, `has ${n}`);
  }

  for (const lk of expect.lookups ?? []) {
    const f = findField(graph, lk.object, lk.field);
    add(
      `lookup:${lk.object}.${lk.field}->${lk.to}`,
      !!f && norm(f.reference ?? '') === norm(lk.to),
      f ? `ref=${f.reference}` : 'missing',
    );
  }

  for (const dash of expect.dashboards ?? []) {
    add(`dashboard:${dash}`, (graph.dashboards ?? []).some((d) => norm(d.name) === norm(dash)));
  }

  // Each expected nav target must be navigated to by some app, through an entry
  // that resolves (deviation 1 above) — and every app nav entry must resolve.
  const targets = navTargets(graph);
  const navEntries = (graph.apps ?? []).flatMap((a) => a.nav ?? []);
  for (const navName of expect.appNavTargets ?? []) {
    add(
      `nav:${navName}->exists`,
      navEntries.some((n) => norm(n.target) === norm(navName) && navEntryResolves(n, targets)),
    );
  }
  for (const n of navEntries) add(`nav-resolves:${n.target}`, navEntryResolves(n, targets));

  checks.push(...measureChecks(graph, (d, m, ds) => `measure:${d}.${m}@${ds}`));

  return result(checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// Name-agnostic structural rubric.
//
// scoreGraph() above matches EXACT api-names — right for a scenario whose names
// are part of the ask, too brittle for a build whose author picked its own: a
// Chinese 借阅记录 prompt answered with `borrow_record` instead of `loan` is a
// correct build that exact-name scoring marks down. This rubric scores the
// SHAPE so it measures build quality independent of the chosen names.

export interface ShapeExpectation {
  /** At least this many user objects. */
  minObjects: number;
  minFieldsPerObject?: number;
  /**
   * At least this many RELATIONSHIP fields across all objects — every spec
   * reference type carrying an author-chosen target (`lookup`, `master_detail`,
   * `tree`), not just `lookup`. Named for the expectation it is derived from
   * (`lookups`); the emitted check is `relationships>=N`.
   */
  minLookups?: number;
  minDashboards?: number;
  /** Require an app whose nav covers EVERY user object (no orphan, no dangle). */
  requireAppCoveringObjects?: boolean;
}

/** Derive a name-agnostic shape from a scenario's (name-coupled) expectations. */
export function deriveShape(expect: ScenarioExpectation): ShapeExpectation {
  return {
    minObjects: expect.objects.length,
    minFieldsPerObject: expect.minFieldsPerObject,
    minLookups: expect.lookups?.length ?? 0,
    minDashboards: expect.dashboards?.length ?? 0,
    requireAppCoveringObjects: (expect.appNavTargets?.length ?? 0) > 0,
  };
}

/**
 * Score a built graph by SHAPE, not names: the same failure modes as
 * {@link scoreGraph} (optionless select, dangling nav, unknown measure) keyed
 * on structure, so a correct build in any language passes.
 */
export function scoreGraphShape(graph: EvalGraph, exp: ShapeExpectation): ScoreResult {
  const checks: CheckResult[] = [];
  const add = (check: string, pass: boolean, detail?: string) =>
    checks.push(detail === undefined ? { check, pass } : { check, pass, detail });

  add(`objects>=${exp.minObjects}`, graph.objects.length >= exp.minObjects, `has ${graph.objects.length}`);

  if (exp.minFieldsPerObject != null) {
    for (const o of graph.objects) {
      add(`${o.name}:minFields>=${exp.minFieldsPerObject}`, o.fields.length >= exp.minFieldsPerObject, `has ${o.fields.length}`);
    }
  }

  // Every select field must carry usable options.
  for (const o of graph.objects) {
    for (const f of o.fields) {
      if (f.type !== 'select') continue;
      add(`${o.name}.${f.name}:select-has-options`, (f.options?.length ?? 0) >= 2, `has ${f.options?.length ?? 0}`);
    }
  }

  // Relationships: enough of them, and each must resolve to a real object.
  //
  // The type set is the SPEC's (`REFERENCE_VALUE_TYPES`), never a literal
  // written here: a hand-copied `type === 'lookup'` is how a master-detail
  // pointing at nothing once failed no check at all (cloud#2149). `&& reference`
  // keeps the fixed-target types out (see `EvalGraphField.reference`).
  const rels = graph.objects.flatMap((o) =>
    o.fields.filter((f) => REFERENCE_VALUE_TYPES.has(f.type) && f.reference).map((f) => ({ o, f })),
  );
  if (exp.minLookups != null) add(`relationships>=${exp.minLookups}`, rels.length >= exp.minLookups, `has ${rels.length}`);
  for (const { o, f } of rels) {
    const ref = f.reference!;
    const resolves = graph.objects.some((x) => norm(x.name) === norm(ref)) || PLATFORM_OBJECT_PREFIX.test(ref);
    // Labelled with the field's OWN type, so a master-detail failure reads as
    // the heavier defect it is.
    add(`${f.type}:${o.name}.${f.name}->resolves`, resolves, ref);
  }

  if (exp.minDashboards != null && exp.minDashboards > 0) {
    add(`dashboards>=${exp.minDashboards}`, (graph.dashboards ?? []).length >= exp.minDashboards, `has ${(graph.dashboards ?? []).length}`);
  }

  // The app must exist, its nav must COVER every object (no orphan) and every
  // entry must resolve (no dangle).
  if (exp.requireAppCoveringObjects) {
    const apps = graph.apps ?? [];
    add('app-exists', apps.length >= 1, `${apps.length} app(s)`);
    if (apps.length) {
      const navSet = new Set(
        apps.flatMap((a) => (a.nav ?? []).filter((n) => n.resolves !== false).map((n) => norm(n.target))),
      );
      for (const o of graph.objects) add(`nav-covers:${o.name}`, navSet.has(norm(o.name)));
      const targets = navTargets(graph);
      for (const a of apps) for (const n of a.nav ?? []) add(`nav-resolves:${n.target}`, navEntryResolves(n, targets));
    }
  }

  checks.push(...measureChecks(graph, (d, m) => `measure:${d}.${m}`));

  return result(checks);
}
