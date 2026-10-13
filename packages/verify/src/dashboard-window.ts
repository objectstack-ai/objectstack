// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The dashboard date-window family: every dashboard that declares a
// `dateRange` answers, under each preset of its own picker, with the rows that
// window selects.
//
// ## The promise, and where each half of it is read from
//
// A dashboard's `dateRange` is a picker. Each widget it binds is narrowed to
// the picked window on one of the widget's own fields, and the widget's count
// is the count of the rows that window selects. Three published sources:
//
//   - WHICH field a widget's window lands on: `DashboardWidgetSchema.filterBindings`
//     (`@objectstack/spec/ui`). A string binds the built-in date range to that
//     field, `false` opts the widget out, and absent means the filter's own
//     field: `dateRange.field ?? 'created_at'`. The field resolves against the
//     object behind the widget's dataset (`dataset.object`). Dashboards and
//     datasets are read through the spec's own parse (`DashboardSchema`,
//     `DatasetSchema`), never as authored.
//   - WHAT a preset's window is: `DATE_RANGE_PRESET_MACRO_WINDOWS`
//     (`@objectstack/spec/data`), the `{date-macro}` pair each preset of
//     `DATE_RANGE_PRESETS` names — its first and last day, inclusive; the
//     three rolling `last_N_days` presets end on `{today}`. It is handed to the
//     door as written, `{ $gte: start, $lte: end }`, ANDed with the widget's
//     own filter (`{ $and: [filter, window] }`, the shipped console's merge):
//     ⛔ never lowered to dates here. The server resolves the tokens.
//   - WHICH days a window selects, for the ground truth: the same window
//     object, resolved by `@objectstack/core`'s `resolveFilterTokens` (the one
//     date-macro resolver the analytics executor calls, on the reference
//     timezone of the caller's `ExecutionContext`, UTC when unset), compared
//     with each fixture row's day by the table's own convention (first and last
//     day inclusive).
//
// ## The door, and who walks through it
//
// `POST {basePath}/analytics/dataset/query` with the saved dataset's name and
// the widget's own selection (its dimensions, one count measure, and its
// filter with the window ANDed in as `runtimeFilter`) — the request a
// dashboard widget makes — as the signed-in principal the caller hands in.
// `{current_user_id}` in a widget's filter is that principal.
//
// ## The ground truth, and the control that keeps it honest
//
// Per widget and count measure, fixture rows are written through the seed door
// (system, hooks and validations live) on known days that straddle every
// preset's past edges, each row stamped at UTC noon (a `date` field takes the
// day itself), with every column the widget's own filter, the dataset's filter
// and the measure's filter read held to a value those filters select, and
// owned by the principal. Each row is read back: a row whose stamp or held
// columns do not read back as written (an app hook rewrote them) makes the
// probe not run, never contradicted. Every answer is a DIFFERENCE — the count
// after the fixtures minus the count before, under the same window — so the
// app's own rows cancel out. The control leg is the widget with no window: it
// must count every fixture row, or the fixtures do not meet the widget's own
// selection and no window is judged.
//
// Three verdicts per preset: the widget is not blank where the window holds
// fixture rows; its count equals the rows the window selects; and a narrower
// preset never answers more than a wider one (a window that never narrows is
// inert, a finding).
//
// Run it on a fresh stack of its own: it writes fixtures.

import { DashboardSchema, DatasetSchema } from '@objectstack/spec/ui';
import { DATE_RANGE_PRESETS, DATE_RANGE_PRESET_MACRO_WINDOWS, type DateRangePreset } from '@objectstack/spec/data';
import { resolveFilterTokens } from '@objectstack/core';
import { declaredCollection } from './artifact-collections.js';
import { deriveCrudCases, fillRelationalRefs, type CrudCase } from './derive.js';
import type { VerifyStack } from './harness.js';

/**
 * The built-in date range's default field, when `dateRange.field` is omitted:
 * `DashboardWidgetSchema.filterBindings`' published contract,
 * "dateRange: `dateRange.field ?? 'created_at'`". No export carries the
 * literal, so it is named once here with that source.
 */
const DATE_RANGE_DEFAULT_FIELD = 'created_at';
/** The reserved `filterBindings` key of the built-in date range. */
const DATE_RANGE_BINDING = 'dateRange';

/** The field types a window can be compared on. */
const WINDOWABLE_TYPES = new Set(['date', 'datetime']);

/** The one principal-scoped placeholder a held column may take. */
const CURRENT_USER_TOKEN = '{current_user_id}';

// ── Types ───────────────────────────────────────────────────────────────────

/** Why the family cannot compare a widget, or one of its measures. */
export type DashboardWindowExclusion =
  | 'dashboard-unparsed'
  | 'dataset-undeclared'
  | 'dataset-unparsed'
  | 'object-undeclared'
  | 'object-not-derivable'
  | 'field-missing'
  | 'field-type'
  | 'filter-unmodelled'
  | 'no-count-measure'
  | 'measure-undeclared'
  | 'not-a-count'
  | 'count-field-unsynthesizable';

/** One measure a widget selects, as the family reads it. */
export interface DashboardWindowMeasureCase {
  measure: string;
  /** A `count` of a named field counts its non-null values, so the fixtures carry one. */
  countField?: string;
  /** The measure's own scoped filter, as parsed. */
  filter?: Record<string, unknown>;
  excluded?: { kind: DashboardWindowExclusion; reason: string };
}

/** One widget of a dashboard that declares a `dateRange`. */
export interface DashboardWindowCase {
  dashboard: string;
  /** The widget's `id`, or `#<index>` when it has none. */
  widget: string;
  dataset?: string;
  object?: string;
  /** The field the window lands on. */
  field?: string;
  /** `explicit` — `filterBindings.dateRange` names it; `default` — the dashboard's own window field. */
  binding?: 'explicit' | 'default';
  /** The widget's own filter, as parsed. */
  filter?: Record<string, unknown>;
  /** The dataset's intrinsic filter, as parsed. */
  datasetFilter?: Record<string, unknown>;
  dimensions: string[];
  measures: DashboardWindowMeasureCase[];
  /** The widget opts out of the window (`filterBindings.dateRange: false`). */
  unbound?: true;
  excluded?: { kind: DashboardWindowExclusion; reason: string };
}

