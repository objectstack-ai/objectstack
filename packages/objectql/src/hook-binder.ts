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
 * - Declarative fields (`condition`, `async`, `retryPolicy`, `timeoutMs`,
 *   `onError`) are honoured uniformly via `wrapDeclarativeHook`.
 * - Hooks can be unregistered as a unit via `packageId`, enabling clean
 *   hot-reload and app uninstall.
 *
 * The ObjectQL engine itself stays simple — it knows how to store and
 * trigger handlers, but knows nothing about declarative semantics. All
 * metadata-aware behaviour lives in this binder + the wrapper module.
 */

import type { Hook } from '@objectstack/spec/data';
import { normalizeFlowFunctionEntry, type FlowFunctionEntry } from '@objectstack/spec/automation';
import type { ObjectQL, HookHandler } from './engine.js';
import { wrapDeclarativeHook, type HookDiagnosticsLogger } from './hook-wrappers.js';
import type { HookMetricsRecorder } from './hook-metrics.js';

export interface BindHooksOptions {
  /** Owning package / app id — used for `unregisterHooksByPackage`. */
  packageId?: string;

  /**
   * Optional name → function map for resolving string `handler` references.
   * Typically supplied by `defineStack({ functions })` (an artifact's runtime
   * module supplies it on the artifact path). A string `handler` resolves
   * against this map, then against the functions registered on the engine
   * under the SAME `packageId` — never another package's; a name neither
   * holds is refused at registration ({@link HOOK_HANDLER_NOT_IN_PACKAGE_CODE}).
   *
   * A value may be the handler itself or a declaration record stating what the
   * function does (`{ handler, effect: 'writes' }`, #4396) — the same two
   * spellings `defineStack({ functions })` accepts. The declaration is stored
   * on the registry entry, where the `script` node reads it to report the run's
   * metrics honestly; hook binding itself only ever needs the handler.
   */
  functions?: Record<string, FlowFunctionEntry>;

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

  /**
   * Logger; defaults to a silent no-op.
   *
   * The `Logger` contract, narrowed to the levels this layer uses — the SAME
   * type the wrapper takes, since every logger handed to the binder is passed
   * straight through to `wrapDeclarativeHook`. See
   * {@link HookDiagnosticsLogger} for why this is not a locally-declared shape
   * (#5637).
   */
  logger?: HookDiagnosticsLogger;
}

const noopLogger: HookDiagnosticsLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Counter for stats. */
export interface BindHooksResult {
  registered: number;
  skipped: number;
  /**
   * One entry per hook that did not bind. `code` and `status` are set when the
   * failure is a coded registration refusal (ADR-0112 envelope) — today a
   * `handler` naming a function the hook's own package does not hold
   * ({@link HOOK_HANDLER_NOT_IN_PACKAGE_CODE}).
   */
  errors: Array<{ hook: string; reason: string; code?: string; status?: number }>;
}

/**
 * The refusal of a hook whose `handler` names a function its own package does
 * not hold, as the ADR-0112 envelope carries it.
 *
 * A hook's `handler` name resolves inside the hook's own package only: the
 * functions handed to its bind (the package's `functions`, which its runtime
 * module supplies) and the functions the same package registered on the
 * engine. A name the package does not hold — a typo, or a function another
 * package registered — is refused at registration and the hook is not bound.
 *
 * `INVALID_REFERENCE` is the standard catalog's member for a reference that
 * does not resolve where it must; the condition is generic, so the ledger's
 * admission rule sends it to the standard member rather than to a new code.
 */
export const HOOK_HANDLER_NOT_IN_PACKAGE_CODE = 'INVALID_REFERENCE';
export const HOOK_HANDLER_NOT_IN_PACKAGE_STATUS = 400;

type HookRegistrationRefusal = Error & {
  code: string;
  status: number;
  hook: string;
  handler: string;
  packageId?: string;
};

