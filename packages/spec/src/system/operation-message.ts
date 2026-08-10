// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Operation Message Catalog
 *
 * The localized message templates for the data path's OPERATION-level
 * refusals — a write the engine declines as a whole, rather than a constraint
 * one field violated. Two members today: the referential-integrity refusal
 * (`409 DELETE_RESTRICTED`, `cascadeDeleteRelations`'s `restrict` branch, #7307)
 * and the object-permission refusal (`403 PERMISSION_DENIED`, plugin-security's
 * CRUD gate, #7414). The catalog is the seat for the rest of the family as they
 * are localized — a second mechanism for the second producer is exactly what
 * this module exists to prevent.
 *
 * ## Why this is a SEPARATE catalog from `validation-message.ts`
 *
 * The sibling catalog renders `FieldValidationError.message` and is addressed
 * as `validation.field.<messageKey>`, because every one of its entries names a
 * field and a constraint that field broke. A `DELETE_RESTRICTED` names neither:
 * the offending field is on a DIFFERENT object from the one the caller acted
 * on, the caller supplied no value, and there is no `fields[]` entry to hang it
 * off. Filing it under `validation.field.*` would give a deployment an override
 * key that lies about what it overrides, and would put an operation refusal in
 * the namespace form UIs scan for per-field copy. Same machinery, honest
 * address: `errors.<messageKey>` (see {@link operationMessageTranslationKey}).
 *
 * ## Why it exists at all (#7307)
 *
 * The restrict branch composed one English sentence with the API names
 * concatenated in, and REST ships `error.message` verbatim in the flat 409
 * envelope — which Console renders as-is in a toast. A business user deleting a
 * 「部门」 in a fully Chinese app read:
 *
 *   `Cannot delete sys_business_unit (): 1 dependent
 *    os_tianshun_ehr_sporadic_application record(s) reference it via apply_dept
 *    … or set deleteBehavior:'cascade' on …`
 *
 * — an English sentence naming two tables and a column they have never seen,
 * ending in a metadata-authoring instruction they cannot act on. This is the
 * same defect #3957 fixed one layer down for field constraints, reached from
 * the operation side, and it is fixed the same way: the catalog renders the
 * user's half in the caller's locale against resolved LABELS, while the
 * developer's half moves to `developerMessage`, which no user-facing surface
 * reads.
 *
 * These strings are platform text, not authored metadata: they exist for every
 * deployment whether or not anyone wrote a `translation`, so they ship as
 * constants (same shape as `BUILTIN_VALIDATION_MESSAGES`) rather than through
 * the extract-and-gate bundle pipeline, which tracks *declared metadata labels*
 * and would read added keys as drift.
 *
 * ## Interpolation
 *
 * `{{name}}` placeholders, matching `II18nService.t()`'s convention. An unknown
 * placeholder is left verbatim so a broken override is visible rather than
 * silently blank — {@link interpolateValidationMessage} is shared with the
 * sibling catalog so the two cannot drift on this.
 */

import { resolveBundleLocale } from './i18n-resolver';
import { interpolateValidationMessage } from './validation-message';
import type { ValidationMessageTranslator } from './validation-message';

/** Prefix under which a deployment can override a built-in operation message. */
export const OPERATION_MESSAGE_KEY_PREFIX = 'errors';

/**
 * The i18n key a `messageKey` resolves under, e.g. `errors.delete_restricted`.
 * A `translation` metadata item that defines this key overrides the built-in
 * catalog for its locale.
 */
export function operationMessageTranslationKey(messageKey: string): string {
  return `${OPERATION_MESSAGE_KEY_PREFIX}.${messageKey}`;
}

/**
 * Built-in templates, `locale → messageKey → template`.
 *
 * Locale keys match the platform bundles (`en`, `zh-CN`, `ja-JP`, `es-ES`);
 * `en` is the last-resort fallback and is therefore the one locale that MUST
 * define every key.
 *
 * The two `delete_restricted*` variants are one wire code with two sentences —
 * the `_required` form is emitted when the child's foreign key is `required`,
 * i.e. the case where reassigning is the only route because the reference
 * cannot simply be cleared. Splitting the SENTENCE, never the code, is the same
 * rule the field catalog states: `DELETE_RESTRICTED` stays one member of the
 * ADR-0112 vocabulary that clients match on.
 *
 * Placeholders: `{{object}}` and `{{dependentObject}}` are LABELS in the
 * caller's locale (the API names live on `developerMessage` and on the
 * structured `object` / `dependentObject` fields), `{{field}}` is the
 * referencing field's label, `{{count}}` the number of dependent records.
 *
 * `permission_denied` (#7414) takes NO placeholders, and that is a deliberate
 * divergence from its sibling rather than an omission. `delete_restricted`
 * names the objects because the user must know WHICH related records block
 * them — that is the action they can take. An object-permission refusal gives
 * the user nothing to act on by naming the object, and on a cascade delete the
 * object the gate refuses is a CHILD the operator never addressed and may not
 * know exists (`cascadeDeleteRelations` re-authorises every child
 * independently). Naming it would be accurate and still misleading, so the
 * sentence names nothing: no object, no operation, no `positions`. The machine
 * detail stays on the error's structured `details` and on `developerMessage`,
 * which is logged server-side (see `plugin-security`'s CRUD gate).
 */
export const BUILTIN_OPERATION_MESSAGES: Record<string, Record<string, string>> = {
  en: {
    permission_denied:
      'You do not have permission to perform this action. Contact your administrator if you need access.',
    delete_restricted:
      'This {{object}} is still referenced by {{count}} {{dependentObject}} record(s) through “{{field}}”. Delete or reassign them first.',
    delete_restricted_required:
      'This {{object}} is still referenced by {{count}} {{dependentObject}} record(s) through “{{field}}”, which is required and cannot be cleared. Delete or reassign them first.',
  },
  'zh-CN': {
    permission_denied: '您没有执行此操作的权限,如需访问请联系管理员。',
    delete_restricted:
      '该{{object}}正被 {{count}} 条{{dependentObject}}记录通过「{{field}}」引用,请先删除或改派这些记录。',
    delete_restricted_required:
      '该{{object}}正被 {{count}} 条{{dependentObject}}记录通过「{{field}}」引用,且该字段为必填、无法清空,请先删除或改派这些记录。',
  },
  'ja-JP': {
    permission_denied: 'この操作を実行する権限がありません。アクセスが必要な場合は管理者にお問い合わせください。',
    delete_restricted:
      'この{{object}}は {{count}} 件の{{dependentObject}}レコードから「{{field}}」で参照されています。先にそれらを削除するか、参照先を変更してください。',
    delete_restricted_required:
      'この{{object}}は {{count}} 件の{{dependentObject}}レコードから「{{field}}」で参照されています。この項目は必須のため空にできません。先にそれらを削除するか、参照先を変更してください。',
  },
  'es-ES': {
    permission_denied:
      'No tiene permiso para realizar esta acción. Póngase en contacto con su administrador si necesita acceso.',
    delete_restricted:
      '{{count}} registro(s) de {{dependentObject}} todavía hacen referencia a este {{object}} mediante «{{field}}». Elimínelos o reasígnelos primero.',
    delete_restricted_required:
      '{{count}} registro(s) de {{dependentObject}} todavía hacen referencia a este {{object}} mediante «{{field}}», un campo obligatorio que no puede vaciarse. Elimínelos o reasígnelos primero.',
  },
};

/** Locale whose catalog is guaranteed complete and used as the last resort. */
export const OPERATION_MESSAGE_FALLBACK_LOCALE = 'en';

export interface RenderOperationMessageInput {
  /** Catalog key, e.g. `delete_restricted`. */
  messageKey: string;
  /** Placeholder values — labels, counts. */
  params?: Record<string, unknown>;
}

export interface RenderOperationMessageOptions {
  /** BCP-47 locale; defaults to `en`. */
  locale?: string;
  /** Deployment override hook — an `II18nService.t`-compatible lookup. */
  translate?: ValidationMessageTranslator;
}

/**
 * Render one built-in operation message in the caller's locale.
 *
 * Resolution order (identical to {@link renderValidationMessage}, deliberately
 * — two resolution orders for two catalogs is how a deployment's overrides
 * start behaving differently depending on which layer refused):
 *   1. `translate('errors.<messageKey>', locale)` — a deployment's
 *      `translation` override. A miss is detected by the II18nService contract
 *      of echoing the key back.
 *   2. the built-in catalog for the locale (BCP-47 matched).
 *   3. the built-in catalog for `en`.
 *   4. the messageKey itself — only reachable for a key absent from even the
 *      English catalog, i.e. a coding error; still returns something a human
 *      can act on rather than an empty string.
 */
export function renderOperationMessage(
  input: RenderOperationMessageInput,
  opts: RenderOperationMessageOptions = {},
): string {
  const locale = opts.locale ?? OPERATION_MESSAGE_FALLBACK_LOCALE;
  const params = input.params ?? {};

  if (opts.translate) {
    const key = operationMessageTranslationKey(input.messageKey);
    let override: string | undefined;
    try {
      override = opts.translate(key, locale, params);
    } catch {
      // A misbehaving i18n service must never turn a 409 into a 500.
      override = undefined;
    }
    if (typeof override === 'string' && override.length > 0 && override !== key) {
      return interpolateValidationMessage(override, params);
    }
  }

  const matched = resolveBundleLocale(BUILTIN_OPERATION_MESSAGES, locale);
  const template = (matched !== undefined
    ? BUILTIN_OPERATION_MESSAGES[matched][input.messageKey]
    : undefined)
    ?? BUILTIN_OPERATION_MESSAGES[OPERATION_MESSAGE_FALLBACK_LOCALE][input.messageKey];

  if (template === undefined) return input.messageKey;
  return interpolateValidationMessage(template, params);
}
