// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hook's declared refusal catalogue, answered at run time (#26170,
 * maintainer ruling 6431311681 letter A).
 *
 * A hook that declares `refusals: { <CODE>: { message, status? } }`
 * (`HookSchema.refusals`) refuses by code only. Its sandboxed body throws an
 * error carrying a declared `code`, and {@link resolveHookRefusal} answers that
 * throw with the catalogue's entry:
 *
 *  - the sentence is `hooks.<hook>.refusals.<CODE>.message`, picked through the
 *    `i18n` service in the caller's `HookContext.session.locale` (negotiated by
 *    `resolveBundleLocale`, the one negotiation rule), else the declared
 *    `message` — served as the error's caller-facing sentence (`innerMessage`)
 *    and marked as the end user's (`userMessage`, the objectui#5210 opt-in);
 *  - the status is the declared `status`, else 400;
 *  - the code is the declared code — on the wire, `declaredCode` beside the
 *    status's registered `code` — so the caller can branch on it.
 *
 * **Picked here, before the refusal leaves.** A hook refusal reaches the
 * caller already rendered — the error envelope every door builds from the
 * thrown error — so nothing downstream could translate it: the validation-rule
 * posture (`objectValidationMessageKey`, objectql's rule evaluator) and the
 * flow `end` one (`flowRefusalMessageKey`, the automation engine).
 *
 * **Loud for anything else the body made.** A throw the catalogue cannot answer
 * — a code it does not declare, or no code at all — is refused as a sandbox
 * fault naming the hook and the code (`undeclaredHookRefusalAtRun`), which
 * every door answers `500` and the body runner logs at `error`. The save
 * refuses a code the body throws literally first (`HookSchema`); this is the
 * half for the codes a save cannot read.
 *
 * **Untouched: what the body did not make.** An error a host call raised and
 * the body let leave unchanged ({@link isHostRelayedSandboxError}: an engine
 * refusal of a `ctx.api` write, a nested hook's refusal), the engine's own
 * error the runner relays as itself, a crash (`TypeError: …`) and the
 * sandbox's own faults (budget, capability) all pass through as before: they
 * are the platform speaking, or a bug, never a refusal the body chose.
 *
 * **Reasons and params (#33214, ruling 6879477573: S1 and params).** A code
 * may hold further declared sentences under `reasons`; a throw that names a
 * `reason` is answered with that sentence
 * (`hooks.<hook>.refusals.<CODE>.reasons.<REASON>.message`), the code's
 * status and the code on the wire, unchanged. A reason the code does not
 * declare is refused loudly, like an undeclared code. An entry that declares
 * `params` is a template: its picked sentence (translated or declared) has its
 * `{{ NAME }}` holes filled from the throw's `params` through the formula
 * template engine — the engine the flow `end` refusal renders through
 * (`renderTextSlot`, service-automation) — with only the declared names in
 * scope. An entry with no `params` is plain text and nothing is filled.
 *
 * **Every path a hook runs on (#33214, ruling 6879477573 letter A).** A hook's
 * code runs as a sandboxed `body` ({@link resolveHookRefusal}, called by the
 * body runner) or as an in-process `handler` — an inline function on a source
 * boot, or the function a string `handler` names when the build could not
 * lower it ({@link resolveInProcessHookRefusal}, called by the in-process seam
 * `withInProcessHookTitle`). Both answer one way and throw one error shape, so
 * the wire is identical. In-process there is no VM bridge to mark what a host
 * call raised, so the seam hands the handler host surfaces ({@link
 * inProcessHostSurface}) that mark every error a host call raises; a marked
 * error passes through unchanged, as a host-relayed error does on the body
 * path.
 *
 * A hook that declares no `refusals` is answered exactly as before.
 */

import type { Hook } from '@objectstack/spec/data';
import { undeclaredHookRefusalAtRun, undeclaredHookRefusalReasonAtRun } from '@objectstack/spec/data';
import { hookRefusalMessageKey, resolveBundleLocale } from '@objectstack/spec/system';
import { templateEngine } from '@objectstack/formula';
import { sandboxBusinessMessage } from '@objectstack/types';
import {
  SandboxError,
  isHostRelayedSandboxError,
  isRelayedSandboxRefusal,
  sandboxRefusalAddressOf,
  type SandboxRefusalAddress,
} from './quickjs-runner.js';

/** The status a declared refusal is answered with when its entry names none. */
export const DEFAULT_HOOK_REFUSAL_STATUS = 400;

/**
 * The slice of `II18nService` a declared refusal is translated through: a key
 * lookup in a locale (which echoes the key on a miss) and, when the service
 * can say, the locales it holds.
 */
export interface HookRefusalI18nService {
  t(key: string, locale: string, params?: Record<string, unknown>): string;
  getLocales?(): string[];
}

/**
 * Where the body runner reads the `i18n` service from — asked at refusal
 * time, never at bind, so a service registered after the hook bound is still
 * found (the `i18nServiceReader` posture of the automation engine).
 */
export type HookRefusalI18nSource = () => HookRefusalI18nService | undefined;

/**
 * The `i18n` service as a {@link HookRefusalI18nSource}: read from the kernel
 * at refusal time, `undefined` while none is registered or when the one
 * registered cannot look a key up.
 */
export function hookRefusalI18nReader(ctx: { getService<T>(name: string): T }): HookRefusalI18nSource {
  return () => {
    let service: HookRefusalI18nService | undefined;
    try {
      service = ctx.getService<HookRefusalI18nService>('i18n');
    } catch {
      return undefined;
    }
    return typeof service?.t === 'function' ? service : undefined;
  };
}

/** One declared entry, as the catalogue holds it. */
interface DeclaredRefusal {
  message: string;
  status?: number;
  /** [#33214] Further declared sentences under this code, by reason. */
  reasons?: Record<string, { message: string }>;
  /** [#33214] The names the entry's sentences may fill. */
  params?: string[];
}

/** [#33214] What a hook's throw named beside its code: a declared reason and the params its holes name. */
export type HookRefusalAddress = SandboxRefusalAddress;

/** The hook's catalogue, or `undefined` when it declares none. */
function catalogueOf(hook: Pick<Hook, 'refusals'>): Record<string, DeclaredRefusal> | undefined {
  const refusals = (hook as { refusals?: unknown }).refusals;
  return refusals && typeof refusals === 'object' ? (refusals as Record<string, DeclaredRefusal>) : undefined;
}

/** The locale the service can answer in for `requested` — `resolveBundleLocale` against what it holds. */
function negotiatedLocale(service: HookRefusalI18nService, requested: string): string {
  if (typeof service.getLocales !== 'function') return requested;
  let available: unknown;
  try {
    available = service.getLocales();
  } catch {
    return requested;
  }
  if (!Array.isArray(available) || available.length === 0) return requested;
  const offered: Record<string, true> = {};
  for (const code of available) {
    if (typeof code === 'string' && code.length > 0) offered[code] = true;
  }
  return resolveBundleLocale(offered, requested) ?? requested;
}

/**
 * [#33214] `template` with each `{{ NAME }}` hole filled from `params`, through
 * the formula template engine the flow `end` refusal renders with
 * (`renderTextSlot`, service-automation) — ⛔ never a second template engine.
 * Only the entry's declared names are in scope: a value the throw passed under
 * any other name is not read, and a declared name the throw did not pass
 * renders nothing. A template the engine cannot render is served as written
 * and the failure is logged: a refusal stays a refusal.
 */
export function fillHookRefusalParams(
  hookName: string,
  template: string,
  declared: readonly string[],
  params: Record<string, unknown> | undefined,
  logger?: { warn?: (...args: any[]) => void },
): string {
  const scope: Record<string, unknown> = {};
  for (const name of declared) {
    scope[name] = params && Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined;
  }
  let result: { ok: boolean; value?: unknown; error?: { message?: string } };
  try {
    result = templateEngine.evaluate({ dialect: 'template', source: template }, { extra: scope }) as typeof result;
  } catch (err: unknown) {
    result = { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
  }
  if (result.ok) return String(result.value ?? '');
  logger?.warn?.(
    `[BodyRunner] hook '${hookName}': its refusal sentence did not render (${result.error?.message ?? 'unknown'}), `
      + 'so it is served as written.',
  );
  return template;
}

/**
 * The sentence a declared refusal is answered with: its translation in
 * `locale` when the `i18n` service holds one, else the declared sentence —
 * the entry's `message`, or, when the throw named a declared reason
 * (#33214), that reason's `message` and key. An entry that declares `params`
 * then has its holes filled from the throw's `params`
 * ({@link fillHookRefusalParams}); one that declares none is plain text both
 * ways, replaced whole. A service that throws, or a key it echoes back, picks
 * nothing; a refusal stays a refusal whatever the service does.
 *
 * The caller has already checked that `address.reason`, when present, is one
 * the entry declares.
 */
export function declaredRefusalMessage(
  hookName: string,
  code: string,
  entry: DeclaredRefusal,
  locale: string | undefined,
  i18n: HookRefusalI18nSource | undefined,
  logger?: { warn?: (...args: any[]) => void },
  address?: HookRefusalAddress,
): string {
  const reason = address?.reason;
  const declaredSentence = reason !== undefined && entry.reasons?.[reason] ? entry.reasons[reason]!.message : entry.message;
  const picked = pickTranslatedSentence(hookName, code, reason, declaredSentence, locale, i18n, logger);
  const params = Array.isArray(entry.params) ? entry.params : [];
  return params.length > 0 ? fillHookRefusalParams(hookName, picked, params, address?.params, logger) : picked;
}

/** The translation of a declared sentence in `locale`, or the declared sentence itself. */
function pickTranslatedSentence(
  hookName: string,
  code: string,
  reason: string | undefined,
  declared: string,
  locale: string | undefined,
  i18n: HookRefusalI18nSource | undefined,
  logger?: { warn?: (...args: any[]) => void },
): string {
  if (typeof locale !== 'string' || locale.length === 0 || !i18n) return declared;
  let service: HookRefusalI18nService | undefined;
  try {
    service = i18n();
  } catch {
    return declared;
  }
  if (!service || typeof service.t !== 'function') return declared;
  const key = hookRefusalMessageKey(hookName, code, reason);
  try {
    const translated = service.t(key, negotiatedLocale(service, locale));
    // II18nService echoes the key back on a miss.
    if (typeof translated === 'string' && translated.trim().length > 0 && translated !== key) return translated;
  } catch (err: unknown) {
    logger?.warn?.(
      `[BodyRunner] hook '${hookName}': the i18n service threw reading '${key}' `
        + `(${err instanceof Error ? err.message : String(err)}), so the refusal shows its declared message.`,
    );
  }
  return declared;
}

/**
 * The error a declared code answers with, or the loud fault for a reason the
 * code does not declare — shared by the body path and the in-process path so
 * the two cannot answer differently.
 */
function answerDeclaredCode(
  hook: Pick<Hook, 'name'>,
  code: string,
  entry: DeclaredRefusal,
  address: HookRefusalAddress | undefined,
  logMessage: string,
  engineCtx: { session?: { locale?: unknown } } | undefined,
  opts: { i18n?: HookRefusalI18nSource; logger?: { warn?: (...args: any[]) => void } },
): SandboxError {
  const reason = address?.reason;
  if (reason !== undefined) {
    const reasons = entry.reasons && typeof entry.reasons === 'object' ? entry.reasons : {};
    if (!Object.prototype.hasOwnProperty.call(reasons, reason)) {
      return new SandboxError(undeclaredHookRefusalReasonAtRun(String(hook.name), code, reason, Object.keys(reasons)));
    }
  }
  const locale = engineCtx?.session?.locale;
  const message = declaredRefusalMessage(
    String(hook.name),
    code,
    entry,
    typeof locale === 'string' ? locale : undefined,
    opts.i18n,
    opts.logger,
    address,
  );
  return new SandboxError(logMessage, message, {
    code,
    status: typeof entry.status === 'number' ? entry.status : DEFAULT_HOOK_REFUSAL_STATUS,
    userMessage: message,
  });
}

/**
 * Answer a sandboxed hook body's throw against the hook's refusal catalogue.
 * Returns the error to throw in its place — `err` itself whenever the
 * catalogue has nothing to say about it (see the module header).
 */
export function resolveHookRefusal(
  hook: Pick<Hook, 'name' | 'refusals'>,
  err: unknown,
  engineCtx: { session?: { locale?: unknown } } | undefined,
  opts: { i18n?: HookRefusalI18nSource; logger?: { warn?: (...args: any[]) => void } } = {},
): unknown {
  const catalogue = catalogueOf(hook);
  if (!catalogue) return err;
  // Not the body's own throw: the engine's error relayed as itself, the
  // sandbox's own fault, a host error re-thrown unchanged, a nested refusal.
  if (!(err instanceof SandboxError) || err.innerMessage === undefined) return err;
  if (isHostRelayedSandboxError(err) || isRelayedSandboxRefusal(err)) return err;
  // A crash (`TypeError: …`) is a bug, not a refusal: it stays the fault it is.
  if (sandboxBusinessMessage(err) === undefined) return err;

  const code = typeof err.code === 'string' && err.code.length > 0 ? err.code : undefined;
  const entry = code !== undefined && Object.prototype.hasOwnProperty.call(catalogue, code) ? catalogue[code] : undefined;
  if (code === undefined || !entry) {
    return new SandboxError(undeclaredHookRefusalAtRun(String(hook.name), code, Object.keys(catalogue)));
  }
  return answerDeclaredCode(hook, code, entry, sandboxRefusalAddressOf(err), err.message, engineCtx, opts);
}

// ── The in-process half (#33214, ruling 6879477573 letter A) ─────────────────

/** Errors a host call raised in-process: an engine refusal, a nested hook's refusal. */
const inProcessHostRaised = new WeakSet<object>();

/** Errors a handler's own callback threw INTO a host call (a `transaction` body), so its rejection is the handler's. */
const inProcessHandlerRaised = new WeakSet<object>();

/** A host surface's proxy → the object it fronts, so a host call never receives a proxy. */
const surfaceTargets = new WeakMap<object, object>();

/** An object or function → its host-surface proxy, so one host object has one proxy. */
const surfaceProxies = new WeakMap<object, object>();

/** Was this error raised by a host call an in-process handler made (marked by {@link inProcessHostSurface})? */
export function isInProcessHostRaised(err: unknown): boolean {
  return typeof err === 'object' && err !== null && inProcessHostRaised.has(err);
}

function markHostRaised(err: unknown): void {
  if (typeof err === 'object' && err !== null && !inProcessHandlerRaised.has(err)) inProcessHostRaised.add(err);
}

function markHandlerRaised(err: unknown): void {
  if (typeof err === 'object' && err !== null && !inProcessHostRaised.has(err)) inProcessHandlerRaised.add(err);
}

/** The object a host-surface proxy fronts, or the value itself. */
function unwrapSurface(value: unknown): unknown {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    ? (surfaceTargets.get(value) ?? value)
    : value;
}

/** A callback the handler hands a host call: what it throws is the handler's own, and what it is handed is a host surface. */
function handlerCallback(fn: (...args: any[]) => unknown): (...args: any[]) => unknown {
  return function handlerOwnedCallback(this: unknown, ...args: unknown[]): unknown {
    let out: unknown;
    try {
      out = Reflect.apply(fn, this, args.map((a) => inProcessHostSurface(a)));
    } catch (err) {
      markHandlerRaised(err);
      throw err;
    }
    if (out instanceof Promise) {
      return out.then(undefined, (err: unknown) => {
        markHandlerRaised(err);
        throw err;
      });
    }
    return out;
  };
}

/** Call a host function: every error it raises is marked, a callback argument is the handler's, a result a surface. */
function callHost(fn: (...args: any[]) => unknown, thisArg: unknown, args: unknown[]): unknown {
  const hostArgs = args.map((a) => (typeof a === 'function' && !surfaceTargets.has(a) ? handlerCallback(a as any) : unwrapSurface(a)));
  let out: unknown;
  try {
    out = Reflect.apply(fn, thisArg, hostArgs);
  } catch (err) {
    markHostRaised(err);
    throw err;
  }
  if (out instanceof Promise) {
    return out.then(undefined, (err: unknown) => {
      markHostRaised(err);
      throw err;
    });
  }
  return inProcessHostSurface(out);
}

/**
 * `value` as a HOST SURFACE an in-process handler may call: every error a call
 * through it raises — synchronously, or as the rejection of the promise it
 * returns — is marked as host-raised ({@link isInProcessHostRaised}), so the
 * refusal catalogue passes it through unchanged, as the body path passes a
 * host-relayed error. An object a call returns is itself a surface (a
 * repository from `ctx.api.object(…)`); a promise is left a native promise and
 * only its rejection is marked; a plain value passes as is.
 *
 * What the handler hands back is the host's own again: a surface passed as an
 * argument is unwrapped, so a host call never receives a proxy; and a function
 * argument (a `transaction` callback) is the handler's — what it throws is
 * the handler's own throw, never marked host-raised by the call it rejects.
 *
 * Methods are called on the object the surface fronts, never on the proxy, so
 * a class's private state is read where it lives.
 */
export function inProcessHostSurface<T>(value: T): T {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value;
  if (value instanceof Promise || surfaceTargets.has(value as object)) return value;
  const cached = surfaceProxies.get(value as object);
  if (cached) return cached as T;
  const target = value as object;
  const proxy = new Proxy(target as any, {
    get(t, prop) {
      const v = Reflect.get(t, prop, t);
      if (typeof v !== 'function' || prop === 'constructor') return v;
      // A proxy must answer a frozen own property with its own value.
      const own = Reflect.getOwnPropertyDescriptor(t, prop);
      if (own && own.configurable === false && own.writable === false) return v;
      if (prop === 'then') {
        // A thenable host value: await reads its rejection through here.
        return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          Reflect.apply(v, t, [
            onFulfilled,
            (err: unknown) => {
              markHostRaised(err);
              if (onRejected) return onRejected(err);
              throw err;
            },
          ]);
      }
      return (...args: unknown[]) => callHost(v as (...a: any[]) => unknown, t, args);
    },
    apply(t, thisArg, args) {
      return callHost(t as (...a: any[]) => unknown, unwrapSurface(thisArg), args);
    },
  });
  surfaceProxies.set(target, proxy);
  surfaceTargets.set(proxy, target);
  return proxy as T;
}

/** A native crash class: a bug, never a refusal the handler chose. */
function isCrash(err: unknown): boolean {
  return err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError
    || err instanceof SyntaxError || err instanceof EvalError || err instanceof URIError;
}

/** `err` flattened the way the VM flattens a body's throw, for the log-facing message. */
function flattenThrown(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
    return `Error: ${(err as { message: string }).message}`;
  }
  return String(err);
}

/**
 * [#33214] Answer an IN-PROCESS hook handler's throw against the hook's refusal
 * catalogue — the in-process twin of {@link resolveHookRefusal}, called by the
 * seam every in-process handler runs through (`withInProcessHookTitle`).
 * Returns the error to throw in its place: `err` itself whenever the catalogue
 * has nothing to say about it.
 *
 *  - A declared code (and declared reason) is answered exactly as on the body
 *    path: the same `SandboxError` carrying the declared code, the declared
 *    status, and the picked sentence as its caller-facing message and
 *    `userMessage` — so every door builds the same envelope from it.
 *  - Any other throw the handler made — an undeclared code, an undeclared
 *    reason, no code at all — is refused loudly, as the same fault the body
 *    path raises.
 *  - Untouched: an error a host call raised ({@link isInProcessHostRaised}), a
 *    `SandboxError` (a nested body's, or the platform's), and a crash
 *    (`TypeError` and the other native classes).
 */
export function resolveInProcessHookRefusal(
  hook: Pick<Hook, 'name' | 'refusals'>,
  err: unknown,
  engineCtx: { session?: { locale?: unknown } } | undefined,
  opts: { i18n?: HookRefusalI18nSource; logger?: { warn?: (...args: any[]) => void } } = {},
): unknown {
  const catalogue = catalogueOf(hook);
  if (!catalogue) return err;
  if (isInProcessHostRaised(err) || err instanceof SandboxError || isCrash(err)) return err;
  const thrown = (typeof err === 'object' && err !== null ? err : {}) as {
    code?: unknown;
    reason?: unknown;
    params?: unknown;
  };
  const code = typeof thrown.code === 'string' && thrown.code.length > 0 ? thrown.code : undefined;
  const entry = code !== undefined && Object.prototype.hasOwnProperty.call(catalogue, code) ? catalogue[code] : undefined;
  if (code === undefined || !entry) {
    return new SandboxError(undeclaredHookRefusalAtRun(String(hook.name), code, Object.keys(catalogue)));
  }
  const address: HookRefusalAddress = {};
  if (typeof thrown.reason === 'string' && thrown.reason.length > 0) address.reason = thrown.reason;
  if (thrown.params !== null && typeof thrown.params === 'object' && !Array.isArray(thrown.params)) {
    address.params = thrown.params as Record<string, unknown>;
  }
  return answerDeclaredCode(
    hook,
    code,
    entry,
    address,
    `hook '${String(hook.name)}' threw: ${flattenThrown(err)}`,
    engineCtx,
    opts,
  );
}
