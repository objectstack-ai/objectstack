// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hook's declared texts, answered at run time (#34374, maintainer ruling
 * 6913660232 option B, parameter 7).
 *
 * A hook that declares `texts: { <key>: { message, params? } }`
 * (`HookSchema.texts`) asks for a sentence it writes into a record by key —
 * `await ctx.text('follow_up_subject', { lead })` — and {@link buildHookTextSurface}
 * answers it:
 *
 *  - in the ORGANIZATION's language, never the caller's (parameter 2): the one
 *    shared reading `readOrganizationTextLocale` (`@objectstack/core`) of the
 *    Localization setting somebody set, else the app's `i18n.defaultLocale`
 *    (parameter 3) — the reading the flow record write's text field uses;
 *  - the translated sentence first, `hooks.<hook>.texts.<key>.message` through
 *    the `i18n` service, negotiated by `resolveBundleLocale`; then its `{{ }}`
 *    holes are filled from `params` through the formula template engine, the
 *    one a declared refusal is filled with (parameter 1). A translation whose
 *    holes do not render is dropped for the declared `message`, filled;
 *  - with no translation, or no language, the declared `message` (parameter 5)
 *    — the hook goes on;
 *  - a Localization setting that cannot be READ (the settings service throws)
 *    rejects the call: the organization's language may exist and could not be
 *    known, and answering another would look like success — the flow record
 *    write's rule (ruling 6929082704 letter A). The hook decides what a
 *    rejection means for its own write.
 *
 * A key the hook does not declare is refused loudly, as a fault naming the hook
 * and the key (`undeclaredHookTextAtRun`); a save already refused the keys the
 * hook's source asks for literally (`HookSchema`).
 *
 * One answer on every path a hook runs on: the sandboxed body (installed on the
 * VM's `ctx.text` by `installCtx`) and the in-process seam a `handler` runs
 * through (`withInProcessHookTitle`).
 */

import type { Hook } from '@objectstack/spec/data';
import { undeclaredHookTextAtRun } from '@objectstack/spec/data';
import { hookTextMessageKey } from '@objectstack/spec/system';
import { readOrganizationTextLocale } from '@objectstack/core';
import {
  negotiatedLocale,
  renderHookTemplate,
  type HookRefusalI18nService,
  type HookRefusalI18nSource,
} from './hook-refusal-catalogue.js';
import { SandboxError } from './quickjs-runner.js';

/** One declared text, as the hook holds it. */
interface DeclaredText {
  message: string;
  params?: string[];
}

/** What `ctx.text(key, params?)` is answered with. */
export type HookTextSurface = (key: string, params?: Record<string, unknown>) => Promise<string>;

/** What {@link buildHookTextSurface} reads its services through. */
export interface HookTextOptions {
  /** The `i18n` service a declared text is translated through, read at call time. */
  i18n?: HookRefusalI18nSource;
  /** Kernel service lookup — the `settings` and `i18n` services the organization's language is read from, at call time. */
  getService?: (name: string) => unknown;
  logger?: { warn?: (...args: any[]) => void };
}

/** The hook's declared texts, or `undefined` when it declares none. */
function textsOf(hook: Pick<Hook, 'texts'>): Record<string, DeclaredText> | undefined {
  const texts = (hook as { texts?: unknown }).texts;
  return texts && typeof texts === 'object' ? (texts as Record<string, DeclaredText>) : undefined;
}

/** The translation of a declared text in `locale`, or `undefined` when none is picked. */
function pickTranslatedText(
  hookName: string,
  key: string,
  locale: string,
  i18n: HookRefusalI18nSource | undefined,
  logger: HookTextOptions['logger'],
): string | undefined {
  let service: HookRefusalI18nService | undefined;
  try {
    service = i18n?.();
  } catch {
    return undefined;
  }
  if (!service || typeof service.t !== 'function') return undefined;
  const translationKey = hookTextMessageKey(hookName, key);
  try {
    const translated = service.t(translationKey, negotiatedLocale(service, locale));
    // II18nService echoes the key back on a miss.
    if (typeof translated === 'string' && translated.trim().length > 0 && translated !== translationKey) return translated;
  } catch (err: unknown) {
    logger?.warn?.(
      `[BodyRunner] hook '${hookName}': the i18n service threw reading '${translationKey}' `
        + `(${err instanceof Error ? err.message : String(err)}), so the text is written as declared.`,
    );
  }
  return undefined;
}

/**
 * Build `ctx.text(key, params?)` for one hook invocation. The organization is
 * the hook context's `session.organizationId`; a write with none asks the
 * settings service with no scope (its own reach), as the flow record write does.
 */
export function buildHookTextSurface(
  hook: Pick<Hook, 'name' | 'texts'>,
  engineCtx: { session?: { organizationId?: unknown } } | undefined,
  opts: HookTextOptions = {},
): HookTextSurface {
  const hookName = String(hook.name);
  return async (key: string, params?: Record<string, unknown>): Promise<string> => {
    const texts = textsOf(hook);
    const entry = texts && Object.prototype.hasOwnProperty.call(texts, key) ? texts[key] : undefined;
    if (!entry || typeof entry.message !== 'string') {
      throw new SandboxError(undeclaredHookTextAtRun(hookName, String(key), Object.keys(texts ?? {})));
    }
    const organizationId = engineCtx?.session?.organizationId;
    const locale = await readOrganizationTextLocale(
      opts.getService,
      typeof organizationId === 'string' && organizationId.length > 0 ? organizationId : undefined,
    );
    const translated = locale ? pickTranslatedText(hookName, key, locale, opts.i18n, opts.logger) : undefined;
    const declared = Array.isArray(entry.params) ? entry.params : [];
    if (declared.length === 0) return translated ?? entry.message;
    // A translation whose holes do not render falls back to the declared
    // sentence, filled; never a sentence with its braces in the record.
    if (translated !== undefined) {
      const filled = renderHookTemplate(translated, declared, params);
      if (filled.ok) return filled.value;
      opts.logger?.warn?.(
        `[BodyRunner] hook '${hookName}': the ${locale} translation of its text '${key}' did not render `
          + `(${filled.error}), so the declared text is written.`,
      );
    }
    const filled = renderHookTemplate(entry.message, declared, params);
    if (filled.ok) return filled.value;
    // Only reachable for a hook that skipped the compile check (`objectstack
    // validate`, `compile`, the publish gate refuse such a sentence).
    opts.logger?.warn?.(
      `[BodyRunner] hook '${hookName}': its declared text '${key}' did not render (${filled.error}), `
        + 'so it is written unfilled, holes and all.',
    );
    return entry.message;
  };
}
