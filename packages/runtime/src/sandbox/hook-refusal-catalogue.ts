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
 * A hook that declares no `refusals` is answered exactly as before.
 */

import type { Hook } from '@objectstack/spec/data';
import { undeclaredHookRefusalAtRun } from '@objectstack/spec/data';
import { hookRefusalMessageKey, resolveBundleLocale } from '@objectstack/spec/system';
import { sandboxBusinessMessage } from '@objectstack/types';
import { SandboxError, isHostRelayedSandboxError, isRelayedSandboxRefusal } from './quickjs-runner.js';

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
}

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
 * The sentence a declared refusal is answered with: its translation in
 * `locale` when the `i18n` service holds one, else the declared `message`.
 *
 * Plain text both ways — an authored refusal has no parameter contract, so the
 * translation replaces the message whole. A service that throws, or a key it
 * echoes back, picks nothing; a refusal stays a refusal whatever the service
 * does.
 */
export function declaredRefusalMessage(
  hookName: string,
  code: string,
  entry: DeclaredRefusal,
  locale: string | undefined,
  i18n: HookRefusalI18nSource | undefined,
  logger?: { warn?: (...args: any[]) => void },
): string {
  if (typeof locale !== 'string' || locale.length === 0 || !i18n) return entry.message;
  let service: HookRefusalI18nService | undefined;
  try {
    service = i18n();
  } catch {
    return entry.message;
  }
  if (!service || typeof service.t !== 'function') return entry.message;
  const key = hookRefusalMessageKey(hookName, code);
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
  return entry.message;
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

  const locale = engineCtx?.session?.locale;
  const message = declaredRefusalMessage(
    String(hook.name),
    code,
    entry,
    typeof locale === 'string' ? locale : undefined,
    opts.i18n,
    opts.logger,
  );
  return new SandboxError(err.message, message, {
    code,
    status: typeof entry.status === 'number' ? entry.status : DEFAULT_HOOK_REFUSAL_STATUS,
    userMessage: message,
  });
}
