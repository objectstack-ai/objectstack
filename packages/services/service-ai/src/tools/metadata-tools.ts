// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IMetadataService } from '@objectstack/spec/contracts';
import type { Tool } from '@objectstack/spec/ai';
import type { ToolHandler } from './tool-registry.js';
import type { ToolRegistry } from './tool-registry.js';
import { z } from 'zod';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';

// ---------------------------------------------------------------------------
// Tool Metadata — individual .tool.ts files (single source of truth)
// ---------------------------------------------------------------------------

export { createObjectTool } from './create-object.tool.js';
export { addFieldTool } from './add-field.tool.js';
export { modifyFieldTool } from './modify-field.tool.js';
export { deleteFieldTool } from './delete-field.tool.js';
export { listObjectsTool } from './list-objects.tool.js';
export { describeObjectTool } from './describe-object.tool.js';
export { validateExpressionTool } from './validate-expression.tool.js';
export { createMetadataTool } from './create-metadata.tool.js';
export { updateMetadataTool } from './update-metadata.tool.js';
export { describeMetadataTool } from './describe-metadata.tool.js';
export { listMetadataTool } from './list-metadata.tool.js';
export { getMetadataSchemaTool } from './get-metadata-schema.tool.js';

import { createObjectTool } from './create-object.tool.js';
import { addFieldTool } from './add-field.tool.js';
import { modifyFieldTool } from './modify-field.tool.js';
import { deleteFieldTool } from './delete-field.tool.js';
import { listObjectsTool } from './list-objects.tool.js';
import { describeObjectTool } from './describe-object.tool.js';
import { validateExpressionTool } from './validate-expression.tool.js';
import { createMetadataTool } from './create-metadata.tool.js';
import { updateMetadataTool } from './update-metadata.tool.js';
import { describeMetadataTool } from './describe-metadata.tool.js';
import { listMetadataTool } from './list-metadata.tool.js';
import { getMetadataSchemaTool } from './get-metadata-schema.tool.js';
import { validateExpression, introspectScope, type FieldRole } from '@objectstack/formula';

/** All built-in metadata management tool definitions (Tool metadata). */
export const METADATA_TOOL_DEFINITIONS: Tool[] = [
  // ADR-0033 type-agnostic apply surface (preferred for any metadata type)
  getMetadataSchemaTool,
  createMetadataTool,
  updateMetadataTool,
  describeMetadataTool,
  listMetadataTool,
  // Object/field convenience tools (now draft-gated thin wrappers)
  createObjectTool,
  addFieldTool,
  modifyFieldTool,
  deleteFieldTool,
  listObjectsTool,
  describeObjectTool,
  validateExpressionTool,
];

// ---------------------------------------------------------------------------
// Internal type aliases for metadata payloads (returned as `unknown` from
// IMetadataService — we cast to these lightweight shapes for field access).
// ---------------------------------------------------------------------------

/** Minimal shape of an object definition as returned by IMetadataService. */
interface ObjectDef {
  name: string;
  label?: string;
  fields?: Record<string, FieldDef>;
  enable?: Record<string, boolean>;
}

/** Minimal shape of a field definition inside an object. */
interface FieldDef {
  name?: string;
  type?: string;
  label?: string;
  required?: boolean;
  reference?: string;
  options?: unknown;
  defaultValue?: unknown;
}

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

/** snake_case identifier pattern (e.g. `project_task`, `due_date`). */
const SNAKE_CASE_RE = /^[a-z_][a-z0-9_]*$/;

/** Validate that a value matches snake_case. */
function isSnakeCase(value: string): boolean {
  return SNAKE_CASE_RE.test(value);
}

// ---------------------------------------------------------------------------
// Package Resolution Helpers
// ---------------------------------------------------------------------------

/**
 * Retrieves the active package ID from the conversation context.
 * Returns null if no conversation service is available or no active package is set.
 */
async function getActivePackageId(ctx: MetadataToolContext): Promise<string | null> {
  if (!ctx.conversationService?.getMetadata || !ctx.conversationId) {
    return null;
  }

  const metadata = await ctx.conversationService.getMetadata(ctx.conversationId);
  return (metadata?.activePackageId as string) ?? null;
}

/**
 * Resolves the package ID to use for a metadata operation.
 * Priority: explicit packageId > active package from conversation > error
 *
 * Also validates that the package exists and checks if it's read-only.
 *
 * @returns Object with packageId or error message
 */
async function resolvePackageId(
  ctx: MetadataToolContext,
  explicitPackageId?: string,
): Promise<{ packageId: string | null; error?: string; warning?: string }> {
  let packageId: string | null = null;

  // 1. Try explicit packageId parameter
  if (explicitPackageId) {
    packageId = explicitPackageId;
  } else {
    // 2. Try active package from conversation
    packageId = await getActivePackageId(ctx);
  }

  // If no package ID could be resolved, return null (backward compatibility)
  // This allows metadata to be stored without package association
  if (!packageId) {
    return {
      packageId: null,
      warning: 'No package specified. Metadata will be created without package association. Consider using set_active_package or providing packageId parameter.',
    };
  }

  // Validate package exists (if registry is available)
  if (ctx.packageRegistry) {
    const exists = await ctx.packageRegistry.exists(packageId);
    if (!exists) {
      return {
        packageId: null,
        error: `Package "${packageId}" not found. Use list_packages to see available packages or create_package to create a new one.`,
      };
    }

    // Check if package is read-only (code-based)
    const pkg = await ctx.packageRegistry.get(packageId);
    if (pkg?.manifest.source === 'filesystem') {
      return {
        packageId: null,
        error: `Package "${packageId}" is read-only (loaded from code). Only database packages can be modified. Use create_package to create a new database package.`,
      };
    }
  }

  return { packageId };
}

