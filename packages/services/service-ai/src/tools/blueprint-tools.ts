// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IAIService, IMetadataService, ModelMessage } from '@objectstack/spec/contracts';
import { SolutionBlueprintSchema, SolutionBlueprintStrictSchema, type SolutionBlueprint } from '@objectstack/spec/ai';
import { stageDraft, type DraftCapableProtocol } from './metadata-tools.js';
import type { ToolHandler, ToolRegistry } from './tool-registry.js';
import { proposeBlueprintTool } from './propose-blueprint.tool.js';
import { applyBlueprintTool } from './apply-blueprint.tool.js';

export { proposeBlueprintTool } from './propose-blueprint.tool.js';
export { applyBlueprintTool } from './apply-blueprint.tool.js';

/**
 * Recursively drop object keys whose value is `null`. The OpenAI-strict output
 * contract ({@link SolutionBlueprintStrictSchema}) requires every key present
 * and emits `null` for "empty" optional fields; stripping those nulls makes the
 * result conform to the lenient {@link SolutionBlueprintSchema} (which uses
 * `.optional()` — absent, not null) so every downstream consumer is unchanged.
 */
function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripNulls(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out as T;
  }
  return value;
}

/** All blueprint (plan-first) tool definitions. */
export const BLUEPRINT_TOOL_DEFINITIONS = [proposeBlueprintTool, applyBlueprintTool];

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * The narrow slice of the runtime `package` service the blueprint tools use to
 * give an app a home (see {@link ensureAppPackage}). A subset of the service
 * registered at `ctx.registerService('package', …)` in `@objectstack/service-package`.
 */
export interface BlueprintPackageService {
  /** Look up a package by id (latest version); null/undefined when absent. */
  get(packageId: string): Promise<{ manifest?: { name?: string } } | null | undefined>;
  /** Insert/publish a package record (writable, source:'database'). */
  publish(data: { manifest: Record<string, unknown>; metadata?: Record<string, unknown> }):
    Promise<{ success?: boolean; error?: string } | undefined>;
}

/**
 * Services the plan-first blueprint tools need (ADR-0033 §4).
 *
 * - {@link IAIService} drives `generateObject` for the structured blueprint.
 * - `protocol` is the draft-capable write path reused from the metadata tools
 *   ({@link stageDraft}) — every artifact is staged, never published.
 * - {@link IMetadataService} is a fallback enumerator for existing objects.
 * - `packageService` (optional) lets a blueprint's app auto-create a writable
 *   "app package" home so the user never has to make one (zero-package UX).
 */
