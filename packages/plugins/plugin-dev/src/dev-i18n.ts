// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The options `DevPlugin` hands `I18nServicePlugin` when it auto-registers it.
 *
 * `defaultLocale` stays optional because the detected stack may declare
 * translations without declaring an i18n config at all — that is the common
 * case, and `I18nServicePlugin`'s own default is what should apply then.
 */
export interface DevI18nPluginOptions {
  defaultLocale?: string;
  fallbackLocale: string;
}

const asBag = (value: unknown): Record<string, unknown> | undefined =>
  (value && typeof value === 'object' ? value as Record<string, unknown> : undefined);

const declaresTranslationArray = (body: unknown): boolean => {
  const declared = asBag(body)?.translations;
  return Array.isArray(declared) && declared.length > 0;
};

/**
 * Does this stack DECLARE translations?
 *
 * ⚠️ TOP LEVEL ONLY, which is the defect #15232 exists to fix — recorded here
 * so this intermediate commit is not mistaken for the fix. A multi-package
 * artifact under ADR-0130 D4's option-B shape carries `translations` inside
 * `packages[]` and nothing at the top level, so this answers `false` and the
 * dev server keeps the in-memory i18n fallback with nothing thrown and nothing
 * logged. The probe row landing in the same commit ledgers exactly that loss.
 */
export function stackDeclaresTranslations(stack: unknown): boolean {
  return declaresTranslationArray(stack);
}

/**
 * [#15232] The `I18nServicePlugin` options a stack implies — the ONE decision
 * `DevPlugin`'s i18n auto-detect makes, resolved in one place.
 *
 * `undefined` means "this stack declares no i18n content", i.e. do not register
 * the file-based service and leave the slot to the core in-memory fallback.
 * Returning the options rather than a boolean is what keeps the decision and
 * the values it derives from the same read — a caller cannot pair a `true` with
 * a locale resolved from somewhere else.
 *
 * Three declarations trigger it, exactly as they have since the auto-detect was
 * written: a `translations` collection (read through
 * {@link stackDeclaresTranslations}), an `i18n` config on the stack or its
 * manifest, or `manifest.translations` — the authoring manifest's glob
 * patterns, which are a declaration of intent even before a bundle is
 * assembled.
 *
 * Exported because the #15004 option-B acceptance probe measures this decision
 * by CALLING it. A probe that re-implemented the read would be a second copy of
 * the code the reader program changes, and would stay red after the reader
 * beside it was fixed.
 */
export function devI18nPluginOptions(stack: unknown): DevI18nPluginOptions | undefined {
  const bag = asBag(stack);
  if (!bag) return undefined;

  const manifest = asBag(bag.manifest);
  const hasTranslations = stackDeclaresTranslations(stack);
  const hasI18nConfig = !!(bag.i18n || manifest?.i18n);
  const hasManifestTranslations = !!(
    manifest && Array.isArray(manifest.translations) && manifest.translations.length > 0
  );

  if (!hasTranslations && !hasI18nConfig && !hasManifestTranslations) return undefined;

  // `stack.i18n || stack.manifest.i18n || {}`, the original expression: the
  // stack's own config wins, the manifest's is the fallback, and neither being
  // present means the service plugin's own defaults apply.
  const i18nConfig = (bag.i18n || manifest?.i18n || {}) as {
    defaultLocale?: string;
    fallbackLocale?: string;
  };
  return {
    defaultLocale: i18nConfig.defaultLocale,
    fallbackLocale: i18nConfig.fallbackLocale || i18nConfig.defaultLocale || 'en',
  };
}
