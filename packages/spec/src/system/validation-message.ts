// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Validation Message Catalog
 *
 * The localized message templates for the write path's BUILT-IN field
 * constraints (`Field.required`, `min`/`max`, `maxLength`, format, options,
 * value shape). Rendered by the record validator into
 * `FieldValidationError.message`, which REST ships verbatim in a
 * `400 VALIDATION_FAILED` envelope and every generic surface — Console toast,
 * CSV-import row report, CLI, custom client — displays as-is.
 *
 * ## Why the catalog lives here
 *
 * Before #3957 each message was a hardcoded English template with the API field
 * name concatenated in, so a Chinese-locale user importing a bad row read
 * `penalty_amount must be ≥ 0` — an English sentence naming a column they have
 * never seen, for a field declared `label: '处罚金额'` with a full `zh-CN`
 * bundle. The form layer localized the SAME constraint correctly (the browser's
 * native `min`), so the language flipped depending on which layer caught it.
 *
 * These strings are platform text, not authored metadata: they exist for every
 * deployment whether or not anyone wrote a `translation`, so they ship as
 * constants (same shape as `SYSTEM_FIELD_LABELS` in `i18n-resolver.ts`) rather
 * than through the extract-and-gate bundle pipeline, which tracks *declared
 * metadata labels* and would read added keys as drift.
 *
 * A deployment can still override any of them: {@link renderValidationMessage}
 * consults the i18n service first under
 * `validation.field.<messageKey>` (see
 * {@link validationMessageTranslationKey}), so a `translation` metadata item
 * that defines that key wins over the built-in.
 *
 * ## Message keys are finer-grained than wire codes
 *
 * `FieldErrorCode` (ADR-0114) is the stable machine vocabulary and must not
 * split (clients match on it). But one code can need several sentences — an
 * `invalid_option` on a single select reads "must be one of …" while the same
 * code on a multiselect must name the offending element. So the catalog is
 * keyed by MESSAGE key, of which a code is the default; extra variants
 * (`invalid_option_value`, `invalid_datetime`, `invalid_type_array`, …) are
 * rendering detail and never appear on the wire.
 *
 * The `import_*` keys are the CSV/XLSX importer's cell-coercion failures
 * (`rest/import-coerce.ts`) — "this cell is not a number" rather than "this
 * value violates a constraint". They live here because they land in the same
 * row report a user reads: leaving them behind would have localized half of it.
 * Their wording deliberately omits the referenced object's API name (the old
 * `no sys_user matches "…"`), since naming internal identifiers is the defect
 * this issue is about; the column and the offending value are what the importer
 * can act on.
 *
 * ## Interpolation
 *
 * `{{name}}` placeholders, matching `II18nService.t()`'s convention, filled from
 * the error's `constraint` values (`min`, `maxLength`, `actual`, `allowed`, …)
 * plus `{{value}}` (the offending value), `{{label}}` (the field's display name
 * in the caller's locale) and `{{field}}` (its API name). An unknown placeholder
 * is left verbatim so a broken override is visible rather than silently blank.
 */

import { resolveBundleLocale } from './i18n-resolver';

/** Prefix under which a deployment can override a built-in message. */
export const VALIDATION_MESSAGE_KEY_PREFIX = 'validation.field';

/**
 * The i18n key a `messageKey` resolves under, e.g.
 * `validation.field.min_value`. A `translation` metadata item that defines this
 * key overrides the built-in catalog for its locale.
 */
export function validationMessageTranslationKey(messageKey: string): string {
  return `${VALIDATION_MESSAGE_KEY_PREFIX}.${messageKey}`;
}

/**
 * Built-in templates, `locale → messageKey → template`.
 *
 * Locale keys match the platform bundles (`en`, `zh-CN`, `ja-JP`, `es-ES`);
 * `en` is the last-resort fallback and is therefore the one locale that MUST
 * define every key. The English wording is byte-identical to the pre-#3957
 * hardcoded strings, so an English deployment's messages do not change.
 */
export const BUILTIN_VALIDATION_MESSAGES: Record<string, Record<string, string>> = {
  en: {
    required: '{{label}} is required',
    required_cleared: '{{label}} is required and cannot be cleared',
    min_length: '{{label}} must be ≥ {{minLength}} characters (got {{actual}})',
    max_length: '{{label}} must be ≤ {{maxLength}} characters (got {{actual}})',
    min_value: '{{label}} must be ≥ {{min}}',
    max_value: '{{label}} must be ≤ {{max}}',
    max_scale: '{{label}} must have at most {{scale}} decimal places (got {{actual}})',
    invalid_email: '{{label}} must be a valid email address',
    invalid_url: '{{label}} must be a valid URL (scheme://...)',
    invalid_phone: '{{label}} must be a valid phone number',
    invalid_number: '{{label}} must be a number',
    invalid_boolean: '{{label}} must be true or false',
    invalid_date: '{{label}} must be a valid date (ISO-8601)',
    invalid_datetime: '{{label}} must be a valid datetime (ISO-8601)',
    invalid_time: '{{label}} must be a valid time (HH:MM or HH:MM:SS)',
    invalid_option: '{{label}} must be one of: {{allowed}}',
    reference_not_found: '{{label}}: no {{target}} record has id "{{value}}"',
    invalid_option_value: '{{label}}: "{{value}}" is not one of: {{allowed}}',
    option_unavailable: "{{label}}: option '{{value}}' is not available",
    invalid_type_array: '{{label}} must be an array of values',
    invalid_value_shape: '{{label}} has an invalid {{type}} value: {{detail}}',
    invalid_initial_state: 'Invalid initial state for {{label}}: {{value}} (allowed: {{allowed}})',
    invalid_transition: 'Invalid transition for {{label}}: {{from}} → {{to}}',
    import_invalid_boolean: '{{label}}: "{{value}}" is not a boolean',
    import_invalid_number: '{{label}}: "{{value}}" is not a number',
    import_invalid_date: '{{label}}: "{{value}}" is not a valid date',
    import_invalid_datetime: '{{label}}: "{{value}}" is not a valid datetime',
    import_invalid_time: '{{label}}: "{{value}}" is not a valid time',
    import_unknown_option: '{{label}}: "{{value}}" is not a known option',
    import_reference_ambiguous: '{{label}}: "{{value}}" matches more than one record — use a unique value or the record id',
    import_reference_not_found: '{{label}}: no record matches "{{value}}"',
  },
  'zh-CN': {
    required: '{{label}}不能为空',
    required_cleared: '{{label}}是必填项,不能清空',
    min_length: '{{label}}长度不能少于 {{minLength}} 个字符(当前 {{actual}} 个)',
    max_length: '{{label}}长度不能超过 {{maxLength}} 个字符(当前 {{actual}} 个)',
    // Wording mirrors the browser's native range message ("值必须大于或等于 0。")
    // so the same constraint reads the same whether the form or the server
    // catches it — the inconsistency #3957 reported.
    min_value: '{{label}}必须大于或等于 {{min}}',
    max_value: '{{label}}必须小于或等于 {{max}}',
    max_scale: '{{label}}的小数位数不能超过 {{scale}} 位(当前 {{actual}} 位)',
    invalid_email: '{{label}}必须是有效的电子邮件地址',
    invalid_url: '{{label}}必须是有效的 URL(scheme://...)',
    invalid_phone: '{{label}}必须是有效的电话号码',
    invalid_number: '{{label}}必须是数字',
    invalid_boolean: '{{label}}必须是 true 或 false',
    invalid_date: '{{label}}必须是有效的日期(ISO-8601)',
    invalid_datetime: '{{label}}必须是有效的日期时间(ISO-8601)',
    invalid_time: '{{label}}必须是有效的时间(HH:MM 或 HH:MM:SS)',
    invalid_option: '{{label}}必须是以下值之一:{{allowed}}',
    reference_not_found: '{{label}}:不存在 id 为“{{value}}”的{{target}}记录',
    invalid_option_value: '{{label}}:“{{value}}”不在允许的取值范围内:{{allowed}}',
    option_unavailable: '{{label}}:选项“{{value}}”当前不可用',
    invalid_type_array: '{{label}}必须是数组',
    invalid_value_shape: '{{label}}的 {{type}} 值格式无效:{{detail}}',
    invalid_initial_state: '{{label}}的初始状态无效:{{value}}(允许:{{allowed}})',
    invalid_transition: '{{label}}不允许从 {{from}} 变更为 {{to}}',
    import_invalid_boolean: '{{label}}:“{{value}}”不是有效的布尔值',
    import_invalid_number: '{{label}}:“{{value}}”不是有效的数字',
    import_invalid_date: '{{label}}:“{{value}}”不是有效的日期',
    import_invalid_datetime: '{{label}}:“{{value}}”不是有效的日期时间',
    import_invalid_time: '{{label}}:“{{value}}”不是有效的时间',
    import_unknown_option: '{{label}}:“{{value}}”不是可选值之一',
    import_reference_ambiguous: '{{label}}:“{{value}}”匹配到多条记录,请改用唯一值或记录 ID',
    import_reference_not_found: '{{label}}:未找到与“{{value}}”匹配的记录',
  },
  'ja-JP': {
    required: '{{label}}は必須です',
    required_cleared: '{{label}}は必須項目のため、空にできません',
    min_length: '{{label}}は {{minLength}} 文字以上で入力してください(現在 {{actual}} 文字)',
    max_length: '{{label}}は {{maxLength}} 文字以内で入力してください(現在 {{actual}} 文字)',
    min_value: '{{label}}は {{min}} 以上で入力してください',
    max_value: '{{label}}は {{max}} 以下で入力してください',
    max_scale: '{{label}}の小数点以下は {{scale}} 桁以内で入力してください(現在 {{actual}} 桁)',
    invalid_email: '{{label}}は有効なメールアドレスを入力してください',
    invalid_url: '{{label}}は有効な URL(scheme://...)を入力してください',
    invalid_phone: '{{label}}は有効な電話番号を入力してください',
    invalid_number: '{{label}}は数値で入力してください',
    invalid_boolean: '{{label}}は true または false で入力してください',
    invalid_date: '{{label}}は有効な日付(ISO-8601)を入力してください',
    invalid_datetime: '{{label}}は有効な日時(ISO-8601)を入力してください',
    invalid_time: '{{label}}は有効な時刻(HH:MM または HH:MM:SS)を入力してください',
    invalid_option: '{{label}}は次のいずれかを指定してください:{{allowed}}',
    reference_not_found: '{{label}}:id が「{{value}}」の{{target}}レコードは存在しません',
    invalid_option_value: '{{label}}:「{{value}}」は指定できません(指定可能:{{allowed}})',
    option_unavailable: '{{label}}:選択肢「{{value}}」は現在利用できません',
    invalid_type_array: '{{label}}は配列で指定してください',
    invalid_value_shape: '{{label}}の {{type}} 値が不正です:{{detail}}',
    invalid_initial_state: '{{label}}の初期ステータスが不正です:{{value}}(許可:{{allowed}})',
    invalid_transition: '{{label}}は {{from}} から {{to}} へ変更できません',
    import_invalid_boolean: '{{label}}:「{{value}}」は真偽値として解釈できません',
    import_invalid_number: '{{label}}:「{{value}}」は数値として解釈できません',
    import_invalid_date: '{{label}}:「{{value}}」は日付として解釈できません',
    import_invalid_datetime: '{{label}}:「{{value}}」は日時として解釈できません',
    import_invalid_time: '{{label}}:「{{value}}」は時刻として解釈できません',
    import_unknown_option: '{{label}}:「{{value}}」は選択肢にありません',
    import_reference_ambiguous: '{{label}}:「{{value}}」に複数のレコードが一致します。一意の値かレコード ID を指定してください',
    import_reference_not_found: '{{label}}:「{{value}}」に一致するレコードが見つかりません',
  },
  'es-ES': {
    required: '{{label}} es obligatorio',
    required_cleared: '{{label}} es obligatorio y no puede vaciarse',
    min_length: '{{label}} debe tener al menos {{minLength}} caracteres (actual: {{actual}})',
    max_length: '{{label}} no debe superar {{maxLength}} caracteres (actual: {{actual}})',
    min_value: '{{label}} debe ser mayor o igual que {{min}}',
    max_value: '{{label}} debe ser menor o igual que {{max}}',
    max_scale: '{{label}} no debe superar {{scale}} decimales (actual: {{actual}})',
    invalid_email: '{{label}} debe ser una dirección de correo electrónico válida',
    invalid_url: '{{label}} debe ser una URL válida (scheme://...)',
    invalid_phone: '{{label}} debe ser un número de teléfono válido',
    invalid_number: '{{label}} debe ser un número',
    invalid_boolean: '{{label}} debe ser true o false',
    invalid_date: '{{label}} debe ser una fecha válida (ISO-8601)',
    invalid_datetime: '{{label}} debe ser una fecha y hora válidas (ISO-8601)',
    invalid_time: '{{label}} debe ser una hora válida (HH:MM o HH:MM:SS)',
    invalid_option: '{{label}} debe ser uno de: {{allowed}}',
    reference_not_found: '{{label}}: ningún registro de {{target}} tiene el id «{{value}}»',
    invalid_option_value: '{{label}}: «{{value}}» no es uno de: {{allowed}}',
    option_unavailable: '{{label}}: la opción «{{value}}» no está disponible',
    invalid_type_array: '{{label}} debe ser una lista de valores',
    invalid_value_shape: '{{label}} tiene un valor {{type}} no válido: {{detail}}',
    invalid_initial_state: 'Estado inicial no válido para {{label}}: {{value}} (permitidos: {{allowed}})',
    invalid_transition: 'Transición no válida para {{label}}: {{from}} → {{to}}',
    import_invalid_boolean: '{{label}}: «{{value}}» no es un booleano',
    import_invalid_number: '{{label}}: «{{value}}» no es un número',
    import_invalid_date: '{{label}}: «{{value}}» no es una fecha válida',
    import_invalid_datetime: '{{label}}: «{{value}}» no es una fecha y hora válidas',
    import_invalid_time: '{{label}}: «{{value}}» no es una hora válida',
    import_unknown_option: '{{label}}: «{{value}}» no es una opción conocida',
    import_reference_ambiguous: '{{label}}: «{{value}}» coincide con más de un registro; use un valor único o el id del registro',
    import_reference_not_found: '{{label}}: ningún registro coincide con «{{value}}»',
  },
};

/** Locale whose catalog is guaranteed complete and used as the last resort. */
export const VALIDATION_MESSAGE_FALLBACK_LOCALE = 'en';

/**
 * Fill `{{name}}` placeholders from `params`. An unresolved placeholder is left
 * verbatim (`{{min}}`) rather than blanked, so a malformed override or a missing
 * param is visible in the message instead of producing "must be ≥ .".
 */
export function interpolateValidationMessage(
  template: string,
  params: Record<string, unknown> | undefined,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? whole : String(value);
  });
}

