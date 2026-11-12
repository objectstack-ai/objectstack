// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A finding's USER-FACING sentence, in the request's language (ruling record
 * 6819749037, option C of the advisory-language analysis: the producer of a
 * finding composes the text its user reads, in that user's language; the rule
 * id stays stable and every consumer renders the text as received).
 *
 * ## The contract this module serves
 *
 * `RuntimeAuthoringIssueSchema.userMessage` (`@objectstack/spec/api`) is the
 * wire field: the finding's user-facing sentence, in the request's locale,
 * else the workspace default, else `en`. Its producers are the authoring rules
 * in this package, and a rule cannot compose that sentence itself: it is a pure
 * `(stack) => findings` function that never sees the request. So a rule emits
 * the NAMES its sentence interpolates ({@link AuthoringFinding.userTextParams})
 * and its catalog holds the sentence for every platform locale; the door that
 * holds the request picks the locale and calls {@link findingUserMessage}.
 *
 * ## Where a sentence lives
 *
 * With its producer: each rule file that authors user sentences has a sibling
 * `<rule file>.user-text.ts` catalog, keyed by the rule's own id constant, so a
 * rule's wording and its translations change in one place, and an author who
 * edits the rule finds them beside it. This module only merges those catalogs
 * ({@link FINDING_USER_TEXT_CATALOG}) and applies the locale ladder. ⛔ There is
 * no second locale list here: the languages are the platform locale table's
 * (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`).
 *
 * ## The locale ladder
 *
 * {@link userTextLocaleOf}: the first candidate the caller hands in (the
 * request's locale, then the workspace default) that names a platform locale
 * the entry has a sentence for, read through `platformLocaleTagOf` so `zh-CN`
 * means `zh-Hans` and `en-US` means `en`; otherwise `en`, which every entry
 * carries (the type requires it). A locale off the table, and a locale the
 * entry has no sentence for, both take the next rung: that English floor is
 * the declared fallback, never a silent gap.
 *
 * ## What it is NOT
 *
 * Not a replacement for `message` / `hint`. Those stay the rule author's
 * developer-facing English, the text `os validate`, logs and AI authors read;
 * the user sentence is addressed to the person who saved the metadata in
 * Studio. And not a second rule list: a finding without `userTextParams`
 * simply has no user sentence, and its consumer renders `message` as before.
 */

import { platformLocaleTagOf, type PlatformLocaleTag } from '@objectstack/spec/system';
import { SECURITY_POSTURE_USER_TEXT } from './validate-security-posture.user-text.js';

/**
 * The names a finding's user sentence interpolates — object, field and
 * permission-set names, as the rule saw them. Strings only, so a finding stays
 * plain data a door can carry, serialize and render later.
 */
export type UserTextParams = Readonly<Record<string, string>>;

/** One locale's sentence: a pure function of the finding's {@link UserTextParams}. */
export type UserTextTemplate = (params: UserTextParams) => string;

/**
 * One rule's sentences, per platform locale. `en` is required: it is the last
 * rung of the ladder, so every entry can always answer. Every other platform
 * locale is optional at the type level and owed by the producer's own pin.
 */
export type UserTextEntry = { readonly en: UserTextTemplate } & {
  readonly [Tag in Exclude<PlatformLocaleTag, 'en'>]?: UserTextTemplate;
};

/** A producer's catalog: rule id → its sentences. */
export type UserTextCatalog = Readonly<Record<string, UserTextEntry>>;

/** The ladder's last rung, which every {@link UserTextEntry} carries. */
export const USER_TEXT_FALLBACK_LOCALE: PlatformLocaleTag = 'en';

/**
 * The locale an entry answers in, for an ordered list of candidates (the
 * request's locale first, then the workspace default). Each candidate is read
 * against the platform locale table; the first that names a locale the entry
 * has a sentence for wins, and `en` answers when none does.
 */
export function userTextLocaleOf(
  entry: UserTextEntry,
  locales: readonly (string | null | undefined)[],
): PlatformLocaleTag {
  for (const candidate of locales) {
    const tag = platformLocaleTagOf(candidate);
    if (tag !== undefined && entry[tag] !== undefined) return tag;
  }
  return USER_TEXT_FALLBACK_LOCALE;
}

/** Render one entry for `params` in the locale {@link userTextLocaleOf} picks. */
export function renderUserText(
  entry: UserTextEntry,
  params: UserTextParams,
  locales: readonly (string | null | undefined)[],
): string {
  const template = entry[userTextLocaleOf(entry, locales)] ?? entry.en;
  return template(params);
}

/**
 * Merge producers' catalogs into one, refusing a rule id two producers both
 * claim: a rule id is one rule, so it has one set of sentences.
 */
export function mergeUserTextCatalogs(...catalogs: readonly UserTextCatalog[]): UserTextCatalog {
  const merged: Record<string, UserTextEntry> = {};
  for (const catalog of catalogs) {
    for (const [rule, entry] of Object.entries(catalog)) {
      if (Object.prototype.hasOwnProperty.call(merged, rule)) {
        throw new Error(`user-text catalogs: rule "${rule}" has sentences in two catalogs; a rule id has one owner`);
      }
      merged[rule] = entry;
    }
  }
  return Object.freeze(merged);
}

/**
 * Every rule's user sentences, merged from the producers' own catalogs. A
 * producer that starts authoring user sentences adds its catalog here.
 */
export const FINDING_USER_TEXT_CATALOG: UserTextCatalog = mergeUserTextCatalogs(SECURITY_POSTURE_USER_TEXT);

/**
 * A finding's user-facing sentence in the first of `locales` its rule has a
 * sentence for (the request's locale, then the workspace default), else `en` —
 * the value `RuntimeAuthoringIssueSchema.userMessage` carries.
 *
 * `undefined` when the finding carries no `userTextParams` (its producer
 * authors no user sentence) or its rule has no catalog entry; the consumer
 * then renders `message`, as it did before this field existed. Pure: the door
 * that holds the request supplies the locales.
 */
export function findingUserMessage(
  finding: { readonly rule: string; readonly userTextParams?: UserTextParams },
  locales: readonly (string | null | undefined)[],
): string | undefined {
  if (finding.userTextParams === undefined) return undefined;
  if (!Object.prototype.hasOwnProperty.call(FINDING_USER_TEXT_CATALOG, finding.rule)) return undefined;
  return renderUserText(FINDING_USER_TEXT_CATALOG[finding.rule]!, finding.userTextParams, locales);
}