/** A dashboard the app declares, and whether it is in the population. */
export interface DashboardWindowDashboard {
  name: string;
  /** `windowed` — it declares a `dateRange`; `not-windowed` — it does not; `excluded` — it does not parse. */
  status: 'windowed' | 'not-windowed' | 'excluded';
  /** The window field its widgets default to. */
  field?: string;
  /** The preset the picker opens on (the parse's default when unauthored). */
  defaultRange?: string;
  reason?: string;
}

/** The window a preset names, as handed to the door and as resolved for the ground truth. */
export interface DashboardWindowPreset {
  preset: DateRangePreset;
  /** The `{date-macro}` condition handed to the door, ANDed onto the widget's field. */
  condition: Record<string, string>;
  /** That condition resolved by the platform's resolver at the start of the run. */
  resolved: Record<string, unknown>;
}

/** What the door answered one query. */
export interface DashboardWindowAnswer {
  kind: 'answered' | 'refused' | 'faulted';
  status: number;
  /** The measure summed over every returned row. */
  count?: number;
  rows?: number;
  code?: string;
  detail?: string;
}

/** One preset against one measure. */
export interface DashboardWindowPresetProbe {
  preset: DateRangePreset;
  /** Fixture rows the window selects (the ground truth). */
  expected: number;
  /** The count the window added once the fixtures were written (after minus before). */
  answered?: number;
  /** The count the widget showed after the fixtures, all rows included. */
  shown?: number;
  /**
   * - `held`         — the window counted exactly the fixture rows it selects;
   * - `blank`        — it showed nothing where it selects fixture rows;
   * - `contradicted` — it counted another number of them;
   * - `failed`       — the door refused or faulted on the windowed query (the unwindowed one answered);
   * - `not-run`      — the fixtures could not be written, or the day turned mid-probe.
   */
  outcome: 'held' | 'blank' | 'contradicted' | 'failed' | 'not-run';
  answer?: DashboardWindowAnswer;
  detail?: string;
}

export interface DashboardWindowMeasureResult {
  measure: string;
  status: 'probed' | 'excluded';
  reason?: string;
  excludedKind?: DashboardWindowExclusion;
  /** The fixture days written (UTC calendar days). */
  days?: string[];
  /** `smallest` — the required fields only; `every-field` — the seed door refused that, so every field the CRUD derivation synthesizes. */
  fixture?: 'smallest' | 'every-field';
  /** The control leg: the widget with no window must count every fixture row. */
  unwindowed?: { expected: number; answered?: number; answer?: DashboardWindowAnswer };
  presets: DashboardWindowPresetProbe[];
  /** Every preset answered what the unwindowed query answered: the window never narrows. */
  inert?: boolean;
  /** `narrower ⊂ wider: a > b` — a preset nested inside another answered more. */
  narrowing?: string[];
}

/**
 * - `proven`        — every probed measure held under every preset;
 * - `contradicted`  — a preset went blank or counted the wrong rows (a hard failure);
 * - `failed`        — the windowed query was refused or faulted (a hard failure);
 * - `inconclusive`  — a probe did not run, or the control leg did not hold;
 * - `unbound`       — the widget opts out of the window;
 * - `excluded`      — the family cannot compare it (see `excludedKind`, `reason`).
 */
export type DashboardWindowWidgetStatus = 'proven' | 'contradicted' | 'failed' | 'inconclusive' | 'unbound' | 'excluded';

export interface DashboardWindowWidgetResult {
  dashboard: string;
  widget: string;
  dataset?: string;
  object?: string;
  field?: string;
  fieldType?: string;
  binding?: 'explicit' | 'default';
  status: DashboardWindowWidgetStatus;
  excludedKind?: DashboardWindowExclusion;
  reason?: string;
  measures: DashboardWindowMeasureResult[];
}

export interface DashboardWindowReport {
  app: string;
  /** `POST /analytics/dataset/query` as the signed-in principal. */
  door: 'rest';
  /** The principal's reference timezone, which the server resolves the window on. */
  timezone: string;
  presets: DashboardWindowPreset[];
  dashboards: DashboardWindowDashboard[];
  results: DashboardWindowWidgetResult[];
  summary: {
    dashboards: { declared: number; windowed: number; notWindowed: number; excluded: number };
    widgets: {
      total: number;
      unbound: number;
      excluded: number;
      probed: number;
      proven: number;
      contradicted: number;
      failed: number;
      inconclusive: number;
    };
    /** Widgets excluded, per reason. */
    excludedBy: Partial<Record<DashboardWindowExclusion, number>>;
    measures: { probed: number; excluded: number; excludedBy: Partial<Record<DashboardWindowExclusion, number>> };
    /** Preset × probed measure. */
    probes: number;
    held: number;
    blank: number;
    contradictions: number;
    faults: number;
    notRun: number;
    /** Measures whose window never narrowed. */
    inert: number;
    /** Nested preset pairs where the narrower answered more. */
    narrowing: number;
    /** `contradicted + failed` widgets — the count a CI gate reads. */
    hardFailures: number;
  };
}

const clip = (s: unknown, n = 200): string => String(s ?? '').slice(0, n);
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (f: unknown): f is Record<string, unknown> => isPlainObject(f) && Object.keys(f).length > 0;

// ── The population ──────────────────────────────────────────────────────────

const firstIssue = (error: any): string => {
  const issue = error?.issues?.[0];
  return `${issue?.path?.join('.') || 'root'}: ${clip(issue?.message, 120)}`;
};

/**
 * Derive one case per widget of every dashboard the app declares with a
 * `dateRange`, as the spec's parse of the dashboard and of its datasets states
 * it. A widget the family cannot compare is still returned, `unbound` or
 * `excluded`, with the reason, so the report counts it. What only a booted
 * stack can answer (the bound field's registered type) is judged by the run.
 */
export function deriveDashboardWindowCases(config: any): DashboardWindowCase[] {
  return derive(config).cases;
}

