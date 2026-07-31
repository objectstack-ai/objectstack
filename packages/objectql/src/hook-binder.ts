// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Hook Binder
 *
 * Single, canonical entry point that turns declarative `Hook` metadata into
 * runtime registrations on the `ObjectQL` engine. Every metadata source —
 * `defineStack({ hooks })` (consumed by `AppPlugin`), the per-project
 * template seeder (`MultiProjectPlugin`), and the metadata service
 * (`ObjectQLPlugin.loadMetadataFromService`) — funnels through here so
 * that:
 *
 * - Inline function handlers and string-named handlers share one resolver.
 * - Declarative fields (`condition`, `async`, `retryPolicy`, `timeout`,
 *   `onError`) are honoured uniformly via `wrapDeclarativeHook`.
 * - Hooks can be unregistered as a unit via `packageId`, enabling clean
 *   hot-reload and app uninstall.
 *
 * The ObjectQL engine itself stays simple — it knows how to store and
 * trigger handlers, but knows nothing about declarative semantics. All
 * metadata-aware behaviour lives in this binder + the wrapper module.
 */

import type { Hook } from '@objectstack/spec/data';
import type { ObjectQL, HookHandler } from './engine.js';
import { wrapDeclarativeHook } from './hook-wrappers.js';
import type { HookMetricsRecorder } from './hook-metrics.js';

export interface BindHooksOptions {
  /** Owning package / app id — used for `unregisterHooksByPackage`. */
  packageId?: string;

  /**
   * Optional name → function map for resolving string `handler` references.
   * Typically supplied by `defineStack({ functions })` and merged with any
   * functions previously registered on the engine.
   */
  functions?: Record<string, HookHandler>;

  /**
   * Optional factory that converts a metadata-only `Hook.body` (L1 expression
   * or L2 sandboxed JS source) into an executable `HookHandler`. The runtime
   * package wires this up using `QuickJSScriptRunner`; objectql itself stays
   * sandbox-free so it can run in lightweight environments.
   *
   * If `hook.body` is set and this factory is missing, the hook is skipped
   * with a clear error.
   */
  bodyRunner?: (hook: Hook) => HookHandler | undefined;

  /**
   * When true, treat unresolved hooks (body present but no runner, or handler
   * string with no implementation) as fatal errors instead of warnings. Used
   * by production runtimes to fail fast on misconfiguration. Defaults false.
   */
  strict?: boolean;

  /**
   * When true, emit a deprecation warning for every hook that still relies
   * on a `handler` ref string instead of the metadata-only `body`. Used by
   * the CLI (compile time) and runtime (boot time) to nudge users away from
   * the legacy `.mjs` runtime bundle path. Defaults false.
   */
  warnLegacyHandler?: boolean;

  /** Per-hook execution metrics sink. Defaults to no-op. */
  metrics?: HookMetricsRecorder;

