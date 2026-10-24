/**
 * Resolve a possibly-localized value to the best string for a language.
 *
 * Accepts a plain string (passed through) or an i18n object keyed by language
 * code — e.g. `{ en: 'Pricing', 'zh-CN': '定价', zh: '定价', default: 'Pricing' }`.
 * Resolution order: exact language -> base language (`zh-CN` -> `zh`) -> any
 * region-qualified key sharing the base (`zh` -> `zh-CN`) -> `default` -> `en`
 * -> first value. Unlike a `default`/`en`-only resolver this is genuinely
 * locale-aware, so server-driven metadata (page text, action param labels) can
 * carry inline translations instead of rendering "[object Object]" or English.
 *
 * Pure — pair it with `useObjectTranslation().language` (or any current-locale
 * source) at the call site.
 *
 * Every limb reads **own properties only** and accepts **only `string` values**
 * (objectui#3907). Both guards used to hold on the regional and last-resort
 * limbs alone, which left the other four able to resolve a locale against
 * `Object.prototype` — `pickLocalized({ en: 'Pricing' }, 'constructor')`
 * rendered the constructor's source text as the label — and able to
 * short-circuit the chain with a non-string value, rendering `[object Object]`.
 * Neither is reachable by an input the contract admits (no BCP-47 tag is an
 * `Object.prototype` member, and `InlineLocaleMapSchema` is
 * `z.record(<tag>, z.string())`), so applying them uniformly changes nothing
 * for any real language tag. It makes this function agree limb for limb with
 * the backend twin `resolveI18nLabel` (`@objectstack/spec`, objectstack#6765),
 * whose locale can arrive from an untrusted `Accept-Language` header and which
 * shipped with exactly these two narrowings recorded as deliberate departures.
 * The only remaining difference between the two is how each spells a miss —
 * `''` here for a text node, `undefined` there for a producer's `?? name` chain
 * — pinned in `plugin-list/src/__tests__/i18nLabel-resolver-parity.test.ts`.
 *
 * A guard makes its limb **miss**; it never aborts the resolution. An unusable
 * entry falls through to the next limb exactly as an absent one does, so
 * `pickLocalized({ en: 'Pricing' }, 'constructor')` is `'Pricing'`, not `''`.
 */
export function pickLocalized(value: unknown, language: string | undefined | null): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    /**
     * One entry, or `undefined` when this limb does not hit — which is what
     * lets the limbs keep chaining through `??` in the same order as before.
     */
    const read = (key: string): string | undefined => {
      if (!Object.prototype.hasOwnProperty.call(o, key)) return undefined;
      const entry = o[key];
      return typeof entry === 'string' ? entry : undefined;
    };
    const lang = (language || 'en').trim();
    const base = lang.split('-')[0];
    // Runtime language is often a bare base code ('zh') while metadata authors
    // write full BCP-47 tags ('zh-CN') — upgrade to any key sharing the base.
    // `Object.keys` is already own-and-enumerable, so `read` here is uniformity
    // rather than a second guard.
    const regional = Object.keys(o).find((k) => k.split('-')[0] === base && read(k) !== undefined);
    const pick =
      read(lang) ??
      read(base) ??
      (regional !== undefined ? read(regional) : undefined) ??
      read('default') ??
      read('en') ??
      Object.values(o).find((v): v is string => typeof v === 'string');
    return pick == null ? '' : pick;
  }
  return String(value);
}

/**
 * The map key an edit made in `language` must be WRITTEN to — the write-side
 * twin of {@link pickLocalized}'s read limbs.
 *
 * It deliberately implements only the first three limbs (exact tag, base
 * language, region-qualified sibling) and then STOPS. `pickLocalized` continues
 * into `default` -> `en` -> first value, and those last three limbs must never
 * be write targets: they are DISPLAY fallbacks that hand back *another*
 * locale's string. Following them would mean an author editing in `fr`, shown
 * the `en` entry because the map has no French, saves and overwrites English.
 * When no entry for the active locale exists the edit ADDS one under the active
 * tag and every stored entry survives untouched.
 *
 * The first three limbs are followed exactly because they identify the entry
 * the author was actually looking at. Writing `zh` when the map stores `zh-CN`
 * would leave the edited-away `zh-CN` string in place — invisible in the panel
 * that just "changed" it, still live for any consumer that asks for `zh-CN`.
 *
 * Own properties only, `string` values only, for the same reason every
 * `pickLocalized` limb narrowed that way in objectui#3907: a locale tag that
 * names an `Object.prototype` member is not an entry, so it cannot be the entry
 * the author edited.
 */