function derive(config: any): { cases: DashboardWindowCase[]; dashboards: DashboardWindowDashboard[] } {
  const crud = new Map<string, CrudCase>(deriveCrudCases(config).map((c) => [c.object, c]));
  const datasets = new Map<string, any>();
  for (const ds of declaredCollection(config, 'datasets')) if (ds?.name) datasets.set(ds.name, ds);
  const objects = new Set<string>();
  for (const o of declaredCollection(config, 'objects')) if (o?.name) objects.add(o.name);

  const cases: DashboardWindowCase[] = [];
  const dashboards: DashboardWindowDashboard[] = [];
  for (const raw of declaredCollection(config, 'dashboards')) {
    const name = String(raw?.name ?? '?');
    const parsed = DashboardSchema.safeParse(raw);
    if (!parsed.success) {
      if (raw?.dateRange) {
        const reason = `the dashboard does not parse under the spec's DashboardSchema (${firstIssue(parsed.error)})`;
        dashboards.push({ name, status: 'excluded', reason });
        cases.push({ dashboard: name, widget: '*', dimensions: [], measures: [], excluded: { kind: 'dashboard-unparsed', reason } });
      } else {
        dashboards.push({ name, status: 'not-windowed' });
      }
      continue;
    }
    const dash: any = parsed.data;
    if (!dash.dateRange) {
      dashboards.push({ name, status: 'not-windowed' });
      continue;
    }
    const windowField: string = dash.dateRange.field || DATE_RANGE_DEFAULT_FIELD;
    dashboards.push({ name, status: 'windowed', field: windowField, defaultRange: dash.dateRange.defaultRange });

    (dash.widgets as any[]).forEach((w, index) => {
      const c: DashboardWindowCase = {
        dashboard: name,
        widget: typeof w?.id === 'string' && w.id ? w.id : `#${index}`,
        dataset: w?.dataset,
        dimensions: Array.isArray(w?.dimensions) ? w.dimensions.map(String) : [],
        measures: [],
        ...(nonEmpty(w?.filter) ? { filter: w.filter } : {}),
      };
      cases.push(c);
      const binding = w?.filterBindings?.[DATE_RANGE_BINDING];
      if (binding === false) {
        c.unbound = true;
        return;
      }
      c.field = typeof binding === 'string' && binding ? binding : windowField;
      c.binding = typeof binding === 'string' && binding ? 'explicit' : 'default';

      const rawDataset = datasets.get(String(w?.dataset));
      if (!rawDataset) {
        c.excluded = { kind: 'dataset-undeclared', reason: `the widget binds dataset "${w?.dataset}", which the app does not declare` };
        return;
      }
      const ds = DatasetSchema.safeParse(rawDataset);
      if (!ds.success) {
        c.excluded = { kind: 'dataset-unparsed', reason: `dataset "${w.dataset}" does not parse under the spec's DatasetSchema (${firstIssue(ds.error)})` };
        return;
      }
      const dataset: any = ds.data;
      c.object = dataset.object;
      if (nonEmpty(dataset.filter)) c.datasetFilter = dataset.filter;
      if (!objects.has(dataset.object)) {
        c.excluded = {
          kind: 'object-undeclared',
          reason: `dataset "${w.dataset}" reads ${dataset.object}, which the app does not declare, so no fixture row can be built from its metadata`,
        };
        return;
      }
      const blocked = crud.get(dataset.object)?.blocked;
      if (blocked) {
        c.excluded = { kind: 'object-not-derivable', reason: `${dataset.object} cannot be synthesized: ${blocked}` };
        return;
      }

      const measures = new Map<string, any>((dataset.measures ?? []).map((m: any) => [m.name, m]));
      for (const name of (Array.isArray(w?.values) ? w.values : []).map(String)) {
        const m = measures.get(name);
        const mc: DashboardWindowMeasureCase = { measure: name };
        c.measures.push(mc);
        if (!m) {
          mc.excluded = { kind: 'measure-undeclared', reason: `dataset "${w.dataset}" declares no measure "${name}"` };
          continue;
        }
        if (m.derived) {
          mc.excluded = { kind: 'not-a-count', reason: `"${name}" is derived (${m.derived.op} of ${(m.derived.of ?? []).join(', ')}), not a row count` };
          continue;
        }
        if (m.aggregate !== 'count') {
          mc.excluded = { kind: 'not-a-count', reason: `"${name}" aggregates ${m.aggregate ?? 'nothing'}${m.field ? ` of ${m.field}` : ''}, not a row count` };
          continue;
        }
        if (typeof m.field === 'string' && m.field !== '*') {
          if (m.field.includes('.')) {
            mc.excluded = { kind: 'count-field-unsynthesizable', reason: `"${name}" counts the relationship path ${m.field}, which a fixture row cannot be held to` };
            continue;
          }
          mc.countField = m.field;
        }
        if (nonEmpty(m.filter)) mc.filter = m.filter;
      }
      if (c.measures.length > 0 && c.measures.every((m) => m.excluded)) {
        const counts = c.measures.filter((m) => m.excluded!.kind !== 'not-a-count' && m.excluded!.kind !== 'measure-undeclared');
        c.excluded = counts.length > 0
          ? { kind: counts[0]!.excluded!.kind, reason: counts[0]!.excluded!.reason }
          : { kind: 'no-count-measure', reason: `no measure the widget selects is a row count (${c.measures.map((m) => m.excluded!.reason).join('; ')})` };
      } else if (c.measures.length === 0) {
        c.excluded = { kind: 'no-count-measure', reason: 'the widget selects no measure' };
      }
    });
  }
  return { cases, dashboards };
}

// ── Held columns: what the widget's own selection asks of a row ─────────────

/** A field's declared option values (`select` and its kin), in declaration order. */
function optionValues(def: any): unknown[] {
  return (Array.isArray(def?.options) ? def.options : []).map((o: any) => (isPlainObject(o) ? o.value : o)).filter((v: unknown) => v != null);
}

/**
 * Collect the equality every row must satisfy for `filter` to select it, into
 * `held`. Understood: a field compared with a scalar (bare or `$eq`), an `$in`
 * list (its first member), a `$nin` list or a `$ne` on a field that declares
 * its options (the first declared option the condition does not exclude, so
 * no row is NULL there), `{current_user_id}` (the principal), and `$and` of
 * those. Anything else is a selection the ground truth cannot model, and the
 * reason is returned — never a guess.
 */
