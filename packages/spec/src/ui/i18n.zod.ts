// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ⚠️ #4001 批 16 measured this file as SPLIT across the ledger's classes, and the
// split is now resolved in BOTH directions. Read before editing.
//
// KEPT. `AriaPropsSchema` is a REAL DOOR and is closed (`strictObject`): it is
// carried as `aria:` on ~30 live shapes across six metadata-type roots —
// `ListViewSchema`, `PageSchema`, `PageComponentSchema`, `ChartConfigSchema`,
// `ActionSchema`, and 20 SDUI component defs — and a BFS from all 24 roots plus
// `defineStack` reaches it directly. (`DashboardWidgetSchema` was a seventh
// carrier when this was measured; its `aria` embed was retired later the same
// day — #5010, ADR-0049 — because no dashboard renderer applied it. The shape
// and every carrier above are unaffected.) It was silently stripping: through
// the `view` root, `aria: { label: 'Accounts', describedBy: 'x' }` parsed CLEAN
// and returned `aria: {}`, so the accessible name the author wrote simply did
// not exist. `I18nLabelSchema` is the live label primitive the whole `ui/` tree
// imports. Both stay, and `i18n.test.ts` pins their survival.
//
// REMOVED. `I18nObjectSchema` / `PluralRuleSchema` / `NumberFormatSchema` /
// `DateFormatSchema` / `LocaleConfigSchema` — per ADR-0049 enforce-or-remove
// (#5055, maintainer ruling 2026-08-06; window moved to protocol 17 on
// 2026-08-07). They had no carrier key anywhere, were unreachable in that same
// BFS, and were never parsed in objectstack / objectui / cloud outside this
// file's own tests — all three re-measured on `origin/main` immediately before
// the removal, controls passing in the same run.
//
// Two things worth keeping straight about what left:
//
//  - `NumberFormatSchema` / `DateFormatSchema` DID have a carrier key
//    (`LocaleConfig.numberFormat` / `.dateFormat`) — but the carrier was itself
//    doorless, so the subtree was `no door` rather than `no gate` and it goes as
//    one subtree. Leaving the two leaf shapes behind would strand exported
//    schemas with no consumer, which reads as a capability to whoever finds them
//    (#3950).
//  - `I18nObjectSchema` was a KEY-REFERENCE dialect (`{ key, defaultValue,
//    params }`) with no resolver: nothing ever looked a `key` up, so the label
//    an author wrote there reached the screen as the raw key string or not at
//    all. It stays retired, and #5728's widening below does NOT bring it back —
//    see the locale-key constraint on {@link InlineLocaleMapSchema}, which is
//    what keeps `{ key, defaultValue }` a parse error rather than a "locale map"
//    whose locales happen to be named `key` and `defaultValue`. The live
//    bundle-based translation surface is `system/translation.zod.ts`.
//
// ⚠️ Route 3 of the retirement playbook ("nothing parses it → neither"): with no
// carrier key there is no shape for a `retiredKey()` tombstone to sit on and no
// author document for an ADR-0087 D2 conversion to rewrite. The declared record
// is the D3 `SemanticMigration` `ui-widget-i18n-family-retired` plus
// `RETIRED_DEFS_BY_MAJOR`. Localisation as authorable protocol metadata returns
// via the ENFORCE route of ADR-0049 through a new ADR — the formatter that reads
// a `LocaleConfig` first, the vocabulary second.

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * Display-label and ARIA-label primitives shared by every `ui/` shape.
 *
 * A MODULE doc, deliberately, rather than the first declaration's doc doing the
 * job by accident: `scripts/build-skill-references.ts` headlines this file in
 * four skill indexes from the first JSDoc it finds, so without one the headline
 * silently becomes whatever declaration happens to sort first. It did exactly
 * that when #5728 added `InlineLocaleMapSchema` above `I18nLabelSchema` — the
 * indexes started describing the file as a BCP-47 key format. Stating the
 * headline once, on the module, makes it a decision instead of a side effect of
 * declaration order.
 *
 * Declaration order here is load-bearing and cannot simply be flipped back:
 * `I18nLabelSchema` names `InlineLocaleMapSchema` in its union, and under
 * `OS_EAGER_SCHEMAS=1` (which `gen:schema` sets) `lazySchema` evaluates its
 * factory at module load — so a forward reference would be a TDZ crash in the
 * schema build rather than a lazy lookup.
 */

