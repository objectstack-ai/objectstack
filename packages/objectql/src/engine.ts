// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { AsyncLocalStorage } from 'node:async_hooks';
import { QueryAST, HookContext, ServiceObject } from '@objectstack/spec/data';
import {
  EngineQueryOptions,
  DataEngineInsertOptions,
  EngineUpdateOptions,
  EngineDeleteOptions,
  EngineAggregateOptions,
  EngineCountOptions
} from '@objectstack/spec/data';
import { ExecutionContext, ExecutionContextSchema } from '@objectstack/spec/kernel';
import { DriverInterface, IDataEngine, Logger, createLogger } from '@objectstack/core';
import { CoreServiceName, StorageNameMapping } from '@objectstack/spec/system';
import { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import type { ICryptoProvider, CryptoHandle } from '@objectstack/spec/contracts';
import {
  collectSecretFields,
  makeSecretRef,
  parseSecretRef,
  isSecretRef,
  SECRET_MASK,
} from './secret-fields.js';
import { pluralToSingular, ExternalWriteForbiddenError } from '@objectstack/spec/shared';
import { SchemaRegistry, computeFQN } from './registry.js';
import { ExpressionEngine } from '@objectstack/formula';
import type { Expression } from '@objectstack/spec';
import { isAggregatedViewContainer, expandViewContainer } from '@objectstack/spec';
import { bindHooksToEngine } from './hook-binder.js';
import { validateRecord } from './validation/record-validator.js';
import { evaluateValidationRules, needsPriorRecord, stripReadonlyWhenFields } from './validation/rule-validator.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';

interface FormulaPlanEntry { name: string; expression: Expression; }

function planFormulaProjection(
  schema: any,
  requestedFields: string[] | undefined
): { plan: FormulaPlanEntry[]; projected?: string[] } {
  if (!schema?.fields) return { plan: [] };
  const allFieldNames = Object.keys(schema.fields);
  // When no explicit projection, evaluate every formula field on the schema —
  // matches REST default of "return everything". Explicit projection still
  // honours the caller's selection.
  const targets = (Array.isArray(requestedFields) && requestedFields.length > 0)
    ? requestedFields
    : allFieldNames;
  const plan: FormulaPlanEntry[] = [];
  const projected = new Set<string>();
  for (const f of targets) {
    const def = (schema.fields as any)[f];
    if (def?.type === 'formula' && def.expression) {
      // Normalize string-shorthand → Expression envelope (M9 transition).
      const expr: Expression = typeof def.expression === 'string'
        ? { dialect: 'cel', source: def.expression }
        : def.expression;
      plan.push({ name: f, expression: expr });
      // Pre-compile to surface syntax errors at planning stage rather than
      // per-row eval. Dependency discovery (which fields the formula reads)
      // is no longer used — CEL uses dynamic projection via `record.<field>`.
      ExpressionEngine.compile(expr);
    } else if (Array.isArray(requestedFields) && requestedFields.length > 0) {
      projected.add(f);
    }
  }
  if (plan.length === 0) return { plan: [] };
  // For formulas: project all schema fields so CEL `record.<field>` lookups
  // see complete data. Static dependency analysis on AST is M9.7 work.
  if (Array.isArray(requestedFields) && requestedFields.length > 0) {
    if (!projected.has('id')) projected.add('id');
    for (const fname of allFieldNames) {
      // Skip formula fields themselves — they are virtual and not
      // projectable by the underlying driver. Without this guard the
      // SQL driver emits `SELECT response_rate ...` which fails as
      // "no such column" and the driver returns [] (silently).
      const fdef = (schema.fields as any)[fname];
      if (fdef?.type === 'formula') continue;
      projected.add(fname);
    }
    return { plan, projected: Array.from(projected) };
  }
  // Implicit/full projection — leave projected undefined so the driver
  // returns its default columns (typically *).
  return { plan };
}

function applyFormulaPlan(plan: FormulaPlanEntry[], records: any[]): void {
  if (!plan.length) return;
  for (const rec of records) {
    if (rec == null) continue;
    for (const fp of plan) {
      const r = ExpressionEngine.evaluate(fp.expression, { record: rec });
      rec[fp.name] = r.ok ? r.value : null;
    }
  }
}

export type HookHandler = (context: HookContext) => Promise<void> | void;

/**
 * Per-object hook entry with priority support
 */
export interface HookEntry {
  handler: HookHandler;
  object?: string | string[];  // undefined = global hook
  priority: number;
  packageId?: string;
  /**
   * Original metadata-form `Hook` definition this entry was bound from
   * (when registered via `bindHooksToEngine`). Pure code-paths that call
   * `engine.registerHook` directly leave this undefined.
   */
  meta?: any;
  /** Hook `name` from metadata; used for diagnostics & deduplication. */
  hookName?: string;
}

/** Function registry entry — see `registerFunction`. */
interface FunctionEntry {
  handler: HookHandler;
  packageId?: string;
}

/**
 * Operation Context for Middleware Chain
 */
export interface OperationContext {
  object: string;
  operation: 'find' | 'findOne' | 'insert' | 'update' | 'delete' | 'count' | 'aggregate';
  ast?: QueryAST;
  data?: any;
  options?: any;
  context?: ExecutionContext;
  result?: any;
}

/**
 * Engine Middleware (Onion model)
 */
export type EngineMiddleware = (
  ctx: OperationContext,
  next: () => Promise<void>
) => Promise<void>;

/**
 * Host Context provided to plugins (Internal ObjectQL Plugin System)
 */
export interface ObjectQLHostContext {
  ql: ObjectQL;
  logger: Logger;
  // Extensible map for host-specific globals (like HTTP Router, etc.)
  [key: string]: any;
}

/**
 * Derive the registry key for a metadata item.
 *
 * Most metadata items expose a top-level `name` (or `id`). The `View`
 * container defined by `@objectstack/spec/ui` is special: it aggregates
 * `list / form / listViews / formViews` for a single object and is
 * keyed implicitly by its target object name (see `data.object`).
 *
 * Per spec, `ViewSchema` does NOT have a top-level `name` field
 * (view.zod.ts), so we resolve it from the inner data source. This
 * matches the server-side metadata API contract (`/api/v1/meta/views/:object`).
 */
function resolveMetadataItemName(key: string, item: any): string | undefined {
  if (!item) return undefined;
  if (item.name) return item.name;
  if (item.id) return item.id;
  if (key === 'views') {
    // Independent ViewItems ("Object has-many View") carry a top-level `name`
    // (handled above) and bind to their object via `object`. The aggregated
    // container has no top-level name/object, so fall back to its inner data
    // source — matching the loader's expansion key.
    return (
      item?.object ||
      item?.list?.data?.object ||
      item?.form?.data?.object ||
      undefined
    );
  }
  return undefined;
}

/**
 * ObjectQL Engine
 * 
 * Implements the IDataEngine interface for data persistence.
 * Acts as the reference implementation for:
 * - CoreServiceName.data (CRUD)
 * - CoreServiceName.metadata (Schema Registry)
 */
/** A roll-up `summary` field on a parent object that aggregates a child. */
interface SummaryDescriptor {
  parentObject: string;
  summaryField: string;
  /** FK field on the child pointing back to the parent. */
  fkField: string;
  fn: 'count' | 'sum' | 'min' | 'max' | 'avg';
  /** Child field aggregated (unused for count). */
  sourceField: string;
}

export class ObjectQL implements IDataEngine {
  /**
   * Ambient transaction store (ADR-0034). While a `transaction()` callback
   * runs, the active transaction handle lives here so that EVERY data
   * operation — including internal reads done during a write (reference
   * checks, hooks, expand) — automatically binds to the same connection
   * instead of asking the pool for another one and deadlocking on the
   * single-connection SQLite pool.
   */
  private readonly txStore = new AsyncLocalStorage<{ transaction: unknown }>();

  private drivers = new Map<string, DriverInterface>();
  private defaultDriver: string | null = null;
  private logger: Logger;

  // Datasource mapping rules (imported from defineStack)
  private datasourceMapping: Array<{
    namespace?: string;
    package?: string;
    objectPattern?: string;
    default?: boolean;
    datasource: string;
    priority?: number;
  }> = [];

  // Package manifests registry (for defaultDatasource lookup)
  private manifests = new Map<string, any>();

  // Datasource definitions by name (ADR-0015): carries schemaMode +
  // external.allowWrites so the write gate (Gate 3) can enforce federation
  // ownership. Populated from manifests in registerApp and via
  // registerDatasourceDef. Absent entry ⇒ treated as managed (default DB).
  private datasourceDefs = new Map<string, { schemaMode?: string; external?: { allowWrites?: boolean } }>();

  // Per-object hooks with priority support
  private hooks: Map<string, HookEntry[]> = new Map([
    ['beforeFind', []], ['afterFind', []],
    ['beforeInsert', []], ['afterInsert', []],
    ['beforeUpdate', []], ['afterUpdate', []],
    ['beforeDelete', []], ['afterDelete', []],
  ]);

  // Middleware chain (onion model)
  private middlewares: Array<{
    fn: EngineMiddleware;
    object?: string;
  }> = [];

  // Action registry: key = "objectName:actionName"
  private actions = new Map<string, { handler: (ctx: any) => Promise<any> | any; package?: string }>();

  // Function registry: name → handler. Used by `bindHooksToEngine` to
  // resolve string-named hook handlers (the JSON-safe form). Populated by
  // `defineStack({ functions })` via `AppPlugin`, or directly via
  // `engine.registerFunction(...)`.
  private functions = new Map<string, FunctionEntry>();

  // Host provided context additions (e.g. Server router)
  private hostContext: Record<string, any> = {};

  // Realtime service for event publishing
  private realtimeService?: IRealtimeService;

  // Crypto provider backing `secret`-typed fields. Optional: when absent,
  // writing an object that declares a secret field fails closed (never
  // persists cleartext). Injected by the host via setCryptoProvider().
  private cryptoProvider?: ICryptoProvider;

  // Per-engine SchemaRegistry instance.
  //
  // Historically SchemaRegistry was a process-wide singleton of static state,
  // which broke multi-environment servers: a project kernel would inherit every
  // object registered by the control plane (e.g. sys_metadata), and
  // getDriver()'s owner lookup would route CRUD to the wrong database. Each
  // engine now owns its registry so kernels are fully isolated.
  private _registry: SchemaRegistry = new SchemaRegistry();

  constructor(hostContext: Record<string, any> = {}) {
    this.hostContext = hostContext;
    // Use provided logger or create a new one
    this.logger = hostContext.logger || createLogger({ level: 'info', format: 'pretty' });
    // Pick up production hardening switches from env so deployers can
    // enforce strict-body without code changes:
    //   OBJECTQL_STRICT_HOOKS=1 → unresolved hooks throw at bind time
    //   OBJECTQL_WARN_LEGACY_HANDLER=1 → log a deprecation per legacy bind
    if (process?.env?.OBJECTQL_STRICT_HOOKS === '1') {
      (this as any)._strictHookBinding = true;
    }
    if (process?.env?.OBJECTQL_WARN_LEGACY_HANDLER === '1') {
      (this as any)._warnLegacyHandler = true;
    }
    this.logger.info('ObjectQL Engine Instance Created');
  }

  /**
   * Service Status Report
   * Used by Kernel to verify health and capabilities.
   */
  getStatus() {
      return {
          name: CoreServiceName.enum.data,
          status: 'running',
          version: '0.9.0',
          features: ['crud', 'query', 'aggregate', 'transactions', 'metadata']
      };
  }

  /**
   * Expose the SchemaRegistry for plugins to register metadata.
   *
   * Returns the per-engine instance, NOT the class. Each ObjectQL engine
   * owns its registry so multi-environment kernels remain isolated.
   */
  get registry(): SchemaRegistry {
    return this._registry;
  }

  /**
   * Load and Register a Plugin
   */
  async use(manifestPart: any, runtimePart?: any) {
    this.logger.debug('Loading plugin', { 
      hasManifest: !!manifestPart, 
      hasRuntime: !!runtimePart 
    });

    // 1. Validate / Register Manifest
    if (manifestPart) {
      this.registerApp(manifestPart);
    }

    // 2. Execute Runtime
    if (runtimePart) {
       const pluginDef = (runtimePart as any).default || runtimePart;
       if (pluginDef.onEnable) {
          this.logger.debug('Executing plugin runtime onEnable');
          
          const context: ObjectQLHostContext = {
            ql: this,
            logger: this.logger,
            // Expose the driver registry helper explicitly if needed
            drivers: {
                register: (driver: DriverInterface) => this.registerDriver(driver)
            },
            ...this.hostContext
          };
          
          await pluginDef.onEnable(context);
          this.logger.debug('Plugin runtime onEnable completed');
       }
    }
  }

  /**
   * Register a hook
   * @param event The event name (e.g. 'beforeFind', 'afterInsert')
   * @param handler The handler function
   * @param options Optional: target object(s) and priority
   */
  registerHook(event: string, handler: HookHandler, options?: {
    object?: string | string[];
    priority?: number;
    packageId?: string;
    /** Original metadata Hook definition (set by `bindHooksToEngine`). */
    meta?: any;
    /** Stable name from metadata (set by `bindHooksToEngine`). */
    hookName?: string;
  }) {
    if (!this.hooks.has(event)) {
        this.hooks.set(event, []);
    }
    const entries = this.hooks.get(event)!;
    entries.push({
      handler,
      object: options?.object,
      priority: options?.priority ?? 100,
      packageId: options?.packageId,
      meta: options?.meta,
      hookName: options?.hookName,
    });
    // Sort by priority (lower runs first)
    entries.sort((a, b) => a.priority - b.priority);
    this.logger.debug('Registered hook', { event, object: options?.object, priority: options?.priority ?? 100, totalHandlers: entries.length });
  }

  /**
   * Remove all hooks registered under a given `packageId`. Used by
   * `bindHooksToEngine` to make re-binding (hot reload, app reinstall)
   * idempotent, and by app uninstall flows.
   */
  unregisterHooksByPackage(packageId: string): number {
    if (!packageId) return 0;
    let removed = 0;
    for (const [event, entries] of this.hooks.entries()) {
      const before = entries.length;
      const kept = entries.filter((e) => e.packageId !== packageId);
      if (kept.length !== before) {
        this.hooks.set(event, kept);
        removed += before - kept.length;
      }
    }
    if (removed > 0) {
      this.logger.debug('Unregistered hooks by package', { packageId, removed });
    }
    return removed;
  }

  /**
   * Register a named function handler that can later be referenced by
   * string from a `Hook.handler` field. This is the JSON-safe form of
   * handler binding — declarative metadata persisted to disk or shipped
   * over the wire only carries the name.
   */
  registerFunction(name: string, handler: HookHandler, packageId?: string): void {
    if (!name || typeof handler !== 'function') return;
    this.functions.set(name, { handler, packageId });
    this.logger.debug('Registered function', { name, packageId });
  }

  /** Look up a registered function by name. */
  resolveFunction(name: string): HookHandler | undefined {
    return this.functions.get(name)?.handler;
  }

  /** Remove all functions registered under a given `packageId`. */
  unregisterFunctionsByPackage(packageId: string): number {
    if (!packageId) return 0;
    let removed = 0;
    for (const [name, entry] of this.functions.entries()) {
      if (entry.packageId === packageId) {
        this.functions.delete(name);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.logger.debug('Unregistered functions by package', { packageId, removed });
    }
    return removed;
  }

  /**
   * Bind a list of declarative `Hook` metadata definitions to this engine.
   *
   * Convenience proxy to the canonical `bindHooksToEngine` so callers do
   * not need a separate import. Use `import { bindHooksToEngine } from
   * '@objectstack/objectql'` directly when you want the result object.
   */
  bindHooks(hooks: any[] | undefined, opts?: {
    packageId?: string;
    functions?: Record<string, HookHandler>;
    bodyRunner?: any;
    strict?: boolean;
    warnLegacyHandler?: boolean;
    metrics?: any;
  }): void {
    const merged = { ...(opts ?? {}), logger: this.logger } as any;
    if (!merged.bodyRunner && (this as any)._defaultBodyRunner) {
      merged.bodyRunner = (this as any)._defaultBodyRunner;
    }
    if (merged.strict === undefined && (this as any)._strictHookBinding) {
      merged.strict = true;
    }
    if (merged.warnLegacyHandler === undefined && (this as any)._warnLegacyHandler) {
      merged.warnLegacyHandler = true;
    }
    if (!merged.metrics && (this as any)._hookMetricsRecorder) {
      merged.metrics = (this as any)._hookMetricsRecorder;
    }
    bindHooksToEngine(this, hooks, merged);
  }

  /**
   * Install a default body-runner used when `bindHooks` is called without
   * an explicit one. The runtime layer sets this once on each per-project
   * engine so every binding path (template seed, metadata sync, AppPlugin)
   * can execute hook `body.source` consistently.
   */
  setDefaultBodyRunner(runner: any): void {
    (this as any)._defaultBodyRunner = runner;
  }

  /**
   * Toggle strict hook-binding mode for this engine. When enabled, every
   * subsequent `bindHooks` call rejects on the first unresolved hook
   * instead of silently warning. Production runtimes should enable this.
   */
  setStrictHookBinding(strict: boolean): void {
    (this as any)._strictHookBinding = strict;
  }

  /** Toggle deprecation warnings for hooks still using legacy `handler` ref. */
  setWarnLegacyHandler(warn: boolean): void {
    (this as any)._warnLegacyHandler = warn;
  }

  /**
   * Install a metrics recorder used by every subsequent `bindHooks` call.
   * The recorder's methods are invoked per-execution to count outcomes
   * (success / error / timeout / capability_rejected), skips, and retries.
   * Defaults to no-op so the engine pays zero cost when nobody is observing.
   */
  setHookMetricsRecorder(recorder: any): void {
    (this as any)._hookMetricsRecorder = recorder;
  }

  /** Read the engine's installed metrics recorder, if any. */
  getHookMetricsRecorder(): any {
    return (this as any)._hookMetricsRecorder;
  }

  public async triggerHooks(event: string, context: HookContext) {
    const entries = this.hooks.get(event) || [];
    
    if (entries.length === 0) {
      this.logger.debug('No hooks registered for event', { event });
      return;
    }

    this.logger.debug('Triggering hooks', { event, count: entries.length });
    
    for (const entry of entries) {
      // Per-object matching
      if (entry.object) {
        const targets = Array.isArray(entry.object) ? entry.object : [entry.object];
        if (!targets.includes('*') && !targets.includes(context.object)) {
          continue; // Skip non-matching hooks
        }
      }
      await entry.handler(context);
    }
  }

  // ========================================
  // Action System
  // ========================================

  /**
   * Register a named action on an object.
   * Actions are custom business logic callable via `repo.execute(actionName, params)`.
   *
   * @param objectName Target object
   * @param actionName Unique action name within the object
   * @param handler Handler function
   * @param packageName Optional package owner (for cleanup)
   */
  registerAction(objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName?: string): void {
    const key = `${objectName}:${actionName}`;
    this.actions.set(key, { handler, package: packageName });
    this.logger.debug('Registered action', { objectName, actionName, package: packageName });
  }

  /**
   * Execute a named action on an object.
   */
  async executeAction(objectName: string, actionName: string, ctx: any): Promise<any> {
    const entry = this.actions.get(`${objectName}:${actionName}`);
    if (!entry) {
      throw new Error(`Action '${actionName}' on object '${objectName}' not found`);
    }
    return entry.handler(ctx);
  }

  /**
   * Remove all actions registered by a specific package.
   */
  removeActionsByPackage(packageName: string): void {
    for (const [key, entry] of this.actions.entries()) {
      if (entry.package === packageName) {
        this.actions.delete(key);
      }
    }
  }

  /**
   * Register a middleware function
   * Middlewares execute in onion model around every data operation.
   * @param fn The middleware function
   * @param options Optional: target object filter
   */
  registerMiddleware(fn: EngineMiddleware, options?: { object?: string }): void {
    this.middlewares.push({ fn, object: options?.object });
    this.logger.debug('Registered middleware', { object: options?.object, total: this.middlewares.length });
  }

  /**
   * Execute an operation through the middleware chain
   */
  private async executeWithMiddleware(ctx: OperationContext, executor: () => Promise<any>): Promise<any> {
    const applicable = this.middlewares.filter(m =>
      !m.object || m.object === '*' || m.object === ctx.object
    );

    let index = 0;
    const next = async (): Promise<void> => {
      if (index < applicable.length) {
        const mw = applicable[index++];
        await mw.fn(ctx, next);
      } else {
        ctx.result = await executor();
      }
    };

    await next();
    return ctx.result;
  }

  /**
   * Build a HookContext.session from ExecutionContext
   */
  private buildSession(execCtx?: ExecutionContext): HookContext['session'] {
    if (!execCtx) return undefined;
    return {
      userId: execCtx.userId,
      tenantId: execCtx.tenantId,
      roles: execCtx.roles,
      accessToken: execCtx.accessToken,
      // Propagate system-elevated flag so hooks can distinguish engine
      // self-writes (e.g. approval status mirror) from genuine user writes.
      ...((execCtx as any).isSystem ? { isSystem: true } : {}),
    } as HookContext['session'];
  }

  /**
   * Build the DriverOptions blob passed to every IDataDriver call.
   *
   * Always carries `tenantId` from the active ExecutionContext so the
   * driver can enforce per-tenant isolation (SQL driver auto-scopes reads
   * and auto-injects the tenant column on writes). Existing user-supplied
   * shapes (transactions, AST extras) are preserved by spreading them
   * first.
   *
   * System / isSystem callers may still cross tenants by clearing
   * `tenantId` themselves on the resulting object; this helper does not
   * mask the system path.
   */
  private buildDriverOptions(execCtx?: ExecutionContext, base?: any): any {
    // The open transaction may arrive explicitly via the context, or ambiently
    // via txStore when an internal query runs during a transactional write
    // (ADR-0034). Explicit wins; ambient is the safety net.
    const tx = execCtx?.transaction !== undefined
      ? execCtx.transaction
      : this.txStore.getStore()?.transaction;
    const hasTx = tx !== undefined;
    const hasTenant = execCtx?.tenantId !== undefined;
    const isSystem = execCtx?.isSystem === true;
    if (!hasTx && !hasTenant && !isSystem) return base;
    const opts: any = base && typeof base === 'object' ? { ...base } : {};
    if (hasTx && opts.transaction === undefined) {
      opts.transaction = tx;
    }
    if (hasTenant && opts.tenantId === undefined) {
      opts.tenantId = execCtx!.tenantId;
    }
    if (isSystem && opts.bypassTenantAudit === undefined) {
      // System-elevated writes (boot-time seeds, internal mirrors, scheduled
      // hooks) are unscoped by design — silence the audit warn for them but
      // still flag genuine user-path bugs.
      opts.bypassTenantAudit = true;
    }
    return opts;
  }

  /**
   * Build a HookContext.api: a ScopedContext that hooks can use to
   * read/write other objects within the same execution context.
   * Falls back to a system-elevated empty context when no execCtx
   * is supplied (e.g. system-triggered hooks).
   */
  private buildHookApi(execCtx?: ExecutionContext): ScopedContext {
    const safeCtx: ExecutionContext = execCtx ?? ({ isSystem: true } as any);
    return new ScopedContext(safeCtx, this as unknown as IDataEngine);
  }

  /**
   * Apply field defaults to an incoming insert payload. Defaults that are
   * Expression envelopes (e.g. `{ dialect: 'cel', source: 'today()' }`,
   * `{ dialect: 'cel', source: 'os.user.id' }`) are evaluated via
   * `ExpressionEngine` against the calling user/org/now snapshot. Static
   * defaults are applied verbatim. Records that already supplied a value for a
   * field are left untouched.
   *
   * Implements ROADMAP §M9.9b — `defaultValue` accepts Expression so authors
   * can replace "write a hook to default to today/current-user" with a
   * declarative `defaultValue: cel\`today()\``.
   */
  private applyFieldDefaults(
    object: string,
    record: Record<string, unknown>,
    execCtx?: ExecutionContext,
    nowSnapshot?: Date,
  ): Record<string, unknown> {
    const schema = this.getSchema(object);
    const fieldsRaw = (schema as any)?.fields;
    if (!fieldsRaw || typeof fieldsRaw !== 'object') return record;
    // `fields` may be a Record<string, Field> (canonical) or an array (legacy).
    const fieldEntries: Array<{ name: string; defaultValue?: unknown }> = Array.isArray(fieldsRaw)
      ? fieldsRaw
      : Object.entries(fieldsRaw).map(([name, def]) => ({ name, ...(def as object) }));
    const out = { ...record };
    const now = nowSnapshot ?? new Date();
    for (const f of fieldEntries) {
      if (out[f.name] !== undefined) continue;
      if (f.defaultValue == null) continue;
      const dv = f.defaultValue;
      if (typeof dv === 'object' && dv !== null && (dv as any).dialect && typeof (dv as any).source === 'string') {
        const result = ExpressionEngine.evaluate(dv as any, {
          now,
          user: execCtx?.userId ? { id: String(execCtx.userId), role: execCtx?.roles?.[0] } : undefined,
          org: execCtx?.tenantId ? { id: String(execCtx.tenantId) } : undefined,
          record: out,
          extra: { object },
        });
        if (result.ok) {
          out[f.name] = result.value as unknown;
        } else {
          this.logger.warn('Failed to evaluate default expression', {
            object, field: f.name, error: result.error,
          });
        }
      } else {
        out[f.name] = dv;
      }
    }
    return out;
  }

  /**
   * Generate values for empty `autonumber` fields on insert — ONLY for drivers
   * that do not generate them natively (memory, mongodb). For SQL-backed objects
   * the driver owns a persistent, atomic `_objectstack_sequences` table and
   * advertises `supports.autonumber === true`; the engine then defers entirely
   * and never pre-fills (so the persistent sequence is the single source of
   * truth — see #1603). Required-validation exempts `autonumber` either way, so
   * a `required` record number is never rejected for "missing" — the runtime
   * owns the value, not the client.
   *
   * In the fallback path the next value is `max(existing) + 1`, seeded once per
   * `object.field` from the store then incremented in memory (monotonic within
   * the process, resilient to deletions). `autonumberFormat` is honored, e.g.
   * `CASE-{0000}` → `CASE-0042`. NOTE: this in-memory seeding is single-instance.
   */
  private async applyAutonumbers(
    object: string,
    record: Record<string, unknown>,
    execCtx?: ExecutionContext,
    driverOwnsAutonumber?: boolean,
  ): Promise<void> {
    if (driverOwnsAutonumber) return; // driver generates persistently in create()
    const fields = (this.getSchema(object) as any)?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
    for (const [name, def] of Object.entries(fields)) {
      if ((def as any)?.type !== 'autonumber') continue;
      const current = record[name];
      if (current != null && current !== '') continue; // respect explicit value
      const key = `${object}.${name}`;
      let next = this.autonumberCounters.get(key);
      if (next == null) next = await this.seedAutonumber(object, name, execCtx);
      next += 1;
      this.autonumberCounters.set(key, next);
      // Honor either the spec-canonical `autonumberFormat` or the shorthand
      // `format` (both appear in metadata; the driver reads both too) — #1603.
      const fmt = (def as any).autonumberFormat ?? (def as any).format;
      record[name] = this.formatAutonumber(fmt, next);
    }
  }

  /** Seed the autonumber counter from the current max numeric value in store. */
  private async seedAutonumber(
    object: string,
    field: string,
    execCtx?: ExecutionContext,
  ): Promise<number> {
    try {
      const rows = await this.find(object, {
        select: ['id', field],
        limit: 5000,
        context: execCtx,
      } as any);
      let max = 0;
      for (const r of rows || []) {
        const v = r?.[field];
        if (v == null) continue;
        const m = String(v).match(/(\d+)(?!.*\d)/); // last run of digits
        if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
      }
      return max;
    } catch {
      return 0;
    }
  }

  /** Apply an autonumber format like `CASE-{0000}`; default to the bare number. */
  private formatAutonumber(format: string | undefined, value: number): string {
    if (!format) return String(value);
    const m = format.match(/\{(0+)\}/);
    if (!m) return format.includes('{0}') ? format.replace('{0}', String(value)) : `${format}${value}`;
    const padded = String(value).padStart(m[1].length, '0');
    return format.replace(m[0], padded);
  }

  /**
   * Register contribution (Manifest)
   * 
   * Installs the manifest as a Package (the unit of installation),
   * then decomposes it into individual metadata items (objects, apps, actions, etc.)
   * and registers each into the SchemaRegistry.
   * 
   * Key: Package ≠ App. The manifest is the package. The apps[] array inside
   * the manifest contains UI navigation definitions (AppSchema).
   */
  registerApp(manifest: any) {
      const id = manifest.id || manifest.name;
      const namespace = manifest.namespace as string | undefined;
      this.invalidateSummaryIndex(); // new objects may add/change summary fields
      this.logger.debug('Registering package manifest', { id, namespace });
      console.warn(`[ObjectQL:registerApp] id=${id} flows=${Array.isArray(manifest.flows) ? manifest.flows.length : typeof manifest.flows} keys=${Object.keys(manifest).join(',')}`);

      // Store manifest for defaultDatasource lookup
      if (id) {
        this.manifests.set(id, manifest);
      }

      // Index datasource definitions (ADR-0015) so the write gate can read
      // schemaMode + external.allowWrites. Manifests may carry `datasources`
      // as an array or a name-keyed map.
      if (manifest.datasources) {
        const dsList = Array.isArray(manifest.datasources)
          ? manifest.datasources
          : Object.entries(manifest.datasources).map(([name, def]) => ({ name, ...(def as any) }));
        for (const ds of dsList) {
          if (ds?.name) this.registerDatasourceDef(ds);
        }
      }

      // 1. Register the Package (manifest + lifecycle state)
      this._registry.installPackage(manifest);
      this.logger.debug('Installed Package', { id: manifest.id, name: manifest.name, namespace });

      // 2. Register owned objects
      if (manifest.objects) {
          if (Array.isArray(manifest.objects)) {
             this.logger.debug('Registering objects from manifest (Array)', { id, objectCount: manifest.objects.length });
             for (const objDef of manifest.objects) {
                const fqn = this._registry.registerObject(objDef, id, namespace, 'own');
                this.logger.debug('Registered Object', { fqn, from: id });
             }
          } else {
             this.logger.debug('Registering objects from manifest (Map)', { id, objectCount: Object.keys(manifest.objects).length });
             for (const [name, objDef] of Object.entries(manifest.objects)) {
                // Ensure name in definition matches key
                (objDef as any).name = name;
                const fqn = this._registry.registerObject(objDef as any, id, namespace, 'own');
                this.logger.debug('Registered Object', { fqn, from: id });
             }
          }
      }

      // 2b. Register object extensions (fields added to objects owned by other packages)
      if (Array.isArray(manifest.objectExtensions) && manifest.objectExtensions.length > 0) {
          this.logger.debug('Registering object extensions', { id, count: manifest.objectExtensions.length });
          for (const ext of manifest.objectExtensions) {
              const targetFqn = ext.extend;
              const priority = ext.priority ?? 200;
              // Create a partial object definition for the extension
              const extDef = {
                  name: targetFqn, // Use the target FQN as name
                  fields: ext.fields,
                  label: ext.label,
                  pluralLabel: ext.pluralLabel,
                  description: ext.description,
                  validations: ext.validations,
                  indexes: ext.indexes,
              };
              // Register as extension (namespace is undefined since we're targeting by FQN)
              this._registry.registerObject(extDef as any, id, undefined, 'extend', priority);
              this.logger.debug('Registered Object Extension', { target: targetFqn, priority, from: id });
          }
      }

      // 3. Register apps (UI navigation definitions) as their own metadata type
      //    Resolve short objectName references in navigation to FQN so the
      //    Console UI can match them against the object registry.
      if (Array.isArray(manifest.apps) && manifest.apps.length > 0) {
          this.logger.debug('Registering apps from manifest', { id, count: manifest.apps.length });
          for (const app of manifest.apps) {
              const appName = app.name || app.id;
              if (appName) {
                  const resolved = namespace ? this.resolveNavObjectNames(app, namespace) : app;
                  this._registry.registerApp(resolved, id);
                  this.logger.debug('Registered App', { app: appName, from: id });
              }
          }
      }

      // 4. If manifest itself looks like an App (has navigation), also register as app
      //    This handles the case where the manifest IS the app definition (legacy/simple packages)
      if (manifest.name && manifest.navigation && !manifest.apps?.length) {
          const resolved = namespace ? this.resolveNavObjectNames(manifest, namespace) : manifest;
          this._registry.registerApp(resolved, id);
          this.logger.debug('Registered manifest-as-app', { app: manifest.name, from: id });
      }

      // 4b. Register navigation contributions (ADR-0029 D7) — nav items this
      //     package injects into apps owned by other packages (e.g. a
      //     capability plugin adding its menu into the `setup` app). Merged
      //     into the target app's navigation on read by group id + priority.
      if (Array.isArray((manifest as any).navigationContributions) && (manifest as any).navigationContributions.length > 0) {
          for (const contribution of (manifest as any).navigationContributions) {
              this._registry.registerAppNavContribution(contribution, id);
          }
          this.logger.debug('Registered navigation contributions', {
              from: id,
              count: (manifest as any).navigationContributions.length,
          });
      }

      // 5. Register all other metadata types generically
      const metadataArrayKeys = [
        // UI Protocol
        'actions', 'views', 'pages', 'dashboards', 'reports', 'datasets', 'themes',
        // Automation Protocol
        'flows', 'workflows', 'approvals', 'webhooks',
        'jobs',
        // Security Protocol
        'roles', 'permissions', 'profiles', 'sharingRules', 'policies',
        // AI Protocol
        'agents', 'tools', 'skills', 'ragPipelines',
        // API Protocol
        'apis',
        // Data Extensions
        'hooks', 'mappings', 'analyticsCubes',
        // Integration Protocol
        'connectors',
        // System Protocol — package documentation (ADR-0046); inert data
        'docs',
        // Documentation navigation spine (ADR-0046 §6)
        'books',
      ];
      for (const key of metadataArrayKeys) {
          const items = (manifest as any)[key];
          if (Array.isArray(items) && items.length > 0) {
              this.logger.debug(`Registering ${key} from manifest`, { id, count: items.length });
              for (const item of items) {
                  const itemName = resolveMetadataItemName(key, item);
                  if (itemName) {
                      const toRegister = item.name === itemName ? item : { ...item, name: itemName };
                      this._registry.registerItem(pluralToSingular(key), toRegister, 'name' as any, id);
                      // "Object has-many View" (ADR-0017): a `defineView` document
                      // aggregates an object's views. Register the container under
                      // the bare <object> key (above, back-compat) AND expand it
                      // into independent ViewItems registered under <object>.<key>,
                      // so `getViewsByObject()` / `GET /meta/view?object=` surface
                      // the per-view `package` layer the switcher + Studio consume.
                      if (key === 'views' && isAggregatedViewContainer(toRegister)) {
                          for (const vi of expandViewContainer(itemName, toRegister)) {
                              this._registry.registerItem('view', vi, 'name' as any, id);
                          }
                      }
                  } else {
                      this.logger.warn(`Skipping ${pluralToSingular(key)} without a derivable name`, { id });
                  }
              }
          }
      }

      // 6. Register seed data as metadata (keyed by target object name)
      const seedData = (manifest as any).data;
      if (Array.isArray(seedData) && seedData.length > 0) {
          this.logger.debug('Registering seed data datasets', { id, count: seedData.length });
          for (const dataset of seedData) {
              if (dataset.object) {
                  this._registry.registerItem('data', dataset, 'object' as any, id);
              }
          }
      }

      // 6. Register contributions
       if (manifest.contributes?.kinds) {
          this.logger.debug('Registering kinds from manifest', { id, kindCount: manifest.contributes.kinds.length });
          for (const kind of manifest.contributes.kinds) {
            this._registry.registerKind(kind);
            this.logger.debug('Registered Kind', { kind: kind.name || kind.type, from: id });
          }
       }

      // 7. Recursively register nested plugins
      if (Array.isArray(manifest.plugins) && manifest.plugins.length > 0) {
          this.logger.debug('Processing nested plugins', { id, count: manifest.plugins.length });
          for (const plugin of manifest.plugins) {
              if (plugin && typeof plugin === 'object') {
                  const pluginName = plugin.name || plugin.id || 'unnamed-plugin';
                  this.logger.debug('Registering nested plugin', { pluginName, parentId: id });
                  this.registerPlugin(plugin, id, namespace);
              }
          }
      }
  }

  /**
   * Deep-clone an app definition, resolving objectName references in navigation
   * items via the registry. Object names are canonical identifiers — no FQN
   * expansion is applied.
   */
  private resolveNavObjectNames(app: any, namespace: string): any {
      if (!app.navigation) return app;

      const resolveItems = (items: any[]): any[] =>
          items.map((item: any) => {
              const resolved = { ...item };
              if (resolved.objectName && !resolved.objectName.includes('__')) {
                  resolved.objectName = computeFQN(namespace, resolved.objectName);
              }
              if (Array.isArray(resolved.children)) {
                  resolved.children = resolveItems(resolved.children);
              }
              return resolved;
          });

      return { ...app, navigation: resolveItems(app.navigation) };
  }

  /**
   * Register a nested plugin's metadata (objects, actions, views, etc.)
   *
   * Unlike registerApp(), this does NOT call SchemaRegistry.installPackage()
   * because plugins are not formal manifests — they are lightweight config
   * bundles with objects, actions, triggers, and navigation.
   *
   * @param plugin - The plugin config object
   * @param parentId - The parent package ID (for ownership tracking)
   * @param parentNamespace - The parent package's namespace (for FQN resolution)
   */
  private registerPlugin(plugin: any, parentId: string, parentNamespace?: string) {
      const pluginName = plugin.name || plugin.id || 'unnamed';
      const pluginNamespace = plugin.namespace || parentNamespace;

      // Use parentId as the owning package for namespace consistency.
      // The parent package already claimed the namespace — nested plugins
      // contribute objects UNDER the parent's ownership.
      const ownerId = parentId;

      // Register objects (supports both Array and Map formats)
      if (plugin.objects) {
          try {
              if (Array.isArray(plugin.objects)) {
                  this.logger.debug('Registering plugin objects (Array)', { pluginName, count: plugin.objects.length });
                  for (const objDef of plugin.objects) {
                      const fqn = this._registry.registerObject(objDef, ownerId, pluginNamespace, 'own');
                      this.logger.debug('Registered Object', { fqn, from: pluginName });
                  }
              } else {
                  const entries = Object.entries(plugin.objects);
                  this.logger.debug('Registering plugin objects (Map)', { pluginName, count: entries.length });
                  for (const [name, objDef] of entries) {
                      (objDef as any).name = name;
                      const fqn = this._registry.registerObject(objDef as any, ownerId, pluginNamespace, 'own');
                      this.logger.debug('Registered Object', { fqn, from: pluginName });
                  }
              }
          } catch (err: any) {
              this.logger.warn('Failed to register plugin objects', { pluginName, error: err.message });
          }
      }

      // Register plugin as app if it has navigation (for sidebar display)
      if (plugin.name && plugin.navigation) {
          try {
              const resolved = pluginNamespace ? this.resolveNavObjectNames(plugin, pluginNamespace) : plugin;
              this._registry.registerApp(resolved, ownerId);
              this.logger.debug('Registered plugin-as-app', { app: plugin.name, from: pluginName });
          } catch (err: any) {
              this.logger.warn('Failed to register plugin as app', { pluginName, error: err.message });
          }
      }

      // Register metadata arrays (actions, views, triggers, etc.)
      const metadataArrayKeys = [
          'actions', 'views', 'pages', 'dashboards', 'reports', 'datasets', 'themes',
          'flows', 'workflows', 'approvals', 'webhooks',
          'roles', 'permissions', 'profiles', 'sharingRules', 'policies',
          'agents', 'ragPipelines', 'apis',
          'hooks', 'mappings', 'analyticsCubes', 'connectors',
          'docs', 'books',
      ];
      for (const key of metadataArrayKeys) {
          const items = (plugin as any)[key];
          if (Array.isArray(items) && items.length > 0) {
              for (const item of items) {
                  const itemName = resolveMetadataItemName(key, item);
                  if (itemName) {
                      const toRegister = item.name === itemName ? item : { ...item, name: itemName };
                      this._registry.registerItem(pluralToSingular(key), toRegister, 'name' as any, ownerId);
                  }
              }
          }
      }
  }

  /**
   * Register a new storage driver
   */
  registerDriver(driver: DriverInterface, isDefault: boolean = false) {
    if (this.drivers.has(driver.name)) {
      this.logger.warn('Driver already registered, skipping', { driverName: driver.name });
      return;
    }

    this.drivers.set(driver.name, driver);
    this.logger.info('Registered driver', {
      driverName: driver.name,
      version: driver.version
    });

    if (isDefault || this.drivers.size === 1) {
      this.defaultDriver = driver.name;
      this.logger.info('Set default driver', { driverName: driver.name });
    }
  }

  /**
   * Register a Datasource *definition* (ADR-0015).
   *
   * Distinct from {@link registerDriver}, which registers a live connection.
   * This captures the declarative `schemaMode` + `external.allowWrites` so the
   * write gate ({@link assertWriteAllowed}) can enforce external-datasource
   * ownership. Safe to call repeatedly; last write wins.
   */
  registerDatasourceDef(def: { name: string; schemaMode?: string; external?: { allowWrites?: boolean } }): void {
    if (!def?.name) return;
    this.datasourceDefs.set(def.name, { schemaMode: def.schemaMode, external: def.external });
  }

  /**
   * Write gate — Gate 3 of ADR-0015 §5.3.
   *
   * Blocks insert/update/delete against a federated datasource
   * (`schemaMode !== 'managed'`) unless BOTH the datasource opts in
   * (`external.allowWrites`) AND the object opts in (`external.writable`).
   * Managed datasources (the common case, including the absence of any
   * definition) are unaffected.
   */
  private assertWriteAllowed(objectName: string, operation: 'insert' | 'update' | 'delete'): void {
    const object = this._registry.getObject(objectName) as any;
    const dsName = object?.datasource;
    if (!dsName || dsName === 'default') return;

    const ds = this.datasourceDefs.get(dsName);
    // No recorded definition, or an explicitly managed one ⇒ allow.
    if (!ds || !ds.schemaMode || ds.schemaMode === 'managed') return;

    const dsAllows = ds.external?.allowWrites ?? false;
    const objAllows = object?.external?.writable ?? false;
    if (!(dsAllows && objAllows)) {
      throw new ExternalWriteForbiddenError(
        `Write '${operation}' blocked on object '${objectName}': datasource '${dsName}' is external ` +
          `(schemaMode=${ds.schemaMode}). Requires datasource.external.allowWrites=true (got ${dsAllows}) ` +
          `AND object.external.writable=true (got ${objAllows}).`,
      );
    }
  }

  /**
   * Set the realtime service for publishing data change events.
   * Should be called after kernel resolves the realtime service.
   *
   * @param service - An IRealtimeService instance for event publishing
   */
  setRealtimeService(service: IRealtimeService): void {
    this.realtimeService = service;
    this.logger.info('RealtimeService configured for data events');
  }

  /**
   * Register the crypto provider that backs `secret`-typed fields.
   *
   * When set, the engine encrypts secret fields on write (storing ciphertext in
   * `sys_secret` and only an opaque ref on the business row) and masks them on
   * read. When NOT set, writing to an object that declares a secret field is
   * **fail-closed** — the write throws rather than persist cleartext.
   *
   * Mirrors the Settings subsystem's ICryptoProvider wiring; the host (e.g.
   * `serve`) injects `LocalCryptoProvider` in dev and a KMS/Vault-backed
   * provider in production.
   */
  setCryptoProvider(provider: ICryptoProvider): void {
    this.cryptoProvider = provider;
    this.logger.info('CryptoProvider configured for secret fields');
  }

  /**
   * Encrypt any `secret`-typed fields on `row` in place before it reaches the
   * driver. Each plaintext is wrapped by the ICryptoProvider, persisted as a
   * `sys_secret` row, and replaced on `row` by an opaque ref. Cleartext never
   * reaches the business table.
   *
   * Rules:
   *  - No secret fields on the object ⇒ no-op (fast path, no crypto cost).
   *  - `null`/`undefined` value ⇒ left as-is (clears the secret).
   *  - Value already a ref (re-save of an unchanged ref) ⇒ left as-is.
   *  - Value equal to the read mask ⇒ dropped, so a form round-trip that
   *    echoes the mask does not overwrite the stored secret.
   *  - **Fail-closed:** any other value with no CryptoProvider registered, or
   *    no reachable `sys_secret` store, THROWS — never persists cleartext.
   */
  private async encryptSecretFields(
    object: string,
    row: Record<string, unknown>,
    context: ExecutionContext | undefined,
    driverOptions: unknown,
  ): Promise<void> {
    if (!row || typeof row !== 'object') return;
    const schema = this._registry.getObject(object);
    const secretFields = collectSecretFields(schema);
    if (secretFields.length === 0) return;

    for (const field of secretFields) {
      if (!(field in row)) continue;
      const value = row[field];

      if (value === null || typeof value === 'undefined') continue; // clear
      if (isSecretRef(value)) continue; // already encrypted ref
      if (value === SECRET_MASK) {
        // The read path masks secrets to SECRET_MASK; a form that echoes it
        // back means "unchanged". Drop the key so the stored secret survives.
        delete row[field];
        continue;
      }

      if (!this.cryptoProvider) {
        throw new Error(
          `Cannot persist secret field "${object}.${field}": no CryptoProvider is registered. `
            + 'Wire one via engine.setCryptoProvider(...) (e.g. LocalCryptoProvider in dev, '
            + 'a KMS/Vault provider in production). Refusing to store cleartext (fail-closed).',
        );
      }

      const plain = typeof value === 'string' ? value : JSON.stringify(value);
      const handle: CryptoHandle = await this.cryptoProvider.encrypt(plain, {
        namespace: object,
        key: field,
        tenantId: context?.tenantId,
      });

      let secretDriver;
      try {
        secretDriver = this.getDriver('sys_secret');
      } catch {
        throw new Error(
          `Cannot persist secret field "${object}.${field}": the sys_secret store is not available. `
            + 'Ensure the platform-objects (sys_secret) are registered before writing secret fields (fail-closed).',
        );
      }

      await secretDriver.create(
        'sys_secret',
        {
          id: handle.id,
          namespace: object,
          key: field,
          kms_key_id: handle.kmsKeyId,
          alg: handle.alg,
          version: handle.version,
          ciphertext: handle.ciphertext,
          created_at: new Date().toISOString(),
        },
        driverOptions as any,
      );

      row[field] = makeSecretRef(handle.id);
    }
  }

  /**
   * Mask `secret`-typed fields on read so plaintext never leaves the engine
   * through the normal query path. A set secret becomes {@link SECRET_MASK};
   * an unset one stays `null`. Privileged callers that genuinely need the
   * plaintext use {@link resolveSecret} against the stored ref.
   */
  private maskSecretFields(object: string, rows: any): void {
    if (!rows) return;
    const schema = this._registry.getObject(object);
    const secretFields = collectSecretFields(schema);
    if (secretFields.length === 0) return;
    const list = Array.isArray(rows) ? rows : [rows];
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      for (const field of secretFields) {
        if (!(field in row)) continue;
        row[field] = row[field] == null ? null : SECRET_MASK;
      }
    }
  }

  /**
   * Dereference a stored secret ref back to its plaintext. Intended for
   * privileged, server-side consumers (e.g. a datasource connection-pool
   * binder) — NOT exposed through the generic read path, which only ever
   * returns the mask.
   *
   * Fail-closed: throws when no CryptoProvider is registered or the
   * `sys_secret` row is missing. Returns `null` when `ref` is not a secret ref.
   */
  async resolveSecret(ref: unknown, opts?: { tenantId?: string }): Promise<string | null> {
    const id = parseSecretRef(ref);
    if (!id) return null;
    if (!this.cryptoProvider) {
      throw new Error('Cannot resolve secret: no CryptoProvider is registered (fail-closed).');
    }
    const secretDriver = this.getDriver('sys_secret');
    const found = await secretDriver.find('sys_secret', { object: 'sys_secret', where: { id } } as QueryAST);
    const secret: any = Array.isArray(found) ? found[0] : found;
    if (!secret) {
      throw new Error(`Cannot resolve secret: sys_secret row "${id}" not found (fail-closed).`);
    }
    const handle: CryptoHandle = {
      id: secret.id,
      kmsKeyId: secret.kms_key_id,
      alg: secret.alg,
      version: secret.version,
      ciphertext: secret.ciphertext,
    };
    return this.cryptoProvider.decrypt(handle, {
      namespace: secret.namespace,
      key: secret.key,
      tenantId: opts?.tenantId,
    });
  }

  /**
   * Helper to get object definition
   */
  getSchema(objectName: string): ServiceObject | undefined {
    return this._registry.getObject(objectName);
  }

  /**
   * Resolve any object identifier to the physical storage name used by drivers.
   *
   * Accepts the canonical short name (e.g., 'account') or, for explicit
   * cross-package disambiguation, the canonical object name (e.g., 'account'). The result is
   * the physical table name derived via `StorageNameMapping.resolveTableName`.
   */
  private resolveObjectName(name: string): string {
    const schema = this._registry.getObject(name);
    if (schema) {
      return StorageNameMapping.resolveTableName(schema);
    }
    // Return name as-is (canonical name = table name; no FQN prefix to strip)
    return StorageNameMapping.resolveTableName({ name });
  }

  /**
   * Helper to get the target driver
   *
   * Resolution priority (first match wins):
   * 1. Object's explicit `datasource` field (if not 'default')
   * 2. DatasourceMapping rules (namespace/package/pattern matching)
   * 3. Package's `defaultDatasource` from manifest
   * 4. Global default driver
   */
  private getDriver(objectName: string): DriverInterface {
    const object = this._registry.getObject(objectName);

    // 1. Object's explicit datasource field (highest priority)
    if (object?.datasource && object.datasource !== 'default') {
      if (this.drivers.has(object.datasource)) {
        return this.drivers.get(object.datasource)!;
      }
      throw new Error(`[ObjectQL] Datasource '${object.datasource}' configured for object '${objectName}' is not registered.`);
    }

    // 2. Check datasourceMapping rules
    const mappedDatasource = this.resolveDatasourceFromMapping(objectName, object);
    if (mappedDatasource && this.drivers.has(mappedDatasource)) {
      this.logger.debug('Resolved datasource from mapping', {
        object: objectName,
        datasource: mappedDatasource
      });
      return this.drivers.get(mappedDatasource)!;
    }

    // 3. Check package's defaultDatasource
    // Use the object's FQN name (from getObject) for ownership lookup
    const fqn = object?.name || objectName;
    const owner = this._registry.getObjectOwner(fqn);
    if (owner?.packageId) {
      const manifest = this.manifests.get(owner.packageId);
      if (manifest?.defaultDatasource && manifest.defaultDatasource !== 'default') {
        if (this.drivers.has(manifest.defaultDatasource)) {
          this.logger.debug('Resolved datasource from package manifest', {
            object: objectName,
            package: owner.packageId,
            datasource: manifest.defaultDatasource
          });
          return this.drivers.get(manifest.defaultDatasource)!;
        }
      }
    }

    // 4. Fallback to global default driver
    if (this.defaultDriver && this.drivers.has(this.defaultDriver)) {
      return this.drivers.get(this.defaultDriver)!;
    }

    throw new Error(`[ObjectQL] No driver available for object '${objectName}'`);
  }

  /**
   * Resolve datasource from mapping rules
   *
   * Rules are evaluated in order (or by priority if specified).
   * First matching rule wins.
   */
  private resolveDatasourceFromMapping(
    objectName: string,
    object?: any
  ): string | null {
    if (!this.datasourceMapping || this.datasourceMapping.length === 0) {
      return null;
    }

    // Sort rules by priority if any have priority set
    const sortedRules = [...this.datasourceMapping].sort((a, b) => {
      const aPriority = a.priority ?? 1000;
      const bPriority = b.priority ?? 1000;
      return aPriority - bPriority;
    });

    for (const rule of sortedRules) {
      // 1. Match by namespace
      if (rule.namespace && object?.namespace === rule.namespace) {
        return rule.datasource;
      }

      // 2. Match by package ID
      if (rule.package && object?.packageId === rule.package) {
        return rule.datasource;
      }

      // 3. Match by object name pattern (glob-style)
      if (rule.objectPattern && this.matchPattern(objectName, rule.objectPattern)) {
        return rule.datasource;
      }

      // 4. Default fallback rule
      if (rule.default) {
        return rule.datasource;
      }
    }

    return null;
  }

  /**
   * Simple glob pattern matching
   * Supports * (any chars) and ? (single char)
   */
  private matchPattern(objectName: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
      .replace(/\*/g, '.*')                   // * → .*
      .replace(/\?/g, '.');                   // ? → .

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(objectName);
  }

  /**
   * Set datasource mapping rules
   * Called by ObjectQLPlugin during bootstrap
   */
  setDatasourceMapping(rules: Array<{
    namespace?: string;
    package?: string;
    objectPattern?: string;
    default?: boolean;
    datasource: string;
    priority?: number;
  }>) {
    this.datasourceMapping = rules;
    this.logger.info('Datasource mapping rules configured', {
      ruleCount: rules.length
    });
  }

  /**
   * Initialize the engine and all registered drivers
   */
  async init() {
    this.logger.info('Initializing ObjectQL engine', { 
      driverCount: this.drivers.size,
      drivers: Array.from(this.drivers.keys())
    });
    
    const failedDrivers: string[] = [];
    for (const [name, driver] of this.drivers) {
      try {
        await driver.connect();
        this.logger.info('Driver connected successfully', { driverName: name });
      } catch (e) {
        failedDrivers.push(name);
        this.logger.error('Failed to connect driver', e as Error, { driverName: name });
      }
    }

    if (failedDrivers.length > 0) {
      this.logger.warn(
        `${failedDrivers.length} of ${this.drivers.size} driver(s) failed initial connect. ` +
        `Operations may recover via lazy reconnection or fail at query time.`,
        { failedDrivers }
      );
    }
    
    this.logger.info('ObjectQL engine initialization complete');
  }

  async destroy() {
    this.logger.info('Destroying ObjectQL engine', { driverCount: this.drivers.size });
    
    for (const [name, driver] of this.drivers.entries()) {
      try {
        await driver.disconnect();
      } catch (e) {
        this.logger.error('Error disconnecting driver', e as Error, { driverName: name });
      }
    }
    
    this.logger.info('ObjectQL engine destroyed');
  }

  // ============================================
  // Helper: Expand Related Records
  // ============================================

  /** Maximum depth for recursive expand to prevent infinite loops */
  private static readonly MAX_EXPAND_DEPTH = 3;
  private static readonly MAX_CASCADE_DEPTH = 10;
  /** In-memory next-value cache per `object.field` for autonumber generation,
   *  lazily seeded from the current max in the store. */
  private readonly autonumberCounters = new Map<string, number>();

  /** Lazily-built index: child object name → roll-up summary descriptors on
   *  parent objects that aggregate it. Invalidated when packages register. */
  private summaryIndex: Map<string, SummaryDescriptor[]> | null = null;

  /** Invalidate the cached roll-up summary index (call when metadata changes). */
  private invalidateSummaryIndex(): void {
    this.summaryIndex = null;
  }

  /** Scan all registered objects for `summary` fields and index them by the
   *  child object they aggregate, resolving the child→parent FK field. */
  private buildSummaryIndex(): Map<string, SummaryDescriptor[]> {
    const index = new Map<string, SummaryDescriptor[]>();
    let objects: any[] = [];
    try { objects = (this._registry as any).getAllObjects?.() ?? []; } catch { objects = []; }
    for (const parent of objects) {
      const fields = parent?.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
      for (const [summaryField, def] of Object.entries(fields)) {
        const d: any = def;
        if (d?.type !== 'summary' || !d.summaryOperations) continue;
        const so = d.summaryOperations;
        const childObject = so.object;
        const fn = so.function;
        if (!childObject || !fn) continue;
        // Resolve the FK on the child pointing back to this parent.
        let fkField: string | undefined = so.relationshipField;
        if (!fkField) {
          const child = this._registry.getObject(childObject) as any;
          const cfields = child?.fields || {};
          for (const [cfName, cdef] of Object.entries(cfields)) {
            const cd: any = cdef;
            if ((cd?.type === 'master_detail' || cd?.type === 'lookup') && cd?.reference === parent.name) {
              fkField = cfName;
              break;
            }
          }
        }
        if (!fkField) continue; // can't resolve the relationship — skip
        const list = index.get(childObject) ?? [];
        list.push({ parentObject: parent.name, summaryField, fkField, fn, sourceField: so.field });
        index.set(childObject, list);
      }
    }
    return index;
  }

  private getSummaryDescriptors(childObject: string): SummaryDescriptor[] {
    if (!this.summaryIndex) this.summaryIndex = this.buildSummaryIndex();
    return this.summaryIndex.get(childObject) ?? [];
  }

  /**
   * Recompute roll-up `summary` fields on parent records after a child write.
   * For each affected parent (the FK value on the changed/old child record), it
   * aggregates the child collection and writes the result onto the parent's
   * summary field. Runs in the caller's execution context so it joins the same
   * transaction (e.g. the cross-object batch) when one is open.
   */
  private async recomputeSummaries(
    childObject: string,
    records: any,
    previous: any,
    execCtx?: ExecutionContext,
  ): Promise<void> {
    const descriptors = this.getSummaryDescriptors(childObject);
    if (descriptors.length === 0) return;
    const recs = Array.isArray(records) ? records : records ? [records] : [];
    const prevs = Array.isArray(previous) ? previous : previous ? [previous] : [];
    for (const desc of descriptors) {
      const ids = new Set<string>();
      for (const r of recs) { const v = r?.[desc.fkField]; if (v != null && v !== '') ids.add(String(v)); }
      for (const p of prevs) { const v = p?.[desc.fkField]; if (v != null && v !== '') ids.add(String(v)); }
      for (const parentId of ids) {
        try {
          const rows = await this.aggregate(childObject, {
            where: { [desc.fkField]: parentId },
            aggregations: [{
              function: desc.fn,
              ...(desc.fn === 'count' ? {} : { field: desc.sourceField }),
              alias: 'value',
            }],
            context: execCtx,
          } as any);
          let value = rows?.[0]?.value;
          if (value == null) value = (desc.fn === 'count' || desc.fn === 'sum') ? 0 : null;
          await this.update(desc.parentObject, { id: parentId, [desc.summaryField]: value }, { context: execCtx } as any);
        } catch (err) {
          this.logger.warn('Roll-up summary recompute failed', {
            childObject, parentObject: desc.parentObject, parentId, field: desc.summaryField,
            error: (err as any)?.message,
          });
        }
      }
    }
  }

  /**
   * Post-process expand: resolve lookup/master_detail fields by batch-loading related records.
   * 
   * This is a driver-agnostic implementation that uses secondary queries ($in batches)
   * to load related records, then injects them into the result set.
   * 
   * @param objectName - The source object name
   * @param records - The records returned by the driver
   * @param expand - The expand map from QueryAST (field name → nested QueryAST)
   * @param depth - Current recursion depth (0-based)
   * @returns Records with expanded lookup fields (IDs replaced by full objects)
   */
  private async expandRelatedRecords(
    objectName: string,
    records: any[],
    expand: Record<string, QueryAST>,
    depth: number = 0,
    execCtx?: ExecutionContext,
  ): Promise<any[]> {
    if (!records || records.length === 0) return records;
    if (depth >= ObjectQL.MAX_EXPAND_DEPTH) return records;

    const objectSchema = this._registry.getObject(objectName);
    // If no schema registered, skip expand — return raw data
    if (!objectSchema || !objectSchema.fields) return records;

    for (const [fieldName, nestedAST] of Object.entries(expand)) {
      const fieldDef = objectSchema.fields[fieldName];

      // Skip if field not found or not a relationship type
      if (!fieldDef || !fieldDef.reference) continue;
      if (fieldDef.type !== 'lookup' && fieldDef.type !== 'master_detail') continue;

      const referenceObject = fieldDef.reference;

      // Collect all foreign key IDs from records (handle both single and multiple values)
      const allIds: any[] = [];
      for (const record of records) {
        const val = record[fieldName];
        if (val == null) continue;
        if (Array.isArray(val)) {
          allIds.push(...val.filter((id: any) => id != null));
        } else if (typeof val === 'object') {
          // Already expanded — skip
          continue;
        } else {
          allIds.push(val);
        }
      }

      // De-duplicate IDs
      const uniqueIds = [...new Set(allIds)];
      if (uniqueIds.length === 0) continue;

      // Batch-load related records using $in query
      try {
        const relatedQuery: QueryAST = {
          object: referenceObject,
          where: { id: { $in: uniqueIds } },
          ...(nestedAST.fields ? { fields: nestedAST.fields } : {}),
          ...(nestedAST.orderBy ? { orderBy: nestedAST.orderBy } : {}),
        };

        const driver = this.getDriver(referenceObject);
        // Propagate tenantId so cross-object expansion respects isolation —
        // e.g. a contact expansion only resolves IDs visible to the caller's
        // tenant. Without this the driver returns the raw FK target which
        // would let a maliciously crafted FK reach across tenants.
        const expandOpts = this.buildDriverOptions(execCtx);
        const relatedRecords = await driver.find(referenceObject, relatedQuery, expandOpts) ?? [];

        // Build a lookup map: id → record
        const recordMap = new Map<string, any>();
        for (const rec of relatedRecords) {
          const id = rec.id;
          if (id != null) recordMap.set(String(id), rec);
        }

        // Recursively expand nested relations if present
        if (nestedAST.expand && Object.keys(nestedAST.expand).length > 0) {
          const expandedRelated = await this.expandRelatedRecords(
            referenceObject,
            relatedRecords,
            nestedAST.expand,
            depth + 1,
            execCtx,
          );
          // Rebuild map with expanded records
          recordMap.clear();
          for (const rec of expandedRelated) {
            const id = rec.id;
            if (id != null) recordMap.set(String(id), rec);
          }
        }

        // Inject expanded records back into the original result set
        for (const record of records) {
          const val = record[fieldName];
          if (val == null) continue;

          if (Array.isArray(val)) {
            record[fieldName] = val.map((id: any) => recordMap.get(String(id)) ?? id);
          } else if (typeof val !== 'object') {
            record[fieldName] = recordMap.get(String(val)) ?? val;
          }
          // If val is already an object, leave it as-is
        }
      } catch (e) {
        // Graceful degradation: if expand fails, keep original IDs
        this.logger.warn('Failed to expand relationship field; retaining foreign key IDs', {
          object: objectName,
          field: fieldName,
          reference: referenceObject,
          error: (e as Error).message,
        });
      }
    }

    return records;
  }

  // ============================================
  // Data Access Methods (IDataEngine Interface)
  // ============================================

  async find(object: string, query?: EngineQueryOptions): Promise<any[]> {
    object = this.resolveObjectName(object);
    this.logger.debug('Find operation starting', { object, query });
    const driver = this.getDriver(object);
    const ast: QueryAST = { object, ...query };
    // Remove context from the AST — it's not a driver concern
    delete (ast as any).context;
    // Normalize OData `top` alias → standard `limit`
    if ((ast as any).top != null && ast.limit == null) {
      ast.limit = (ast as any).top;
    }
    delete (ast as any).top;

    // Plan formula projection: rewrite ast.fields to drop virtual formula
    // names and inject their dependencies, so the driver returns the raw
    // fields needed to compute the formulas after fetch.
    const _findSchema = this._registry.getObject(object);
    const _findFormula = planFormulaProjection(_findSchema, ast.fields as string[] | undefined);
    if (_findFormula.projected) ast.fields = _findFormula.projected;

    // Drop any requested field that doesn't exist on the schema. Without
    // this, drivers (notably SqlDriver) emit `SELECT unknown_col FROM ...`
    // which the DB rejects ("no such column") — and SqlDriver swallows
    // that error and returns `[]`, making a frontend bug (e.g. a generic
    // view requesting `name`/`due_date` on every object) look like "no
    // records exist". Silently filtering matches the existing OData
    // tolerance and Salesforce/Postgres behavior of `SELECT *` semantics.
    if (_findSchema?.fields && Array.isArray(ast.fields) && ast.fields.length > 0) {
      const known = new Set(Object.keys(_findSchema.fields));
      // Always allow the primary key + audit columns even if not present in
      // schema.fields. Without this, callers requesting `select=id,name`
      // silently get the `id` projected away, breaking record navigation.
      known.add('id');
      known.add('created_at');
      known.add('updated_at');
      const filtered = (ast.fields as string[]).filter(f => {
        // Keep relationship paths like `owner.name` — the engine will
        // resolve those via populate; only validate top-level segment.
        const head = String(f).split('.')[0];
        return known.has(head);
      });
      // Guard against an empty projection — fall back to `*` so the
      // request still returns rows. An empty SELECT list would either
      // 400 in Postgres or silently project nothing.
      ast.fields = filtered.length > 0 ? filtered : undefined;
    }

    const opCtx: OperationContext = {
      object,
      operation: 'find',
      ast,
      options: query,
      context: query?.context,
    };

    await this.executeWithMiddleware(opCtx, async () => {
      const hookContext: HookContext = {
          object,
          event: 'beforeFind',
          input: { ast: opCtx.ast, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
      };
      await this.triggerHooks('beforeFind', hookContext);
      hookContext.input.options = this.buildDriverOptions(opCtx.context, hookContext.input.options as any);

      try {
          let result = await driver.find(object, hookContext.input.ast as QueryAST, hookContext.input.options as any);

          // Post-process: evaluate formula virtual fields against the raw rows
          if (Array.isArray(result)) applyFormulaPlan(_findFormula.plan, result);

          // Post-process: expand related records if expand is requested
          if (ast.expand && Object.keys(ast.expand).length > 0 && Array.isArray(result)) {
            result = await this.expandRelatedRecords(object, result, ast.expand, 0, opCtx.context);
          }
          
          hookContext.event = 'afterFind';
          hookContext.result = result;
          await this.triggerHooks('afterFind', hookContext);

          // Never let secret-field plaintext (or its ref) leave through the
          // generic read path — mask after hooks run. Privileged consumers use
          // resolveSecret() against the stored ref instead.
          this.maskSecretFields(object, hookContext.result);

          return hookContext.result;
      } catch (e) {
          this.logger.error('Find operation failed', e as Error, { object });
          throw e;
      }
    });

    return opCtx.result as any[];
  }

  async findOne(objectName: string, query?: EngineQueryOptions): Promise<any> {
    objectName = this.resolveObjectName(objectName);
    this.logger.debug('FindOne operation', { objectName });
    const driver = this.getDriver(objectName);
    const ast: QueryAST = { object: objectName, ...query, limit: 1 };
    // Remove context and top alias from the AST
    delete (ast as any).context;
    delete (ast as any).top;

    // Plan formula projection (same as find): rewrite ast.fields so the driver
    // returns the raw dependency fields, then evaluate formulas after fetch.
    const _findOneSchema = this._registry.getObject(objectName);
    const _findOneFormula = planFormulaProjection(_findOneSchema, ast.fields as string[] | undefined);
    if (_findOneFormula.projected) ast.fields = _findOneFormula.projected;

    // Drop unknown fields — see equivalent block in `find()` for rationale.
    if (_findOneSchema?.fields && Array.isArray(ast.fields) && ast.fields.length > 0) {
      const known = new Set(Object.keys(_findOneSchema.fields));
      // Always allow the primary key + audit columns even if not present
      // in schema.fields (matches `find()` behavior).
      known.add('id');
      known.add('created_at');
      known.add('updated_at');
      const filtered = (ast.fields as string[]).filter(f => known.has(String(f).split('.')[0]));
      ast.fields = filtered.length > 0 ? filtered : undefined;
    }

    const opCtx: OperationContext = {
      object: objectName,
      operation: 'findOne',
      ast,
      options: query,
      context: query?.context,
    };

    await this.executeWithMiddleware(opCtx, async () => {
      const findOneOpts = this.buildDriverOptions(opCtx.context);
      let result = await driver.findOne(objectName, opCtx.ast as QueryAST, findOneOpts);

      // Post-process: evaluate formula virtual fields against the raw row
      if (result != null) applyFormulaPlan(_findOneFormula.plan, [result]);

      // Post-process: expand related records if expand is requested
      if (ast.expand && Object.keys(ast.expand).length > 0 && result != null) {
        const expanded = await this.expandRelatedRecords(objectName, [result], ast.expand, 0, opCtx.context);
        result = expanded[0];
      }

      // Mask secret fields — plaintext never leaves through the read path.
      this.maskSecretFields(objectName, result);

      return result;
    });

    return opCtx.result;
  }

  async insert(object: string, data: any | any[], options?: DataEngineInsertOptions): Promise<any> {
    object = this.resolveObjectName(object);
    this.logger.debug('Insert operation starting', { object, isBatch: Array.isArray(data) });
    this.assertWriteAllowed(object, 'insert');
    const driver = this.getDriver(object);

    const opCtx: OperationContext = {
      object,
      operation: 'insert',
      data,
      options,
      context: options?.context,
    };

    await this.executeWithMiddleware(opCtx, async () => {
      const hookContext: HookContext = {
          object,
          event: 'beforeInsert',
          input: { data: opCtx.data, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
      };
      await this.triggerHooks('beforeInsert', hookContext);
      // Thread the open transaction (if any) into the driver-facing
      // options so that knex's `.transacting(trx)` is honoured. Without
      // this, calls inside a `engine.transaction(...)` block would deadlock
      // on SQLite's single-connection pool. Also propagates tenantId so
      // the driver can enforce per-tenant isolation.
      hookContext.input.options = this.buildDriverOptions(opCtx.context, hookContext.input.options as any);

      try {
        let result;
        const nowSnap = new Date();
        const schemaForValidation = this._registry.getObject(object);
        // When the driver generates autonumbers natively (persistent SQL
        // sequence), the engine defers to it — see #1603.
        const driverOwnsAutonumber = (driver as any)?.supports?.autonumber === true;
        if (Array.isArray(hookContext.input.data)) {
          // Bulk Create — apply defaults per row
          const rows = (hookContext.input.data as any[]).map((row) =>
            this.applyFieldDefaults(object, row as Record<string, unknown>, opCtx.context, nowSnap),
          );
          for (const r of rows) {
            await this.applyAutonumbers(object, r as Record<string, unknown>, opCtx.context, driverOwnsAutonumber);
          }
          for (const r of rows) {
            await this.encryptSecretFields(object, r, opCtx.context, hookContext.input.options);
          }
          for (const r of rows) {
            validateRecord(schemaForValidation, r, 'insert');
            evaluateValidationRules(schemaForValidation as any, r, 'insert', { logger: this.logger });
          }
          if (driver.bulkCreate) {
               result = await driver.bulkCreate(object, rows, hookContext.input.options as any);
          } else {
               // Fallback loop
               result = await Promise.all(rows.map((item) => driver.create(object, item, hookContext.input.options as any)));
          }
        } else {
          const row = this.applyFieldDefaults(
            object,
            hookContext.input.data as Record<string, unknown>,
            opCtx.context,
            nowSnap,
          );
          await this.applyAutonumbers(object, row, opCtx.context, driverOwnsAutonumber);
          await this.encryptSecretFields(object, row, opCtx.context, hookContext.input.options);
          validateRecord(schemaForValidation, row, 'insert');
          evaluateValidationRules(schemaForValidation as any, row, 'insert', { logger: this.logger });
          result = await driver.create(object, row, hookContext.input.options as any);
        }

        hookContext.event = 'afterInsert';
        hookContext.result = result;
        await this.triggerHooks('afterInsert', hookContext);

        // Roll-up: recompute parent summary fields that aggregate this object.
        await this.recomputeSummaries(object, result, null, opCtx.context);

        // Publish data.record.created event to realtime service
        if (this.realtimeService) {
          try {
            if (Array.isArray(result)) {
              // Bulk insert - publish event for each record
              for (const record of result) {
                const event: RealtimeEventPayload = {
                  type: 'data.record.created',
                  object,
                  payload: {
                    recordId: record.id,
                    after: record,
                  },
                  timestamp: new Date().toISOString(),
                };
                await this.realtimeService.publish(event);
              }
              this.logger.debug(`Published ${result.length} data.record.created events`, { object });
            } else {
              const event: RealtimeEventPayload = {
                type: 'data.record.created',
                object,
                payload: {
                  recordId: result.id,
                  after: result,
                },
                timestamp: new Date().toISOString(),
              };
              await this.realtimeService.publish(event);
              this.logger.debug('Published data.record.created event', { object, recordId: result.id });
            }
          } catch (error) {
            this.logger.warn('Failed to publish data event', { object, error });
          }
        }

        return hookContext.result;
      } catch (e) {
        this.logger.error('Insert operation failed', e as Error, { object });
        throw e;
      }
    });

    return opCtx.result;
  }

  async update(object: string, data: any, options?: EngineUpdateOptions): Promise<any> {
     object = this.resolveObjectName(object);
     this.logger.debug('Update operation starting', { object });
     this.assertWriteAllowed(object, 'update');
     const driver = this.getDriver(object);
     
     // 1. Extract ID from data or where if it's a single update by ID.
     //    Only a SCALAR `where.id` means "update one row by primary key". An
     //    operator object ({ $in: [...] }, { $ne: ... }, …) is a multi-row
     //    predicate — treating it as an id would bind the object literally
     //    (e.g. `WHERE id = {"$in":[...]}`, which SQLite rejects). Leave `id`
     //    undefined in that case so the call routes to updateMany (requires
     //    options.multi=true), where applyFilters compiles the operator.
     let id = data.id;
     if (!id && options?.where && typeof options.where === 'object' && 'id' in options.where) {
         const whereId = (options.where as Record<string, unknown>).id;
         const t = typeof whereId;
         if (whereId !== null && (t === 'string' || t === 'number' || t === 'bigint')) {
             id = whereId;
         }
     }

     const opCtx: OperationContext = {
       object,
       operation: 'update',
       data,
       options,
       context: options?.context,
     };

     await this.executeWithMiddleware(opCtx, async () => {
       const hookContext: HookContext = {
          object,
          event: 'beforeUpdate',
          input: { id, data: opCtx.data, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
       };
       await this.triggerHooks('beforeUpdate', hookContext);
       hookContext.input.options = this.buildDriverOptions(opCtx.context, hookContext.input.options as any);

       try {
           let result;
           // Pre-update snapshot. Exposed to after-hooks via `hookContext.previous`
           // (the HookContext contract documents `previous` for update/delete) and
           // reused for object-level validation rules. Fetched once, only for
           // single-id updates, when either a rule needs it (ADR-0020:
           // state_machine / cross_field / script — a PATCH carries only changed
           // fields) OR an afterUpdate hook is registered. The latter is what makes
           // record-change flow triggers work: their start-condition gate reads
           // `previous.*` (e.g. `status == "done" && previous.status != "done"`),
           // which silently fails when `previous` is absent.
           let priorRecord: Record<string, unknown> | null = null;
           const updateSchema = this._registry.getObject(object);
           if (hookContext.input.id) {
               await this.encryptSecretFields(object, hookContext.input.data as Record<string, unknown>, opCtx.context, hookContext.input.options);
               validateRecord(updateSchema, hookContext.input.data as Record<string, unknown>, 'update');
               if (needsPriorRecord(updateSchema as any) || (this.hooks.get('afterUpdate')?.length ?? 0) > 0) {
                   const priorAst: QueryAST = { object, where: { id: hookContext.input.id }, limit: 1 };
                   priorRecord = await driver.findOne(object, priorAst, hookContext.input.options as any);
               }
               // B2: drop writes to fields locked by a TRUE `readonlyWhen` — the
               // field is read-only for this record's state, so the incoming
               // change is ignored (the persisted value is kept).
               hookContext.input.data = stripReadonlyWhenFields(updateSchema as any, hookContext.input.data as Record<string, unknown>, priorRecord, this.logger) as any;
               evaluateValidationRules(updateSchema as any, hookContext.input.data as Record<string, unknown>, 'update', { previous: priorRecord, logger: this.logger });
               result = await driver.update(object, hookContext.input.id as string, hookContext.input.data as Record<string, unknown>, hookContext.input.options as any);
           } else if (options?.multi && driver.updateMany) {
               await this.encryptSecretFields(object, hookContext.input.data as Record<string, unknown>, opCtx.context, hookContext.input.options);
               validateRecord(updateSchema, hookContext.input.data as Record<string, unknown>, 'update');
               // Multi-row update: per-row prior state is not fetched (one query
               // per matched row would be unbounded). state_machine /
               // cross_field rules are skipped here; warn so the gap is visible.
               if (needsPriorRecord(updateSchema as any)) {
                   this.logger.warn('Object-level validation rules (state_machine/cross_field/script) are not enforced on multi-row updates', { object });
               }
               const ast: QueryAST = { object, where: options.where };
               result = await driver.updateMany(object, ast, hookContext.input.data as Record<string, unknown>, hookContext.input.options as any);
           } else {
               throw new Error('Update requires an ID or options.multi=true');
           }

           hookContext.event = 'afterUpdate';
           hookContext.result = result;
           if (priorRecord) hookContext.previous = priorRecord;
           await this.triggerHooks('afterUpdate', hookContext);

           // Roll-up: recompute parent summaries; pass priorRecord too so a child
           // that moved to a different parent updates BOTH old and new parent.
           await this.recomputeSummaries(object, result, priorRecord, opCtx.context);

           // Publish data.record.updated event to realtime service
           if (this.realtimeService) {
             try {
               const resultId = (typeof result === 'object' && result && 'id' in result) ? (result as any).id : undefined;
               const recordId = String(hookContext.input.id || resultId || '');
               const event: RealtimeEventPayload = {
                 type: 'data.record.updated',
                 object,
                 payload: {
                   recordId,
                   changes: hookContext.input.data,
                   after: result,
                 },
                 timestamp: new Date().toISOString(),
               };
               await this.realtimeService.publish(event);
               this.logger.debug('Published data.record.updated event', { object, recordId });
             } catch (error) {
               this.logger.warn('Failed to publish data event', { object, error });
             }
           }

           return hookContext.result;
       } catch (e) {
          this.logger.error('Update operation failed', e as Error, { object });
          throw e;
       }
     });

     return opCtx.result;
  }

  /**
   * Apply referential delete behavior for relations pointing AT this record,
   * before it is removed. For every registered object with a `master_detail`
   * or `lookup` field referencing `object`, honor the field's `deleteBehavior`:
   *   - `cascade`  → delete the dependent rows (recursively, so grandchildren
   *                  are handled by each child's own delete),
   *   - `set_null` → clear the foreign key,
   *   - `restrict` → refuse the delete when dependents exist.
   * `master_detail` defaults to `cascade` (the parent owns the child
   * lifecycle); `lookup` defaults to `set_null`. Only runs for single-id
   * deletes — multi/predicate deletes skip cascade (logged).
   */
  private async cascadeDeleteRelations(
    object: string,
    id: string | number,
    context?: ExecutionContext,
    depth = 0,
  ): Promise<void> {
    if (id == null || depth >= ObjectQL.MAX_CASCADE_DEPTH) return;
    let objects: ServiceObject[];
    try {
      objects = this._registry.getAllObjects();
    } catch {
      return;
    }
    for (const child of objects) {
      const childName = (child as any)?.name as string | undefined;
      const fields = (child as any)?.fields as Record<string, any> | undefined;
      if (!childName || !fields) continue;
      for (const [fieldName, fdef] of Object.entries(fields)) {
        if (!fdef || (fdef.type !== 'master_detail' && fdef.type !== 'lookup')) continue;
        const ref = fdef.reference;
        if (!ref) continue;
        // Match the target object by raw or resolved name.
        let resolvedRef: string | undefined;
        try { resolvedRef = this.resolveObjectName(ref); } catch { resolvedRef = undefined; }
        if (ref !== object && resolvedRef !== object) continue;

        // A master-detail parent owns its children: cascade by default (the
        // child FK is typically required, so set_null would be invalid). Only
        // an explicit `restrict` deviates. A plain lookup honors its
        // configured deleteBehavior (default set_null).
        const behavior: string =
          fdef.type === 'master_detail'
            ? (fdef.deleteBehavior === 'restrict' ? 'restrict' : 'cascade')
            : (fdef.deleteBehavior || 'set_null');

        let dependents: any[];
        try {
          dependents = await this.find(childName, { where: { [fieldName]: id }, context } as any);
        } catch {
          continue;
        }
        if (!dependents || dependents.length === 0) continue;

        if (behavior === 'restrict') {
          throw new Error(
            `Cannot delete ${object} (${id}): ${dependents.length} dependent ${childName} record(s) via ${fieldName}`,
          );
        }

        for (const dep of dependents) {
          const depId = dep?.id;
          if (depId == null) continue;
          if (behavior === 'cascade') {
            // Recurse via the public delete so the child's own cascade,
            // hooks and events fire.
            await this.delete(childName, { where: { id: depId }, context } as any);
          } else {
            await this.update(childName, { id: depId, [fieldName]: null }, { context } as any);
          }
        }
      }
    }
  }

  async delete(object: string, options?: EngineDeleteOptions): Promise<any> {
    object = this.resolveObjectName(object);
    this.logger.debug('Delete operation starting', { object });
    this.assertWriteAllowed(object, 'delete');
    const driver = this.getDriver(object);

    // Extract ID logic similar to update
    let id: any = undefined;
    if (options?.where && typeof options.where === 'object' && 'id' in options.where) {
        id = (options.where as Record<string, unknown>).id;
    }

    const opCtx: OperationContext = {
      object,
      operation: 'delete',
      options,
      context: options?.context,
    };

    await this.executeWithMiddleware(opCtx, async () => {
      const hookContext: HookContext = {
          object,
          event: 'beforeDelete',
          input: { id, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
      };
      await this.triggerHooks('beforeDelete', hookContext);
      hookContext.input.options = this.buildDriverOptions(opCtx.context, hookContext.input.options as any);

      try {
          let result;
          // Capture the row's FK values BEFORE deletion so roll-up summaries can
          // recompute the (now-orphaned) parent. Only when a summary aggregates
          // this object — avoids an extra read on every delete.
          let summaryPrev: any = null;
          if (hookContext.input.id && this.getSummaryDescriptors(object).length > 0) {
            try {
              summaryPrev = await this.findOne(object, { where: { id: hookContext.input.id }, context: opCtx.context } as any);
            } catch { /* best-effort */ }
          }
          if (hookContext.input.id) {
              // Honor referential delete behavior (cascade/set_null/restrict)
              // for relations pointing at this record before removing it.
              await this.cascadeDeleteRelations(object, hookContext.input.id as string | number, opCtx.context);
              result = await driver.delete(object, hookContext.input.id as string, hookContext.input.options as any);
          } else if (options?.multi && driver.deleteMany) {
               const ast: QueryAST = { object, where: options.where };
               result = await driver.deleteMany(object, ast, hookContext.input.options as any);
          } else {
               throw new Error('Delete requires an ID or options.multi=true');
          }

          hookContext.event = 'afterDelete';
          hookContext.result = result;
          await this.triggerHooks('afterDelete', hookContext);

          // Roll-up: recompute the parent summary now that the child is gone.
          if (summaryPrev) await this.recomputeSummaries(object, null, summaryPrev, opCtx.context);

          // Publish data.record.deleted event to realtime service
          if (this.realtimeService) {
            try {
              const resultId = (typeof result === 'object' && result && 'id' in result) ? (result as any).id : undefined;
              const recordId = String(hookContext.input.id || resultId || '');
              const event: RealtimeEventPayload = {
                type: 'data.record.deleted',
                object,
                payload: {
                  recordId,
                },
                timestamp: new Date().toISOString(),
              };
              await this.realtimeService.publish(event);
              this.logger.debug('Published data.record.deleted event', { object, recordId });
            } catch (error) {
              this.logger.warn('Failed to publish data event', { object, error });
            }
          }

          return hookContext.result;
      } catch (e) {
          this.logger.error('Delete operation failed', e as Error, { object });
          throw e;
      }
    });

    return opCtx.result;
  }

  async count(object: string, query?: EngineCountOptions): Promise<number> {
     object = this.resolveObjectName(object);
     const driver = this.getDriver(object);

     const opCtx: OperationContext = {
       object,
       operation: 'count',
       options: query,
       context: query?.context,
     };

     await this.executeWithMiddleware(opCtx, async () => {
       const countOpts = this.buildDriverOptions(opCtx.context);
       if (driver.count) {
           const ast: QueryAST = { object, where: query?.where };
           return driver.count(object, ast, countOpts);
       }
       // Fallback to find().length
       const res = await this.find(object, { where: query?.where, fields: ['id'], context: opCtx.context });
       return res.length;
     });

     return opCtx.result as number;
  }

  async aggregate(object: string, query: EngineAggregateOptions): Promise<any[]> {
      object = this.resolveObjectName(object);
      const driver = this.getDriver(object);
      this.logger.debug(`Aggregate on ${object} using ${driver.name}`, query);

      const opCtx: OperationContext = {
        object,
        operation: 'aggregate',
        options: query,
        context: query?.context,
      };

      await this.executeWithMiddleware(opCtx, async () => {
        const ast: QueryAST = {
            object,
            where: query.where,
            groupBy: query.groupBy as any,
            aggregations: query.aggregations,
        };

        // Prefer driver.aggregate() when available — driver.find() in many
        // drivers (e.g. driver-sql) does not honor `groupBy` / `aggregations`
        // and would silently return ungrouped raw rows. Fall back to find()
        // for drivers that handle aggregations through their query AST.
        const drv = driver as any;
        // Structured groupBy items ({field, dateGranularity}) require the
        // driver to advertise per-granularity native bucket support via
        // `supports.queryDateGranularity[g]`. If every structured item is
        // supported we can push the aggregate down to the driver; otherwise
        // we fall back to driver.find() + in-memory bucketing so the result
        // remains correct on partial-support dialects (e.g. SQLite + week).
        const groupByItems = Array.isArray(query.groupBy) ? (query.groupBy as any[]) : [];
        const granularityCaps: Record<string, boolean> | undefined =
            drv?.supports?.queryDateGranularity;
        const structuredItems = groupByItems.filter((g) => typeof g !== 'string');
        const allStructuredSupported = structuredItems.every((g: any) => {
            if (!g?.dateGranularity) return true; // plain {field} object is fine
            return granularityCaps?.[g.dateGranularity] === true;
        });
        if (typeof drv.aggregate === 'function' && allStructuredSupported) {
            return drv.aggregate(object, ast, this.buildDriverOptions(opCtx.context));
        }
        // In-memory fallback path: ask the driver for raw rows, then bucket +
        // aggregate here. This guarantees `groupBy` (incl. structured items
        // carrying `dateGranularity`) and `aggregations` always work even on
        // drivers that have no native aggregation support (driver-rest,
        // driver-memory, partial SQL drivers).
        const raw = await driver.find(object, ast, this.buildDriverOptions(opCtx.context));
        return applyInMemoryAggregation(raw, ast);
      });

      return opCtx.result as any[];
  }
  
  /**
   * Run raw driver-specific commands (SQL for SqlDriver, REST for RestDriver, …).
   *
   * ⚠️ **Tenant isolation bypass.** Raw `execute()` does NOT thread the
   * caller's `ExecutionContext.tenantId` into a `WHERE organization_id`
   * predicate — drivers see the command verbatim. Callers MUST inline the
   * tenant filter themselves, or restrict raw execution to genuinely global
   * statements (schema migrations, sys_* / control-plane tables).
   *
   * Prefer the typed entry points (`find`, `update`, `delete`, `count`, …)
   * whenever feasible — they auto-apply tenancy + soft-delete + audit warnings.
   */
  async execute(command: any, options?: Record<string, any>): Promise<any> {
      // Driver selection priority:
      //   1. options.object  → route via getDriver(objectName)
      //   2. options.datasource → explicit driver name
      //   3. default driver (set via datasourceMapping or defaultDriver)
      // This lets system services (e.g. PackageService, AuditService) issue raw
      // SQL against the control-plane / default DB without having to know the
      // object name behind every CREATE TABLE / SELECT statement.
      let driver: DriverInterface | undefined;
      if (options?.object) {
          driver = this.getDriver(options.object);
      } else if (options?.datasource && this.drivers.has(options.datasource)) {
          driver = this.drivers.get(options.datasource);
      } else if (this.defaultDriver && this.drivers.has(this.defaultDriver)) {
          driver = this.drivers.get(this.defaultDriver);
      } else if (this.drivers.size === 1) {
          // Single registered driver — unambiguously the right one.
          driver = this.drivers.values().next().value;
      }

      if (!driver) {
          throw new Error(
              'Execute requires options.object to select a driver, or a default driver to be configured. ' +
              'Configure datasourceMapping with `default: true` or pass `{ object }` / `{ datasource }` in options.',
          );
      }
      if (!driver.execute) {
          throw new Error('Selected driver does not implement execute()');
      }

      // Support both call shapes:
      //   execute('SELECT ...', { args: [...] })
      //   execute({ sql: 'SELECT ...', args: [...] })
      let rawCommand: any = command;
      let params: any[] | undefined = options?.args ?? options?.params;
      if (command && typeof command === 'object' && !Array.isArray(command) && 'sql' in command) {
          rawCommand = command.sql;
          if (params === undefined) {
              params = command.args ?? command.params;
          }
      }

      return driver.execute(rawCommand, params, options);
  }

  /**
   * Execute a callback inside a database transaction.
   *
   * The callback receives a context object that should be passed to all
   * downstream `engine.insert/update/delete/find/findOne` calls (as
   * `{ context: trxCtx }`). The transaction handle threads through
   * `OperationContext.context.transaction` and the SQL driver's per-builder
   * `.transacting(trx)` call.
   *
   * - If the default driver does not support `beginTransaction`, the callback
   *   runs directly with the supplied base context (no rollback). This keeps
   *   the API safe to call on drivers without ACID support (e.g. the
   *   in-memory driver in tests).
   * - On callback success the transaction is committed; on any thrown error
   *   it is rolled back and the original error is re-thrown.
   *
   * Use case: multi-step operations that must be atomic (e.g. CRM
   * `convertLead`, which creates an account + contact + opportunity + flips
   * the lead in a single unit of work).
   */
  async transaction<T>(
    callback: (trxCtx: any) => Promise<T>,
    baseContext?: any,
  ): Promise<T> {
    const driver = this.defaultDriver ? this.drivers.get(this.defaultDriver) : undefined;
    const drv = driver as any;
    if (!drv?.beginTransaction) {
      return callback(baseContext);
    }
    const trx = await drv.beginTransaction();
    const trxCtx = { ...(baseContext ?? {}), transaction: trx };
    try {
      // Run the callback inside the ambient transaction store so internal
      // queries during writes reuse this transaction's connection (ADR-0034).
      const result = await this.txStore.run({ transaction: trx }, () => callback(trxCtx));
      if (drv.commit) await drv.commit(trx);
      else if (drv.commitTransaction) await drv.commitTransaction(trx);
      return result;
    } catch (err) {
      try {
        if (drv.rollback) await drv.rollback(trx);
        else if (drv.rollbackTransaction) await drv.rollbackTransaction(trx);
      } catch {
        // swallow rollback failures so the original error surfaces
      }
      throw err;
    }
  }

  // ============================================
  // Compatibility / Convenience API
  // ============================================
  // These methods provide a higher-level API matching the @objectql/core
  // ObjectQL interface, enabling painless migration from the legacy layer.

  /**
   * Register a single object definition.
   * 
   * Proxies to SchemaRegistry.registerObject() with sensible defaults.
   * Fields without a `name` property are auto-assigned from their key.
   */
  registerObject(
    schema: ServiceObject,
    packageId: string = '__runtime__',
    namespace?: string
  ): string {
    // Auto-assign field names from keys
    if (schema.fields) {
      for (const [key, field] of Object.entries(schema.fields)) {
        if (field && typeof field === 'object' && !('name' in field)) {
          (field as any).name = key;
        }
      }
    }
    return this._registry.registerObject(schema, packageId, namespace);
  }

  /**
   * Unregister a single object by name.
   */
  unregisterObject(name: string, packageId?: string): void {
    if (packageId) {
      this._registry.unregisterObjectsByPackage(packageId);
    } else {
      // Remove from generic metadata as fallback
      this._registry.unregisterItem('object', name);
    }
  }

  /**
   * Get an object definition by name.
   * Alias for getSchema() — matches @objectql/core API.
   */
  getObject(name: string): ServiceObject | undefined {
    return this.getSchema(name);
  }

  /**
   * Get all registered object configs as a name→config map.
   * Matches @objectql/core getConfigs() API.
   */
  getConfigs(): Record<string, ServiceObject> {
    const result: Record<string, ServiceObject> = {};
    const objects = this._registry.getAllObjects();
    for (const obj of objects) {
      if (obj.name) {
        result[obj.name] = obj;
      }
    }
    return result;
  }

  /**
   * Get a registered driver by datasource name.
   * 
   * Unlike the private getDriver() (which resolves by object name),
   * this method directly looks up a driver by its registered name.
   */
  getDriverByName(name: string): DriverInterface | undefined {
    return this.drivers.get(name);
  }

  /**
   * Introspect a datasource's live remote schema (ADR-0015).
   *
   * Resolves the driver registered under `datasource` and delegates to its
   * `introspectSchema()` capability. Used by the external-datasource service
   * (and CLI/REST) to list remote tables and validate federated objects.
   *
   * @throws if the datasource has no registered driver, or the driver does
   *   not support introspection.
   */
  async introspectDatasource(datasource: string): Promise<unknown> {
    const driver = this.drivers.get(datasource) as any;
    if (!driver) {
      throw new Error(`[ObjectQL] Datasource '${datasource}' has no registered driver to introspect.`);
    }
    if (typeof driver.introspectSchema !== 'function') {
      throw new Error(`[ObjectQL] Driver for datasource '${datasource}' does not support introspectSchema().`);
    }
    return driver.introspectSchema();
  }

  /**
   * Get the driver responsible for the given object.
   *
   * Resolves datasource binding from the object's schema definition,
   * falling back to the default driver. This is a public version of
   * the internal getDriver() used by CRUD operations.
   *
   * @param objectName - FQN or short name of the registered object.
   * @returns The resolved DriverInterface, or undefined if no driver is available.
   */
  getDriverForObject(objectName: string): DriverInterface | undefined {
    try {
      return this.getDriver(objectName);
    } catch {
      return undefined;
    }
  }

  /**
   * Sync all registered object schemas to their respective drivers.
   * Call this after dynamically registering new objects at runtime
   * (e.g. after template seeding) to ensure tables/collections exist
   * before inserting seed data.
   */
  async syncSchemas(): Promise<void> {
    const allObjects = this._registry.getAllObjects();
    for (const obj of allObjects) {
      const driver = this.getDriverForObject(obj.name);
      if (!driver) continue;
      const tableName = StorageNameMapping.resolveTableName(obj);
      if (typeof (driver as any).syncSchemasBatch === 'function' && (driver as any).supports?.batchSchemaSync) {
        // Already handled per-driver below; skip individual call
      }
      if (typeof (driver as any).syncSchema === 'function') {
        try {
          await (driver as any).syncSchema(tableName, obj);
        } catch {
          // best effort — log suppressed to avoid noise on already-synced tables
        }
      }
    }
  }

  /**
   * Sync a SINGLE object's physical storage (create/alter its table) on
   * demand. Boot-time {@link syncSchemas} runs once at startup, so an object
   * that becomes live at runtime (e.g. publishing a drafted object) has a
   * registry entry but no table — data CRUD then fails with "no such table"
   * until the next restart. Calling this right after the object is registered
   * makes it immediately usable. Idempotent: the SQL driver only creates the
   * table when absent (and alters to add new columns).
   */
  async syncObjectSchema(objectName: string): Promise<void> {
    const obj = this._registry.getObject(objectName) as any;
    if (!obj) return;
    const driver = this.getDriverForObject(objectName);
    if (!driver || typeof (driver as any).syncSchema !== 'function') return;
    const tableName = StorageNameMapping.resolveTableName(obj);
    await (driver as any).syncSchema(tableName, obj);
  }

  /**
   * Drop the physical storage (table/collection) backing an object — the
   * inverse of {@link syncObjectSchema}. DESTRUCTIVE: deletes all rows in the
   * table. Used by the protocol delete path when the caller explicitly opts
   * into storage teardown (e.g. discarding an object that was published only
   * to preview it). No-op when the object's driver does not expose `dropTable`.
   * Resolves the physical table name from the registered definition, falling
   * back to the bare name if the def was already removed.
   */
  async dropObjectSchema(objectName: string): Promise<void> {
    const obj = this._registry.getObject(objectName) as any;
    const driver = this.getDriverForObject(objectName);
    if (!driver || typeof (driver as any).dropTable !== 'function') return;
    const tableName = StorageNameMapping.resolveTableName(obj ?? ({ name: objectName } as any));
    await (driver as any).dropTable(tableName);
  }

  /**
   * Get a registered driver by datasource name.
   * Alias matching @objectql/core datasource() API.
   *
   * @throws Error if the datasource is not found
   */
  datasource(name: string): DriverInterface {
    const driver = this.drivers.get(name);
    if (!driver) {
      throw new Error(`[ObjectQL] Datasource '${name}' not found`);
    }
    return driver;
  }

  /**
   * Register a hook handler.
   * Convenience alias for registerHook() matching @objectql/core on() API.
   * 
   * Usage:
   *   ql.on('beforeInsert', 'user', async (ctx) => { ... });
   */
  on(
    event: string,
    objectName: string,
    handler: (ctx: HookContext) => Promise<void> | void,
    packageId?: string
  ): void {
    this.registerHook(event, handler, { object: objectName, packageId });
  }

  /**
   * Remove all hooks, actions, and objects contributed by a package.
   */
  removePackage(packageId: string): void {
    // Remove hooks
    for (const [key, handlers] of this.hooks.entries()) {
      const filtered = handlers.filter(h => h.packageId !== packageId);
      if (filtered.length !== handlers.length) {
        this.hooks.set(key, filtered);
      }
    }
    // Remove actions
    this.removeActionsByPackage(packageId);
    // Remove objects
    this._registry.unregisterObjectsByPackage(packageId, true);
  }

  /**
   * Gracefully shut down the engine, disconnecting all drivers.
   * Alias for destroy() — matches @objectql/core close() API.
   */
  async close(): Promise<void> {
    return this.destroy();
  }

  /**
   * Create a scoped execution context bound to this engine.
   * 
   * Usage:
   *   const ctx = engine.createContext({ userId: '...', tenantId: '...' });
   *   const users = ctx.object('user');
   *   await users.find({ filter: { status: 'active' } });
   */
  createContext(ctx: Partial<ExecutionContext>): ScopedContext {
    return new ScopedContext(
      ExecutionContextSchema.parse(ctx),
      this
    );
  }

  /**
   * Static factory: create a fully configured ObjectQL instance.
   * 
   * Matches @objectql/core's `new ObjectQL(config)` pattern but also
   * registers drivers and objects, then calls init().
   * 
   * Usage:
   *   const ql = await ObjectQL.create({
   *     datasources: { default: myDriver },
   *     objects: { user: { name: 'user', fields: { ... } } }
   *   });
   */
  static async create(config: {
    datasources?: Record<string, DriverInterface>;
    objects?: Record<string, ServiceObject>;
    hooks?: Array<{ event: string; object: string; handler: (ctx: HookContext) => Promise<void> | void }>;
  }): Promise<ObjectQL> {
    const ql = new ObjectQL();

    // Register drivers
    if (config.datasources) {
      for (const [name, driver] of Object.entries(config.datasources)) {
        // Set driver name if not already set
        if (!driver.name) {
          (driver as any).name = name;
        }
        ql.registerDriver(driver, name === 'default');
      }
    }

    // Register objects
    if (config.objects) {
      for (const [_key, schema] of Object.entries(config.objects)) {
        ql.registerObject(schema);
      }
    }

    // Register hooks
    if (config.hooks) {
      for (const hook of config.hooks) {
        ql.on(hook.event, hook.object, hook.handler);
      }
    }

    // Initialize (connect drivers)
    await ql.init();

    return ql;
  }
}

/**
 * Repository scoped to a single object, bound to an execution context.
 *
 * Provides both IDataEngine-style methods (find, insert, update, delete)
 * and convenience aliases (create, updateById, deleteById) matching
 * the @objectql/core ObjectRepository API.
 */
export class ObjectRepository {
  constructor(
    private objectName: string,
    private context: ExecutionContext,
    private engine: IDataEngine & { executeAction?: (o: string, a: string, c: any) => Promise<any> }
  ) {}

  async find(query: any = {}): Promise<any[]> {
    return this.engine.find(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  async findOne(query: any = {}): Promise<any> {
    return this.engine.findOne(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  async insert(data: any): Promise<any> {
    return this.engine.insert(this.objectName, data, {
      context: this.context,
    });
  }

  /** Alias for insert() — matches @objectql/core convention */
  async create(data: any): Promise<any> {
    return this.insert(data);
  }

  async update(data: any, options: any = {}): Promise<any> {
    return this.engine.update(this.objectName, data, {
      ...options,
      context: this.context,
    });
  }

  /** Update a single record by ID */
  async updateById(id: string | number, data: any): Promise<any> {
    return this.engine.update(this.objectName, { ...data, id: id }, {
      where: { id: id },
      context: this.context,
    });
  }

  async delete(options: any = {}): Promise<any> {
    return this.engine.delete(this.objectName, {
      ...options,
      context: this.context,
    });
  }

  /** Delete a single record by ID */
  async deleteById(id: string | number): Promise<any> {
    return this.engine.delete(this.objectName, {
      where: { id: id },
      context: this.context,
    });
  }

  async count(query: any = {}): Promise<number> {
    return this.engine.count(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /** Aggregate query */
  async aggregate(query: any = {}): Promise<any[]> {
    return this.engine.aggregate(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /** Execute a named action registered on this object */
  async execute(actionName: string, params?: any): Promise<any> {
    if (this.engine.executeAction) {
      return this.engine.executeAction(this.objectName, actionName, {
        ...params,
        userId: this.context.userId,
        tenantId: this.context.tenantId,
        roles: this.context.roles,
      });
    }
    throw new Error(`Actions not supported by engine`);
  }
}

/**
 * Scoped execution context with object() accessor.
 * 
 * Provides identity (userId, tenantId/spaceId, roles),
 * repository access via object(), privilege escalation via sudo(),
 * and transactional execution via transaction().
 */
export class ScopedContext {
  constructor(
    private executionContext: ExecutionContext,
    private engine: IDataEngine
  ) {}

  /** Get a repository scoped to this context */
  object(name: string): ObjectRepository {
    return new ObjectRepository(name, this.executionContext, this.engine as any);
  }

  /** Create an elevated (system) context */
  sudo(): ScopedContext {
    return new ScopedContext(
      { ...this.executionContext, isSystem: true },
      this.engine
    );
  }

  /**
   * Execute a callback within a database transaction.
   *
   * The callback receives a new ScopedContext whose operations
   * share the same transaction handle. If the callback throws,
   * the transaction is rolled back; otherwise it is committed.
   *
   * Falls back to non-transactional execution if the driver
   * does not support transactions.
   */
  async transaction(callback: (trxCtx: ScopedContext) => Promise<any>): Promise<any> {
    const engine = this.engine as any;

    // Find the default driver for transaction support
    const driver = engine.defaultDriver
      ? engine.drivers?.get(engine.defaultDriver)
      : undefined;

    if (!driver?.beginTransaction) {
      // No transaction support — execute directly
      return callback(this);
    }

    const trx = await driver.beginTransaction();
    const trxCtx = new ScopedContext(
      { ...this.executionContext, transaction: trx },
      this.engine
    );
    // Share the engine's ambient transaction store so internal queries during
    // writes reuse this transaction's connection (ADR-0034).
    const txStore = (this.engine as any)?.txStore as
      | { run<R>(s: { transaction: unknown }, fn: () => R): R }
      | undefined;
    const runIn = <R>(fn: () => Promise<R>): Promise<R> =>
      txStore ? txStore.run({ transaction: trx }, fn) : fn();

    try {
      const result = await runIn(() => callback(trxCtx));
      if (driver.commit) await driver.commit(trx);
      else if (driver.commitTransaction) await driver.commitTransaction(trx);
      return result;
    } catch (error) {
      if (driver.rollback) await driver.rollback(trx);
      else if (driver.rollbackTransaction) await driver.rollbackTransaction(trx);
      throw error;
    }
  }

  get userId() { return this.executionContext.userId; }
  get tenantId() { return this.executionContext.tenantId; }
  /** Alias for tenantId — matches ObjectQLContext.spaceId convention */
  get spaceId() { return this.executionContext.tenantId; }
  get roles() { return this.executionContext.roles; }
  get isSystem() { return this.executionContext.isSystem; }

  /** Internal: expose the transaction handle for driver-level access */
  get transactionHandle() { return this.executionContext.transaction; }
}
