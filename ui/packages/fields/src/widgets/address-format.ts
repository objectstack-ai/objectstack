/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The address value shape, and the ONE formatting rule every address surface
 * renders it with.
 *
 * This module exists because the rule had exactly one implementation and only
 * one consumer could reach it (objectui#4037). `AddressField`'s readonly branch
 * collapsed a stored address to a formatted line, while the display (read)
 * registry the detail page uses mapped `address` straight to `JsonCellRenderer`
 * — so the same stored value rendered as `Street, City, State ZIP, Country` in
 * a readonly form and as `{"street":"…","city":"…"}` on the detail page.
 *
 * The fix keeps ONE definition rather than a second copy next to the renderer:
 * a duplicated rule is a rule that drifts, and two spellings of the same
 * address on two surfaces of one app is the very failure the issue reports.
 *
 * Deliberately pure — no React, no component imports — so the eager
 * `@object-ui/fields` barrel can use it for cell rendering without pulling
 * `AddressField` (and its inputs) out of the lazily-loaded widget chunk.
 */

import type { AddressValue } from '@objectstack/spec/data';

/**
 * Address data structure — `z.input` of `@objectstack/spec`'s
 * `AddressValueSchema`, which is what the platform stores and what
 * `/api/v1/data/**` serves back.
 *
 * The postal code is spelled `postalCode` (objectstack#5143). `AddressField`
 * used to read and write `zipCode`, a key that appears nowhere in the spec, so
 * the stored postal code never reached the input — and whatever the user then
 * typed into that apparently-empty box was written under a key
 * `AddressValueSchema` strips: lost outright on a new record, and on an
 * existing one silently discarded while the stale stored value survived. (A
 * postal code nobody touched did survive an unrelated edit, because the write
 * spread the whole stored object through; the issue's account of that half is
 * corrected in `AddressField.postalCode.test.tsx`.) One name, on both sides:
 * the contract's.
 *
 * IMPORTED rather than declared since objectui#4167. rc.6 publishes
 * `AddressValue` under this exact name, and the local copy — whose own comment
 * already claimed to be "the part names of `AddressSchema`" — declared five of
 * the seven parts. `countryCode` and `formatted` were missing, which is
 * objectstack#4115's failure class precisely: a canonical CLAIM over a narrower
 * shape, believed by the next reader. The claim is now the code.
 *
 * `AddressField` still renders five inputs and {@link formatAddress} still
 * composes five parts, and that is a deliberate split rather than an omission:
 * `formatted` is a derived one-line rendering of the parts (what this module
 * computes) and `countryCode` is the ISO pair for `country`, neither of which a
 * human types into a part box. Binding the type does not publish them as
 * inputs — it stops the type from asserting the platform cannot store them, and
 * it means a write from the widget no longer looks type-clean while dropping a
 * key the contract carries: the `{ ...address }` spread in `handleFieldChange`
 * preserves both, and now says so.
 *
 * The declaration moved here (objectui#4037) so the display cell renderer and
 * the widget share one definition; the SOURCE of that definition is the spec.
 */
export type { AddressValue };

/**
 * The shape written by builds up to and including 17.0.0-rc.1, whose postal
 * code landed under `zipCode` (objectstack#5143). Read-time compatibility ONLY,
 * and deliberately not part of {@link AddressValue}: authoring code must not be
 * able to spell `zipCode`, and nothing here ever writes it back — the first
 * edit of any part normalizes the record onto `postalCode` (see
 * `AddressField`'s `handleFieldChange`). This is not a producer alias to be
 * honoured forever; it exists to carry data THIS widget mis-wrote, and can go
 * once no such data remains.
 */
export type LegacyAddressValue = AddressValue & { zipCode?: string };

/** Postal code of a stored address, preferring the canonical key. */
export function readPostalCode(addr: AddressValue): string | undefined {
  return addr.postalCode ?? (addr as LegacyAddressValue).zipCode;
}

/**
 * One address part, normalized for joining: absent, non-string and
 * whitespace-only parts all collapse to `''` so the caller's `filter(Boolean)`
 * drops them. This is what keeps a partial address free of dangling separators
 * and of the string `undefined`.
 */
function part(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * Language subtags whose addresses are conventionally written LARGEST-FIRST —
 * country, then region, then city, then street (objectui#4028).
 *
 * Deliberately a language-subtag set and not a country table. The two candidate
 * channels were compared before picking this one:
 *
 *   - The ADDRESS's own country (`countryCode`) would be the more correct
 *     channel — an address format is a property of where the mail goes, not of
 *     who is reading — but `AddressField` exposes no `countryCode` input and
 *     never writes one, so on data this widget produces that channel is empty.
 *     A `country` free-text match ("中国" / "China" / "PRC") would be a
 *     name-guessing table, invented here rather than derived from anything.
 *   - The reader's DISPLAY LOCALE is the channel this repo already resolves
 *     once, for every display formatter, through `useDisplayLocale()` (tenant
 *     regional default -> active UI language -> `'en'`; objectui#4033/#4468).
 *     Both callers pass that, so a stored address reads the same way in a
 *     readonly form and in a grid cell.
 *
 * The limit is stated rather than hidden: a `zh` reader looking at a US address
 * gets it largest-first. That is the reading order their own locale writes
 * addresses in, and it is the trade the empty `countryCode` channel forces
 * today; the refinement is a follow-up, not a silent assumption.
 *
 * Region subtags are ignored (`zh-CN`, `zh-Hant-TW` and `zh` all match) — the
 * convention here follows the language, and `useDisplayLocale()` can serve any
 * of those spellings.
 */
const LARGE_TO_SMALL_LANGUAGES = new Set(['zh', 'ja', 'ko']);

/** Primary language subtag of a BCP-47 tag, lowercased (`'zh-CN'` -> `'zh'`). */
function languageOf(locale: string | undefined): string {
  return (locale || '').split(/[-_]/)[0].toLowerCase();
}

/**
 * Formats a stored address as a single line, in the part order the reader's
 * locale writes addresses in.
 *
 * Two orders, and the second is exactly the first reversed:
 *
 *   - **small-to-large** (default; `en` and every Latin/Cyrillic/Arabic locale
 *     this repo ships) — `Street, City, State ZIP, Country`. Unchanged from
 *     what `AddressField`'s readonly branch has always produced, so English and
 *     provider-less rendering are byte-identical to before.
 *   - **large-to-small** ({@link LARGE_TO_SMALL_LANGUAGES}) — `Country, ZIP
 *     State, City, Street`. A `zh` console rendering a Chinese address
 *     largest-first is the whole point of objectui#4028: `中国, 310000 浙江,
 *     杭州, 中策路 1 号` rather than the US-ordered line it produced before.
 *
 * Only the ORDER varies. The separator stays `', '` in both, because that is
 * not what the issue reports and because these lines carry mixed-script data —
 * a US address read on a `zh` console would look stranger under fullwidth
 * punctuation than under the comma it already has.
 *
 * The state/postal-code pair keeps its one comma-delimited group in both
 * orders, space-separated inside it ("CA 94102" / "310000 浙江"); either part
 * alone occupies the group by itself. Missing parts are dropped rather than
 * spaced over, so a street-only address is `"中策路 1 号"` and never `", , ,"`.
 *
 * Returns `''` when no part is usable — callers decide what an empty address
 * looks like (an `EmptyValue` placeholder for the cell renderer), and a value
 * carrying no recognized part at all is NOT silently blanked: see
 * `AddressCellRenderer`, which falls back to JSON so unknown data stays visible.
 *
 * @param locale - BCP-47 tag from `useDisplayLocale()`. Omitted (tests, and any
 *   caller with no React context) means the small-to-large default, which is
 *   what this function did unconditionally before objectui#4028.
 */
export function formatAddress(addr: AddressValue, locale?: string): string {
  const street = part(addr.street);
  const city = part(addr.city);
  const state = part(addr.state);
  const postalCode = part(readPostalCode(addr));
  const country = part(addr.country);

  if (LARGE_TO_SMALL_LANGUAGES.has(languageOf(locale))) {
    const postalAndState = [postalCode, state].filter(Boolean).join(' ');
    return [country, postalAndState, city, street].filter(Boolean).join(', ');
  }

  const stateAndPostal = [state, postalCode].filter(Boolean).join(' ');
  return [street, city, stateAndPostal, country].filter(Boolean).join(', ');
}