function localeWriteKey(
  o: Record<string, unknown>,
  language: string | undefined | null,
): string {
  const lang = (language || 'en').trim() || 'en';
  const base = lang.split('-')[0];
  const has = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(o, key) && typeof o[key] === 'string';
  if (has(lang)) return lang;
  if (has(base)) return base;
  return Object.keys(o).find((k) => k.split('-')[0] === base && has(k)) ?? lang;
}

/**
 * Write `next` back into a possibly-localized value as the `language` entry,
 * preserving every other locale — the write-side inverse of
 * {@link pickLocalized}.
 *
 * An authoring surface that shows one locale in one text input has to answer
 * two questions, and they are not the same question: which entry to DISPLAY
 * (`pickLocalized`) and which entry a save REPLACES. Answering the second with
 * "the whole value" is the data-loss shape this function exists to remove —
 * `onChange(e.target.value)` straight back over `{ en, zh-CN }` destroys every
 * locale the author was not looking at, silently, on the first keystroke.
 *
 * - Plain string / `null` / `undefined` / array input: there is no map to
 *   preserve, so the result is `next` itself. A string-valued label keeps
 *   behaving exactly as it always has.
 * - Inline locale map: the result is the same map with exactly one entry
 *   replaced (or added — see {@link localeWriteKey}). Non-string entries and
 *   unrelated locales are carried across untouched.
 *
 * The pairing with `pickLocalized` is the invariant that matters and it is
 * pinned in `__tests__/setLocalized.test.ts`: for any map and any language,
 * `pickLocalized(setLocalized(map, lang, s), lang) === s`. If the two functions
 * ever drift apart, an edit lands in an entry the panel does not display and
 * the "saved" string vanishes — which is why they live in one file.
 *
 * ⚠️ This is the minimal non-destructive write for a SINGLE-locale editor. It
 * is not a multi-locale authoring UI and does not pretend to be: an author can
 * only ever reach the entry for the locale they are in.
 *
 * Authoring every locale from one surface remains an OPEN product question, and
 * is deliberately not deferred to a tracker here: the deferral this replaced
 * named objectui#4163, which closed as completed on 2026-08-15 with the question
 * still unanswered. A comment pointing at a closed card reads as though the
 * question were settled somewhere, which is how the previous stale premise in
 * this area survived unread.
 */
export function setLocalized(
  value: unknown,
  language: string | undefined | null,
  next: string,
): string | Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return next;
  const o = value as Record<string, unknown>;
  return { ...o, [localeWriteKey(o, language)]: next };
}

/**
 * Remove the `language` entry from a possibly-localized value — the CLEAR arm
 * of the same editor {@link setLocalized} serves, and the reason it cannot be
 * spelled as `setLocalized(value, language, '')`.
 *
 * A single-line authoring input has three actions, not two: type, retype, and
 * clear. `setLocalized` answers the first two. Answering the third with "write
 * the empty string" stores `{ en: '' }` — an entry that claims "English has a
 * title and it is blank", which then SHADOWS every display fallback: a viewer
 * in `en` sees nothing where the map's other locales would have been offered.
 * Answering it with "drop the whole value" is the objectui#9274 data loss
 * itself, arriving through the clearing door instead of the typing door.
 *
 * So clearing removes exactly one entry — the same entry {@link setLocalized}
 * would have written, chosen by the same {@link localeWriteKey} limbs, which is
 * what keeps the cleared entry the one the author was actually looking at.
 *
 * - Plain string / `null` / `undefined` / array: there is no map, so there is
 *   nothing localized left — `undefined`. The caller decides how its own field
 *   spells empty (`undefined` for an optional key, `''` for a required one).
 * - Map with the active entry present: that entry is removed and every other
 *   locale is carried across untouched. When it was the LAST entry the result
 *   is `undefined` rather than `{}`, because an empty map is not a title.
 * - Map WITHOUT an entry for the active locale: returned unchanged. The box was
 *   showing a display fallback borrowed from another locale, and clearing a
 *   borrowed string must not delete the locale it was borrowed from — the same
 *   refusal {@link localeWriteKey} enforces on the write side, which is why
 *   both read the same limbs from the same file.
 */
export function clearLocalized(
  value: unknown,
  language: string | undefined | null,
): Record<string, unknown> | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const key = localeWriteKey(o, language);
  if (!Object.prototype.hasOwnProperty.call(o, key)) return o;
  const rest = Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
  return Object.keys(rest).length > 0 ? rest : undefined;
}