export interface BlueprintToolContext {
  ai: IAIService;
  protocol?: DraftCapableProtocol;
  metadataService: IMetadataService;
  packageService?: BlueprintPackageService;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Best-effort list of existing object names, so the agent doesn't redesign
 *  what already exists. Mirrors `list_metadata`'s protocol-first enumeration. */
async function listExistingObjectNames(ctx: BlueprintToolContext): Promise<string[]> {
  try {
    if (ctx.protocol?.getMetaItems) {
      const res = await ctx.protocol.getMetaItems({ type: 'object' });
      const arr = Array.isArray(res)
        ? res
        : res && typeof res === 'object' && Array.isArray((res as { items?: unknown[] }).items)
          ? (res as { items: unknown[] }).items
          : [];
      return (arr as Array<{ name?: string }>).map((o) => o?.name).filter((n): n is string => !!n);
    }
  } catch {
    /* fall through to metadata service */
  }
  try {
    const objs = (await ctx.metadataService.listObjects()) as Array<{ name?: string }>;
    return objs.map((o) => o?.name).filter((n): n is string => !!n);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// propose_blueprint — structured design, NOTHING persisted
// ---------------------------------------------------------------------------

function createProposeBlueprintHandler(ctx: BlueprintToolContext): ToolHandler {
  return async (args) => {
    const { goal, context } = args as { goal?: string; context?: string };
    if (!goal || typeof goal !== 'string') {
      return JSON.stringify({ error: 'propose_blueprint: "goal" is required' });
    }
    if (!ctx.ai.generateObject) {
      return JSON.stringify({
        error:
          'propose_blueprint requires structured-output support. Configure a ' +
          'Vercel-AI-SDK-backed adapter (OpenAI, Anthropic, Google).',
      });
    }

    const existing = await listExistingObjectNames(ctx);
    const existingNote = existing.length
      ? `Objects that ALREADY exist (do not recreate these; reference them in lookups): ${existing.join(', ')}.`
      : 'There are no existing objects yet.';

    const messages: ModelMessage[] = [
      {
        role: 'system',
        content:
          'You are a metadata architect. Turn the user\'s high-level goal into a concrete, ' +
          'minimal-but-complete solution blueprint: the objects (tables) and their fields, the ' +
          'relationships (expressed as lookup/master_detail fields with a `reference` to the target ' +
          'object), a few useful list views, and optionally a dashboard.\n\n' +
          'Rules:\n' +
          '- Use snake_case for every object, field, and view name.\n' +
          '- Prefer a small, sensible field set per object over an exhaustive one.\n' +
          '- State the design choices you made as `assumptions`.\n' +
          '- If (and only if) a genuinely structure-deciding choice is unclear, put at most 1-2 ' +
          'short `questions`; otherwise pick the most likely interpretation and proceed.\n' +
          '- Do NOT invent field types — use the allowed enum values.\n' +
          '- Include an `app` (navigation shell) that surfaces the created objects (and any ' +
          'dashboards) so the user can actually open the solution: give it a snake_case `name`, a ' +
          'friendly `label`, and a Lucide `icon`. Keep it to a single app with a flat list of nav ' +
          'entries (you may omit `nav` to auto-surface every object and dashboard).\n' +
          `- ${existingNote}\n` +
          'This is a PROPOSAL. Nothing is built from it until the human approves.',
      },
      {
        role: 'user',
        content: context ? `${goal}\n\nAdditional context: ${context}` : goal,
      },
    ];

    let blueprint: SolutionBlueprint;
    try {
      // Use the OpenAI-strict-compatible mirror as the output contract (the
      // lenient SolutionBlueprintSchema's optional fields make OpenAI strict
      // structured outputs reject the schema). Strip the nulls it emits so the
      // result conforms to the lenient schema everything else consumes.
      const generated = await ctx.ai.generateObject(messages, SolutionBlueprintStrictSchema, {
        schemaName: 'SolutionBlueprint',
        schemaDescription:
          'A proposed solution: objects + fields + relationships + views + dashboards + an app (navigation shell), with stated assumptions. Use null for fields that do not apply.',
      });
      blueprint = stripNulls(generated.object) as SolutionBlueprint;
    } catch (err) {
      return JSON.stringify({
        error: `Failed to design blueprint: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    return JSON.stringify({
      status: 'blueprint_proposed',
      blueprint,
      summary: blueprint.summary,
      counts: {
        objects: blueprint.objects?.length ?? 0,
        views: blueprint.views?.length ?? 0,
        dashboards: blueprint.dashboards?.length ?? 0,
        app: blueprint.app ? 1 : 0,
        seedData: blueprint.seedData?.length ?? 0,
      },
      questions: blueprint.questions ?? [],
      note: 'Nothing has been created. Present this to the user; only call apply_blueprint after they approve.',
    });
  };
}

// ---------------------------------------------------------------------------
// apply_blueprint — batch-draft every artifact (per-item, partial-tolerant)
// ---------------------------------------------------------------------------

/** Convert a blueprint object into an `object` metadata body. */
function objectBody(o: SolutionBlueprint['objects'][number]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const f of o.fields ?? []) {
    fields[f.name] = {
      type: f.type,
      ...(f.label ? { label: f.label } : {}),
      ...(f.required !== undefined ? { required: f.required } : {}),
      ...(f.reference ? { reference: f.reference } : {}),
      ...(f.options ? { options: f.options } : {}),
    };
  }
  return {
    name: o.name,
    ...(o.label ? { label: o.label } : {}),
    ...(o.description ? { description: o.description } : {}),
    fields,
  };
}

/** Map a blueprint view's kind to a ListView `type`. */
const LIST_TYPE: Record<string, string> = { list: 'grid', kanban: 'kanban', calendar: 'calendar' };

/**
 * Convert a blueprint view into a `view` metadata RECORD (ADR-0005 view item).
 *
 * Emits the canonical single-view shape the console binds + renders:
 *   `{ object, viewKind: 'list'|'form', config: <ListView|FormView> }`
 * NOT the bare `{ list: … }` container fragment — without the top-level
 * `object` (and the `<object>.<key>` record name set by {@link viewName}) the
 * console can't associate the view with its object, so it never surfaces as a
 * tab and a kanban silently falls back to the default grid.
 */
function viewBody(
  v: NonNullable<SolutionBlueprint['views']>[number],
  columnsByObject: Map<string, string[]>,
  groupFieldByObject?: Map<string, string>,
): Record<string, unknown> {
  const cols = v.columns?.length ? v.columns : columnsByObject.get(v.object) ?? ['name'];
  const data = { provider: 'object', object: v.object };
  // The body MUST carry a top-level `name` (the `<object>.<key>` record name):
  // getMetaItems only surfaces overlay rows whose body has `name`, so a view
  // without it is silently dropped from the object's view list (never a tab).
  const name = viewName(v);
  if (v.type === 'form') {
    return {
      name,
      object: v.object,
      viewKind: 'form',
      config: {
        type: 'simple',
        data,
        sections: [{ fields: cols.map((field) => ({ field })) }],
        ...(v.label ? { label: v.label } : {}),
      },
      ...(v.label ? { label: v.label } : {}),
    };
  }
  const config: Record<string, unknown> = {
    type: LIST_TYPE[v.type] ?? 'grid',
    data,
    columns: cols,
    ...(v.label ? { label: v.label } : {}),
  };
  // A kanban board needs a group-by field to form its columns; without it the
  // renderer falls back to a flat grid. Prefer the blueprint's explicit
  // `groupBy`, else infer the object's first select/status field.
  if (v.type === 'kanban') {
    const groupByField = v.groupBy || groupFieldByObject?.get(v.object);
    // KanbanConfig requires both the group-by field and the card columns.
    if (groupByField) config.kanban = { groupByField, columns: cols };
  }
  return {
    name,
    object: v.object,
    viewKind: 'list',
    config,
    ...(v.label ? { label: v.label } : {}),
  };
}

/**
 * Canonical view record name: `<object>.<key>` (e.g. `delivery_task.task_kanban`).
 * The console keys an object's view tabs off this `<object>.` prefix, so a bare
 * view name never appears as a selectable view on the object page.
 */
function viewName(v: NonNullable<SolutionBlueprint['views']>[number]): string {
  return v.name.startsWith(`${v.object}.`) ? v.name : `${v.object}.${v.name}`;
}

/** Convert a blueprint dashboard into a `dashboard` metadata body. */
function dashboardBody(d: NonNullable<SolutionBlueprint['dashboards']>[number]): Record<string, unknown> {
  return {
    name: d.name,
    label: d.label ?? d.name,
    widgets: (d.widgets ?? []).map((w) => ({
      id: w.id,
      ...(w.title ? { title: w.title } : {}),
      ...(w.object ? { object: w.object } : {}),
      ...(w.chart ? { chart: w.chart } : {}),
    })),
  };
}

/**
 * Convert the blueprint's app into an `app` metadata body — the navigation
 * shell end users open in the App Launcher. When the blueprint gives no
 * explicit `nav`, auto-surface every created object (then every dashboard) as a
 * top-level nav entry. Never sets `isDefault` (don't hijack the default app).
 */
function appBody(
  app: NonNullable<SolutionBlueprint['app']>,
  blueprint: SolutionBlueprint,
): Record<string, unknown> {
  const navSource: Array<{ type: 'object' | 'dashboard'; target: string; label?: string; icon?: string }> =
    app.nav && app.nav.length > 0
      ? app.nav
      : [
          ...(blueprint.objects ?? []).map((o) => ({ type: 'object' as const, target: o.name, label: o.label })),
          ...(blueprint.dashboards ?? []).map((d) => ({ type: 'dashboard' as const, target: d.name, label: d.label })),
        ];
  const navigation = navSource.map((n, i) => {
    const base = {
      id: `nav_${n.target}`,
      label: n.label ?? n.target,
      ...(n.icon ? { icon: n.icon } : {}),
      order: i,
    };
    return n.type === 'dashboard'
      ? { ...base, type: 'dashboard', dashboardName: n.target }
      : { ...base, type: 'object', objectName: n.target };
  });
  return {
    name: app.name,
    label: app.label ?? app.name,
    ...(app.icon ? { icon: app.icon } : {}),
    navigation,
  };
}

/**
 * Give a blueprint's app a writable "home" package so the user never has to
 * create one (mainstream AI builders — Power Apps' default solution, Salesforce
 * orgs — never make a business user make a package to start building). Idempotent:
 * one app ⇒ one `app.<name>` package. Returns the package descriptor, or `null`
 * to fall back to today's package-less drafting (no package service wired, or
 * publish failed) — never throws, never blocks the build.
 *
 * NOTE: this stamps the *legacy* `sys_metadata.package_id` (a real grouping that
 * shows in Studio's package selector and is the foundation for later
 * version/export/promote). Full cross-environment promotion still needs the
 * sealed `sys_package_version` model from ADR-0027, which is separate.
 */
async function ensureAppPackage(
  protocol: DraftCapableProtocol | undefined,
  pkgSvc: BlueprintPackageService | undefined,
  app: { name: string; label?: string; icon?: string },
): Promise<{ id: string; name: string; created: boolean } | null> {
  const id = `app.${app.name}`;
  const name = app.label ?? app.name;
  const manifest: Record<string, unknown> = {
    id,
    name,
    version: '1.0.0',
    type: 'application',
    namespace: app.name,
    // Must NOT be 'system'/'cloud' — Studio's package selector filters those
    // out (studio.app.ts optionsSource). 'environment' keeps it visible.
    scope: 'environment',
    ...(app.icon ? { icon: app.icon } : {}),
  };
  try {
    // Idempotency: reuse an existing package when we can look one up.
    if (pkgSvc?.get) {
      const existing = await pkgSvc.get(id);
      if (existing) return { id, name: existing.manifest?.name ?? name, created: false };
    }
    // Preferred write path: the canonical `protocol.installPackage` primitive
    // lands the package in BOTH the in-memory registry (Studio's selector reads
    // this) and the durable `sys_packages` table — so the app package actually
    // surfaces in Studio (ADR-0033 consolidation).
    if (protocol?.installPackage) {
      await protocol.installPackage({ manifest });
      return { id, name, created: true };
    }
    // Fallback (older/remote protocol): the `package` service writes only
    // `sys_packages`. Preserves prior behaviour when the primitive is absent.
    if (pkgSvc?.publish) {
      const res = await pkgSvc.publish({ manifest, metadata: { createdBy: 'ai', source: 'database' } });
      if (res && res.success === false) return null; // degrade to package-less
      return { id, name, created: true };
    }
    return null; // no write path available → package-less
  } catch {
    return null; // never block the build on packaging
  }
}

function createApplyBlueprintHandler(ctx: BlueprintToolContext): ToolHandler {
  return async (args, exec) => {
    const raw = (args as { blueprint?: unknown }).blueprint;
    if (raw === undefined || raw === null) {
      return JSON.stringify({ error: 'apply_blueprint: "blueprint" is required' });
    }

    // Defensive: the model re-emits the (possibly edited) blueprint — validate
    // it before fanning out so a malformed plan fails fast with fixable issues.
    // Strip any nulls first: the strict output contract emits `null` for empty
    // optional fields, and the model may carry those through to this call; the
    // lenient schema expects them absent.
    const parsed = SolutionBlueprintSchema.safeParse(stripNulls(raw));
    if (!parsed.success) {
      return JSON.stringify({
        error: 'Blueprint failed validation — fix and resend.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
      });
    }
    const blueprint = parsed.data;
    const actor = exec?.actor?.id;

    // Zero-package UX: if the blueprint has an app, ensure a writable home
    // package up front and bind every drafted artifact to it. Best-effort —
    // `null` (no package service / publish failed) falls back to package-less.
    const appPackage = blueprint.app ? await ensureAppPackage(ctx.protocol, ctx.packageService, blueprint.app) : null;
    const packageId = appPackage?.id;

    const drafted: Array<{ type: string; name: string }> = [];
    const failed: Array<{ type: string; name: string; error: string; code?: string }> = [];

    const record = async (type: string, name: string, item: unknown) => {
      const res = await stageDraft(ctx.protocol, { type, name, item, actor, packageId });
      if (res.ok) drafted.push({ type, name });
      else failed.push({ type, name, error: res.error ?? 'unknown error', ...(res.code ? { code: res.code } : {}) });
    };

    // Objects first (views/dashboards reference them).
    const columnsByObject = new Map<string, string[]>();
    const groupFieldByObject = new Map<string, string>();
    for (const o of blueprint.objects ?? []) {
      columnsByObject.set(o.name, (o.fields ?? []).map((f) => f.name));
      // Remember the first select field — the natural kanban group-by column.
      const sel = (o.fields ?? []).find((f) => f.type === 'select');
      if (sel) groupFieldByObject.set(o.name, sel.name);
      await record('object', o.name, objectBody(o));
    }
    for (const v of blueprint.views ?? []) {
      await record('view', viewName(v), viewBody(v, columnsByObject, groupFieldByObject));
    }
    for (const d of blueprint.dashboards ?? []) {
      await record('dashboard', d.name, dashboardBody(d));
    }
    // The app (navigation shell) is drafted last — it references everything above.
    if (blueprint.app) {
      await record('app', blueprint.app.name, appBody(blueprint.app, blueprint));
    }

    const seedDataProposed = (blueprint.seedData ?? []).map((s) => ({
      object: s.object,
      rows: s.records.length,
    }));

    const summaryParts = [`drafted ${drafted.length} artifact(s)`];
    if (failed.length) summaryParts.push(`${failed.length} failed`);
    if (appPackage) summaryParts.push(`grouped under app package "${appPackage.name}"`);
    if (seedDataProposed.length) summaryParts.push(`${seedDataProposed.length} seed set(s) proposed (not applied)`);

    return JSON.stringify({
      status: failed.length && !drafted.length ? 'failed' : 'drafted',
      drafted,
      failed,
      // The app's artifacts were auto-homed in a writable package (zero user
      // package steps); informational only — no action required.
      ...(appPackage ? { package: appPackage } : {}),
      // Phase C does not auto-apply seed data — no runtime-draftable `dataset`
      // type exists; surface it so a human can wire it deliberately.
      seedDataProposed,
      summary:
        `${summaryParts.join(', ')}. Review the drafted items in the designer and publish to make them live.` +
        (seedDataProposed.length ? ' Seed data is suggested only — load it separately.' : ''),
    });
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the plan-first blueprint tools (`propose_blueprint`, `apply_blueprint`). */
export function registerBlueprintTools(registry: ToolRegistry, context: BlueprintToolContext): void {
  registry.register(proposeBlueprintTool, createProposeBlueprintHandler(context));
  registry.register(applyBlueprintTool, createApplyBlueprintHandler(context));
}
