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
 * the entry has a sentence for; otherwise `en`, which every entry carries (the
 * type requires it). A candidate is read through `platformLocaleTagOf`, the
 * whole code first and then one subtag shorter at a time
 * ({@link platformLocaleNamedBy}), so `zh-CN` means `zh-Hans`, `fr-FR` means
 * `fr` and `en-GB` means `en`. A code that names no table language, and a
 * language the entry has no sentence for, both take the next rung: that
 * English floor is the declared fallback, never a silent gap.
 *
 * The caller hands in the request's locale and the workspace default as two
 * values. `ExecutionContext.locale` is the fold of the two, so it alone
 * cannot serve the second rung once a request names a locale.
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
import { APPROVAL_APPROVERS_USER_TEXT } from './validate-approval-approvers.user-text.js';
import { FLOW_TRIGGER_READINESS_USER_TEXT } from './validate-flow-trigger-readiness.user-text.js';
import { FLOW_TEMPLATE_PATHS_USER_TEXT } from './validate-flow-template-paths.user-text.js';
import { FLOW_NODE_WRITES_USER_TEXT } from './validate-flow-node-writes.user-text.js';
import { READONLY_FLOW_WRITES_USER_TEXT } from './validate-readonly-flow-writes.user-text.js';
import { FLOW_CREDENTIAL_LITERALS_USER_TEXT } from './lint-flow-credential-literals.user-text.js';

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

/**
 * The ladder's last rung, which every {@link UserTextEntry} carries. Not
 * exported: it is a locale tag, and an exported slug-shaped string reads as a
 * rule id to this package's barrel census (`rule-id-barrel-exports.test.ts`).
 */
const USER_TEXT_FALLBACK_LOCALE: PlatformLocaleTag = 'en';

/**
 * The platform locale one candidate code names, or `undefined`: the whole code
 * through `platformLocaleTagOf`, then each shorter prefix, one subtag at a time
 * (RFC 4647 lookup: `fr-FR` → `fr`, `en-GB` → `en`, `zh-Hant-US` → `zh-Hant`,
 * `pt-PT` → `pt` → `pt-BR`). The first prefix the table names decides, and no
 * shorter one is tried after it, so a Traditional Chinese code never reads as
 * `zh` and is never handed the Simplified sentence. The reading the platform's
 * other table-keyed copy already uses (`driverCatalogLocaleOf` in
 * `@objectstack/service-datasource`, `storageTestCopyLocaleOf` in
 * `@objectstack/service-storage`).
 */
function platformLocaleNamedBy(code: string | null | undefined): PlatformLocaleTag | undefined {
  if (typeof code !== 'string' || code.length === 0) return undefined;
  const subtags = code.split('-');
  for (let n = subtags.length; n > 0; n -= 1) {
    const tag = platformLocaleTagOf(subtags.slice(0, n).join('-'));
    if (tag !== undefined) return tag;
  }
  return undefined;
}

/**
 * The locale an entry answers in, for an ordered list of candidates (the
 * request's locale first, then the workspace default). Each candidate names
 * its platform locale through {@link platformLocaleNamedBy}; the first whose
 * locale the entry has a sentence for wins, and `en` answers when none does.
 */
export function userTextLocaleOf(
  entry: UserTextEntry,
  locales: readonly (string | null | undefined)[],
): PlatformLocaleTag {
  for (const candidate of locales) {
    const tag = platformLocaleNamedBy(candidate);
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
export const FINDING_USER_TEXT_CATALOG: UserTextCatalog = mergeUserTextCatalogs(
  SECURITY_POSTURE_USER_TEXT,
  // The automation writes: approval, flow trigger and flow node advisories.
  APPROVAL_APPROVERS_USER_TEXT,
  FLOW_TRIGGER_READINESS_USER_TEXT,
  FLOW_TEMPLATE_PATHS_USER_TEXT,
  FLOW_NODE_WRITES_USER_TEXT,
  READONLY_FLOW_WRITES_USER_TEXT,
  FLOW_CREDENTIAL_LITERALS_USER_TEXT,
);

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
