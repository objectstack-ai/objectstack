// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IMetadataService } from '@objectstack/spec/contracts';
import { ToolRegistry } from '../tools/tool-registry.js';
import {
  registerMetadataTools,
  METADATA_TOOL_DEFINITIONS,
} from '../tools/metadata-tools.js';
import {
  registerDataTools,
} from '../tools/data-tools.js';
import type { MetadataToolContext } from '../tools/metadata-tools.js';

// Individual tool metadata imports
import { createObjectTool } from '../tools/create-object.tool.js';
import { addFieldTool } from '../tools/add-field.tool.js';
import { modifyFieldTool } from '../tools/modify-field.tool.js';
import { deleteFieldTool } from '../tools/delete-field.tool.js';
import { listObjectsTool } from '../tools/list-objects.tool.js';
import { describeObjectTool } from '../tools/describe-object.tool.js';
import { createMetadataTool } from '../tools/create-metadata.tool.js';
import { updateMetadataTool } from '../tools/update-metadata.tool.js';
import { describeMetadataTool } from '../tools/describe-metadata.tool.js';
import { listMetadataTool } from '../tools/list-metadata.tool.js';

// ── Helpers ────────────────────────────────────────────────────────

/** Build a mock IMetadataService with optionally pre-loaded objects. */
function createMockMetadataService(
  objects: Record<string, any> = {},
  overrides: Partial<IMetadataService> = {},
): IMetadataService {
  // Keep a mutable store so handlers can modify it
  const store: Record<string, any> = { ...objects };

  return {
    register: vi.fn(async (_type: string, name: string, data: unknown) => {
      store[name] = data;
    }),
    get: vi.fn(async (_type: string, name: string) => store[name] ?? undefined),
    list: vi.fn(async () => Object.values(store)),
    unregister: vi.fn(async (_type: string, name: string) => {
      delete store[name];
    }),
    exists: vi.fn(async (_type: string, name: string) => name in store),
    listNames: vi.fn(async () => Object.keys(store)),
    getObject: vi.fn(async (name: string) => store[name] ?? undefined),
    listObjects: vi.fn(async () => Object.values(store)),
    ...overrides,
  };
}

/**
 * Build a mock protocol that mimics ObjectStackProtocolImplementation's
 * draft-aware behaviour: `saveMetaItem({ mode:'draft' })` stages a draft;
 * `getMetaItem({ state:'draft' })` returns it or throws `no_draft` (404);
 * the published value is served when `state` is omitted. This is what
 * `applyDraft` writes through (ADR-0033) — nothing reaches a live store.
 */
function createMockProtocol(seedActive: Record<string, unknown> = {}) {
  const active = new Map<string, unknown>(Object.entries(seedActive));
  const drafts = new Map<string, unknown>();

  const saveMetaItem = vi.fn(async (req: any) => {
    const key = `${req.type}:${req.name}`;
    if (req.mode === 'draft') drafts.set(key, req.item);
    else active.set(key, req.item);
    return { success: true };
  });
  const getMetaItem = vi.fn(async (req: any) => {
    const key = `${req.type}:${req.name}`;
    if (req.state === 'draft') {
      if (!drafts.has(key)) {
        const e: any = new Error(`[no_draft] No pending draft for ${key}.`);
        e.code = 'no_draft';
        e.status = 404;
        throw e;
      }
      return { type: req.type, name: req.name, item: drafts.get(key) };
    }
    return { type: req.type, name: req.name, item: active.get(key) };
  });
  // Returns the bare array form (the metadata-tools handlers normalize both
  // `unknown[]` and `{ items }`, but the declared protocol contract is
  // `Promise<unknown[]>`).
  const getMetaItems = vi.fn(async (req: any) => {
    const fromActive = [...active.entries()]
      .filter(([k]) => k.startsWith(`${req.type}:`))
      .map(([, v]) => v);
    if (!req.previewDrafts) return fromActive;
    // Mirror protocol.getMetaItems({ previewDrafts }): overlay draft rows on top
    // of active (draft wins by name; draft-only surfaces).
    const byName = new Map<string, unknown>();
    for (const v of fromActive) byName.set((v as any)?.name, v);
    for (const [k, v] of drafts.entries()) {
      if (k.startsWith(`${req.type}:`)) byName.set((v as any)?.name ?? k, v);
    }
    return [...byName.values()];
  });

  const protocol: NonNullable<MetadataToolContext['protocol']> = {
    getMetaItems,
    getMetaItem,
    saveMetaItem,
  };
  return { protocol, active, drafts, saveMetaItem, getMetaItem, getMetaItems };
}

