// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The per-field refusals of a settings save, as the rows under the inputs show
 * them (objectstack#30206).
 *
 * The settings service refuses a value that misses its specifier's `pattern`
 * with `code: 'invalid_format'` and a sentence written in English for every
 * reader: `Default country does not match the expected format. …`. A Chinese
 * administrator who typed 「中国」 into 默认国家 read exactly that. The code is
 * the machine half of the refusal (ADR-0114 `FieldError`), so the console says
 * it in its own words, in the reader's language, naming the setting by the
 * label the page draws. The server's sentence ends with the specifier's
 * description as a hint; the console's ends with the same description as the
 * field draws it (`fieldHelp`), translated where a bundle carries it. Every
 * other code keeps the server's sentence: it names the allowed set or the rule
 * the server judged, which the console does not know better.
 *
 * `extractFieldErrors` reads each refusal's `field` and `message` and drops its
 * `code`, so the code is read here from the same `details.fields` array the
 * settings door declares.
 *
 * Shared by the Settings page and the first-run checklist on Home, which save
 * through the same door.
 *
 * @module
 */

import { extractFieldErrors } from '@object-ui/react';
import { resolveLabel, type Specifier } from './types';
import type { SettingsLabelHelpers } from './useSettingsLabel';

/** The machine code of a refusal for a value that misses its declared `pattern`. */
export const INVALID_FORMAT_CODE = 'invalid_format';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The `code` of each refused key, from the settings door's `details.fields`. */
function refusalCodes(apiError: unknown): Map<string, string> {
  const codes = new Map<string, string>();
  const details = (apiError as { details?: { fields?: unknown } } | null | undefined)?.details;
  const fields = details && typeof details === 'object' ? details.fields : undefined;
  if (!Array.isArray(fields)) return codes;
  for (const entry of fields) {
    if (!entry || typeof entry !== 'object') continue;
    const { field, code } = entry as { field?: unknown; code?: unknown };
    if (typeof field === 'string' && typeof code === 'string') codes.set(field, code);
  }
  return codes;
}

/** How the page names a field: its label, and the help line it draws under it. */
export interface FieldWording {
  label: string;
  help?: string;
}

/**
 * The console's sentence for a value that misses its format: for a picker
 * (a `select` that offers options) it says to pick from the list, which is how
 * the value is entered; for any other field it names the setting and, when the
 * field has a help line, repeats it, because the refusal takes the help line's
 * place under the input.
 */
export function invalidFormatMessage(spec: Specifier | undefined, field: FieldWording, t: Translate): string {
  const picker = spec?.type === 'select' && (spec.options?.length ?? 0) > 0;
  if (picker) return t('console.settingsView.invalidFormatPick', { setting: field.label });
  const help = field.help?.trim();
  return help
    ? t('console.settingsView.invalidFormatHelp', { setting: field.label, help })
    : t('console.settingsView.invalidFormat', { setting: field.label });
}

/**
 * The refused keys of a failed save with the message each row shows, in the
 * order the server sent them, or `null` when the refusal was not field-scoped.
 */
export function settingsFieldRefusals(
  apiError: unknown,
  specifiers: ReadonlyArray<Specifier>,
  wordingOf: (key: string, spec: Specifier | undefined) => FieldWording,
  t: Translate,
): Array<{ field: string; message: string }> | null {
  const perField = extractFieldErrors(apiError);
  if (!perField?.length) return null;
  const codes = refusalCodes(apiError);
  return perField.map(({ field, message }) => {
    if (codes.get(field) !== INVALID_FORMAT_CODE) return { field, message };
    const spec = specifiers.find((s) => s.key === field);
    return { field, message: invalidFormatMessage(spec, wordingOf(field, spec), t) };
  });
}

/**
 * A field's wording as `SettingsField` draws it: the label and help line
 * through the namespace's translation helpers, falling back to the manifest's
 * literals, and the key itself for a key no specifier declares.
 */
export function fieldWording(
  labels: Pick<SettingsLabelHelpers, 'fieldLabel' | 'fieldHelp'>,
): (key: string, spec: Specifier | undefined) => FieldWording {
  return (key, spec) => ({
    label: labels.fieldLabel(key, spec ? resolveLabel(spec.label) : key),
    help: spec ? labels.fieldHelp(key, spec.description) : undefined,
  });
}