/**
 * The key face of an inline locale map: a BCP-47-shaped language tag (`en`,
 * `zh`, `zh-CN`, `pt-BR`, `zh-Hans-CN`), plus the literal `default`, which the
 * renderer's `pickLocalized` reads as the untagged fallback entry.
 *
 * ## Why the key is constrained rather than left as `z.string()`
 *
 * A bare `z.record(z.string(), z.string())` would re-admit the **retired**
 * `I18nObjectSchema` dialect through the front door: `{ key: 'views.x.label',
 * defaultValue: 'Task List' }` is, structurally, a map of strings to strings.
 * It would parse clean and then reach objectui's `pickLocalized`, whose last
 * resort is "the first string value in the object" — so the *i18n key itself*
 * renders as the visible label, in every locale. That is the silent-strip
 * failure class this file's own header exists to record, arriving through the
 * one shape #5055 deliberately removed.
 *
 * Constraining the key keeps both halves of the #5728 ruling true at once: the
 * inline locale map the resolver really honours is authorized, and the dead
 * key-reference dialect stays rejected — declared = enforced in both
 * directions, which is exactly the #4667 consistency the ruling asks for.
 * Every inline map authored in this repo (31 of them, across three platform
 * pages) uses `en` / `zh-CN` / `ja-JP` / `es-ES`, so the constraint costs no
 * real authoring surface.
 *
 * The two retired spellings are rejected BY NAME, in any combination
 * (#10492). An earlier revision of this comment argued the opposite — that the
 * key-reference form "always carried `defaultValue`" and a lone three-letter
 * `key` was indistinguishable from a language subtag — and that reasoning left
 * an enforcement hole in the #5055 retirement: `{ key: 'common.save' }` alone
 * parsed as a "language `key` locale map" and then rendered the raw dotted key
 * on screen (the resolvers' last resort is the first string value — see the
 * message below), while the emitted type had already made the same spelling a
 * compile error (#9925's `key?: never` limb). Runtime and type axis now refuse
 * the same two names. This is not a deny-list of English words that "look
 * like" tags — it is exactly the two spellings #5055 retired, nothing else:
 * `deu`, `fra`, or any other real three-letter subtag still parses.
 */