// ---------------------------------------------------------------------------
// Context — injected once at registration time
// ---------------------------------------------------------------------------

/**
 * Services required by the metadata management tools.
 *
 * Provided by the kernel at `ai:ready` time and closed over
 * by the handler functions so they stay framework-agnostic.
 */
export interface MetadataToolContext {
  /** Metadata service for schema CRUD operations. */
  metadataService: IMetadataService;

  /** Optional: Conversation service for retrieving active package context */
  conversationService?: {
    getMetadata?(conversationId: string): Promise<Record<string, unknown> | undefined>;
  };

  /** Optional: Current conversation ID (if in a conversation context) */
  conversationId?: string;

  /** Optional: Package registry for validating package existence */
  packageRegistry?: {
    exists(packageId: string): Promise<boolean>;
    get(packageId: string): Promise<{ manifest: { scope?: string; source?: string } } | undefined>;
  };

  /**
   * Optional: ObjectStack protocol for cross-source metadata enumeration.
   *
   * `IMetadataService.listObjects()` only sees items registered through the
   * MetadataManager (in-memory registry + loaders). It misses objects that
   * live in ObjectQL's SchemaRegistry — most notably system objects shipped
   * by plugins (e.g. `sys_user`, `sys_organization` from plugin-auth) and
   * environment-scoped objects persisted to `sys_metadata`.
   *
   * When provided, `list_objects` will use `protocol.getMetaItems({ type: 'object' })`
   * (the same source that backs `GET /api/v1/meta/object`) so the agent sees the
   * complete set of available objects.
   */
  protocol?: {
    /**
     * `previewDrafts` overlays pending `state='draft'` rows on the active list
     * so the authoring agent can DISCOVER metadata it (or a prior turn) just
     * drafted but nobody has published yet — e.g. referencing a just-drafted
     * object when authoring a flow. Without it, `getMetaItems` is active-only
     * and the agent reports its own draft objects as "not found". Older runtimes
     * ignore the unknown property (graceful: stays active-only).
     */
    getMetaItems(request: { type: string; packageId?: string; organizationId?: string; previewDrafts?: boolean }): Promise<unknown[]>;
    /**
     * Read a single metadata item. With `state:'draft'` returns the pending
     * draft row and throws `no_draft` (404) when none exists — it does NOT
     * fall through to the published value, so callers must catch and fall
     * back. The runtime object backing `ctx.protocol` is the full
     * ObjectStackProtocolImplementation, which provides this.
     */
    getMetaItem?(request: {
      type: string;
      name: string;
      packageId?: string;
      organizationId?: string;
      state?: 'active' | 'draft';
    }): Promise<unknown>;
    /**
     * Save a metadata item. ADR-0033: AI writes ALWAYS pass `mode:'draft'` so
     * nothing the agent authors goes live until a human publishes. Validates
     * against the per-type Zod schema (ADR-0005) and throws `invalid_metadata`
     * / `destructive_change` with structured `issues` on rejection.
     */
    saveMetaItem?(request: {
      type: string;
      name: string;
      item?: unknown;
      organizationId?: string;
      parentVersion?: string | null;
      actor?: string;
      force?: boolean;
      mode?: 'draft' | 'publish';
      packageId?: string | null;
    }): Promise<unknown>;
    /**
     * Install a package from a manifest — the canonical write primitive that
     * lands the package in BOTH the in-memory registry (Studio's selector reads
     * this) and the durable `sys_packages` table (ADR-0033 consolidation). The
     * runtime object backing `ctx.protocol` is the full
     * ObjectStackProtocolImplementation, which provides this; older/remote
     * protocols may omit it (callers fall back to the `package` service).
     */
    installPackage?(request: {
      manifest: Record<string, unknown>;
      settings?: Record<string, unknown>;
    }): Promise<{ package?: unknown; message?: string } | unknown>;
  };
}

// ---------------------------------------------------------------------------
// ADR-0033 — draft-gated write core
//
// Every metadata mutation an AI makes routes through `applyDraft`, which
// writes `mode:'draft'` via the protocol's `saveMetaItem`. The draft IS the
// approval gate: nothing is live until a human publishes. We never call
// `metadataService.register(...)` from a tool handler — that path publishes
// straight to the live schema (the exact hazard ADR-0033 closes).
// ---------------------------------------------------------------------------