function holdColumns(
  filter: unknown,
  held: Map<string, unknown>,
  ctx: { fields: Record<string, any>; windowField: string; principal: string; object: string },
): string | undefined {
  if (filter == null) return undefined;
  if (!isPlainObject(filter)) return `a filter that is not an object (${clip(JSON.stringify(filter), 80)})`;
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$and') {
      if (!Array.isArray(cond)) return '`$and` that is not a list';
      for (const member of cond) {
        const reason = holdColumns(member, held, ctx);
        if (reason) return reason;
      }
      continue;
    }
    if (key.startsWith('$')) return `the operator ${key}`;
    if (key.includes('.')) return `the relationship path ${key}`;
    if (key === ctx.windowField) return `a condition on ${key}, the field the window lands on`;
    if (!(key in ctx.fields)) return `${key}, which is not a field of ${ctx.object}`;
    let value: unknown = cond;
    if (isPlainObject(cond)) {
      const ops = Object.keys(cond);
      const excluding = ops.length === 1 && ops[0] === '$nin' && Array.isArray(cond.$nin)
        ? cond.$nin
        : ops.length === 1 && ops[0] === '$ne' && cond.$ne !== null && typeof cond.$ne !== 'object' ? [cond.$ne] : undefined;
      if (ops.length === 1 && ops[0] === '$eq') value = cond.$eq;
      else if (ops.length === 1 && ops[0] === '$in' && Array.isArray(cond.$in) && cond.$in.length > 0) value = cond.$in[0];
      else if (excluding) {
        const options = optionValues(ctx.fields[key]);
        if (options.length === 0) return `the condition ${clip(JSON.stringify({ [key]: cond }), 100)} on ${key}, which declares no options to choose from`;
        value = options.find((o) => !excluding.some((x: unknown) => String(x) === String(o)));
        if (value === undefined) return `the condition ${clip(JSON.stringify({ [key]: cond }), 100)}, which excludes every option ${key} declares`;
      } else return `the condition ${clip(JSON.stringify({ [key]: cond }), 100)}`;
    }
    if (typeof value === 'string' && /^\$?\{.*\}$/.test(value)) {
      if (value !== CURRENT_USER_TOKEN && value !== `$${CURRENT_USER_TOKEN}`) return `the placeholder ${value} on ${key}`;
      value = ctx.principal;
    }
    if (value === null || !['string', 'number', 'boolean'].includes(typeof value)) {
      return `the value ${clip(JSON.stringify(value), 60)} on ${key}`;
    }
    if (held.has(key) && held.get(key) !== value) {
      return `${key} held to ${JSON.stringify(held.get(key))} and to ${JSON.stringify(value)}: no row satisfies both`;
    }
    held.set(key, value);
  }
  return undefined;
}

