// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveArtifactPackageOrder } from '@objectstack/core';

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
 * [ADR-0130 D4, #15232] Does this stack DECLARE translations — at the flattened
 * top level, or inside `packages[]`?
 *
 * ## What this exists to stop
 *
 * A multi-package artifact carries each definition twice today: flattened onto
 * the top level, and again inside `packages[i].manifest`. Option B (the
 * ADR-0130 D4 ruling on #14512) removes the flattened copy, so `packages[]`
 * carries it once. A reader that only ever looked at the top level does not
 * fail when that happens — `stack.translations` is simply `undefined`, the
 * detection answers "this app declared no copy", and the boot continues.
 *
 * For THIS reader the consequence is a dev server that serves the wrong
 * strings. `I18nServicePlugin` (`@objectstack/service-i18n`) is never
 * registered, so the `i18n` slot keeps the core in-memory fallback and the
 * developer sees message KEYS, or last release's copy, where the app declared
 * real translations. Nothing throws and nothing logs — the failure reads as
 * "the translations are wrong", which is why it needs a reader fix rather than
 * a footnote.
 *
 * ## Top level FIRST, `packages[]` only where it came back falsy
 *
 * The reader half of the program lands while the artifact is still ADDITIVE, so
 * this has to be a superset of the old read rather than a replacement for it:
 * every artifact the platform emits today still answers on the flattened level,
 * bit-identically, and the `packages[]` pass can only supply a declaration the
 * top level did not have — which is precisely the option-B shape. Keeping the
 * caller's original expression as the first answer is also what stops the
 * measured trap #15006 recorded: re-expressing a gate as a resolved-and-counted
 * traversal silently changes the verdict for a stack that declares the key
 * empty. Here the original expression is `Array.isArray(t) && t.length > 0` and
 * it is preserved verbatim, both at the top level and per package body.
 *
 * ## The order is `resolveArtifactPackageOrder`'s, not the array's
 *
 * `resolveArtifactPackageOrder` (`@objectstack/core`, ADR-0130 D4+D5, #14643)
 * is the ONE place that turns an artifact into its ordered package list, and it
 * is also the GATE that parses each entry. ⛔ Do not iterate `stack.packages`
 * directly: a second traversal is a second ordering, and this reader would then
 * disagree with the load path about which artifacts are even loadable.
 *
 * ⚠️ Stated so the next reader does not mistake the reason: the ORDER itself is
 * not observable through a boolean — any package declaring translations answers
 * the same question. What is observable is the GATE. A hand-rolled loop over
 * `stack.packages` would accept a duplicate package id, an unwrapped entry or a
 * body carrying authoring-time globs and answer "this app declares copy" for an
 * artifact the registration path refuses moments later. That is why the one
 * traversal is used even where its ordering does not show.
 *
 * The `packages` guard above it is not an optimisation. D4's second branch
 * makes `resolveArtifactPackageOrder` return the CALLER'S OWN OBJECT as the
 * single package body when the key is absent, so walking it unguarded would
 * read the top-level `translations` a second time — the same answer, reached
 * twice, for every single-package stack the platform has ever emitted.
 *
 * ## A malformed `packages[]` is refused, not skipped
 *
 * A non-array `packages`, an entry inlined instead of wrapped under `manifest:`
 * or a duplicate package id raises an ADR-0112 envelope (`code` +
 * `status: 422`) out of this call, and it is deliberately not caught. It is the
 * same refusal `ObjectQL.registerApp` raises for the same object later in the
 * same boot (the registration path IS reached from `AppPlugin.start`, measured
 * on both shapes in #14512 comment 5523603341), so catching it here would
 * resolve an i18n posture out of a package list nothing else will accept — the
 * gate travels with the read. ⚠️ It can only be reached at all when the top
 * level declares no translations, because the flattened answer returns first.
 *
 * ## `i18n` is NOT read from `packages[]`, and that is not an omission
 *
 * `i18n` is an artifact ENVELOPE key, not a package-owned collection — derived,
 * not asserted: the package-owned set is `ObjectStackDefinitionSchema` ∩
 * `AssembledPackageBodySchema`, and `i18n` is in the seven-key complement
 * (`ARTIFACT_ENVELOPE_KEYS`, pinned by #15004). An option-B artifact therefore
 * still carries `stack.i18n` and `stack.manifest` exactly where they are today,
 * so those two limbs of the detection lose nothing and are left untouched.
 * `translations` is the one limb the strip moves.
 */
export function stackDeclaresTranslations(stack: unknown): boolean {
  // The caller's ORIGINAL expression, first and unchanged.
  if (declaresTranslationArray(stack)) return true;

  const packages = asBag(stack)?.packages;
  if (packages === undefined || packages === null) return false;

  for (const body of resolveArtifactPackageOrder(stack)) {
    if (declaresTranslationArray(body)) return true;
  }
  return false;
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
 * written: a `translations` collection (now read through
 * {@link stackDeclaresTranslations}, so `packages[]` counts), an `i18n` config
 * on the stack or its manifest, or `manifest.translations` — the authoring
 * manifest's glob patterns, which are a declaration of intent even before a
 * bundle is assembled.
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