interface ApplyDraftInput {
  /** Metadata type (singular, e.g. 'object', 'view'). */
  type: string;
  /** Item name (snake_case). */
  name: string;
  /** The full item body to stage as a draft. */
  item: unknown;
  /** Acting user id (from the tool execution context) for provenance/audit. */
  actor?: string;
  /** Owning package id, when resolved. */
  packageId?: string | null;
  /**
   * Bypass the destructive-data 409. Defaults to `true` for draft writes: a
   * draft never applies DDL or drops data — the human's *publish* is the
   * moment data is touched, and it re-runs its own checks. Blocking staging on
   * the publish-time guard would prevent the agent from proposing schema
   * changes for review, which is the whole point.
   */
  force?: boolean;
  /** Human-readable one-line summary for the result envelope. */
  summary: string;
  /** Paths that changed, for the review/diff surface. */
  changedKeys: string[];
}

/** The draft-capable subset of the ObjectStack protocol (a `saveMetaItem` that
 *  honours `mode:'draft'`). Shared by the metadata tools and the blueprint
 *  apply step so there is one draft-write path. */
export type DraftCapableProtocol = NonNullable<MetadataToolContext['protocol']>;

/** Input to {@link stageDraft} — the type/name/body plus provenance. */
export interface StageDraftInput {
  type: string;
  name: string;
  item: unknown;
  actor?: string;
  packageId?: string | null;
  /** See {@link ApplyDraftInput.force}. Defaults to `true` for draft writes. */
  force?: boolean;
}

/** Structured outcome of a single draft write (no JSON, no throw). */
export interface StageDraftResult {
  ok: boolean;
  error?: string;
  code?: string;
  issues?: unknown;
}

/**
 * The single ADR-0033 draft-write primitive: stage `item` via
 * `protocol.saveMetaItem({ mode:'draft' })`. Validates against the per-type Zod
 * schema (ADR-0005) and never throws — a rejection comes back as
 * `{ ok:false, error, code, issues }` so callers can feed it to the model or
 * collect per-item results (the blueprint apply step). Safe by default: with no
 * draft-capable protocol it refuses rather than falling back to publish.
 */
export async function stageDraft(
  protocol: DraftCapableProtocol | undefined,
  input: StageDraftInput,
): Promise<StageDraftResult> {
  if (!protocol?.saveMetaItem) {
    return {
      ok: false,
      error:
        'Draft persistence is unavailable: no protocol service is wired, so metadata changes cannot be staged for review.',
    };
  }
  try {
    await protocol.saveMetaItem({
      type: input.type,
      name: input.name,
      item: input.item,
      mode: 'draft',
      force: input.force ?? true,
      ...(input.actor ? { actor: input.actor } : {}),
      ...(input.packageId !== undefined && input.packageId !== null
        ? { packageId: input.packageId }
        : {}),
    });
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string; code?: string; issues?: unknown };
    return {
      ok: false,
      error: e.message ?? String(err),
      ...(e.code ? { code: e.code } : {}),
      ...(e.issues ? { issues: e.issues } : {}),
    };
  }
}

/**
 * Stage `item` as a draft and return the ADR-0033 result envelope
 * `{ status:'drafted', type, name, summary, changedKeys }` as a JSON string.
 * Thin wrapper over {@link stageDraft} that shapes the per-tool envelope and
 * the error feedback the tool-call loop expects.
 */
async function applyDraft(ctx: MetadataToolContext, input: ApplyDraftInput): Promise<string> {
  const res = await stageDraft(ctx.protocol, input);
  if (!res.ok) {
    return JSON.stringify({
      error: res.error,
      ...(res.code ? { code: res.code } : {}),
      ...(res.issues ? { issues: res.issues } : {}),
    });
  }
  return JSON.stringify({
    status: 'drafted',
    type: input.type,
    name: input.name,
    summary: input.summary,
    changedKeys: input.changedKeys,
  });
}

/**
 * Read the current body of a metadata item, **draft-first**: returns the
 * pending draft if one exists, else the live/published value, else undefined.
 * This is what lets successive field ops (`add_field`, `modify_field`, …)
 * stack into the *same* single draft rather than each starting from the last
 * published version (ADR-0033 §3: "read-modify-write the single object draft,
 * they do not fork drafts").
 */
async function readDraftFirst(
  ctx: MetadataToolContext,
  type: string,
  name: string,
): Promise<unknown | undefined> {
  if (ctx.protocol?.getMetaItem) {
    // Draft row first. `getMetaItem({state:'draft'})` throws `no_draft` (404)
    // when none exists — catch and fall through to the published value.
    try {
      const draft = await ctx.protocol.getMetaItem({ type, name, state: 'draft' });
      const draftItem = (draft as { item?: unknown } | undefined)?.item;
      if (draftItem) return draftItem;
    } catch {
      /* no draft — fall through */
    }
    try {
      const active = await ctx.protocol.getMetaItem({ type, name });
      const activeItem = (active as { item?: unknown } | undefined)?.item;
      if (activeItem) return activeItem;
    } catch {
      /* not found via protocol — fall through to the metadata service */
    }
  }
  if (type === 'object') {
    return ctx.metadataService.getObject(name);
  }
  return ctx.metadataService.get(type, name);
}