/** Does a value read back as the one written? (Read coercion answers in the declared type.) */
function sameValue(written: unknown, read: unknown): boolean {
  if (typeof written === 'boolean') return read === written || read === (written ? 1 : 0);
  if (typeof written === 'number') return Number(read) === written;
  return String(read) === String(written);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The calendar day `n` days after (`n < 0`: before) a `YYYY-MM-DD` day. */
function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** A `date` / `datetime` value moved `days` later, in the same spelling. */
function laterBy(value: string, days: number): string {
  const at = Date.parse(value);
  if (Number.isNaN(at) || days === 0) return value;
  const moved = new Date(at + days * DAY_MS).toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? moved.slice(0, 10) : moved;
}

/** The `k`-th distinct value of a sample `base`. */
function vary(base: string | number, k: number): string | number {
  if (typeof base === 'number') return base + k;
  if (/^\d{4}-\d{2}-\d{2}/.test(base)) return laterBy(base, k);
  const at = base.indexOf('@');
  if (at > 0) return `${base.slice(0, at)}-w${k}${base.slice(at)}`;
  if (/^https?:\/\//.test(base)) return `${base.replace(/\/$/, '')}/w${k}`;
  if (/^\+\d+$/.test(base)) return `${base}${k}`;
  return `${base}-w${k}`;
}

/** The fields of `objectDef` a uniqueness constraint covers: a declared field scope, or a unique index entry. */
function uniqueFields(objectDef: any): Set<string> {
  const out = new Set<string>();
  for (const [name, def] of Object.entries<any>(objectDef?.fields ?? {})) {
    if (def?.unique !== undefined && def?.unique !== false) out.add(name);
  }
  for (const index of Array.isArray(objectDef?.indexes) ? objectDef.indexes : []) {
    if (index?.unique) for (const f of Array.isArray(index.fields) ? index.fields : []) out.add(String(f));
  }
  return out;
}

/**
 * A record the CRUD derivation can offer: by default the smallest (the shape
 * the sibling families use) — its values for the fields the object REQUIRES,
 * so every optional field takes the app's own default; with `full`, every
 * field it synthesizes (what a rule that requires a field only in some state
 * asks for). Each `date` / `datetime` is one day after the one declared before
 * it, and each unique-constrained value is made distinct by `n`.
 */
function fixtureBody(body: Record<string, unknown>, objectDef: any, n: number, full = false): Record<string, unknown> {
  const unique = uniqueFields(objectDef);
  const out: Record<string, unknown> = {};
  let dates = 0;
  for (const [name, def] of Object.entries<any>(objectDef?.fields ?? {})) {
    if ((!full && def?.required !== true) || !(name in body)) continue;
    let value = body[name];
    if ((def?.type === 'date' || def?.type === 'datetime') && typeof value === 'string') value = laterBy(value, dates++);
    if (unique.has(name) && (typeof value === 'string' || typeof value === 'number')) value = vary(value, n);
    out[name] = value;
  }
  return out;
}

/** The days the fixtures are written on: each preset's first and last day and the day either side, never after today. */
function fixtureDays(presets: DashboardWindowPreset[], today: string): string[] {
  const days = new Set<string>([today]);
  for (const p of presets) {
    const start = p.resolved.$gte as string;
    const end = p.resolved.$lte as string | undefined;
    for (const d of [start, shiftDay(start, -1), ...(end ? [end, shiftDay(end, 1)] : [])]) {
      if (d <= today) days.add(d);
    }
  }
  return [...days].sort().reverse();
}

/** Is `day` inside a resolved window? The table's convention: first and last day inclusive (every preset names its last day). */
const selects = (resolved: Record<string, unknown>, day: string): boolean =>
  day >= String(resolved.$gte) && (resolved.$lte === undefined || day <= String(resolved.$lte));

/** Is window `a` nested inside window `b`? */
const nestedIn = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  String(a.$gte) >= String(b.$gte)
  && (b.$lte === undefined || (a.$lte !== undefined && String(a.$lte) <= String(b.$lte)));

// ── The verdict ─────────────────────────────────────────────────────────────

/**
 * Compare one windowed answer against the ground truth. The whole verdict of
 * the family is this function: it reads the expectation and the door's two
 * answers under the same window, and nothing else.
 */
function judge(
  expected: number,
  before: DashboardWindowAnswer,
  after: DashboardWindowAnswer,
): Pick<DashboardWindowPresetProbe, 'outcome' | 'answered' | 'shown' | 'detail'> {
  const failed = before.kind !== 'answered' ? before : after.kind !== 'answered' ? after : undefined;
  if (failed) {
    return { outcome: 'failed', detail: `the windowed query answered ${failed.status}${failed.code ? ` ${failed.code}` : ''}: ${failed.detail ?? ''}` };
  }
  const answered = after.count! - before.count!;
  const shown = after.count!;
  if (expected > 0 && (after.rows === 0 || shown === 0)) {
    return { outcome: 'blank', answered, shown, detail: `the widget showed nothing where the window selects ${expected} fixture row(s)` };
  }
  if (answered === expected) return { outcome: 'held', answered, shown };
  return {
    outcome: 'contradicted',
    answered,
    shown,
    detail: `the window counted ${answered} fixture row(s), and it selects ${expected} (${answered > expected ? 'wider' : 'narrower'})`,
  };
}

// ── The run ─────────────────────────────────────────────────────────────────

export interface DashboardWindowProofOptions {
  /** The reference instant the ground truth resolves on. Defaults to the start of the run. */
  now?: Date;
}

/**
 * Run the dashboard date-window family against a live stack, as the principal
 * `token` signs in: for every widget a `dateRange` binds, every count measure
 * it selects is asked through the dataset door with no window and under each
 * preset of `DATE_RANGE_PRESETS`, before and after fixture rows are written on
 * known days, and each difference is compared with the rows that window
 * selects. Returns a structured report; a per-widget failure is collected,
 * not thrown.
 */
export async function runDashboardWindowProofs(
  stack: VerifyStack,
  token: string,
  config: any,
  options: DashboardWindowProofOptions = {},
): Promise<DashboardWindowReport> {
  const { cases, dashboards } = derive(config);
  const crud = new Map<string, CrudCase>(deriveCrudCases(config).map((c) => [c.object, c]));
  const objectDefs = new Map<string, any>();
  for (const o of declaredCollection(config, 'objects')) if (o?.name) objectDefs.set(o.name, o);

  const caller = await stack.contextFor(token);
  const principal = String(caller.userId);
  const timezone: string | undefined = (caller as { timezone?: string }).timezone;
  const utc = timezone === undefined || timezone === 'UTC';
  const tokenCtx = (now: Date) => ({ now, timezone, userId: principal });

  const start = options.now ?? new Date();
  const presets: DashboardWindowPreset[] = DATE_RANGE_PRESETS.map((preset) => {
    const [from, to] = DATE_RANGE_PRESET_MACRO_WINDOWS[preset];
    const condition: Record<string, string> = { $gte: from, ...(to ? { $lte: to } : {}) };
    return { preset, condition, resolved: resolveFilterTokens(condition, tokenCtx(start)) as Record<string, unknown> };
  });
  const todayAt = (now: Date) => String(resolveFilterTokens('{today}', tokenCtx(now)));

  const registered = (object: string): Record<string, any> => {
    try {
      return ((stack.metadata.object(object) as any)?.fields ?? {}) as Record<string, any>;
    } catch {
      return {};
    }
  };

  // ── The door ──────────────────────────────────────────────────────────────
  async function ask(dataset: string, selection: Record<string, unknown>, measure: string): Promise<DashboardWindowAnswer> {
    try {
      const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query', { datasetName: dataset, selection });
      const body = (await res.json().catch(() => undefined)) as { rows?: unknown; code?: unknown; message?: unknown } | undefined;
      if (res.status === 200 && Array.isArray(body?.rows)) {
        const rows = body!.rows as Array<Record<string, unknown>>;
        return { kind: 'answered', status: 200, rows: rows.length, count: rows.reduce((s, r) => s + (Number(r?.[measure]) || 0), 0) };
      }
      return {
        kind: res.status >= 500 ? 'faulted' : 'refused',
        status: res.status,
        ...(typeof body?.code === 'string' ? { code: body.code } : {}),
        detail: clip(body?.message),
      };
    } catch (e) {
      return { kind: 'faulted', status: 0, detail: clip((e as Error)?.message ?? e) };
    }
  }

  // ── Base records for required relations, through the seed door ────────────
  let counter = 0;
  const bases = new Map<string, { id?: string; reason?: string }>();
  async function baseRecord(object: string): Promise<{ id?: string; reason?: string }> {
    const known = bases.get(object);
    if (known) return known;
    bases.set(object, { reason: `the base ${object} record is being created` });
    const c = crud.get(object);
    let made: { id?: string; reason?: string };
    if (!c || c.blocked) {
      made = { reason: c?.blocked ?? `object ${object} is not derived` };
    } else {
      const ids = new Map<string, string>();
      let reason: string | undefined;
      for (const ref of c.relationalRefs ?? []) {
        if (!ref.required) continue;
        const dep = await baseRecord(ref.target);
        if (!dep.id) {
          reason = `required relation ${ref.field} → ${ref.target}: ${dep.reason}`;
          break;
        }
        ids.set(ref.target, dep.id);
      }
      if (reason) {
        made = { reason };
      } else {
        const { body } = fillRelationalRefs(c, ids);
        try {
          const [written] = await stack.seed(object, [fixtureBody(body, objectDefs.get(object), ++counter)]);
          made = written?.id != null ? { id: String(written.id) } : { reason: `the seed of ${object} returned no id` };
        } catch (e) {
          made = { reason: `the seed of ${object} was refused: ${clip((e as Error)?.message, 160)}` };
        }
      }
    }
    bases.set(object, made);
    return made;
  }

  // ── Probes ────────────────────────────────────────────────────────────────
  const results: DashboardWindowWidgetResult[] = [];
  for (const c of cases) {
    const base: DashboardWindowWidgetResult = {
      dashboard: c.dashboard,
      widget: c.widget,
      ...(c.dataset ? { dataset: c.dataset } : {}),
      ...(c.object ? { object: c.object } : {}),
      ...(c.field ? { field: c.field } : {}),
      ...(c.binding ? { binding: c.binding } : {}),
      status: 'excluded',
      measures: [],
    };
    if (c.unbound) {
      results.push({ ...base, status: 'unbound', reason: 'the widget opts out of the window (filterBindings.dateRange: false)' });
      continue;
    }
    const measureResults: DashboardWindowMeasureResult[] = c.measures.map((m) => ({
      measure: m.measure,
      status: 'excluded' as const,
      ...(m.excluded ? { reason: m.excluded.reason, excludedKind: m.excluded.kind } : {}),
      presets: [],
    }));
    if (c.excluded) {
      results.push({ ...base, excludedKind: c.excluded.kind, reason: c.excluded.reason, measures: measureResults });
      continue;
    }

    const fields = registered(c.object!);
    const fieldType = fields[c.field!]?.type as string | undefined;
    if (!fieldType) {
      results.push({
        ...base,
        excludedKind: 'field-missing',
        reason: `the window lands on ${c.field}, which is not a field of ${c.object} as the stack registers it`,
        measures: measureResults,
      });
      continue;
    }
    base.fieldType = fieldType;
    if (!WINDOWABLE_TYPES.has(fieldType)) {
      results.push({
        ...base,
        excludedKind: 'field-type',
        reason: `the window lands on ${c.object}.${c.field}, a ${fieldType} field: only a date or datetime field is compared`,
        measures: measureResults,
      });
      continue;
    }

    const ownerColumn = 'owner_id' in fields;
    const holdCtx = { fields, windowField: c.field!, principal, object: c.object! };
    const objectHeld = new Map<string, unknown>();
    const objectReason = holdColumns(c.datasetFilter, objectHeld, holdCtx) ?? holdColumns(c.filter, objectHeld, holdCtx);
    if (objectReason) {
      results.push({
        ...base,
        excludedKind: 'filter-unmodelled',
        reason: `the widget's own selection carries ${objectReason}, which the ground truth cannot model`,
        measures: measureResults,
      });
      continue;
    }

    for (const [i, m] of c.measures.entries()) {
      const r = measureResults[i]!;
      if (m.excluded) continue;
      const held = new Map(objectHeld);
      const measureReason = holdColumns(m.filter, held, holdCtx);
      if (measureReason) {
        Object.assign(r, { reason: `the measure's own filter carries ${measureReason}, which the ground truth cannot model`, excludedKind: 'filter-unmodelled' });
        continue;
      }
      // A count of a field counts its non-null values: hold one.
      if (m.countField && !held.has(m.countField)) {
        const cc = crud.get(c.object!)!;
        const ref = (cc.relationalRefs ?? []).find((x) => x.field === m.countField);
        if (ref) {
          const dep = await baseRecord(ref.target);
          if (!dep.id) {
            Object.assign(r, { reason: `"${m.measure}" counts ${m.countField}, and no ${ref.target} record can be written for it: ${dep.reason}`, excludedKind: 'count-field-unsynthesizable' });
            continue;
          }
          held.set(m.countField, ref.multiple ? [dep.id] : dep.id);
        } else if (cc.body && m.countField in cc.body) {
          held.set(m.countField, cc.body[m.countField]);
        } else {
          Object.assign(r, { reason: `"${m.measure}" counts ${m.countField}, and the CRUD derivation synthesizes no value for it`, excludedKind: 'count-field-unsynthesizable' });
          continue;
        }
      }
      r.status = 'probed';
      delete r.reason;
      delete r.excludedKind;
      await probeMeasure(c, m, r, held, fieldType, ownerColumn);
    }

    const probed = measureResults.filter((m) => m.status === 'probed');
    if (probed.length === 0) {
      const first = measureResults.find((m) => m.excludedKind && m.excludedKind !== 'not-a-count' && m.excludedKind !== 'measure-undeclared');
      results.push({
        ...base,
        excludedKind: first?.excludedKind ?? 'no-count-measure',
        reason: first?.reason ?? 'no measure the widget selects is a row count',
        measures: measureResults,
      });
      continue;
    }
    results.push({ ...base, ...widgetStatus(probed), measures: measureResults });
  }

  async function probeMeasure(
    c: DashboardWindowCase,
    m: DashboardWindowMeasureCase,
    r: DashboardWindowMeasureResult,
    held: Map<string, unknown>,
    fieldType: string,
    ownerColumn: boolean,
  ): Promise<void> {
    const selection = (window?: Record<string, string>): Record<string, unknown> => {
      const windowed = window ? { [c.field!]: window } : undefined;
      const runtimeFilter = c.filter && windowed ? { $and: [c.filter, windowed] } : (windowed ?? c.filter);
      return {
        ...(c.dimensions.length > 0 ? { dimensions: c.dimensions } : {}),
        measures: [m.measure],
        ...(runtimeFilter ? { runtimeFilter } : {}),
      };
    };
    const notRun = (detail: string) => {
      r.presets = presets.map((p) => ({ preset: p.preset, expected: 0, outcome: 'not-run' as const, detail }));
    };

    if (!utc) {
      notRun(`the principal's reference timezone is ${timezone}: the fixtures are stamped on UTC calendar days, so the family judges a window resolved on UTC days only`);
      return;
    }

    // The control leg, before any fixture: the widget's own query must answer.
    const before0 = await ask(c.dataset!, selection(), m.measure);
    if (before0.kind !== 'answered') {
      r.unwindowed = { expected: 0, answer: before0 };
      notRun(`the widget's own query, with no window, answered ${before0.status}${before0.code ? ` ${before0.code}` : ''}: ${before0.detail ?? ''}`);
      return;
    }
    const day0 = todayAt(new Date());
    const before = new Map<DateRangePreset, DashboardWindowAnswer>();
    for (const p of presets) before.set(p.preset, await ask(c.dataset!, selection(p.condition), m.measure));

    // Fixtures: one row per day, every held column held, owned by the principal.
    const cc = crud.get(c.object!)!;
    const ids = new Map<string, string>();
    for (const ref of cc.relationalRefs ?? []) {
      if (!ref.required || held.has(ref.field)) continue;
      const dep = await baseRecord(ref.target);
      if (!dep.id) {
        notRun(`required relation ${ref.field} → ${ref.target}: ${dep.reason}`);
        return;
      }
      ids.set(ref.target, dep.id);
    }
    const refs = (cc.relationalRefs ?? []).filter((x) => !held.has(x.field));
    const { body } = fillRelationalRefs({ ...cc, relationalRefs: refs }, ids);
    const days = fixtureDays(presets, day0);
    const stamp = (day: string) => (fieldType === 'date' ? day : `${day}T12:00:00.000Z`);
    const written: Array<{ day: string; id: string }> = [];
    // The smallest record first; if the seed door refuses it (an app rule that
    // requires a field in the state the held columns put the row in), every
    // field the CRUD derivation synthesizes, and that shape for the rest.
    let full = false;
    for (const day of days) {
      const row = (wide: boolean): Record<string, unknown> => ({
        ...fixtureBody(body, objectDefs.get(c.object!), ++counter, wide),
        ...(ownerColumn ? { owner_id: principal } : {}),
        ...Object.fromEntries(held),
        [c.field!]: stamp(day),
      });
      const seedOne = async (wide: boolean): Promise<string> => {
        const [made] = await stack.seed(c.object!, [row(wide)]);
        if (made?.id == null) throw new Error(`the seed of ${c.object} returned no id`);
        return String(made.id);
      };
      try {
        let id: string;
        try {
          id = await seedOne(full);
        } catch (first) {
          if (full || written.length > 0) throw first;
          full = true;
          id = await seedOne(true);
        }
        written.push({ day, id });
      } catch (e) {
        r.days = days;
        notRun(`the fixture row for ${day} was refused by the seed door: ${clip((e as Error)?.message, 160)}`);
        return;
      }
    }
    r.days = days;
    r.fixture = full ? 'every-field' : 'smallest';
    // Read back: the stamp and every held column must read as written.
    for (const { day, id } of written) {
      const [got] = await stack.rows(c.object!, { id });
      const stamped = got?.[c.field!];
      const stampHolds = fieldType === 'date'
        ? String(stamped ?? '').slice(0, 10) === day
        : Date.parse(String(stamped)) === Date.parse(stamp(day));
      const drifted = [...held].find(([k, v]) => !Array.isArray(v) && !sameValue(v, got?.[k]));
      const misread = (field: string, value: unknown, wrote: unknown): string =>
        value === undefined
          ? `the fixture row for ${day} reads back no ${field} (the read does not return that field), so what was written there cannot be confirmed`
          : `the fixture row for ${day} reads back ${field} = ${clip(JSON.stringify(value), 60)}, not ${typeof wrote === 'string' ? wrote : JSON.stringify(wrote)}: something rewrote it on write`;
      if (!got || !stampHolds || drifted) {
        notRun(
          !got
            ? `the fixture row for ${day} does not read back`
            : !stampHolds
              ? misread(c.field!, stamped, stamp(day))
              : misread(drifted![0], got[drifted![0]], drifted![1]),
        );
        return;
      }
    }

    const after0 = await ask(c.dataset!, selection(), m.measure);
    const after = new Map<DateRangePreset, DashboardWindowAnswer>();
    for (const p of presets) after.set(p.preset, await ask(c.dataset!, selection(p.condition), m.measure));
    if (todayAt(new Date()) !== day0) {
      notRun(`the day turned during the probe (${day0} → ${todayAt(new Date())}), so the windows the server resolved moved under the fixtures`);
      return;
    }

    // The control leg: with no window, the widget counts every fixture row.
    const unwindowedAnswered = after0.kind === 'answered' ? after0.count! - before0.count! : undefined;
    r.unwindowed = { expected: written.length, ...(unwindowedAnswered !== undefined ? { answered: unwindowedAnswered } : {}), answer: after0 };
    if (unwindowedAnswered !== written.length) {
      notRun(
        after0.kind !== 'answered'
          ? `the widget's own query, with no window, answered ${after0.status} once the fixtures were written: ${after0.detail ?? ''}`
          : `with no window the widget counts ${unwindowedAnswered} of the ${written.length} fixture rows, so the fixtures do not meet its own selection and no window can be judged`,
      );
      return;
    }

    r.presets = presets.map((p) => {
      const expected = written.filter((w) => selects(p.resolved, w.day)).length;
      const b = before.get(p.preset)!;
      const a = after.get(p.preset)!;
      return { preset: p.preset, expected, ...judge(expected, b, a), answer: a };
    });

    // An inert window: every preset answered what no window answered.
    r.inert = r.presets.every((p) => p.answered === unwindowedAnswered);
    r.narrowing = [];
    for (const a of presets) {
      for (const b of presets) {
        if (a === b || !nestedIn(a.resolved, b.resolved)) continue;
        const pa = r.presets.find((x) => x.preset === a.preset)!;
        const pb = r.presets.find((x) => x.preset === b.preset)!;
        if (pa.answered !== undefined && pb.answered !== undefined && pa.answered > pb.answered) {
          r.narrowing.push(`${a.preset} ⊂ ${b.preset}: ${pa.answered} > ${pb.answered}`);
        }
      }
    }
  }

  // ── The report ────────────────────────────────────────────────────────────
  const widgetsBy = (s: DashboardWindowWidgetStatus) => results.filter((r) => r.status === s).length;
  const tally = (kinds: Array<DashboardWindowExclusion | undefined>) => {
    const out: Partial<Record<DashboardWindowExclusion, number>> = {};
    for (const k of kinds) if (k) out[k] = (out[k] ?? 0) + 1;
    return out;
  };
  const probedMeasures = results.flatMap((r) => r.measures.filter((m) => m.status === 'probed'));
  const excludedMeasures = results.filter((r) => r.status !== 'excluded' && r.status !== 'unbound')
    .flatMap((r) => r.measures.filter((m) => m.status === 'excluded'));
  const probes = probedMeasures.flatMap((m) => m.presets);
  return {
    app: config?.manifest?.id ?? config?.manifest?.namespace ?? 'app',
    door: 'rest',
    timezone: timezone ?? 'UTC',
    presets,
    dashboards,
    results,
    summary: {
      dashboards: {
        declared: dashboards.length,
        windowed: dashboards.filter((d) => d.status === 'windowed').length,
        notWindowed: dashboards.filter((d) => d.status === 'not-windowed').length,
        excluded: dashboards.filter((d) => d.status === 'excluded').length,
      },
      widgets: {
        total: results.length,
        unbound: widgetsBy('unbound'),
        excluded: widgetsBy('excluded'),
        probed: results.length - widgetsBy('unbound') - widgetsBy('excluded'),
        proven: widgetsBy('proven'),
        contradicted: widgetsBy('contradicted'),
        failed: widgetsBy('failed'),
        inconclusive: widgetsBy('inconclusive'),
      },
      excludedBy: tally(results.filter((r) => r.status === 'excluded').map((r) => r.excludedKind)),
      measures: { probed: probedMeasures.length, excluded: excludedMeasures.length, excludedBy: tally(excludedMeasures.map((m) => m.excludedKind)) },
      probes: probes.length,
      held: probes.filter((p) => p.outcome === 'held').length,
      blank: probes.filter((p) => p.outcome === 'blank').length,
      contradictions: probes.filter((p) => p.outcome === 'contradicted').length,
      faults: probes.filter((p) => p.outcome === 'failed').length,
      notRun: probes.filter((p) => p.outcome === 'not-run').length,
      inert: probedMeasures.filter((m) => m.inert).length,
      narrowing: probedMeasures.reduce((s, m) => s + (m.narrowing?.length ?? 0), 0),
      hardFailures: widgetsBy('contradicted') + widgetsBy('failed'),
    },
  };
}

function widgetStatus(measures: DashboardWindowMeasureResult[]): { status: DashboardWindowWidgetStatus; reason?: string } {
  const probes = measures.flatMap((m) => m.presets);
  const first = (o: DashboardWindowPresetProbe['outcome']) => probes.find((p) => p.outcome === o);
  const bad = first('blank') ?? first('contradicted');
  if (bad) return { status: 'contradicted', reason: `${bad.preset}: ${bad.detail ?? ''}` };
  const failed = first('failed');
  if (failed) return { status: 'failed', reason: `${failed.preset}: ${failed.detail ?? ''}` };
  const notRun = first('not-run');
  if (notRun || probes.length === 0) return { status: 'inconclusive', reason: notRun?.detail ?? 'no preset was probed' };
  return { status: 'proven' };
}

/** Pretty one-line-per-widget summary for logs. */
export function formatDashboardWindowReport(report: DashboardWindowReport): string {
  const lines: string[] = [`\n=== objectstack verify — dashboard date windows — ${report.app} ===`];
  lines.push(
    `  door: POST /analytics/dataset/query as the signed-in principal; ${report.presets.length} preset(s) per count measure, ` +
      `each window resolved on ${report.timezone} calendar days`,
  );
  for (const d of report.dashboards.filter((x) => x.status === 'excluded')) {
    lines.push(`  – dashboard ${d.name} excluded: ${d.reason ?? ''}`);
  }
  for (const r of report.results) {
    const at = `${r.dashboard}/${r.widget}${r.field ? ` (${r.object ?? '?'}.${r.field}${r.fieldType ? `, ${r.fieldType}` : ''})` : ''}`;
    const probed = r.measures.filter((m) => m.status === 'probed');
    if (r.status === 'proven') {
      lines.push(`  ✓ ${at}  held under ${probed.reduce((s, m) => s + m.presets.length, 0)} window(s) on ${probed.map((m) => m.measure).join(', ')}`);
    } else if (r.status === 'contradicted' || r.status === 'failed') {
      lines.push(`  ✗ ${at}  ${r.status === 'contradicted' ? 'CONTRADICTED' : 'FAILED'}:`);
      for (const m of probed) {
        const bad = m.presets.filter((p) => p.outcome === 'blank' || p.outcome === 'contradicted' || p.outcome === 'failed');
        for (const p of bad.slice(0, 13)) lines.push(`      ${m.measure} @ ${p.preset}: ${p.outcome} — ${clip(p.detail, 200)}`);
        if (m.inert) lines.push(`      ${m.measure}: the window is INERT — every preset answered what no window answered`);
        for (const n of (m.narrowing ?? []).slice(0, 6)) lines.push(`      ${m.measure}: a narrower preset answered more — ${n}`);
      }
    } else if (r.status === 'inconclusive') {
      lines.push(`  ~ ${at}  inconclusive: ${clip(r.reason, 220)}`);
    } else {
      lines.push(`  – ${at}  ${r.status}${r.excludedKind ? ` (${r.excludedKind})` : ''}: ${clip(r.reason, 220)}`);
    }
  }
  const s = report.summary;
  lines.push(
    `  ── ${s.widgets.proven} proven, ${s.widgets.contradicted} CONTRADICTED, ${s.widgets.failed} FAILED, ` +
      `${s.widgets.inconclusive} inconclusive, ${s.widgets.unbound} unbound, ${s.widgets.excluded} excluded ` +
      `(${s.dashboards.windowed} windowed dashboard(s) of ${s.dashboards.declared}; ${s.measures.probed} count measure(s) probed, ` +
      `${s.measures.excluded} excluded; ${s.probes} window(s): ${s.held} held, ${s.blank} blank, ${s.contradictions} contradicted, ` +
      `${s.faults} faulted, ${s.notRun} not run; ${s.inert} inert, ${s.narrowing} narrowing violation(s))`,
  );
  return lines.join('\n');
}
