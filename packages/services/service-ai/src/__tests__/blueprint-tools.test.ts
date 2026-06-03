// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SolutionBlueprintStrictSchema, type SolutionBlueprint } from '@objectstack/spec/ai';
import { ToolRegistry } from '../tools/tool-registry.js';
import {
  registerBlueprintTools,
  BLUEPRINT_TOOL_DEFINITIONS,
  type BlueprintToolContext,
} from '../tools/blueprint-tools.js';

// ── Helpers ────────────────────────────────────────────────────────

const SAMPLE_BLUEPRINT: SolutionBlueprint = {
  summary: 'A project tracker',
  assumptions: ['Projects own many tasks'],
  objects: [
    { name: 'project', label: 'Project', fields: [{ name: 'name', type: 'text', required: true }] },
    {
      name: 'task', label: 'Task',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'project_id', type: 'lookup', reference: 'project' },
      ],
    },
  ],
  views: [{ object: 'task', name: 'open_tasks', label: 'Open Tasks', type: 'list', columns: ['title'] }],
  seedData: [{ object: 'project', records: [{ name: 'Apollo' }, { name: 'Gemini' }] }],
};

/** Mock protocol with a draft store + saveMetaItem honoring mode:'draft'. */
function createMockProtocol(existingObjects: string[] = []) {
  const drafts = new Map<string, unknown>();
  const saveMetaItem = vi.fn(async (req: any) => {
    if (req.mode === 'draft') drafts.set(`${req.type}:${req.name}`, req.item);
    return { success: true };
  });
  const getMetaItems = vi.fn(async (_req: any) =>
    existingObjects.map((name) => ({ name, label: name })),
  );
  const getMetaItem = vi.fn(async () => ({ item: undefined }));
  const protocol = { getMetaItems, getMetaItem, saveMetaItem } as NonNullable<BlueprintToolContext['protocol']>;
  return { protocol, drafts, saveMetaItem, getMetaItems };
}

function createMockMetadataService() {
  return {
    register: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
    getObject: vi.fn(async () => undefined),
    listObjects: vi.fn(async () => []),
  } as any;
}

/** Mock AI service whose generateObject returns a fixed blueprint. */
function createMockAi(blueprint: SolutionBlueprint = SAMPLE_BLUEPRINT) {
  const generateObject = vi.fn(async () => ({ object: blueprint, model: 'mock', usage: undefined }));
  return { ai: { generateObject } as any, generateObject };
}

function parse(result: any): any {
  return JSON.parse((result.output as any).value);
}

const call = (toolName: string, input: Record<string, unknown>, id = 't') => ({
  type: 'tool-call' as const,
  toolCallId: id,
  toolName,
  input,
});

// ═══════════════════════════════════════════════════════════════════
// Definitions & registration
// ═══════════════════════════════════════════════════════════════════