/**
 * RFC 7386 JSON Merge Patch: recursively merge `patch` into `target`; a `null`
 * value deletes that key; a non-object `patch` replaces wholesale. Used by
 * `update_metadata` so the agent can express a partial change without
 * restating the whole item.
 */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch;
  }
  const base: Record<string, unknown> =
    target && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) {
      delete base[key];
    } else {
      base[key] = mergePatch(base[key], value);
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Handler Factories
// ---------------------------------------------------------------------------

/**
 * validate_expression (ADR-0032 §1e) — run the shared validator on an
 * expression before it is saved, so the agent self-corrects at authoring time.
 * Resolves the object's field names (when `objectName` is given) for
 * schema-aware field-existence checks.
 */
function createValidateExpressionHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args) => {
    const { role, source, objectName } = args as { role?: string; source?: string; objectName?: string };
    if (!source || typeof source !== 'string') {
      return JSON.stringify({ ok: false, errors: [{ message: '"source" is required' }] });
    }
    const fieldRole: FieldRole = role === 'template' || role === 'value' ? role : 'predicate';

    let fields: string[] | undefined;
    if (objectName) {
      try {
        const objectDef = (await ctx.metadataService.getObject(objectName)) as ObjectDef | undefined;
        if (objectDef?.fields) fields = Object.keys(objectDef.fields);
      } catch {
        // schema lookup is best-effort — fall back to syntax-only validation
      }
    }

    const result = validateExpression(fieldRole, source, objectName ? { objectName, fields } : undefined);
    const scope = introspectScope(fieldRole, objectName ? { objectName, fields } : undefined);
    return JSON.stringify({
      ok: result.ok,
      errors: result.errors,
      dialect: scope.dialect,
      // On failure, surface what IS in scope so the agent can fix the reference.
      ...(result.ok ? {} : { availableFields: scope.fields, roots: scope.roots, functions: scope.functions }),
    });
  };
}

function createCreateObjectHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args, exec) => {
    const { name, label, packageId: explicitPackageId, fields, enableFeatures } = args as {
      name: string;
      label: string;
      packageId?: string;
      fields?: Array<{ name: string; label?: string; type: string; required?: boolean }>;
      enableFeatures?: Record<string, boolean>;
    };

    if (!name || !label) {
      return JSON.stringify({ error: 'Both "name" and "label" are required' });
    }

    // Resolve package ID
    const resolved = await resolvePackageId(ctx, explicitPackageId);
    if (resolved.error) {
      return JSON.stringify({ error: resolved.error });
    }
    const packageId = resolved.packageId;

    // Validate snake_case name
    if (!isSnakeCase(name)) {
      return JSON.stringify({ error: `Invalid object name "${name}". Must be snake_case.` });
    }

    // Check if the object already exists (draft-first — an AI-drafted object
    // not yet published still counts as existing).
    const existing = await readDraftFirst(ctx, 'object', name);
    if (existing) {
      return JSON.stringify({ error: `Object "${name}" already exists` });
    }

    // Build field map from array input with per-field validation
    const fieldMap: Record<string, Record<string, unknown>> = {};
    if (fields && Array.isArray(fields)) {
      const seenNames = new Set<string>();
      for (const f of fields) {
        if (!f.name) {
          return JSON.stringify({ error: 'Each field must have a "name" property' });
        }
        if (!isSnakeCase(f.name)) {
          return JSON.stringify({ error: `Invalid field name "${f.name}". Must be snake_case.` });
        }
        if (seenNames.has(f.name)) {
          return JSON.stringify({ error: `Duplicate field name "${f.name}" in initial fields` });
        }
        seenNames.add(f.name);
        fieldMap[f.name] = {
          type: f.type,
          ...(f.label ? { label: f.label } : {}),
          ...(f.required !== undefined ? { required: f.required } : {}),
        };
      }
    }

    const objectDef: Record<string, unknown> = {
      name,
      label,
      ...(packageId ? { packageId } : {}),
      ...(Object.keys(fieldMap).length > 0 ? { fields: fieldMap } : {}),
      ...(enableFeatures ? { enable: enableFeatures } : {}),
    };

    return applyDraft(ctx, {
      type: 'object',
      name,
      item: objectDef,
      actor: exec?.actor?.id,
      packageId,
      summary: `Drafted new object "${name}" (${label})${
        Object.keys(fieldMap).length ? ` with ${Object.keys(fieldMap).length} field(s)` : ''
      }`,
      changedKeys: Object.keys(objectDef),
    });
  };
}

function createAddFieldHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args, exec) => {
    const { objectName, name, label, type, required, defaultValue, options, reference, packageId: explicitPackageId } = args as {
      objectName: string;
      name: string;
      label?: string;
      type: string;
      required?: boolean;
      defaultValue?: unknown;
      options?: Array<{ label: string; value: string }>;
      reference?: string;
      packageId?: string;
    };

    if (!objectName || !name || !type) {
      return JSON.stringify({ error: '"objectName", "name", and "type" are required' });
    }

    // Resolve package ID (for validation and tracking)
    const resolved = await resolvePackageId(ctx, explicitPackageId);
    if (resolved.error) {
      return JSON.stringify({ error: resolved.error });
    }

    // Validate snake_case names
    if (!isSnakeCase(objectName)) {
      return JSON.stringify({ error: `Invalid object name "${objectName}". Must be snake_case.` });
    }
    if (!isSnakeCase(name)) {
      return JSON.stringify({ error: `Invalid field name "${name}". Must be snake_case.` });
    }

    // Validate reference as snake_case if provided
    if (reference && !isSnakeCase(reference)) {
      return JSON.stringify({ error: `Invalid reference "${reference}". Must be a snake_case object name.` });
    }

    // Validate select option values as snake_case if provided
    if (options && Array.isArray(options)) {
      for (const opt of options) {
        if (opt.value && !isSnakeCase(opt.value)) {
          return JSON.stringify({ error: `Invalid option value "${opt.value}". Must be lowercase snake_case.` });
        }
      }
    }

    // Verify the target object exists (draft-first so repeated field ops stack
    // into the same single draft rather than forking from the published copy).
    const objectDef = await readDraftFirst(ctx, 'object', objectName);
    if (!objectDef) {
      return JSON.stringify({ error: `Object "${objectName}" not found` });
    }

    // Check if field already exists
    const def = objectDef as ObjectDef;
    if (def.fields && def.fields[name]) {
      return JSON.stringify({ error: `Field "${name}" already exists on object "${objectName}"` });
    }

    // Build new field definition
    const fieldDef: Record<string, unknown> = {
      type,
      ...(label ? { label } : {}),
      ...(required !== undefined ? { required } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(options ? { options } : {}),
      ...(reference ? { reference } : {}),
    };

    // Merge the new field into the existing object definition and stage it.
    const updatedFields = { ...(def.fields ?? {}), [name]: fieldDef };
    return applyDraft(ctx, {
      type: 'object',
      name: objectName,
      item: { ...def, fields: updatedFields },
      actor: exec?.actor?.id,
      packageId: resolved.packageId,
      summary: `Drafted field "${name}" (${type}) on object "${objectName}"`,
      changedKeys: [`fields.${name}`],
    });
  };
}

function createModifyFieldHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args, exec) => {
    const { objectName, fieldName, changes, packageId: explicitPackageId } = args as {
      objectName: string;
      fieldName: string;
      changes: Record<string, unknown>;
      packageId?: string;
    };

    if (!objectName || !fieldName || !changes) {
      return JSON.stringify({ error: '"objectName", "fieldName", and "changes" are required' });
    }

    // Resolve package ID (for validation and tracking)
    const resolved = await resolvePackageId(ctx, explicitPackageId);
    if (resolved.error) {
      return JSON.stringify({ error: resolved.error });
    }

    // Validate snake_case names
    if (!isSnakeCase(objectName)) {
      return JSON.stringify({ error: `Invalid object name "${objectName}". Must be snake_case.` });
    }
    if (!isSnakeCase(fieldName)) {
      return JSON.stringify({ error: `Invalid field name "${fieldName}". Must be snake_case.` });
    }

    // Verify the target object exists (draft-first — see add_field).
    const objectDef = await readDraftFirst(ctx, 'object', objectName);
    if (!objectDef) {
      return JSON.stringify({ error: `Object "${objectName}" not found` });
    }

    const def = objectDef as ObjectDef;
    if (!def.fields || !def.fields[fieldName]) {
      return JSON.stringify({ error: `Field "${fieldName}" not found on object "${objectName}"` });
    }

    // Apply changes to the field definition
    const existingField = def.fields[fieldName];
    const updatedField = { ...existingField, ...changes };
    const updatedFields = { ...def.fields, [fieldName]: updatedField };

    return applyDraft(ctx, {
      type: 'object',
      name: objectName,
      item: { ...def, fields: updatedFields },
      actor: exec?.actor?.id,
      packageId: resolved.packageId,
      summary: `Drafted change to field "${fieldName}" on object "${objectName}" (${Object.keys(changes).join(', ')})`,
      changedKeys: Object.keys(changes).map((k) => `fields.${fieldName}.${k}`),
    });
  };
}

function createDeleteFieldHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args, exec) => {
    const { objectName, fieldName, packageId: explicitPackageId } = args as {
      objectName: string;
      fieldName: string;
      packageId?: string;
    };

    if (!objectName || !fieldName) {
      return JSON.stringify({ error: '"objectName" and "fieldName" are required' });
    }

    // Resolve package ID (for validation and tracking)
    const resolved = await resolvePackageId(ctx, explicitPackageId);
    if (resolved.error) {
      return JSON.stringify({ error: resolved.error });
    }

    // Validate snake_case names
    if (!isSnakeCase(objectName)) {
      return JSON.stringify({ error: `Invalid object name "${objectName}". Must be snake_case.` });
    }
    if (!isSnakeCase(fieldName)) {
      return JSON.stringify({ error: `Invalid field name "${fieldName}". Must be snake_case.` });
    }

    // Verify the target object exists (draft-first — see add_field).
    const objectDef = await readDraftFirst(ctx, 'object', objectName);
    if (!objectDef) {
      return JSON.stringify({ error: `Object "${objectName}" not found` });
    }

    const def = objectDef as ObjectDef;
    if (!def.fields || !def.fields[fieldName]) {
      return JSON.stringify({ error: `Field "${fieldName}" not found on object "${objectName}"` });
    }

    // Remove the field and stage the change. Dropping a field is destructive,
    // but it only lands in the draft here — the human's publish is the gate
    // that actually touches data (and re-runs the destructive check).
    const { [fieldName]: _removed, ...remainingFields } = def.fields;
    return applyDraft(ctx, {
      type: 'object',
      name: objectName,
      item: { ...def, fields: remainingFields },
      actor: exec?.actor?.id,
      packageId: resolved.packageId,
      summary: `Drafted removal of field "${fieldName}" from object "${objectName}"`,
      changedKeys: [`fields.${fieldName}`],
    });
  };
}

function createListObjectsHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args) => {
    const { filter, includeFields } = (args ?? {}) as {
      filter?: string;
      includeFields?: boolean;
    };

    // Prefer the protocol-level enumerator when available — it merges
    // ObjectQL's SchemaRegistry (system plugins like plugin-auth contribute
    // `sys_user`, `sys_organization`, …), persisted `sys_metadata` overlays,
    // and MetadataService runtime registrations into a single list. Falling
    // back to `metadataService.listObjects()` alone would miss everything
    // registered through the SchemaRegistry, which is why agents previously
    // reported "no user object exists" despite `sys_user` being present.
    let objects: unknown[] = [];
    if (ctx.protocol?.getMetaItems) {
      try {
        const fromProtocol = await ctx.protocol.getMetaItems({ type: 'object', previewDrafts: true });
        // Protocol can return either a plain array OR a wrapped envelope
        // `{ type, items: [] }` (the shape returned by the protocol shim
        // backing `GET /api/v1/meta/object`). Normalize both.
        const arr = Array.isArray(fromProtocol)
          ? fromProtocol
          : (fromProtocol && typeof fromProtocol === 'object' && Array.isArray((fromProtocol as any).items)
            ? (fromProtocol as any).items
            : null);
        objects = arr ?? await ctx.metadataService.listObjects();
      } catch {
        objects = await ctx.metadataService.listObjects();
      }
    } else {
      objects = await ctx.metadataService.listObjects();
    }
    if (!Array.isArray(objects)) objects = [];
    if (!Array.isArray(objects)) objects = [];
    let result = (objects as ObjectDef[]).map(o => {
      const base: Record<string, unknown> = {
        name: o.name,
        label: o.label ?? o.name,
        fieldCount: o.fields ? Object.keys(o.fields).length : 0,
      };
      if (includeFields && o.fields) {
        base.fields = Object.entries(o.fields).map(([key, f]) => ({
          name: key,
          type: f.type,
          label: f.label ?? key,
        }));
      }
      return base;
    });

    // Apply optional name/label substring filter
    if (filter) {
      const lower = filter.toLowerCase();
      result = result.filter(o =>
        (o.name as string).toLowerCase().includes(lower) ||
        (o.label as string).toLowerCase().includes(lower),
      );
    }

    return JSON.stringify({
      objects: result,
      totalCount: result.length,
    });
  };
}

function createDescribeObjectHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args) => {
    const { objectName } = args as { objectName: string };

    if (!objectName) {
      return JSON.stringify({ error: '"objectName" is required' });
    }

    // Validate snake_case name
    if (!isSnakeCase(objectName)) {
      return JSON.stringify({ error: `Invalid object name "${objectName}". Must be snake_case.` });
    }

    // Same protocol-first lookup rationale as `list_objects` — `getObject`
    // alone won't find objects living in ObjectQL's SchemaRegistry.
    let objectDef: unknown | undefined = await ctx.metadataService.getObject(objectName);
    if (!objectDef && ctx.protocol?.getMetaItems) {
      try {
        const all = await ctx.protocol.getMetaItems({ type: 'object', previewDrafts: true });
        const arr: ObjectDef[] = Array.isArray(all)
          ? (all as ObjectDef[])
          : (all && typeof all === 'object' && Array.isArray((all as any).items)
            ? ((all as any).items as ObjectDef[])
            : []);
        objectDef = arr.find(o => o?.name === objectName);
      } catch {
        // fall through — still report not found below
      }
    }
    if (!objectDef) {
      return JSON.stringify({ error: `Object "${objectName}" not found` });
    }

    const def = objectDef as ObjectDef;
    const fields = def.fields ?? {};
    const fieldSummary = Object.entries(fields).map(([key, f]) => ({
      name: key,
      type: f.type,
      label: f.label ?? key,
      required: f.required ?? false,
      ...(f.reference ? { reference: f.reference } : {}),
      ...(f.options ? { options: f.options } : {}),
    }));

    return JSON.stringify({
      name: def.name,
      label: def.label ?? def.name,
      fields: fieldSummary,
      enableFeatures: def.enable ?? {},
    });
  };
}

