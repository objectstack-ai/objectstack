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
 *
 * [#34374 PR2] And one answer for an ACTION's declared texts
 * (`ActionSchema.texts`), through {@link buildActionTextSurface}: the same
 * language, pick, fill and fallback, the translation read at the action's own
 * address (`actionTextMessageKey` — `objects.<object>._actions.<action>.texts.<key>.message`,
 * or `globalActions.<action>.…` for an object-less action, the object read by
 * the one owner-key ladder the action's refusals read), the organization the
 * action context's `session.organizationId`, and an undeclared key refused as
 * a fault naming the action (`undeclaredActionTextAtRun`). Only a `script`
 * action's sandboxed `js` body runs code of its own (`actionBodyRunnerFactory`),
 * so that is the one path it is installed on. Both are one function,
 * {@link buildDeclaredTextSurface}, parameterised by the owner.
 */

import type { Hook } from '@objectstack/spec/data';
import { undeclaredActionTextAtRun, undeclaredHookTextAtRun } from '@objectstack/spec/data';
import { actionTextMessageKey, hookTextMessageKey } from '@objectstack/spec/system';
import { readOrganizationTextLocale } from '@objectstack/core';
import {
  actionOwnObject,
  negotiatedLocale,
  renderHookTemplate,
  type HookRefusalI18nService,
  type HookRefusalI18nSource,
} from './hook-refusal-catalogue.js';
import { SandboxError } from './quickjs-runner.js';

/** One declared text, as the declaration holds it. */
interface DeclaredText {
  message: string;
  params?: string[];
}

/** What `ctx.text(key, params?)` is answered with. */
export type HookTextSurface = (key: string, params?: Record<string, unknown>) => Promise<string>;

/** What {@link buildHookTextSurface} and {@link buildActionTextSurface} read their services through. */
export interface HookTextOptions {
  /** The `i18n` service a declared text is translated through, read at call time. */
  i18n?: HookRefusalI18nSource;
  /** Kernel service lookup — the `settings` and `i18n` services the organization's language is read from, at call time. */
  getService?: (name: string) => unknown;
  logger?: { warn?: (...args: any[]) => void };
}

/**
 * [#34374 PR2] The declaration a text catalogue sits on — a hook, or an
 * action — as the shared answer needs it: its label for the log lines, the
 * key its translations are read at, and the run-time fault sentence.
 */
interface TextOwner {
  /** `hook 'NAME'` / `action 'NAME'`, for the log lines. */
  label: string;
  messageKey(key: string): string;
  undeclaredAtRun(key: string, declared: readonly string[]): string;
}

/** The declaration's declared texts, or `undefined` when it declares none. */
function textsOf(declaration: { texts?: unknown }): Record<string, DeclaredText> | undefined {
  const texts = declaration.texts;
  return texts && typeof texts === 'object' ? (texts as Record<string, DeclaredText>) : undefined;
}

/** The translation of a declared text in `locale`, or `undefined` when none is picked. */
function pickTranslatedText(
  owner: TextOwner,
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
  const translationKey = owner.messageKey(key);
  try {
    const translated = service.t(translationKey, negotiatedLocale(service, locale));
    // II18nService echoes the key back on a miss.
    if (typeof translated === 'string' && translated.trim().length > 0 && translated !== translationKey) return translated;
  } catch (err: unknown) {
    logger?.warn?.(
      `[BodyRunner] ${owner.label}: the i18n service threw reading '${translationKey}' `
        + `(${err instanceof Error ? err.message : String(err)}), so the text is written as declared.`,
    );
  }
  return undefined;
}

/**
 * Build `ctx.text(key, params?)` for one invocation of a declaration that
 * holds `texts`. The organization is the context's `session.organizationId`;
 * a call with none asks the settings service with no scope (its own reach),
 * as the flow record write does.
 */
function buildDeclaredTextSurface(
  owner: TextOwner,
  declaration: { texts?: unknown },
  engineCtx: { session?: { organizationId?: unknown } } | undefined,
  opts: HookTextOptions,
): HookTextSurface {
  return async (key: string, params?: Record<string, unknown>): Promise<string> => {
    const texts = textsOf(declaration);
    const entry = texts && Object.prototype.hasOwnProperty.call(texts, key) ? texts[key] : undefined;
    if (!entry || typeof entry.message !== 'string') {
      throw new SandboxError(owner.undeclaredAtRun(String(key), Object.keys(texts ?? {})));
    }
    const organizationId = engineCtx?.session?.organizationId;
    const locale = await readOrganizationTextLocale(
      opts.getService,
      typeof organizationId === 'string' && organizationId.length > 0 ? organizationId : undefined,
    );
    const translated = locale ? pickTranslatedText(owner, key, locale, opts.i18n, opts.logger) : undefined;
    const declared = Array.isArray(entry.params) ? entry.params : [];
    if (declared.length === 0) return translated ?? entry.message;
    // A translation whose holes do not render falls back to the declared
    // sentence, filled; never a sentence with its braces in the record.
    if (translated !== undefined) {
      const filled = renderHookTemplate(translated, declared, params);
      if (filled.ok) return filled.value;
      opts.logger?.warn?.(
        `[BodyRunner] ${owner.label}: the ${locale} translation of its text '${key}' did not render `
          + `(${filled.error}), so the declared text is written.`,
      );
    }
    const filled = renderHookTemplate(entry.message, declared, params);
    if (filled.ok) return filled.value;
    // Only reachable for a declaration that skipped the compile check
    // (`objectstack validate`, `compile`, the publish gate refuse such a sentence).
    opts.logger?.warn?.(
      `[BodyRunner] ${owner.label}: its declared text '${key}' did not render (${filled.error}), `
        + 'so it is written unfilled, holes and all.',
    );
    return entry.message;
  };
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
  const owner: TextOwner = {
    label: `hook '${hookName}'`,
    messageKey: (key) => hookTextMessageKey(hookName, key),
    undeclaredAtRun: (key, declared) => undeclaredHookTextAtRun(hookName, key, declared),
  };
  return buildDeclaredTextSurface(owner, hook, engineCtx, opts);
}

/** [#34374 PR2] An action as its declared texts read it: its name, its OWN object (absent: object-less), its texts. */
export interface ActionTextDeclaration {
  name: string;
  /** The object the action is declared on (`ActionSchema.objectName`). */
  objectName?: string;
  /** The object that declares it inline, as the bundle collector stamps it. */
  object?: string;
  texts?: unknown;
}

/**
 * [#34374 PR2] Build `ctx.text(key, params?)` for one invocation of an
 * action's sandboxed body. The organization is the action context's
 * `session.organizationId` (`buildActionSession`, both action doors); the
 * translation is read at the action's own address, never the object a caller
 * routed it under, so a bound action never reads `globalActions` and an
 * object-less one never reads an object's group.
 */
export function buildActionTextSurface(
  action: ActionTextDeclaration,
  actionCtx: { session?: { organizationId?: unknown } } | undefined,
  opts: HookTextOptions = {},
): HookTextSurface {
  const actionName = String(action.name);
  const object = actionOwnObject(action);
  const owner: TextOwner = {
    label: `action '${actionName}'`,
    messageKey: (key) => actionTextMessageKey(object, actionName, key),
    undeclaredAtRun: (key, declared) => undeclaredActionTextAtRun(actionName, key, declared),
  };
  return buildDeclaredTextSurface(owner, action, actionCtx, opts);
}
