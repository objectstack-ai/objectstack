// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The case half of the locale-tag family: the D2 conversion
// `translation-locale-tag-case-folded` folds a stored or built locale to its
// BCP-47 case, the parse folds a live author's, and this entry states what
// that changes for a consumer that compared locales by their exact spelling.
export const entry: SemanticMigration = {
  id: 'translation-locale-case-canonicalized',
  surface:
    'a locale tag written in another case than BCP-47 canonical case (LocaleSchema): a translation '
    + 'item locale, a translation bundle locale key, i18n.defaultLocale / fallbackLocale / '
    + 'supportedLocales, a seed dataset locale scope, the seed loader locale',
  replacement:
    'nothing to rewrite: the parse returns the tag in its BCP-47 case (language lower case, script '
    + 'title case, region upper case, every subtag after a singleton lower case), so `zh-cn` reads '
    + 'back as `zh-CN`, `zh-hans-cn` as `zh-Hans-CN` and `EN` as `en`. A consumer that matched the '
    + 'authored spelling exactly matches the canonical one. Two exact matchers compare a folded '
    + 'i18n locale with a row tagged as written, and neither row is folded: the email-template floor '
    + 'warning (warnEmailTemplateLocaleFloor in stack.zod.ts) compares i18n.supportedLocales with '
    + 'emailTemplates[].locale, and the messaging template ladder compares '
    + 'localeCandidates(i18n.getDefaultLocale()) with sys_notification_template.locale. A row tagged '
    + '`zh-cn` no longer matches a supported or default locale authored as `zh-cn`, which now reads '
    + '`zh-CN`: re-tag the row in its canonical case, or fold case in the consumer. The row-side fold '
    + 'lands with the save-door change that stores the parsed locale. A translation bundle holding two '
    + 'keys that fold to one tag (`zh-cn` and `zh-CN`) is refused naming both: merge them by hand '
    + 'under the canonical key',
  reason:
    'Case was accepted as written, on the premise that the resolvers fold it. They answer one locale '
    + 'for a request, exact match first, so a translation saved under `zh-cn` beside the stock `zh-CN` '
    + 'bundle was never merged into it: the save answered 200 and a `zh-CN` session kept rendering the '
    + 'stock strings, with no diagnostic. The parse now corrects the case instead of refusing it, so '
    + 'every reader sees one spelling and no input that parsed before is refused, except a bundle '
    + 'whose two keys would now land on one entry and silently drop one set of strings. The fold is '
    + 'case only: it never replaces a legacy subtag the way Intl.getCanonicalLocales does (`iw` stays '
    + '`iw`).',
  acceptanceCriteria:
    'Every locale that parses through LocaleSchema reads back in its BCP-47 case. A stored '
    + '`translation` row under `zh-cn` is read back as `zh-CN` by every stored-row seam, so its '
    + 'strings are merged into the `zh-CN` locale a session asks for. A built artifact inside the '
    + 'conversion window (built by @objectstack/spec 18.2.0 or earlier) is folded the same way. A '
    + 'canonical tag is never rewritten. An email-template or notification-template row tagged in '
    + 'another case is matched by its consumer only once the row is re-tagged or the consumer folds '
    + 'case. A bundle holding `zh-cn` beside `zh-CN` fails the parse naming both keys, and the '
    + 'stored-row conversion leaves such a pair as stored and reports it.',
  conversionIds: ['translation-locale-tag-case-folded'],
};