  /** Logger; defaults to a silent no-op. */
  logger?: {
    debug: (msg: string, meta?: any) => void;
    info: (msg: string, meta?: any) => void;
    warn: (msg: string, meta?: any) => void;
    error: (msg: string, meta?: any) => void;
  };
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Counter for stats. */
export interface BindHooksResult {
  registered: number;
  skipped: number;
  errors: Array<{ hook: string; reason: string }>;
}

/**
 * Bind a list of declarative `Hook` definitions to a running ObjectQL engine.
 *
 * Idempotent on `(packageId, hook.name, event, object)`: re-binding the
 * same set after a hot reload first calls `unregisterHooksByPackage`
 * (when `packageId` is provided).
 */
export function bindHooksToEngine(
  engine: ObjectQL,
  hooks: Hook[] | undefined,
  opts: BindHooksOptions = {},
): BindHooksResult {
  const logger = opts.logger ?? noopLogger;
  const result: BindHooksResult = { registered: 0, skipped: 0, errors: [] };

  if (!Array.isArray(hooks) || hooks.length === 0) {
    return result;
  }

  // Hot-reload friendly: drop anything we previously bound under this
  // packageId so the new set fully replaces the old.
  if (opts.packageId && typeof (engine as any).unregisterHooksByPackage === 'function') {
    try {
      (engine as any).unregisterHooksByPackage(opts.packageId);
    } catch (err: any) {
      logger.warn('[hook-binder] unregister-by-package failed; continuing', {
        packageId: opts.packageId,
        error: err?.message,
      });
    }
  }

  // Pre-load any inline functions supplied via `bundle.functions` so
  // string-handler resolution works.
  if (opts.functions && typeof (engine as any).registerFunction === 'function') {
    for (const [name, fn] of Object.entries(opts.functions)) {
      try {
        (engine as any).registerFunction(name, fn, opts.packageId);
      } catch (err: any) {
        logger.warn('[hook-binder] failed to register function', {
          name,
          error: err?.message,
        });
      }
    }
  }

  for (const hook of hooks) {
    try {
      const resolved = resolveHandler(engine, hook, opts);
      if (!resolved) {
        result.skipped += 1;
        const reason = (hook as any).body
          ? `hook body present but no bodyRunner supplied to bindHooksToEngine (runtime must wire QuickJSScriptRunner)`
          : typeof hook.handler === 'string'
            ? `unknown function '${hook.handler}'`
            : 'no handler';
        result.errors.push({ hook: hook.name, reason });
        if (opts.strict) {
          throw new Error(`[hook-binder] strict: cannot bind hook '${hook.name}': ${reason}`);
        }
        logger.warn('[hook-binder] skipping hook with unresolved handler', {
          hook: hook.name,
          handler: hook.handler,
          hasBody: Boolean((hook as any).body),
        });
        continue;
      }

      if (opts.warnLegacyHandler && !(hook as any).body && typeof hook.handler === 'string') {
        logger.warn('[hook-binder] DEPRECATED: hook uses legacy handler ref without body', {
          hook: hook.name,
          handler: hook.handler,
          hint: 'Move the handler source into Hook.body so the artifact stays metadata-only and the .mjs runtime bundle can be dropped.',
        });
      }

      const objects = normalizeObjects(hook.object);
      if (objects.length === 0) {
        result.skipped += 1;
        const reason =
          'hook target names no object — an empty `object` is refused rather than widened to '
          + "the wildcard '*' (#4001). Name the object(s), or write `object: '*'` if firing on "
          + 'every object is the intent.';
        result.errors.push({ hook: hook.name, reason });
        if (opts.strict) {
          throw new Error(`[hook-binder] strict: cannot bind hook '${hook.name}': ${reason}`);
        }
        logger.warn('[hook-binder] skipping hook with an empty object target', {
          hook: hook.name,
          object: hook.object,
        });
        continue;
      }

      const wrapped = wrapDeclarativeHook(hook, resolved, { logger, metrics: opts.metrics });
      const events = Array.isArray(hook.events) ? hook.events : [];

      for (const event of events) {
        for (const object of objects) {
          engine.registerHook(event, wrapped, {
            object,
            priority: typeof hook.priority === 'number' ? hook.priority : 100,
            packageId: opts.packageId,
            // Reflect metadata so future tooling can introspect / unregister
            // and so we can detect duplicate name collisions.
            // The engine ignores unknown options today; this is forward-only.
            ...({ meta: hook, hookName: hook.name } as any),
          } as any);
          result.registered += 1;
        }
      }
    } catch (err: any) {
      // `strict` is documented as "fail fast on misconfiguration", but this
      // catch swallowed the throw the strict branches raise — including its
      // own — so the option only ever recorded the failure twice and carried
      // on. A production runtime that opted into fail-fast never got it.
      // Under strict, every bind failure is fatal, as advertised.
      if (opts.strict) throw err;
      result.errors.push({ hook: hook.name, reason: err?.message ?? String(err) });
      logger.error('[hook-binder] failed to bind hook', {
        hook: hook.name,
        error: err?.message,
      });
    }
  }

  if (result.registered > 0) {
    logger.debug('[hook-binder] hooks bound', {
      packageId: opts.packageId,
      registered: result.registered,
      skipped: result.skipped,
    });
  }

  return result;
}

/**
 * Resolve a hook's declared target to the object names it registers on.
 *
 * Returns `[]` when the target names nothing. This used to fall back to
 * `['*']`, which is the engine's match-everything sentinel — so a hook whose
 * target was blank (`''`, `[]`, or a list of blanks) silently registered on
 * EVERY object, on every event it listed. Blank intent became the broadest
 * possible blast radius with no diagnostic (#4001).
 *
 * `HookSchema` now refuses those shapes at parse time, but this binder accepts
 * unparsed `Hook` input, so the guard has to hold here too. An empty result is
 * skipped and recorded by the caller rather than widened: a wildcard hook is
 * legitimate, it just has to be spelled `'*'` so a reviewer can see it.
 */
function normalizeObjects(target: Hook['object']): string[] {
  const names = Array.isArray(target) ? target : [target];
  return names.filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
}

function resolveHandler(
  engine: ObjectQL,
  hook: Hook,
  opts: BindHooksOptions,
): HookHandler | undefined {
  // Metadata-only body (L1 expression or L2 sandboxed JS) takes precedence
  // over the legacy `handler` field. This is the cloud-deployable path —
  // the body string ships inside the artifact JSON and runs under a
  // capability-gated sandbox supplied by the runtime.
  const body = (hook as any).body;
  if (body && typeof body === 'object') {
    let runner = opts.bodyRunner;
    if (typeof runner !== 'function') {
      // [#4251] The public accessor — this read used to reach the private
      // `_defaultBodyRunner` field through `as any`.
      const fallback = engine?.getDefaultBodyRunner?.();
      if (typeof fallback === 'function') runner = fallback;
    }
    if (typeof runner !== 'function') {
      return undefined;
    }
    const fn = runner(hook);
    if (typeof fn === 'function') return fn;
    return undefined;
  }

  const h = hook.handler;
  if (typeof h === 'function') return h as HookHandler;
  if (typeof h === 'string' && h.length > 0) {
    // Try the per-bundle map first (hot path during initial bind),
    // then fall back to whatever the engine already knows.
    const fromBundle = opts.functions?.[h];
    if (typeof fromBundle === 'function') return fromBundle;
    if (typeof (engine as any).resolveFunction === 'function') {
      const fn = (engine as any).resolveFunction(h);
      if (typeof fn === 'function') return fn as HookHandler;
    }
  }
  return undefined;
}