/** Translation lookup, shaped after `II18nService.t` (key returned on a miss). */
export type ValidationMessageTranslator = (
  key: string,
  locale: string,
  params?: Record<string, unknown>,
) => string;

export interface RenderValidationMessageInput {
  /** Catalog key — a `FieldValidationCode` or one of the finer variants. */
  messageKey: string;
  /** Field display label in the caller's locale; falls back to the API name. */
  label: string;
  /** API field name, exposed to templates as `{{field}}`. */
  field?: string;
  /** Discrete constraint values (`FieldValidationParams`). */
  params?: Record<string, unknown>;
}

export interface RenderValidationMessageOptions {
  /** BCP-47 locale; defaults to `en`. */
  locale?: string;
  /** Deployment override hook — an `II18nService.t`-compatible lookup. */
  translate?: ValidationMessageTranslator;
}

/**
 * Render one built-in validation message in the caller's locale.
 *
 * Resolution order:
 *   1. `translate('validation.field.<messageKey>', locale)` — a deployment's
 *      `translation` override. A miss is detected by the II18nService contract
 *      of echoing the key back.
 *   2. the built-in catalog for the locale (BCP-47 matched: exact →
 *      case-insensitive → base language → variant).
 *   3. the built-in catalog for `en`.
 *   4. `<label> (<messageKey>)` — only reachable for a messageKey absent from
 *      even the English catalog, i.e. a coding error; still returns something a
 *      human can act on rather than an empty string.
 */
