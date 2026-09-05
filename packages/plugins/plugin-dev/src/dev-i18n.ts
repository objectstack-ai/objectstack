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
 * the ANSWER for every artifact the platform emits today is bit-identical,
 * because `composeStacks` merges `translations` with `'concat'`
 * (`stack.zod.ts`), so a package that declares copy always leaves a non-empty
 * flattened array too. The `packages[]` pass can only supply a declaration the
 * top level did not have — which is precisely the option-B shape. Keeping the
 * caller's original expression as the first answer is also what stops the
 * measured trap #15006 recorded: re-expressing a gate as a resolved-and-counted
 * traversal silently changes the verdict for a stack that declares the key
 * empty. Here the original expression is `Array.isArray(t) && t.length > 0` and
 * it is preserved verbatim, both at the top level and per package body.
 *
 * ⚠️ **The same answer is NOT the same work, and an earlier draft of this file
 * said it was.** The flattened read returns early only when `translations` is
 * present and NON-EMPTY. So every stack that carries `packages[]` and declares
 * no i18n at all — no `i18n` config, no `manifest.translations`, no non-empty
 * top-level `translations`, i.e. the ordinary multi-package app that simply
 * does not translate — DOES reach `resolveArtifactPackageOrder`, on every
 * `DevPlugin.init`, and pays a full ADR-0130 D4 parse of every package body.
 * Measured with a counting proxy on a real `composeStacks(…, 'preserve')`
 * output, not reasoned about; the case is pinned below. Two things follow, and
 * both are load-bearing: {@link devI18nPluginOptions} asks the cheap limbs
 * FIRST so a stack that already declares its locales never pays this, and the
 * refusals documented under `@throws` are reachable in ORDINARY use rather than
 * only for exotic input — which is why `DevPlugin` degrades on them instead of
 * dying.
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
 * on both shapes in #14512 comment 5523603341), so answering out of a package
 * list nothing else will accept is not something this function does — the gate
 * travels with the read.
 *
 * ⚠️ What that means for a CALLER is a separate question, and `DevPlugin`
 * answers it the other way: it catches, says so loudly and boots anyway. The
 * reason is not comfort — it is consistency with what already ships. Twenty
 * lines above the i18n block, `new AppPlugin(this.options.stack)` parses the
 * same object and its refusal is degraded to one log line, so a detector for
 * "should I register a translation service" must not refuse harder than the
 * gate for "should I register this app's metadata at all". The measured
 * regression that made this concrete: a project whose package manifest still
 * carries authoring-time glob `objects` is refused by `ArtifactPackageSchema`
 * BY DESIGN, boots today, and would have stopped booting on this reader alone.
 * ⛔ Whether `DevPlugin` should refuse malformed metadata outright is a
 * maintainer question filed separately; it is not decided here, and this
 * function's own semantics are unchanged by it.
 *
 * ## The guard divergence with `@objectstack/core`, recorded rather than fixed
 *
 * This reader treats only an ABSENT `packages` key (`undefined` / `null`) as
 * "single package"; anything else goes to the gate, so `packages: {}` is
 * REFUSED. `resolveArtifactPackageOrder`'s own second branch is spelled
 * `declared === undefined || declared === null` too, but the sibling reader in
 * `@objectstack/metadata` guards with `Array.isArray`, which silently accepts a
 * non-array. Two readers in one program answering the same input differently is
 * a program-level split, not this file's to settle (#15226 spells it as this
 * file does). Recorded here so the next author does not "fix" one side into
 * agreement without ruling the other.
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
 *
 * @param stack - Any value. A non-object (`null`, a primitive, a function) and
 *   an object with no `translations` and no `packages` both answer `false`
 *   without reaching the gate.
 * @returns Whether any level of this stack declares a non-empty `translations`
 *   array.
 * @throws An ADR-0112 envelope (`Error & { code, status: 422 }`) from
 *   `resolveArtifactPackageOrder` when `packages` is present but not loadable:
 *   `INVALID_ARTIFACT_PACKAGES` (not an array), `INVALID_ARTIFACT_PACKAGE_ENTRY`
 *   (an entry that is not `{ manifest: … }`, a body carrying authoring-time
 *   globs where definitions belong, or a manifest with no usable id) or
 *   `DUPLICATE_ARTIFACT_PACKAGE`.
 * @throws A **bare** `Error` — no `code`, no `status` — from `resolvePluginOrder`
 *   when two packages in `packages[]` depend on each other
 *   (`[Kernel] Circular dependency detected: …`). Documented because it is the
 *   one failure here that does NOT carry the envelope every other refusal in
 *   this repo does, so a caller matching on `code` alone will miss it. Measured,
 *   not inferred from the sorter's prose.
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
 * ## The three limbs are asked CHEAPEST FIRST, and that ordering is a fix
 *
 * `||` is commutative, so the ANSWER does not depend on the order — but which
 * inputs can make this call throw does. The `translations` limb is the only one
 * that can reach `resolveArtifactPackageOrder`, so asking it first meant a
 * stack that had already stated its locales in `i18n` could still be refused
 * over a `packages` list that answer never needed. The envelope limbs are pure
 * property reads on the stack and its manifest; they are asked first, and only
 * a stack that answers neither of them pays the package walk.
 *
 * Exported because the #15004 option-B acceptance probe measures this decision
 * by CALLING it. A probe that re-implemented the read would be a second copy of
 * the code the reader program changes, and would stay red after the reader
 * beside it was fixed.
 *
 * @param stack - The caller-supplied stack (`new DevPlugin({ stack })`).
 * @returns The options to construct `I18nServicePlugin` with, or `undefined`
 *   when this stack declares no i18n content at all.
 * @throws Everything {@link stackDeclaresTranslations} throws, and only from
 *   that limb: the ADR-0112 envelopes (`code` + `status: 422`) for a `packages`
 *   list that is not loadable, and the **bare** `Error` (no `code`, no
 *   `status`) for a dependency cycle between two packages. ⚠️ A stack whose
 *   `i18n` / `manifest.i18n` / `manifest.translations` answers the question
 *   never reaches that limb and therefore never throws. `DevPlugin` catches
 *   both classes, reports the metadata defect and boots on the in-memory
 *   fallback — see `dev-plugin.ts`'s 3b block for why degrading is the
 *   consistent posture there.
 */
export function devI18nPluginOptions(stack: unknown): DevI18nPluginOptions | undefined {
  const bag = asBag(stack);
  if (!bag) return undefined;

  const manifest = asBag(bag.manifest);
  // Cheapest first — see the docblock. These two are property reads that cannot
  // throw; `stackDeclaresTranslations` is the limb that can reach the artifact
  // gate, so it is asked LAST and only when the others answered no.
  const hasI18nConfig = !!(bag.i18n || manifest?.i18n);
  const hasManifestTranslations = !!(
    manifest && Array.isArray(manifest.translations) && manifest.translations.length > 0
  );

  if (!hasI18nConfig && !hasManifestTranslations && !stackDeclaresTranslations(stack)) {
    return undefined;
  }

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