// ---------------------------------------------------------------------------
// ADR-0033 — type-agnostic apply surface
//
// A small generic surface (`create_metadata` / `update_metadata` /
// `describe_metadata` / `list_metadata`) that works for ANY metadata type —
// view, dashboard, flow, … — not just objects. Coverage of new types grows by
// teaching the agent these tools, not by adding bespoke per-type write tools.
// Every write goes through `applyDraft` (draft-gated, per-type Zod validated).
// ---------------------------------------------------------------------------

function createCreateMetadataHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args, exec) => {
    const { type, name, definition, packageId: explicitPackageId } = args as {
      type: string;
      name: string;
      definition: unknown;
      packageId?: string;
    };

    if (!type || !name || definition === undefined || definition === null) {
      return JSON.stringify({ error: '"type", "name", and "definition" are required' });
    }
    if (!isSnakeCase(name)) {
      return JSON.stringify({ error: `Invalid name "${name}". Must be snake_case.` });
    }

    // Reject re-creating an item that already exists (draft or published).
    const existing = await readDraftFirst(ctx, type, name);
    if (existing) {
      return JSON.stringify({
        error: `${type} "${name}" already exists — use update_metadata to change it.`,
      });
    }

    // Ensure the canonical `name` is present on the body (most type schemas
    // require it); the explicit `name` arg is authoritative.
    const item =
      definition && typeof definition === 'object' && !Array.isArray(definition)
        ? { name, ...(definition as Record<string, unknown>) }
        : definition;
    const changedKeys =
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.keys(item as Record<string, unknown>)
        : [];

    return applyDraft(ctx, {
      type,
      name,
      item,
      actor: exec?.actor?.id,
      packageId: explicitPackageId ?? null,
      summary: `Drafted new ${type} "${name}"`,
      changedKeys,
    });
  };
}

function createUpdateMetadataHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args, exec) => {
    const { type, name, patch, packageId: explicitPackageId } = args as {
      type: string;
      name: string;
      patch: unknown;
      packageId?: string;
    };

    if (!type || !name || patch === undefined) {
      return JSON.stringify({ error: '"type", "name", and "patch" are required' });
    }

    // Read-modify-write the SINGLE draft (never fork): start from the pending
    // draft if any, else the published value.
    const current = await readDraftFirst(ctx, type, name);
    if (!current) {
      return JSON.stringify({
        error: `${type} "${name}" not found — use create_metadata to create it first.`,
      });
    }

    const merged = mergePatch(current, patch);
    const changedKeys =
      patch && typeof patch === 'object' && !Array.isArray(patch)
        ? Object.keys(patch as Record<string, unknown>)
        : [];

    return applyDraft(ctx, {
      type,
      name,
      item: merged,
      actor: exec?.actor?.id,
      packageId: explicitPackageId ?? null,
      summary: `Drafted update to ${type} "${name}"`,
      changedKeys,
    });
  };
}

function createDescribeMetadataHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args) => {
    const { type, name } = args as { type: string; name: string };
    if (!type || !name) {
      return JSON.stringify({ error: '"type" and "name" are required' });
    }
    const item = await readDraftFirst(ctx, type, name);
    if (!item) {
      return JSON.stringify({ error: `${type} "${name}" not found` });
    }
    return JSON.stringify({ type, name, item });
  };
}

function createListMetadataHandler(ctx: MetadataToolContext): ToolHandler {
  return async (args) => {
    const { type, filter } = args as { type: string; filter?: string };
    if (!type) {
      return JSON.stringify({ error: '"type" is required' });
    }

    // Prefer the protocol enumerator (same source as GET /api/v1/meta/:type);
    // fall back to the metadata service registry.
    let items: unknown[] = [];
    if (ctx.protocol?.getMetaItems) {
      try {
        const res = await ctx.protocol.getMetaItems({ type, previewDrafts: true });
        items = Array.isArray(res)
          ? res
          : res && typeof res === 'object' && Array.isArray((res as { items?: unknown[] }).items)
            ? (res as { items: unknown[] }).items
            : [];
      } catch {
        items = await ctx.metadataService.list(type);
      }
    } else {
      items = await ctx.metadataService.list(type);
    }
    if (!Array.isArray(items)) items = [];

    let summaries = (items as Array<Record<string, unknown>>).map((it) => ({
      name: it?.name,
      label: it?.label ?? it?.name,
    }));
    if (filter) {
      const lower = filter.toLowerCase();
      summaries = summaries.filter(
        (s) =>
          String(s.name ?? '').toLowerCase().includes(lower) ||
          String(s.label ?? '').toLowerCase().includes(lower),
      );
    }

    return JSON.stringify({ type, items: summaries, totalCount: summaries.length });
  };
}

// JSON-Schema conversion options for the authoring contract: emit the INPUT
// side of the schema (what the agent writes — `io:'input'` skips the output of
// transforms) and degrade anything genuinely unrepresentable to permissive
// `{}` instead of throwing.
const TO_JSON_SCHEMA_OPTS = {
  target: 'draft-2020-12',
  io: 'input',
  unrepresentable: 'any',
} as Parameters<typeof z.toJSONSchema>[1];