const INLINE_LOCALE_KEY = /^(?!(?:key|defaultValue)$)(default|[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/;

/**
 * The emitted type of an inline locale map — hand-tied, because the key regex
 * above is a Zod runtime refinement that does NOT survive into a derived type:
 * `z.input` of a bare `z.record(z.string().regex(…), z.string())` erases to
 * `Record<string, string>`, on which **every** string key type-checks. The
 * retired `{ key, defaultValue }` key-reference form therefore stayed
 * structurally assignable to every `I18nLabel` surface even though
 * `I18nLabelSchema` refuses it at parse time — declared ≠ enforced on the type
 * axis, and it shipped a full release of measured harm: objectui#5264 declared
 * the retired form on a widget prop, the wrong shape compiled, and the raw
 * dotted i18n key rendered as the visible KPI label (#9925).
 *
 * The two `never` limbs are the fix (#9925, maintainer ruling 2026-08-19,
 * option B): a property named `key` or `defaultValue`, if present, must be
 * `never` — no string satisfies that, so writing either key in an object
 * literal is a compile error, in both property orders, on every surface that
 * embeds `I18nLabelSchema`. Everything else about the type is unchanged:
 *
 *  - every valid inline map still assigns (`{ en: 'Members', 'zh-CN': '成员' }`
 *    — the limbs are optional, so their absence satisfies them);
 *  - computed-key sites still assign (`{ [locale]: text }` and a plain
 *    `Record<string, string>` both carry an index signature, not a declared
 *    `key`/`defaultValue` property, so no escape hatch is needed — measured,
 *    see `i18n.label-type-assertions.ts`);
 *  - reads are unaffected (`map[tag]`, `Object.keys`, `Object.values`).
 *
 * Why this shape and not a template-literal / branded locale-tag key (the
 * ruling offered both and asked for a measured pick): a template-literal key
 * cannot express "2–3 letters", so its letter-union approximation both ADMITS
 * the lone `key` (three lowercase letters parse as a language subtag pattern —
 * the boundary the runtime refinement also had until #10492 closed it by name)
 * and explodes tsc (the
 * 26-letter probe did not finish; a 12-letter scale took 16s where this shape
 * takes 2s), while a branded key breaks every existing object literal. The
 * narrowing is deliberately exactly the measured harm class, not BCP-47
 * fidelity — the full key grammar remains the runtime refinement's job.
 */
export type InlineLocaleMap = Record<string, string> & {
  /** Never writable — the retired key-reference form's `key` (#5055, #9925). */
  key?: never;
  /** Never writable — the retired key-reference form's `defaultValue` (#5055, #9925). */
  defaultValue?: never;
};

/**
 * Inline locale map — the second authorized form of a display label.
 *
 * `{ en: 'Members', 'zh-CN': '成员', 'ja-JP': 'メンバー' }`: the author writes
 * every language inline, and the renderer picks one at display time
 * (objectui's `pickLocalized`, which the CLI's `i18n-extract` also recognises —
 * a label already in map form is multilingual, so no bundle key is scaffolded
 * for it).
 *
 * The annotation is what carries the {@link InlineLocaleMap} narrowing into
 * every `z.input`/`z.infer` derivation that embeds this schema — without it the
 * derived type is `Record<string, string>` and the retired form compiles
 * everywhere (#9925). Input and output are annotated identically because the
 * record neither transforms nor defaults — the annotation itself is what holds
 * them equal now, both halves spelling the same type; the former `Iso759`
 * isomorphism pin was deleted as no-longer-load-bearing per the receipt in
 * `type-alias-convention.pin.test.ts` (#9925).
 *
 * ⚠️ The annotation spells the shape STRUCTURALLY instead of naming
 * {@link InlineLocaleMap}, deliberately. Naming the alias here writes an alias
 * REFERENCE into every emitted embed of this schema, and tsup's dts bundling
 * hoists this module into a hashed chunk (`dist/i18n.zod-*.d.ts`) that no
 * package-exports subpath can address — so any consumer whose INFERRED export
 * type embeds a label (five `ObjectSchema.create` objects in metadata-core
 * were the measured instances) fails declaration emit with TS2883 "cannot be
 * named without a reference to … not portable". The structural spelling makes
 * every emitted embed anonymous and self-contained; the alias above stays the
 * documented public name. The two spellings cannot drift silently: the
 * compile pins in `i18n.label-type-assertions.ts` cover both — the direct
 * alias pins catch a widened alias, the embedded-surface pins catch a widened
 * annotation.
 */
export const InlineLocaleMapSchema: z.ZodType<
  Record<string, string> & { key?: never; defaultValue?: never },
  Record<string, string> & { key?: never; defaultValue?: never }
> = lazySchema(() => z.record(
  z.string().regex(
    INLINE_LOCALE_KEY,
    'an inline label map is keyed by BCP-47 locale tags (`en`, `zh-CN`, …) or `default` — '
    + 'never by `key`/`defaultValue`, the retired key-reference form (#5055): nothing looks the key up, '
    + 'so both resolvers fall through to the first string value and the raw key is rendered on screen',
  ),
  z.string(),
).describe('Inline locale map: BCP-47 tag → translated string'));

/**
 * I18n Label Schema
 *
 * A display label in one of **two** authorized forms (#5728, maintainer ruling
 * 2026-08-06):
 *
 *  1. **A plain string** — the default-language literal. Its translations live
 *     in a translation bundle, addressed by the convention for the surface that
 *     carries the label (`objects.<object>._views.<view>.label`,
 *     `pages.<page>.components.<id>.label`, …) and resolved by
 *     `system/i18n-resolver.ts`.
 *  2. **An inline locale map** — `{ en: 'Members', 'zh-CN': '成员' }`, picked at
 *     render time. Three published platform pages author 31 of these and
 *     objectui resolves them (`pickLocalized`), so the map is a delivered
 *     capability, not a convention the runtime ignores.
 *
 * Form 2 is resolved **on this side too**, since #6765: `resolveI18nLabel` in
 * `./i18n-label-resolver` is the shared `I18nLabel` → `string` resolver, pinned
 * limb for limb to `pickLocalized` by an executed parity table. Before it, the
 * meaning of the shape this file declares existed only in the other repo, and a
 * backend producer holding a map could do nothing with it but drop it — which
 * is exactly what every one of them did (#6761, maintainer ruling 2026-08-08,
 * option B). Form 1's bundle lookup is `system/i18n-resolver.ts`; a caller
 * holding either form runs `resolveI18nLabel` first.
 *
 * Both are real; neither is deprecated by this schema. The bundle route is the
 * one that scales (translators never touch `*.page.ts`) and remains the
 * long-term direction — but a contract that declared only form 1 while the
 * platform's own pages shipped form 2 was the authoritative document being the
 * wrong one, which is what this widening fixes.
 *
 * ⚠️ NOT auto-generated. An earlier version of this description promised "i18n
 * keys are auto-generated by the framework at registration time"; no key is
 * generated for anything (#5377). A plain-string label is translatable exactly
 * where the resolver and `ObjectTranslationDataSchema` define a slot for it,
 * and nowhere else.
 *
 * @example
 * ```typescript
 * const plain: I18nLabel = 'All Active';
 * const inline: I18nLabel = { en: 'All Active', 'zh-CN': '全部活跃' };
 * ```
 */
export const I18nLabelSchema = lazySchema(() => z.union([
  z.string(),
  InlineLocaleMapSchema,
]).describe('Display label — the default-language string, or an inline locale map ({ en, "zh-CN" }) resolved at render time'));

export type I18nLabel = z.input<typeof I18nLabelSchema>;

// The one closed shape in this file (#4001 批 16). Everything below `AriaProps`
// stays open on the `no door` verdict recorded at the top.
//
// Curation is anchored to NAMED SIBLING CONTRACTS, never to edit distance —
// each entry below was measured against a real producer, and the distance
// fallback was measured first so nothing is hand-written that it already reaches
// (it reaches `arialabel`, `ariaLabell`, `ariadescribedby`, `aria-label`,
// `roles`; it does NOT reach any of the four aliases here).
const ARIA_HISTORY =
  'Until #4001 closed this shape an unknown key was dropped silently — the component still '
  + 'rendered, with no accessible name and nothing to say the one you wrote had been discarded.';

/**
 * ARIA Accessibility Properties Schema
 *
 * Common ARIA attributes for UI components to support screen readers
 * and assistive technologies.
 *
 * Aligned with WAI-ARIA 1.2 specification.
 *
 * @see https://www.w3.org/TR/wai-aria-1.2/
 *
 * @example
 * ```typescript
 * const aria: AriaProps = {
 *   ariaLabel: 'Close dialog',
 *   ariaDescribedBy: 'dialog-description',
 *   role: 'dialog',
 * };
 * ```
 */
export const AriaPropsSchema = lazySchema(() => strictObject({
  surface: 'these ARIA attributes',
  history: ARIA_HISTORY,
  aliases: {
    // objectui's `ARIA_KEY_ALIASES` (`packages/core/src/utils/normalize-list-view.ts`)
    // is the measured source for these two: they are the spellings stored view
    // metadata really carries, folded onto the canonical keys at the ListView
    // boundary (objectui#2890). A view authored the legacy way reached this
    // schema and lost BOTH keys — `aria: {}` — so the accessible name existed in
    // the source file and nowhere else.
    label: 'ariaLabel',
    describedBy: 'ariaDescribedBy',
    // Two of this shape's three keys carry the `aria` prefix and `role` does not.
    // An author who has just written `ariaLabel` and `ariaDescribedBy` generalises
    // to `ariaRole`; that is the shape's own inconsistency, not a typo, and the
    // distance fallback provably cannot bridge it (measured).
    ariaRole: 'role',
  },
  guidance: {
    // NOT an alias — `live` is not a key this schema accepts, and suggesting one
    // the schema cannot accept is the ledger's finding 7 (this campaign's own fix
    // signposting the way into the failure it exists to kill).
    live: '`live` is objectui\'s LIST-VIEW-ONLY extension, declared there as '
      + '`AriaPropsSchema.extend({ live })` and read by `ListView` alone — this shared shape is '
      + 'carried by ~30 renderers and only one of them applies `aria-live`, so declaring it here '
      + 'would advertise a capability the other 29 do not deliver. On an objectui list view the key '
      + 'is valid as-is; anywhere else, drop it. Promoting it into the protocol is #5058.',
    // `aria-labelledby` REFERENCES another element's id; `ariaLabel` is a literal
    // string. Renaming between them would be a wrong prescription, so this names
    // the gap instead of pretending there is a target.
    ariaLabelledBy: '`aria-labelledby` has no counterpart in this protocol — it references another '
      + 'element\'s id, which is not the same thing as `ariaLabel` (a literal accessible name), so '
      + 'there is nothing to rename it to. Use `ariaLabel` only if a literal string is what you meant. '
      + 'Declaring the referencing form is #5058.',
    labelledBy: '`aria-labelledby` has no counterpart in this protocol — see `ariaLabelledBy`. '
      + 'Use `ariaLabel` only if a literal accessible name is what you meant; #5058 tracks the gap.',
  },
}, {
  /**
   * Accessible label for screen readers.
   *
   * Same two authorized forms as any other {@link I18nLabelSchema} label. It is
   * called out here because #5377 asked whether this key inherited the
   * "auto-generated i18n keys" claim: it did not carry that sentence itself,
   * but it did inherit the assumption behind it. There is no generated key for
   * an `ariaLabel` and no bundle slot addressing one, so a plain-string
   * `ariaLabel` is announced in the source language in every locale — the
   * inline map is its only localization route today.
   */
  ariaLabel: I18nLabelSchema.optional().describe(
    'Accessible label for screen readers (WAI-ARIA aria-label). Plain string, or an inline locale map — '
    + 'no translation-bundle slot addresses this key, so a plain string is announced in the source language.',
  ),

  /** ID of element that describes this component */
  ariaDescribedBy: z.string().optional().describe('ID of element providing additional description (WAI-ARIA aria-describedby)'),

  /** WAI-ARIA role override */
  role: z.string().optional().describe('WAI-ARIA role attribute (e.g., "dialog", "navigation", "alert")'),
}).describe('ARIA accessibility attributes'));

export type AriaProps = z.input<typeof AriaPropsSchema>;