function hookHandlerNotInPackageRefusal(
  hookName: string,
  fnName: string,
  packageId: string | undefined,
): HookRegistrationRefusal {
  const holder = packageId
    ? `its own package ('${packageId}') holds no function of that name`
    : 'this bind names no owning package and was handed no function of that name';
  const err = new Error(
    `Hook '${hookName}' was not bound: its \`handler\` names '${fnName}', and ${holder}. `
    + "A hook's `handler` resolves only among the functions its own package declares — the package's "
    + "`functions`, its runtime module's among them — and never reaches a function another package "
    + 'registered. Give the hook a `body` (sandboxed JS), or declare the function in this package\'s own '
    + '`functions`; to reuse another package\'s function, import it from the package that owns it.',
  ) as HookRegistrationRefusal;
  err.code = HOOK_HANDLER_NOT_IN_PACKAGE_CODE;
  err.status = HOOK_HANDLER_NOT_IN_PACKAGE_STATUS;
  err.hook = hookName;
  err.handler = fnName;
  if (packageId) err.packageId = packageId;
  return err;
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

  // Pre-load any inline functions supplied via `bundle.functions` so
  // string-handler resolution works. An entry may declare its effect (#4396);
  // that declaration is registered WITH the handler, so a later `script`-node
  // caller reads both off the one registry.
  //
  // BEFORE the no-hooks bail-out below, deliberately: `functions` is not a
  // hook accessory. It also feeds `Action.target` string refs and a flow
  // `script` node's `config.function`, so a stack that declares functions and
  // no hooks — the shape #4396's example has — registered NOTHING and every
  // such `script` node failed with "no function named 'x' is registered",
  // naming the one thing the author had actually done.
  if (opts.functions && typeof (engine as any).registerFunction === 'function') {
    for (const [name, entry] of Object.entries(opts.functions)) {
      const fn = normalizeFlowFunctionEntry(entry);
      if (!fn) {
        logger.warn('[hook-binder] skipping function entry with no callable handler', { name });
        continue;
      }
      if (fn.unrecognizedEffect !== undefined) {
        logger.warn('[hook-binder] unrecognized function effect — counted as an uncountable write', {
          name,
          effect: fn.unrecognizedEffect,
          expected: "'pure' | 'writes'",
        });
      }
      try {
        (engine as any).registerFunction(name, fn.handler, {
          packageId: opts.packageId,
          effect: fn.effect,
        });
      } catch (err: any) {
        logger.warn('[hook-binder] failed to register function', {
          name,
          error: err?.message,
        });
      }
    }
  }

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

  for (const hook of hooks) {
    try {
      const resolved = resolveHandler(engine, hook, opts);
      if (!resolved) {
        result.skipped += 1;
        // A `handler` name the hook's own package does not hold is REFUSED at
        // registration, as a coded refusal, whether the name exists nowhere or
        // only in another package — the two are one condition from where the
        // hook stands. Logged at `error`, beside the binder's other coded
        // registration refusals, and fatal under `strict`.
        if (!(hook as any).body && typeof hook.handler === 'string' && hook.handler.length > 0) {
          const refusal = hookHandlerNotInPackageRefusal(hook.name, hook.handler, opts.packageId);
          result.errors.push({
            hook: hook.name,
            reason: refusal.message,
            code: refusal.code,
            status: refusal.status,
          });
          if (opts.strict) throw refusal;
          logger.error('[hook-binder] hook refused: its handler names no function of its own package', refusal, {
            hook: hook.name,
            handler: hook.handler,
            packageId: opts.packageId,
            code: refusal.code,
            status: refusal.status,
          });
          continue;
        }
        const reason = (hook as any).body
          ? `hook body present but no bodyRunner supplied to bindHooksToEngine (runtime must wire QuickJSScriptRunner)`
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
          + "the wildcard '*'. Name the object(s), or write `object: '*'` if firing on "
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
      // Contract arg order (#5637): `error(message, error?: Error, meta?)`.
      // `err` is the `any` of a catch clause — a bind failure may be thrown by
      // user code and need not be an `Error` — so the Error slot stays empty
      // and the diagnostic travels as meta, in the third parameter.
      logger.error('[hook-binder] failed to bind hook', undefined, {
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
    // A name resolves inside the hook's OWN package only. First the functions
    // handed to this bind — the package's `functions`, which an artifact's
    // runtime module supplies (hot path during initial bind). A declaration
    // record resolves to its handler — a hook cares only about the callable.
    const fromBundle = normalizeFlowFunctionEntry(opts.functions?.[h]);
    if (fromBundle) return fromBundle.handler as HookHandler;
    // Then a function the SAME package registered on the engine earlier. The
    // registry is keyed by bare name, so the owner on the entry is what keeps
    // a hook from binding to a function another package registered under the
    // same name — that package's code would run on this package's events.
    return ownPackageFunction(engine, h, opts.packageId);
  }
  return undefined;
}

/**
 * The engine-registered function `name` when — and only when — its owner is
 * `packageId`. A bind that states no owner holds only the functions handed to
 * it: an entry with no owner, or with another owner, is not this package's.
 */
function ownPackageFunction(
  engine: ObjectQL,
  name: string,
  packageId: string | undefined,
): HookHandler | undefined {
  if (!packageId) return undefined;
  if (typeof (engine as any).resolveFunctionEntry !== 'function') return undefined;
  const entry = (engine as any).resolveFunctionEntry(name);
  if (!entry || entry.packageId !== packageId) return undefined;
  return typeof entry.handler === 'function' ? (entry.handler as HookHandler) : undefined;
}