describe('Blueprint tool definitions', () => {
  it('defines exactly propose_blueprint + apply_blueprint', () => {
    expect(BLUEPRINT_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(['propose_blueprint', 'apply_blueprint']);
  });

  it('registers both tools separately (so the model must take two turns)', () => {
    const registry = new ToolRegistry();
    registerBlueprintTools(registry, {
      ai: createMockAi().ai,
      protocol: createMockProtocol().protocol,
      metadataService: createMockMetadataService(),
    });
    expect(registry.has('propose_blueprint')).toBe(true);
    expect(registry.has('apply_blueprint')).toBe(true);
    expect(registry.size).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// propose_blueprint
// ═══════════════════════════════════════════════════════════════════

describe('propose_blueprint handler', () => {
  let registry: ToolRegistry;
  let saveMetaItem: ReturnType<typeof vi.fn>;
  let generateObject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registry = new ToolRegistry();
    const proto = createMockProtocol(['existing_obj']);
    const ai = createMockAi();
    saveMetaItem = proto.saveMetaItem;
    generateObject = ai.generateObject;
    registerBlueprintTools(registry, { ai: ai.ai, protocol: proto.protocol, metadataService: createMockMetadataService() });
  });

  it('returns a proposed blueprint and persists NOTHING', async () => {
    const parsed = parse(await registry.execute(call('propose_blueprint', { goal: 'build a project tracker' })));
    expect(parsed.status).toBe('blueprint_proposed');
    expect(parsed.blueprint.objects).toHaveLength(2);
    expect(parsed.counts).toEqual({ objects: 2, views: 1, dashboards: 0, app: 0, seedData: 1 });
    // Crucially: proposing creates no drafts.
    expect(saveMetaItem).not.toHaveBeenCalled();
    expect(generateObject).toHaveBeenCalledOnce();
  });

  it('includes existing object names in the model context', async () => {
    await registry.execute(call('propose_blueprint', { goal: 'extend the system' }));
    const messages = generateObject.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain('existing_obj');
  });

  it('errors when goal is missing', async () => {
    const parsed = parse(await registry.execute(call('propose_blueprint', {})));
    expect(parsed.error).toContain('goal');
  });

  it('errors cleanly when the adapter lacks structured output', async () => {
    const registry2 = new ToolRegistry();
    registerBlueprintTools(registry2, {
      ai: { /* no generateObject */ } as any,
      protocol: createMockProtocol().protocol,
      metadataService: createMockMetadataService(),
    });
    const parsed = parse(await registry2.execute(call('propose_blueprint', { goal: 'x' })));
    expect(parsed.error).toContain('structured-output');
  });
});

// ═══════════════════════════════════════════════════════════════════
// apply_blueprint
// ═══════════════════════════════════════════════════════════════════

describe('apply_blueprint handler', () => {
  let registry: ToolRegistry;
  let drafts: Map<string, unknown>;
  let saveMetaItem: ReturnType<typeof vi.fn>;
  let metadataService: any;

  beforeEach(() => {
    registry = new ToolRegistry();
    const proto = createMockProtocol();
    drafts = proto.drafts;
    saveMetaItem = proto.saveMetaItem;
    metadataService = createMockMetadataService();
    registerBlueprintTools(registry, { ai: createMockAi().ai, protocol: proto.protocol, metadataService });
  });

  it('batch-drafts every object and view via mode:draft, never publishing', async () => {
    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: SAMPLE_BLUEPRINT })));

    expect(parsed.status).toBe('drafted');
    expect(parsed.drafted).toEqual([
      { type: 'object', name: 'project' },
      { type: 'object', name: 'task' },
      // View is named `<object>.<key>` so the console binds it to the object.
      { type: 'view', name: 'task.open_tasks' },
    ]);
    expect(parsed.failed).toEqual([]);

    // Every write was a draft; the live-publish path is never touched.
    for (const c of saveMetaItem.mock.calls) expect(c[0].mode).toBe('draft');
    expect(metadataService.register).not.toHaveBeenCalled();

    // Object body expanded fields into a record keyed by name.
    const task = drafts.get('object:task') as any;
    expect(task.fields.project_id).toMatchObject({ type: 'lookup', reference: 'project' });
    // View is the canonical record shape: top-level object + viewKind + config
    // (NOT a bare `{ list }`), so the console can bind + render it.
    const view = drafts.get('view:task.open_tasks') as any;
    // Top-level name is REQUIRED — getMetaItems only surfaces overlay rows
    // whose body carries `name`, so a nameless view never lists as a tab.
    expect(view.name).toBe('task.open_tasks');
    expect(view.object).toBe('task');
    expect(view.viewKind).toBe('list');
    expect(view.config.data).toEqual({ provider: 'object', object: 'task' });
    expect(view.config.columns).toEqual(['title']);
  });

  it('surfaces packageId + bindingHint so follow-up automation (a flow) binds to the app package', async () => {
    const reg = new ToolRegistry();
    const proto = createMockProtocol();
    // installPackage present → ensureAppPackage materialises an app package.
    (proto.protocol as any).installPackage = vi.fn(async () => ({ success: true }));
    registerBlueprintTools(reg, { ai: createMockAi().ai, protocol: proto.protocol, metadataService: createMockMetadataService() });

    const parsed = parse(await reg.execute(call('apply_blueprint', {
      blueprint: { ...SAMPLE_BLUEPRINT, app: { name: 'pm_app', label: 'PM' } },
    })));

    // Without these, the agent's follow-up create_metadata(flow) had no package
    // to bind to and produced an ORPHAN flow draft.
    expect(parsed.packageId).toBe('app.pm_app');
    expect(parsed.bindingHint).toContain('app.pm_app');
    expect(parsed.bindingHint).toMatch(/create_metadata/);
  });

  it('emits kanban config (groupByField + columns) — explicit groupBy wins, else infers the select field', async () => {
    const blueprint = {
      summary: 'recruiting',
      objects: [{
        name: 'lead',
        label: 'Lead',
        fields: [
          { name: 'name', label: 'Name', type: 'text' },
          { name: 'stage', label: 'Stage', type: 'select', options: [{ label: 'New', value: 'new' }] },
        ],
      }],
      views: [
        { object: 'lead', name: 'lead_board', label: 'Board', type: 'kanban', columns: ['name', 'stage'] },
        { object: 'lead', name: 'lead_board2', label: 'Board2', type: 'kanban', columns: ['name'], groupBy: 'stage' },
      ],
    };
    await registry.execute(call('apply_blueprint', { blueprint }));

    // Inferred from the object's first select field.
    const inferred = drafts.get('view:lead.lead_board') as any;
    expect(inferred.object).toBe('lead');
    expect(inferred.viewKind).toBe('list');
    expect(inferred.config.type).toBe('kanban');
    expect(inferred.config.kanban).toEqual({ groupByField: 'stage', columns: ['name', 'stage'] });
    // Explicit groupBy on the view wins.
    const explicit = drafts.get('view:lead.lead_board2') as any;
    expect(explicit.config.kanban.groupByField).toBe('stage');
  });

  it('reports seed data as proposed-but-not-applied', async () => {
    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: SAMPLE_BLUEPRINT })));
    expect(parsed.seedDataProposed).toEqual([{ object: 'project', rows: 2 }]);
    // No draft was written for the seed (no 'dataset' type).
    expect(drafts.has('dataset:project')).toBe(false);
  });

  it('isolates a per-item failure — others still draft', async () => {
    // Make the view write fail, objects succeed.
    saveMetaItem.mockImplementation(async (req: any) => {
      if (req.type === 'view') {
        const e: any = new Error('[invalid_metadata] view/open_tasks failed spec validation');
        e.code = 'invalid_metadata';
        throw e;
      }
      return { success: true };
    });
    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: SAMPLE_BLUEPRINT })));
    expect(parsed.drafted.map((d: any) => d.name)).toEqual(['project', 'task']);
    expect(parsed.failed).toHaveLength(1);
    expect(parsed.failed[0]).toMatchObject({ type: 'view', name: 'task.open_tasks', code: 'invalid_metadata' });
    // Partial success is still 'drafted' (some items landed).
    expect(parsed.status).toBe('drafted');
  });

  it('rejects a malformed blueprint with fixable issues (nothing drafted)', async () => {
    const parsed = parse(await registry.execute(call('apply_blueprint', {
      blueprint: { summary: 'bad', objects: [{ name: 'X', fields: [{ name: 'f', type: 'text' }] }] },
    })));
    expect(parsed.error).toContain('validation');
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(saveMetaItem).not.toHaveBeenCalled();
  });

  it('errors when blueprint is missing', async () => {
    const parsed = parse(await registry.execute(call('apply_blueprint', {})));
    expect(parsed.error).toContain('blueprint');
  });

  it('defaults view columns to the object fields when none are given', async () => {
    const bp: SolutionBlueprint = {
      summary: 'x',
      assumptions: [],
      objects: [{ name: 'lead', fields: [{ name: 'name', type: 'text' }, { name: 'email', type: 'email' }] }],
      views: [{ object: 'lead', name: 'all_leads', type: 'list' }],
    };
    await registry.execute(call('apply_blueprint', { blueprint: bp }));
    const view = drafts.get('view:lead.all_leads') as any;
    expect(view.config.columns).toEqual(['name', 'email']);
  });

  it('drafts the app (navigation shell) with explicit nav referencing the objects', async () => {
    const bp: SolutionBlueprint = {
      ...SAMPLE_BLUEPRINT,
      app: {
        name: 'project_mgmt',
        label: 'Project Management',
        icon: 'kanban',
        nav: [
          { type: 'object', target: 'project', label: 'Projects' },
          { type: 'object', target: 'task' },
        ],
      },
    };
    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: bp })));
    expect(parsed.drafted).toContainEqual({ type: 'app', name: 'project_mgmt' });
    expect(saveMetaItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'app', mode: 'draft' }));

    const app = drafts.get('app:project_mgmt') as any;
    expect(app.label).toBe('Project Management');
    expect(app.icon).toBe('kanban');
    expect(app.isDefault).toBeUndefined(); // never hijack the default app
    expect(app.navigation).toEqual([
      { id: 'nav_project', label: 'Projects', order: 0, type: 'object', objectName: 'project' },
      { id: 'nav_task', label: 'task', order: 1, type: 'object', objectName: 'task' },
    ]);
  });

  it('auto-surfaces every object then dashboard when app.nav is omitted', async () => {
    const bp: SolutionBlueprint = {
      summary: 'crm',
      assumptions: [],
      objects: [
        { name: 'account', label: 'Account', fields: [{ name: 'name', type: 'text' }] },
        { name: 'contact', label: 'Contact', fields: [{ name: 'name', type: 'text' }] },
      ],
      dashboards: [{ name: 'sales', label: 'Sales', widgets: [] }],
      app: { name: 'crm', label: 'CRM' },
    };
    await registry.execute(call('apply_blueprint', { blueprint: bp }));
    const app = drafts.get('app:crm') as any;
    expect(app.navigation).toEqual([
      { id: 'nav_account', label: 'Account', order: 0, type: 'object', objectName: 'account' },
      { id: 'nav_contact', label: 'Contact', order: 1, type: 'object', objectName: 'contact' },
      { id: 'nav_sales', label: 'Sales', order: 2, type: 'dashboard', dashboardName: 'sales' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// OpenAI strict structured outputs (live-verified bug: optional fields made
// OpenAI reject the schema; the model emits null for "empty" fields)
// ═══════════════════════════════════════════════════════════════════

describe('blueprint ⨯ OpenAI strict structured outputs', () => {
  // A blueprint shaped like the strict mirror's output: every optional field
  // present as `null` rather than absent.
  const bpWithNulls: any = {
    summary: 's',
    assumptions: [],
    questions: null,
    objects: [
      {
        name: 'project',
        label: 'Project',
        description: null,
        fields: [
          { name: 'name', label: null, type: 'text', required: null, reference: null, options: null },
        ],
      },
    ],
    views: null,
    dashboards: null,
    app: null,
  };

  it('propose_blueprint uses the strict mirror schema and strips the model\'s nulls', async () => {
    const registry = new ToolRegistry();
    const generateObject = vi.fn(async () => ({ object: bpWithNulls, model: 'mock', usage: undefined }));
    registerBlueprintTools(registry, {
      ai: { generateObject } as any,
      protocol: createMockProtocol().protocol,
      metadataService: createMockMetadataService(),
    });

    const parsed = parse(await registry.execute(call('propose_blueprint', { goal: 'x' })));

    // The OpenAI-strict mirror is the output contract sent to generateObject.
    expect((generateObject.mock.calls[0] as unknown[])[1]).toBe(SolutionBlueprintStrictSchema);
    // Nulls are stripped so the result conforms to the lenient schema.
    expect(parsed.status).toBe('blueprint_proposed');
    expect(parsed.blueprint.objects[0].description).toBeUndefined();
    expect(parsed.blueprint.objects[0].fields[0].label).toBeUndefined();
    expect(parsed.blueprint.views).toBeUndefined();
    expect(parsed.blueprint.app).toBeUndefined();
  });

  it('apply_blueprint tolerates a blueprint carrying nulls (strips before validating)', async () => {
    const registry = new ToolRegistry();
    const proto = createMockProtocol();
    registerBlueprintTools(registry, {
      ai: createMockAi().ai,
      protocol: proto.protocol,
      metadataService: createMockMetadataService(),
    });

    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: bpWithNulls })));
    expect(parsed.status).toBe('drafted');
    expect(parsed.drafted).toEqual([{ type: 'object', name: 'project' }]);
    // null field props were stripped, not persisted as null
    const project = proto.drafts.get('object:project') as any;
    expect(project.fields.name).toEqual({ type: 'text' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Zero-package app building — apply_blueprint auto-homes the app's artifacts
// in a writable app package (one app ⇒ one package), best-effort.
// ═══════════════════════════════════════════════════════════════════

function createMockPackageService(existing: string[] = []) {
  const published: any[] = [];
  const get = vi.fn(async (id: string) =>
    existing.includes(id) ? { manifest: { id, name: id } } : null,
  );
  const publish = vi.fn(async (data: any) => {
    published.push(data);
    return { success: true };
  });
  return { svc: { get, publish }, get, publish, published };
}

const APP_BLUEPRINT: SolutionBlueprint = {
  summary: 'pm',
  assumptions: [],
  objects: [{ name: 'project', label: 'Project', fields: [{ name: 'name', type: 'text' }] }],
  views: [{ object: 'project', name: 'all_projects', type: 'list', columns: ['name'] }],
  app: { name: 'project_management', label: '项目管理', nav: [{ type: 'object', target: 'project' }] },
};

describe('apply_blueprint — auto app package', () => {
  it('creates app.<name> once and binds every artifact to it', async () => {
    const registry = new ToolRegistry();
    const proto = createMockProtocol();
    const pkg = createMockPackageService();
    registerBlueprintTools(registry, {
      ai: createMockAi().ai, protocol: proto.protocol,
      metadataService: createMockMetadataService(), packageService: pkg.svc as any,
    });

    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: APP_BLUEPRINT })));

    // looked up, found absent, published exactly one app package
    expect(pkg.get).toHaveBeenCalledWith('app.project_management');
    expect(pkg.publish).toHaveBeenCalledOnce();
    expect(pkg.published[0].manifest).toMatchObject({
      id: 'app.project_management', type: 'application', namespace: 'project_management', scope: 'environment',
    });
    // every staged artifact carries the package id
    expect(proto.saveMetaItem.mock.calls.length).toBe(3); // object + view + app
    for (const c of proto.saveMetaItem.mock.calls) {
      expect(c[0].packageId).toBe('app.project_management');
      expect(c[0].mode).toBe('draft');
    }
    expect(parsed.package).toEqual({ id: 'app.project_management', name: '项目管理', created: true });
  });

  it('reuses an existing app package (no second publish) and still binds', async () => {
    const registry = new ToolRegistry();
    const proto = createMockProtocol();
    const pkg = createMockPackageService(['app.project_management']);
    registerBlueprintTools(registry, {
      ai: createMockAi().ai, protocol: proto.protocol,
      metadataService: createMockMetadataService(), packageService: pkg.svc as any,
    });

    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: APP_BLUEPRINT })));
    expect(pkg.publish).not.toHaveBeenCalled();
    expect(parsed.package).toEqual({ id: 'app.project_management', name: 'app.project_management', created: false });
    for (const c of proto.saveMetaItem.mock.calls) expect(c[0].packageId).toBe('app.project_management');
  });

  it('falls back to package-less drafting when no package service is wired', async () => {
    const registry = new ToolRegistry();
    const proto = createMockProtocol();
    registerBlueprintTools(registry, {
      ai: createMockAi().ai, protocol: proto.protocol, metadataService: createMockMetadataService(),
    });
    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: APP_BLUEPRINT })));
    expect(parsed.status).toBe('drafted');
    expect(parsed.package).toBeUndefined();
    for (const c of proto.saveMetaItem.mock.calls) expect(c[0].packageId).toBeUndefined();
  });

  it('does nothing package-wise when the blueprint has no app', async () => {
    const registry = new ToolRegistry();
    const proto = createMockProtocol();
    const pkg = createMockPackageService();
    registerBlueprintTools(registry, {
      ai: createMockAi().ai, protocol: proto.protocol,
      metadataService: createMockMetadataService(), packageService: pkg.svc as any,
    });
    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: SAMPLE_BLUEPRINT })));
    expect(pkg.get).not.toHaveBeenCalled();
    expect(pkg.publish).not.toHaveBeenCalled();
    expect(parsed.package).toBeUndefined();
  });

  it('still drafts when publish fails (degrades to package-less, never blocks)', async () => {
    const registry = new ToolRegistry();
    const proto = createMockProtocol();
    const pkg = createMockPackageService();
    pkg.publish.mockResolvedValueOnce({ success: false, error: 'boom' } as any);
    registerBlueprintTools(registry, {
      ai: createMockAi().ai, protocol: proto.protocol,
      metadataService: createMockMetadataService(), packageService: pkg.svc as any,
    });
    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: APP_BLUEPRINT })));
    expect(parsed.status).toBe('drafted');
    expect(parsed.package).toBeUndefined();
    for (const c of proto.saveMetaItem.mock.calls) expect(c[0].packageId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADR-0033 consolidation — when the protocol exposes the canonical
// `installPackage` primitive, the app package is written through it (registry
// + sys_packages) instead of the legacy package-service publish, so the app
// actually surfaces in Studio.
// ═══════════════════════════════════════════════════════════════════

function createMockProtocolWithInstall(existingObjects: string[] = []) {
  const base = createMockProtocol(existingObjects);
  const installPackage = vi.fn(async (req: any) => ({ package: { manifest: req.manifest }, message: 'ok' }));
  (base.protocol as any).installPackage = installPackage;
  return { ...base, installPackage };
}

describe('apply_blueprint — app package via protocol.installPackage', () => {
  it('prefers protocol.installPackage over the legacy publish and binds artifacts', async () => {
    const registry = new ToolRegistry();
    const proto = createMockProtocolWithInstall();
    const pkg = createMockPackageService();
    registerBlueprintTools(registry, {
      ai: createMockAi().ai, protocol: proto.protocol,
      metadataService: createMockMetadataService(), packageService: pkg.svc as any,
    });

    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: APP_BLUEPRINT })));

    expect(proto.installPackage).toHaveBeenCalledOnce();
    expect((proto.installPackage.mock.calls[0] as any[])[0].manifest).toMatchObject({
      id: 'app.project_management', type: 'application', namespace: 'project_management', scope: 'environment',
    });
    expect(pkg.publish).not.toHaveBeenCalled(); // canonical primitive wins; legacy publish skipped
    expect(parsed.package).toEqual({ id: 'app.project_management', name: '项目管理', created: true });
    expect(proto.saveMetaItem.mock.calls.length).toBe(3); // object + view + app
    for (const c of proto.saveMetaItem.mock.calls) {
      expect(c[0].packageId).toBe('app.project_management');
      expect(c[0].mode).toBe('draft');
    }
  });

  it('installs via protocol.installPackage even with no package service wired', async () => {
    const registry = new ToolRegistry();
    const proto = createMockProtocolWithInstall();
    registerBlueprintTools(registry, {
      ai: createMockAi().ai, protocol: proto.protocol, metadataService: createMockMetadataService(),
    });

    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: APP_BLUEPRINT })));

    expect(proto.installPackage).toHaveBeenCalledOnce();
    expect(parsed.package).toEqual({ id: 'app.project_management', name: '项目管理', created: true });
    for (const c of proto.saveMetaItem.mock.calls) expect(c[0].packageId).toBe('app.project_management');
  });

  it('reuses an existing package (get-guard) without calling installPackage', async () => {
    const registry = new ToolRegistry();
    const proto = createMockProtocolWithInstall();
    const pkg = createMockPackageService(['app.project_management']);
    registerBlueprintTools(registry, {
      ai: createMockAi().ai, protocol: proto.protocol,
      metadataService: createMockMetadataService(), packageService: pkg.svc as any,
    });

    const parsed = parse(await registry.execute(call('apply_blueprint', { blueprint: APP_BLUEPRINT })));

    expect(proto.installPackage).not.toHaveBeenCalled();
    expect(pkg.publish).not.toHaveBeenCalled();
    expect(parsed.package).toEqual({ id: 'app.project_management', name: 'app.project_management', created: false });
  });
});
