// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 1] The validation-message localisation helpers of `ObjectQL` —
 * `validationMessageContext` (the locale and translate hooks a rejected write
 * is reported through, #3957), `negotiatedMessageLocale` (the locale the
 * bridged i18n service can actually answer in, #15757) and
 * `objectDisplayLabel` (an object's display name in the caller's locale,
 * #7307) — moved out of `engine.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same negotiation through `resolveBundleLocale`, the same
 * translation-bundle → declared label → API name ladder, the same two
 * `catch` blocks that keep a misbehaving i18n service from turning a write
 * into a 500.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method. The class keeps
 * every method — the published `.d.ts` lists each one's name, docblock and
 * position — and each body is one literal of exactly the
 * {@link ValidationMessageHost} members that method reads, plus a `.call`;
 * `objectDisplayLabel` reads no member, takes no host and is called directly.
 * A method is handed over as a closure that calls it on the engine at call
 * time, so a test double or spy set on the instance is still the one the body
 * reaches: `validationMessageContext` reaches `negotiatedMessageLocale`
 * through the engine, exactly as before.
 *
 * The one field the bodies read, `i18nService`, goes as a GETTER, so each read
 * happens when the body makes it — including the read inside the `translate`
 * closure, which runs after `validationMessageContext` has returned and sees
 * whatever service `setI18nService` has installed by then, as it did.
 * `setI18nService` itself stays in the class: it is the field's setter.
 * `registry` (ADR-0029 D9.2a, the packaged rule lookup) goes as a getter too.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 */

import type { ObjectQL } from './engine.js';
import type { ValidationMessageContext } from './validation/record-validator.js';
import { objectLabelKey, resolveBundleLocale } from '@objectstack/spec/system';

/**
 * The `ObjectQL` members the functions below read — every one of them, and no
 * other; each function's `this` is the `Pick` of the members IT reads. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member
 * the class does not have is a compile error. See the module header for which
 * member is a getter.
 */
export interface ValidationMessageHost {
  readonly i18nService: ObjectQL['i18nService'];
  readonly registry: ObjectQL['registry'];
  negotiatedMessageLocale: ObjectQL['negotiatedMessageLocale'];
}

/**
 * The body of `ObjectQL#validationMessageContext`; the method's docblock there is its contract.
 *
 * [ADR-0029 D9.2a] It also carries `packagedRule` (`ValidationMessageContext`),
 * the lookup the rule evaluator judges a tenant's rewrite of a rule message by,
 * when the object has a packaged owner — see {@link packagedRuleLookup}.
 */
export function validationMessageContext(
  this: Pick<ValidationMessageHost, 'i18nService' | 'registry' | 'negotiatedMessageLocale'>,
  objectName: string,
  // Only `locale` is read — narrower than `ExecutionContext` so both the
  // resolved and the input-shaped envelope satisfy it.
  context?: { locale?: string },
): ValidationMessageContext & { objectName: string } {
  const t = this.i18nService?.t;
  const packagedRule = packagedRuleLookup(this.registry, objectName);
  return {
    objectName,
    locale: this.negotiatedMessageLocale(context?.locale),
    translate: t ? (key, locale, params) => t.call(this.i18nService, key, locale, params) : undefined,
    ...(packagedRule !== undefined ? { packagedRule } : {}),
  };
}

/**
 * How deep {@link packagedRuleLookup} follows `conditional` branches — the
 * bound `/meta`'s `translateObjectValidations` walks to, so both readers judge
 * the same branches.
 */
const MAX_VALIDATION_DEPTH = 10;

/**
 * [ADR-0029 D9.2a] The packaged (code-shipped) rule of a name on `objectName`,
 * for the rule evaluator's divergence test.
 *
 * The rules are the registry's packaged rule set (`getPackagedObjectBase`: the
 * packaged owner's declaration with its code extenders' rules appended, #27559),
 * the same body `/meta` hands `translateObject` as `packagedBase` through the
 * protocol's `getPackagedObjectBase`, so both readers compare a served message
 * against one packaged rule. Rules are keyed by `name`, each `conditional`
 * branch under its own name; the first rule of a name wins, as on `/meta`.
 *
 * `undefined` — nothing inferred, the catalog applies — when no packaged owner
 * is registered for the object, or the registry cannot answer (a partial
 * double; one that predates `getPackagedObjectBase` is read through
 * `getPackagedObjectOwner`, the owner alone). The index is built on the first
 * lookup, which a write that refuses nothing never makes.
 */
function packagedRuleLookup(
  registry: ValidationMessageHost['registry'] | undefined,
  objectName: string,
): ((ruleName: string) => unknown) | undefined {
  let definition: unknown;
  try {
    if (typeof registry?.getPackagedObjectBase === 'function') {
      definition = registry.getPackagedObjectBase(objectName);
    } else if (typeof registry?.getPackagedObjectOwner === 'function') {
      definition = registry.getPackagedObjectOwner(objectName)?.definition;
    } else {
      return undefined;
    }
  } catch {
    // A read over in-memory contributors must not turn a 400 into a 500.
    return undefined;
  }
  if (!definition || typeof definition !== 'object') return undefined;
  const validations = (definition as { validations?: unknown }).validations;
  let byName: Map<string, unknown> | undefined;
  return (ruleName) => {
    if (byName === undefined) {
      const index = new Map<string, unknown>();
      const visit = (raw: unknown, depth: number): void => {
        if (!raw || typeof raw !== 'object' || depth >= MAX_VALIDATION_DEPTH) return;
        const rule = raw as { type?: unknown; name?: unknown; then?: unknown; otherwise?: unknown };
        if (rule.type === 'conditional') {
          visit(rule.then, depth + 1);
          visit(rule.otherwise, depth + 1);
          return;
        }
        if (typeof rule.name === 'string' && rule.name.length > 0 && !index.has(rule.name)) index.set(rule.name, rule);
      };
      if (Array.isArray(validations)) for (const raw of validations) visit(raw, 0);
      byName = index;
    }
    return byName.get(ruleName);
  };
}

/** The body of `ObjectQL#negotiatedMessageLocale`; the method's docblock there is its contract. */
export function negotiatedMessageLocale(
  this: Pick<ValidationMessageHost, 'i18nService'>,
  requested: string | undefined): string | undefined {
  if (!requested) return requested;
  const getLocales = this.i18nService?.getLocales;
  if (typeof getLocales !== 'function') return requested;
  let available: unknown;
  try {
    available = getLocales.call(this.i18nService);
  } catch {
    // A misbehaving i18n service must not turn a write into a 500.
    return requested;
  }
  if (!Array.isArray(available) || available.length === 0) return requested;
  // `resolveBundleLocale` matches against a bundle's KEYS; the offered
  // locales are exactly that key set, with no data behind them.
  const offered: Record<string, true> = {};
  for (const code of available) {
    if (typeof code === 'string' && code.length > 0) offered[code] = true;
  }
  return resolveBundleLocale(offered, requested) ?? requested;
}

/** The body of `ObjectQL#objectDisplayLabel`; the method's docblock there is its contract. */
export function objectDisplayLabel(
  objectName: string,
  declaredLabel: unknown,
  ctx: { locale?: string; translate?: (key: string, locale: string, params?: Record<string, unknown>) => string },
): string {
  if (ctx.translate && ctx.locale) {
    const key = objectLabelKey(objectName);
    try {
      const translated = ctx.translate(key, ctx.locale);
      // II18nService echoes the key back on a miss.
      if (typeof translated === 'string' && translated.length > 0 && translated !== key) {
        return translated;
      }
    } catch {
      // A misbehaving i18n service must not turn a 409 into a 500.
    }
  }
  const declared = typeof declaredLabel === 'string' ? declaredLabel.trim() : '';
  return declared.length > 0 ? declared : objectName;
}