/** Peel any top-level `pipe` (transform/refine) chain down to its INPUT schema. */
function unwrapToInput(schema: unknown): unknown {
  let cur = schema as { _zod?: { def?: { type?: string; in?: unknown } } };
  for (let i = 0; i < 12; i++) {
    const def = cur?._zod?.def;
    if (def?.type === 'pipe' && def.in) cur = def.in as typeof cur;
    else break;
  }
  return cur;
}

/**
 * Robustly convert ANY metadata-type Zod schema to JSON Schema. Some schemas
 * (object, action, …) wrap a `.transform()`/refine pipe or nest one (e.g. an
 * object's `actions: z.array(ActionSchema)`), which makes Zod v4's
 * `toJSONSchema` throw. We peel pipes to their input and, when the whole-schema
 * conversion still fails, recurse property-by-property / element-by-element so
 * every type yields a usable contract (an unconvertible leaf degrades to a
 * placeholder rather than failing the whole call).
 */
function metadataTypeToJsonSchema(schema: unknown): Record<string, unknown> {
  const s = unwrapToInput(schema);
  try {
    return z.toJSONSchema(s as z.ZodType, TO_JSON_SCHEMA_OPTS) as Record<string, unknown>;
  } catch {
    const def = (s as { _zod?: { def?: { type?: string; shape?: Record<string, unknown>; element?: unknown; innerType?: unknown } } })?._zod?.def;
    if (def?.type === 'object' && def.shape) return objectShapeToJsonSchema(def.shape);
    if (def?.type === 'array' && def.element) return { type: 'array', items: metadataTypeToJsonSchema(def.element) };
    if (def?.type === 'optional' && def.innerType) return metadataTypeToJsonSchema(def.innerType);
    return { description: '(schema omitted — not representable as JSON Schema)' };
  }
}

function objectShapeToJsonSchema(shape: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const omitted: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    try {
      properties[key] = metadataTypeToJsonSchema(value);
    } catch {
      omitted.push(key);
    }
  }
  return {
    type: 'object',
    properties,
    ...(omitted.length ? { 'x-omittedProperties': omitted } : {}),
  };
}

/**
 * `get_metadata_schema` — return the JSON Schema (contract) for a metadata type
 * so the agent can author a correct payload in one shot instead of guessing the
 * shape of complex types and learning from validation errors. The schema is
 * derived from the SAME live Zod schema `saveMetaItem` validates against
 * ({@link getMetadataTypeSchema}).
 */
function createGetMetadataSchemaHandler(_ctx: MetadataToolContext): ToolHandler {
  return async (args) => {
    const raw = (args as { type?: string }).type;
    if (!raw || typeof raw !== 'string') {
      return JSON.stringify({ error: '"type" is required, e.g. "view", "dashboard", "flow".' });
    }
    // Accept a plural ("views") by falling back to the singular form.
    const candidates = raw.endsWith('s') ? [raw, raw.slice(0, -1)] : [raw];
    let resolved: { type: string; schema: z.ZodType } | undefined;
    for (const t of candidates) {
      const s = getMetadataTypeSchema(t);
      if (s) { resolved = { type: t, schema: s }; break; }
    }
    if (!resolved) {
      return JSON.stringify({
        error: `No schema registered for metadata type '${raw}'. Use a singular type like: object, view, page, dashboard, report, app, flow.`,
      });
    }
    try {
      const jsonSchema = metadataTypeToJsonSchema(resolved.schema);
      return JSON.stringify({ type: resolved.type, jsonSchema });
    } catch (err) {
      return JSON.stringify({
        type: resolved.type,
        error: `Schema for '${resolved.type}' could not be serialized: ${(err as Error)?.message ?? String(err)}`,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Public Registration Helper
// ---------------------------------------------------------------------------

/**
 * Register all built-in metadata management tools on the given {@link ToolRegistry}.
 *
 * Typically called from the `ai:ready` hook after the metadata service is available.
 *
 * @example
 * ```ts
 * ctx.hook('ai:ready', async (aiService) => {
 *   const metadataService = ctx.getService<IMetadataService>('metadata');
 *   registerMetadataTools(aiService.toolRegistry, { metadataService });
 * });
 * ```
 */
export function registerMetadataTools(
  registry: ToolRegistry,
  context: MetadataToolContext,
): void {
  // ADR-0033 type-agnostic apply surface.
  registry.register(getMetadataSchemaTool, createGetMetadataSchemaHandler(context));
  registry.register(createMetadataTool, createCreateMetadataHandler(context));
  registry.register(updateMetadataTool, createUpdateMetadataHandler(context));
  registry.register(describeMetadataTool, createDescribeMetadataHandler(context));
  registry.register(listMetadataTool, createListMetadataHandler(context));
  // Object/field convenience tools (draft-gated thin wrappers).
  registry.register(createObjectTool, createCreateObjectHandler(context));
  registry.register(addFieldTool, createAddFieldHandler(context));
  registry.register(modifyFieldTool, createModifyFieldHandler(context));
  registry.register(deleteFieldTool, createDeleteFieldHandler(context));
  registry.register(listObjectsTool, createListObjectsHandler(context));
  registry.register(describeObjectTool, createDescribeObjectHandler(context));
  registry.register(validateExpressionTool, createValidateExpressionHandler(context));
}