export function renderValidationMessage(
  input: RenderValidationMessageInput,
  opts: RenderValidationMessageOptions = {},
): string {
  const locale = opts.locale ?? VALIDATION_MESSAGE_FALLBACK_LOCALE;
  const params: Record<string, unknown> = {
    ...(input.params ?? {}),
    label: input.label,
    ...(input.field !== undefined ? { field: input.field } : {}),
  };

  if (opts.translate) {
    const key = validationMessageTranslationKey(input.messageKey);
    let override: string | undefined;
    try {
      override = opts.translate(key, locale, params);
    } catch {
      // A misbehaving i18n service must never turn a 400 into a 500.
      override = undefined;
    }
    // The contract is "returns the key itself if not found" — anything else is
    // a real translation. Interpolate defensively: an implementation that does
    // not substitute (or ignores `params`) still yields a filled message.
    if (typeof override === 'string' && override.length > 0 && override !== key) {
      return interpolateValidationMessage(override, params);
    }
  }

  const matched = resolveBundleLocale(BUILTIN_VALIDATION_MESSAGES, locale);
  const template = (matched !== undefined
    ? BUILTIN_VALIDATION_MESSAGES[matched][input.messageKey]
    : undefined)
    ?? BUILTIN_VALIDATION_MESSAGES[VALIDATION_MESSAGE_FALLBACK_LOCALE][input.messageKey];

  if (template === undefined) return `${input.label} (${input.messageKey})`;
  return interpolateValidationMessage(template, params);
}