/** Parse a tool-call result envelope into an object. */
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
// Metadata Tool Definitions
// ═══════════════════════════════════════════════════════════════════

describe('Metadata Tool Definitions', () => {
  it('should define exactly 12 tools', () => {
    expect(METADATA_TOOL_DEFINITIONS).toHaveLength(12);
  });

  it('should include all expected tool names', () => {
    const names = METADATA_TOOL_DEFINITIONS.map(t => t.name);
    expect(names).toEqual([
      // ADR-0033 type-agnostic apply surface first
      'get_metadata_schema',
      'create_metadata',
      'update_metadata',
      'describe_metadata',
      'list_metadata',
      // object/field convenience tools
      'create_object',
      'add_field',
      'modify_field',
      'delete_field',
      'list_objects',
      'describe_object',
      'validate_expression',
    ]);
  });

  it('should have descriptions and parameters for each tool', () => {
    for (const def of METADATA_TOOL_DEFINITIONS) {
      expect(def.description).toBeTruthy();
      expect(def.parameters).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Individual Tool Metadata Files (.tool.ts)
// ═══════════════════════════════════════════════════════════════════

describe('Individual Tool Metadata (.tool.ts)', () => {
  const tools = [
    { tool: createMetadataTool, expectedName: 'create_metadata', expectedLabel: 'Create Metadata' },
    { tool: updateMetadataTool, expectedName: 'update_metadata', expectedLabel: 'Update Metadata' },
    { tool: describeMetadataTool, expectedName: 'describe_metadata', expectedLabel: 'Describe Metadata' },
    { tool: listMetadataTool, expectedName: 'list_metadata', expectedLabel: 'List Metadata' },
    { tool: createObjectTool, expectedName: 'create_object', expectedLabel: 'Create Object' },
    { tool: addFieldTool, expectedName: 'add_field', expectedLabel: 'Add Field' },
    { tool: modifyFieldTool, expectedName: 'modify_field', expectedLabel: 'Modify Field' },
    { tool: deleteFieldTool, expectedName: 'delete_field', expectedLabel: 'Delete Field' },
    { tool: listObjectsTool, expectedName: 'list_objects', expectedLabel: 'List Objects' },
    { tool: describeObjectTool, expectedName: 'describe_object', expectedLabel: 'Describe Object' },
  ];

  for (const { tool, expectedName, expectedLabel } of tools) {
    describe(expectedName, () => {
      it('should have correct name', () => {
        expect(tool.name).toBe(expectedName);
      });

      it('should have a label', () => {
        expect(tool.label).toBe(expectedLabel);
      });

      it('should be categorized as data', () => {
        expect(tool.category).toBe('data');
      });

      it('should be marked as built-in', () => {
        expect(tool.builtIn).toBe(true);
      });

      it('should have a description', () => {
        expect(tool.description).toBeTruthy();
      });

      it('should have parameters schema', () => {
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe('object');
      });

      it('should be included in METADATA_TOOL_DEFINITIONS', () => {
        expect(METADATA_TOOL_DEFINITIONS).toContain(tool);
      });
    });
  }

  // ADR-0033: the draft workspace is the approval gate, so no tool relies on
  // the (never-enforced) requiresConfirmation flag.
  it('should leave requiresConfirmation false on write tools (draft is the gate)', () => {
    expect(createObjectTool.requiresConfirmation).toBe(false);
    expect(deleteFieldTool.requiresConfirmation).toBe(false);
    expect(addFieldTool.requiresConfirmation).toBe(false);
    expect(modifyFieldTool.requiresConfirmation).toBe(false);
    expect(createMetadataTool.requiresConfirmation).toBe(false);
    expect(updateMetadataTool.requiresConfirmation).toBe(false);
  });

  it('should leave requiresConfirmation false on read tools', () => {
    expect(listObjectsTool.requiresConfirmation).toBe(false);
    expect(describeObjectTool.requiresConfirmation).toBe(false);
    expect(listMetadataTool.requiresConfirmation).toBe(false);
    expect(describeMetadataTool.requiresConfirmation).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// registerMetadataTools
// ═══════════════════════════════════════════════════════════════════

describe('registerMetadataTools', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    const metadataService = createMockMetadataService();
    const { protocol } = createMockProtocol();
    registerMetadataTools(registry, { metadataService, protocol });
  });

  it('should register all 12 tools', () => {
    expect(registry.size).toBe(12);
    for (const name of [
      'get_metadata_schema',
      'create_metadata', 'update_metadata', 'describe_metadata', 'list_metadata',
      'create_object', 'add_field', 'modify_field', 'delete_field',
      'list_objects', 'describe_object', 'validate_expression',
    ]) {
      expect(registry.has(name)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// get_metadata_schema — lets the AI read the real protocol on demand
// ═══════════════════════════════════════════════════════════════════

describe('get_metadata_schema', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    const { protocol } = createMockProtocol();
    registerMetadataTools(registry, { metadataService: createMockMetadataService(), protocol });
  });

  it('returns the JSON Schema (contract) for a known type', async () => {
    const parsed = parse(await registry.execute(call('get_metadata_schema', { type: 'view' })));
    expect(parsed.type).toBe('view');
    expect(parsed.jsonSchema).toBeTruthy();
    // A JSON-Schema-shaped object (has $schema/type/properties or $ref/anyOf).
    const js = parsed.jsonSchema as Record<string, unknown>;
    expect(
      typeof js === 'object' &&
        ('properties' in js || 'anyOf' in js || '$ref' in js || 'oneOf' in js || '$defs' in js),
    ).toBe(true);
    expect(parsed.error).toBeUndefined();
  });

  it('resolves a plural type to its singular schema', async () => {
    const parsed = parse(await registry.execute(call('get_metadata_schema', { type: 'views' })));
    expect(parsed.type).toBe('view');
    expect(parsed.jsonSchema).toBeTruthy();
  });

  it('returns a helpful error for an unknown type', async () => {
    const parsed = parse(await registry.execute(call('get_metadata_schema', { type: 'nonsense_type' })));
    expect(parsed.jsonSchema).toBeUndefined();
    expect(String(parsed.error)).toContain('nonsense_type');
  });

  // Every app-development metadata type must yield a usable contract — including
  // object/action, whose schemas wrap/nest a transform pipe that trips Zod v4's
  // toJSONSchema (handled by the robust unwrap-and-recurse converter).
  it('serializes ALL app-development metadata types (no validation-blind spots)', async () => {
    const types = [
      'object', 'field', 'view', 'page', 'dashboard', 'report',
      'app', 'flow', 'action', 'agent', 'role',
    ];
    for (const type of types) {
      const parsed = parse(await registry.execute(call('get_metadata_schema', { type })));
      expect(parsed.error, `'${type}' should serialize`).toBeUndefined();
      expect(parsed.jsonSchema, `'${type}' should return a schema`).toBeTruthy();
      expect(parsed.jsonSchema.type ?? parsed.jsonSchema.properties ?? parsed.jsonSchema.anyOf).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Dual registration (data tools + metadata tools)
// ═══════════════════════════════════════════════════════════════════

describe('registerDataTools + registerMetadataTools — unified list/describe', () => {
  it('should register both tool sets on the same registry', () => {
    const registry = new ToolRegistry();
    const metadataService = createMockMetadataService();
    const { protocol } = createMockProtocol();
    const dataEngine = {
      find: vi.fn(),
      findOne: vi.fn(),
      aggregate: vi.fn(),
    } as any;

    registerDataTools(registry, { dataEngine });
    const sizeAfterData = registry.size;

    registerMetadataTools(registry, { metadataService, protocol });
    const sizeAfterBoth = registry.size;

    // Data tools define: query_records, get_record, aggregate_data (3)
    // Metadata tools define 12.
    expect(sizeAfterData).toBe(3);
    expect(sizeAfterBoth).toBe(sizeAfterData + 12);

    expect(registry.has('list_objects')).toBe(true);
    expect(registry.has('describe_object')).toBe(true);
    expect(registry.has('query_records')).toBe(true);
    expect(registry.has('create_object')).toBe(true);
    expect(registry.has('create_metadata')).toBe(true);
    expect(registry.has('get_metadata_schema')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Draft gating — the core ADR-0033 invariant
// ═══════════════════════════════════════════════════════════════════

describe('ADR-0033 draft gating', () => {
  it('write tools NEVER publish (metadataService.register is never called) and stage mode:draft', async () => {
    const registry = new ToolRegistry();
    const metadataService = createMockMetadataService();
    const { protocol, saveMetaItem, drafts } = createMockProtocol();
    registerMetadataTools(registry, { metadataService, protocol });

    const result = await registry.execute(call('create_object', { name: 'project', label: 'Project' }, 'c1'));
    const parsed = parse(result);

    expect(parsed.status).toBe('drafted');
    expect(parsed.type).toBe('object');
    expect(parsed.name).toBe('project');
    expect(parsed.summary).toContain('project');
    expect(Array.isArray(parsed.changedKeys)).toBe(true);

    // The live-publish path is dead.
    expect(metadataService.register).not.toHaveBeenCalled();
    // The change is staged as a draft.
    expect(saveMetaItem).toHaveBeenCalledWith(expect.objectContaining({
      type: 'object',
      name: 'project',
      mode: 'draft',
    }));
    expect(drafts.get('object:project')).toEqual(expect.objectContaining({ name: 'project', label: 'Project' }));
  });

  it('refuses to write when no draft-capable protocol is wired (safe by default)', async () => {
    const registry = new ToolRegistry();
    const metadataService = createMockMetadataService();
    // No protocol — applyDraft must refuse rather than fall back to publish.
    registerMetadataTools(registry, { metadataService });

    const result = await registry.execute(call('create_object', { name: 'project', label: 'Project' }, 'c1'));
    const parsed = parse(result);

    expect(parsed.status).toBeUndefined();
    expect(parsed.error).toMatch(/draft persistence is unavailable/i);
    expect(metadataService.register).not.toHaveBeenCalled();
  });

  it('feeds per-type validation errors back to the model (does not throw)', async () => {
    const registry = new ToolRegistry();
    const metadataService = createMockMetadataService();
    const { protocol, saveMetaItem } = createMockProtocol();
    // saveMetaItem rejects with the structured invalid_metadata shape.
    (saveMetaItem as any).mockImplementation(async () => {
      const e: any = new Error('[invalid_metadata] object/project failed spec validation: label: Required');
      e.code = 'invalid_metadata';
      e.status = 422;
      e.issues = [{ path: 'label', message: 'Required', code: 'invalid_type' }];
      throw e;
    });
    registerMetadataTools(registry, { metadataService, protocol });

    const result = await registry.execute(call('create_object', { name: 'project', label: 'Project' }, 'c1'));
    const parsed = parse(result);

    expect(parsed.error).toContain('invalid_metadata');
    expect(parsed.code).toBe('invalid_metadata');
    expect(parsed.issues).toEqual([{ path: 'label', message: 'Required', code: 'invalid_type' }]);
    // It returned a string error, not a thrown exception — the loop continues.
    expect(result.isError).toBeFalsy();
  });

  it('stacks repeated field ops into a SINGLE object draft (no fork)', async () => {
    const registry = new ToolRegistry();
    const metadataService = createMockMetadataService();
    const { protocol, drafts } = createMockProtocol();
    registerMetadataTools(registry, { metadataService, protocol });

    await registry.execute(call('create_object', { name: 'invoice', label: 'Invoice' }, 's1'));
    await registry.execute(call('add_field', { objectName: 'invoice', name: 'amount', type: 'number' }, 's2'));
    await registry.execute(call('add_field', { objectName: 'invoice', name: 'status', type: 'text' }, 's3'));

    const draft = drafts.get('object:invoice') as any;
    expect(Object.keys(draft.fields)).toEqual(['amount', 'status']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// create_object handler
// ═══════════════════════════════════════════════════════════════════

describe('create_object handler', () => {
  let registry: ToolRegistry;
  let metadataService: IMetadataService;
  let drafts: Map<string, unknown>;

  beforeEach(() => {
    registry = new ToolRegistry();
    metadataService = createMockMetadataService();
    const mock = createMockProtocol();
    drafts = mock.drafts;
    registerMetadataTools(registry, { metadataService, protocol: mock.protocol });
  });

  it('should draft an object with name and label', async () => {
    const parsed = parse(await registry.execute(call('create_object', { name: 'project', label: 'Project' })));
    expect(parsed.status).toBe('drafted');
    expect(parsed.name).toBe('project');
    expect(drafts.get('object:project')).toEqual(expect.objectContaining({ name: 'project', label: 'Project' }));
  });

  it('should draft an object with initial fields', async () => {
    await registry.execute(call('create_object', {
      name: 'task',
      label: 'Task',
      fields: [
        { name: 'title', type: 'text', label: 'Title', required: true },
        { name: 'status', type: 'select' },
      ],
    }));
    expect(drafts.get('object:task')).toEqual(expect.objectContaining({
      fields: {
        title: { type: 'text', label: 'Title', required: true },
        status: { type: 'select' },
      },
    }));
  });

  it('should draft an object with enableFeatures', async () => {
    await registry.execute(call('create_object', {
      name: 'account',
      label: 'Account',
      enableFeatures: { trackHistory: true, apiEnabled: true },
    }));
    expect(drafts.get('object:account')).toEqual(expect.objectContaining({
      enable: { trackHistory: true, apiEnabled: true },
    }));
  });

  it('should reject invalid snake_case name', async () => {
    const parsed = parse(await registry.execute(call('create_object', { name: 'MyProject', label: 'My Project' })));
    expect(parsed.error).toContain('snake_case');
    expect(drafts.size).toBe(0);
  });

  it('should reject duplicate object names (published)', async () => {
    metadataService = createMockMetadataService({ project: { name: 'project', label: 'Project' } });
    registry = new ToolRegistry();
    const mock = createMockProtocol();
    registerMetadataTools(registry, { metadataService, protocol: mock.protocol });

    const parsed = parse(await registry.execute(call('create_object', { name: 'project', label: 'Project v2' })));
    expect(parsed.error).toContain('already exists');
  });

  it('should reject duplicate object names (already drafted)', async () => {
    await registry.execute(call('create_object', { name: 'project', label: 'Project' }));
    const parsed = parse(await registry.execute(call('create_object', { name: 'project', label: 'Project v2' })));
    expect(parsed.error).toContain('already exists');
  });

  it('should return error when name or label is missing', async () => {
    const parsed = parse(await registry.execute(call('create_object', { name: 'project' })));
    expect(parsed.error).toContain('required');
  });

  it('should reject fields with invalid snake_case names', async () => {
    const parsed = parse(await registry.execute(call('create_object', {
      name: 'project', label: 'Project', fields: [{ name: 'ValidField', type: 'text' }],
    })));
    expect(parsed.error).toContain('snake_case');
    expect(drafts.size).toBe(0);
  });

  it('should reject fields with duplicate names', async () => {
    const parsed = parse(await registry.execute(call('create_object', {
      name: 'project', label: 'Project',
      fields: [{ name: 'status', type: 'text' }, { name: 'status', type: 'select' }],
    })));
    expect(parsed.error).toContain('Duplicate');
    expect(drafts.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// add_field handler
// ═══════════════════════════════════════════════════════════════════

describe('add_field handler', () => {
  let registry: ToolRegistry;
  let metadataService: IMetadataService;
  let drafts: Map<string, unknown>;

  beforeEach(() => {
    metadataService = createMockMetadataService({
      project: { name: 'project', label: 'Project', fields: {} },
    });
    registry = new ToolRegistry();
    const mock = createMockProtocol();
    drafts = mock.drafts;
    registerMetadataTools(registry, { metadataService, protocol: mock.protocol });
  });

  it('should draft a new field onto an existing (published) object', async () => {
    const parsed = parse(await registry.execute(call('add_field',
      { objectName: 'project', name: 'due_date', type: 'date', label: 'Due Date' })));
    expect(parsed.status).toBe('drafted');
    expect(parsed.changedKeys).toEqual(['fields.due_date']);
    expect(drafts.get('object:project')).toEqual(expect.objectContaining({
      fields: expect.objectContaining({
        due_date: expect.objectContaining({ type: 'date', label: 'Due Date' }),
      }),
    }));
  });

  it('should draft a select field with options', async () => {
    await registry.execute(call('add_field', {
      objectName: 'project', name: 'priority', type: 'select',
      options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }],
    }));
    expect(drafts.get('object:project')).toEqual(expect.objectContaining({
      fields: expect.objectContaining({
        priority: expect.objectContaining({
          type: 'select',
          options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }],
        }),
      }),
    }));
  });

  it('should reject adding field to non-existent object', async () => {
    const parsed = parse(await registry.execute(call('add_field',
      { objectName: 'nonexistent', name: 'field_a', type: 'text' })));
    expect(parsed.error).toContain('not found');
  });

  it('should reject duplicate field name (against the pending draft)', async () => {
    await registry.execute(call('add_field', { objectName: 'project', name: 'status', type: 'text' }, 'a'));
    const parsed = parse(await registry.execute(call('add_field',
      { objectName: 'project', name: 'status', type: 'select' }, 'b')));
    expect(parsed.error).toContain('already exists');
  });

  it('should reject invalid field name', async () => {
    const parsed = parse(await registry.execute(call('add_field',
      { objectName: 'project', name: 'MyField', type: 'text' })));
    expect(parsed.error).toContain('snake_case');
  });

  it('should accept reference as a string', async () => {
    const parsed = parse(await registry.execute(call('add_field',
      { objectName: 'project', name: 'account_id', type: 'lookup', reference: 'account' })));
    expect(parsed.status).toBe('drafted');
    expect(drafts.get('object:project')).toEqual(expect.objectContaining({
      fields: expect.objectContaining({
        account_id: expect.objectContaining({ type: 'lookup', reference: 'account' }),
      }),
    }));
  });

  it('should reject invalid reference (not snake_case)', async () => {
    const parsed = parse(await registry.execute(call('add_field',
      { objectName: 'project', name: 'account_id', type: 'lookup', reference: 'MyAccount' })));
    expect(parsed.error).toContain('snake_case');
  });
});

// ═══════════════════════════════════════════════════════════════════
// modify_field handler
// ═══════════════════════════════════════════════════════════════════

describe('modify_field handler', () => {
  let registry: ToolRegistry;
  let drafts: Map<string, unknown>;

  beforeEach(() => {
    const metadataService = createMockMetadataService({
      project: {
        name: 'project', label: 'Project',
        fields: {
          status: { type: 'text', label: 'Status', required: false },
          budget: { type: 'number', label: 'Budget' },
        },
      },
    });
    registry = new ToolRegistry();
    const mock = createMockProtocol();
    drafts = mock.drafts;
    registerMetadataTools(registry, { metadataService, protocol: mock.protocol });
  });

  it('should draft a field-label change', async () => {
    const parsed = parse(await registry.execute(call('modify_field',
      { objectName: 'project', fieldName: 'status', changes: { label: 'Project Status' } })));
    expect(parsed.status).toBe('drafted');
    expect(parsed.changedKeys).toEqual(['fields.status.label']);
    expect((drafts.get('object:project') as any).fields.status.label).toBe('Project Status');
  });

  it('should draft multiple property changes', async () => {
    const parsed = parse(await registry.execute(call('modify_field',
      { objectName: 'project', fieldName: 'status', changes: { label: 'Project Status', required: true } })));
    expect(parsed.changedKeys).toEqual(expect.arrayContaining(['fields.status.label', 'fields.status.required']));
    expect((drafts.get('object:project') as any).fields.status.required).toBe(true);
  });

  it('should return error for non-existent object', async () => {
    const parsed = parse(await registry.execute(call('modify_field',
      { objectName: 'nonexistent', fieldName: 'status', changes: { label: 'New' } })));
    expect(parsed.error).toContain('not found');
  });

  it('should return error for non-existent field', async () => {
    const parsed = parse(await registry.execute(call('modify_field',
      { objectName: 'project', fieldName: 'nonexistent_field', changes: { label: 'New' } })));
    expect(parsed.error).toContain('not found');
  });
});

// ═══════════════════════════════════════════════════════════════════
// delete_field handler
// ═══════════════════════════════════════════════════════════════════

describe('delete_field handler', () => {
  let registry: ToolRegistry;
  let drafts: Map<string, unknown>;

  beforeEach(() => {
    const metadataService = createMockMetadataService({
      project: {
        name: 'project', label: 'Project',
        fields: {
          status: { type: 'text', label: 'Status' },
          budget: { type: 'number', label: 'Budget' },
        },
      },
    });
    registry = new ToolRegistry();
    const mock = createMockProtocol();
    drafts = mock.drafts;
    registerMetadataTools(registry, { metadataService, protocol: mock.protocol });
  });

  it('should draft the removal of a field', async () => {
    const parsed = parse(await registry.execute(call('delete_field',
      { objectName: 'project', fieldName: 'budget' })));
    expect(parsed.status).toBe('drafted');
    expect(parsed.changedKeys).toEqual(['fields.budget']);
    const draft = drafts.get('object:project') as any;
    expect(draft.fields.budget).toBeUndefined();
    expect(draft.fields.status).toBeDefined();
  });

  it('should return error for non-existent object', async () => {
    const parsed = parse(await registry.execute(call('delete_field',
      { objectName: 'nonexistent', fieldName: 'status' })));
    expect(parsed.error).toContain('not found');
  });

  it('should return error for non-existent field', async () => {
    const parsed = parse(await registry.execute(call('delete_field',
      { objectName: 'project', fieldName: 'nonexistent_field' })));
    expect(parsed.error).toContain('not found');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Generic type-agnostic tools (ADR-0033)
// ═══════════════════════════════════════════════════════════════════

describe('create_metadata / update_metadata / describe_metadata / list_metadata', () => {
  let registry: ToolRegistry;
  let drafts: Map<string, unknown>;
  let active: Map<string, unknown>;
  let saveMetaItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const metadataService = createMockMetadataService();
    registry = new ToolRegistry();
    const mock = createMockProtocol({
      'view:account_list': { name: 'account_list', label: 'Accounts', object: 'account' },
      'dashboard:sales': { name: 'sales', label: 'Sales' },
    });
    drafts = mock.drafts;
    active = mock.active;
    saveMetaItem = mock.saveMetaItem;
    registerMetadataTools(registry, { metadataService, protocol: mock.protocol });
  });

  it('create_metadata drafts a new view with the name folded in', async () => {
    const parsed = parse(await registry.execute(call('create_metadata',
      { type: 'view', name: 'contact_list', definition: { label: 'Contacts', object: 'contact' } })));
    expect(parsed.status).toBe('drafted');
    expect(parsed.type).toBe('view');
    expect(saveMetaItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'view', mode: 'draft' }));
    expect(drafts.get('view:contact_list')).toEqual({ name: 'contact_list', label: 'Contacts', object: 'contact' });
  });

  it('create_metadata rejects an item that already exists', async () => {
    const parsed = parse(await registry.execute(call('create_metadata',
      { type: 'view', name: 'account_list', definition: { label: 'X' } })));
    expect(parsed.error).toContain('already exists');
  });

  it('create_metadata rejects an invalid snake_case name', async () => {
    const parsed = parse(await registry.execute(call('create_metadata',
      { type: 'view', name: 'BadName', definition: {} })));
    expect(parsed.error).toContain('snake_case');
  });

  it('update_metadata merges a patch into the published item and drafts it', async () => {
    const parsed = parse(await registry.execute(call('update_metadata',
      { type: 'view', name: 'account_list', patch: { label: 'All Accounts' } })));
    expect(parsed.status).toBe('drafted');
    expect(parsed.changedKeys).toEqual(['label']);
    expect(drafts.get('view:account_list')).toEqual(expect.objectContaining({
      name: 'account_list', label: 'All Accounts', object: 'account',
    }));
    // Published value untouched.
    expect((active.get('view:account_list') as any).label).toBe('Accounts');
  });

  it('update_metadata deletes a key when the patch value is null (RFC 7386)', async () => {
    await registry.execute(call('update_metadata',
      { type: 'view', name: 'account_list', patch: { object: null } }));
    const draft = drafts.get('view:account_list') as any;
    expect(draft.object).toBeUndefined();
    expect(draft.label).toBe('Accounts');
  });

  it('update_metadata returns not-found for an unknown item', async () => {
    const parsed = parse(await registry.execute(call('update_metadata',
      { type: 'view', name: 'ghost', patch: { label: 'X' } })));
    expect(parsed.error).toContain('not found');
  });

  it('describe_metadata returns the draft body when one exists (draft-first)', async () => {
    await registry.execute(call('update_metadata', { type: 'view', name: 'account_list', patch: { label: 'Edited' } }));
    const parsed = parse(await registry.execute(call('describe_metadata', { type: 'view', name: 'account_list' })));
    expect(parsed.item.label).toBe('Edited');
  });

  it('describe_metadata falls back to the published body when no draft', async () => {
    const parsed = parse(await registry.execute(call('describe_metadata', { type: 'dashboard', name: 'sales' })));
    expect(parsed.item.label).toBe('Sales');
  });

  it('list_metadata enumerates items of a type with an optional filter', async () => {
    const all = parse(await registry.execute(call('list_metadata', { type: 'view' })));
    expect(all.totalCount).toBe(1);
    expect(all.items[0]).toEqual({ name: 'account_list', label: 'Accounts' });

    const filtered = parse(await registry.execute(call('list_metadata', { type: 'view', filter: 'zzz' })));
    expect(filtered.totalCount).toBe(0);
  });

  it('list_metadata surfaces a draft-only item (previewDrafts) so the agent sees its own pending work', async () => {
    // A brand-new object the agent just drafted (never published). Active-only
    // reads hide it, so the agent reports its own object as "not found" when it
    // later tries to author a flow against it. previewDrafts overlays it.
    drafts.set('object:expense_claim', { name: 'expense_claim', label: 'Expense Claim' });
    const res = parse(await registry.execute(call('list_metadata', { type: 'object' })));
    expect(res.items.map((i: any) => i.name)).toContain('expense_claim');
  });
});

// ═══════════════════════════════════════════════════════════════════
// describe_object / list_objects (read side, unchanged behaviour)
// ═══════════════════════════════════════════════════════════════════

describe('list_objects + describe_object handlers', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    const metadataService = createMockMetadataService({
      account: { name: 'account', label: 'Account', fields: { name: { type: 'text' } } },
      contact: { name: 'contact', label: 'Contact', fields: { email: { type: 'text' }, phone: { type: 'text' } } },
    });
    registry = new ToolRegistry();
    // No protocol getMetaItems seeded for objects → falls back to metadataService.listObjects.
    registerMetadataTools(registry, { metadataService });
  });

  it('list_objects lists objects with field counts', async () => {
    const parsed = parse(await registry.execute(call('list_objects', {})));
    expect(parsed.totalCount).toBe(2);
    expect(parsed.objects[0]).toEqual(expect.objectContaining({ name: 'account', fieldCount: 1 }));
  });

  it('describe_object returns full schema', async () => {
    const parsed = parse(await registry.execute(call('describe_object', { objectName: 'account' })));
    expect(parsed.name).toBe('account');
    expect(parsed.fields).toHaveLength(1);
  });

  it('describe_object errors for an unknown object', async () => {
    const parsed = parse(await registry.execute(call('describe_object', { objectName: 'nope' })));
    expect(parsed.error).toContain('not found');
  });
});

// ═══════════════════════════════════════════════════════════════════
// End-to-End: full draft lifecycle through the generic + object tools
// ═══════════════════════════════════════════════════════════════════

describe('Metadata Tools — full draft lifecycle', () => {
  let registry: ToolRegistry;
  let drafts: Map<string, unknown>;

  beforeEach(() => {
    const metadataService = createMockMetadataService();
    registry = new ToolRegistry();
    const mock = createMockProtocol();
    drafts = mock.drafts;
    registerMetadataTools(registry, { metadataService, protocol: mock.protocol });
  });

  it('create → add_field → describe_metadata → modify → delete all stage one draft', async () => {
    await registry.execute(call('create_object', { name: 'invoice', label: 'Invoice' }, 's1'));
    await registry.execute(call('add_field', { objectName: 'invoice', name: 'amount', type: 'number', label: 'Amount' }, 's2'));
    await registry.execute(call('add_field', { objectName: 'invoice', name: 'status', type: 'text', label: 'Status' }, 's3'));

    // describe_metadata is draft-aware and sees both fields.
    const desc = parse(await registry.execute(call('describe_metadata', { type: 'object', name: 'invoice' }, 's4')));
    expect(Object.keys(desc.item.fields)).toEqual(['amount', 'status']);

    await registry.execute(call('modify_field', {
      objectName: 'invoice', fieldName: 'status', changes: { type: 'select', label: 'Invoice Status' },
    }, 's5'));

    const del = parse(await registry.execute(call('delete_field', { objectName: 'invoice', fieldName: 'amount' }, 's6')));
    expect(del.status).toBe('drafted');

    const draft = drafts.get('object:invoice') as any;
    expect(Object.keys(draft.fields)).toEqual(['status']);
    expect(draft.fields.status.type).toBe('select');
    expect(draft.fields.status.label).toBe('Invoice Status');
  });
});
