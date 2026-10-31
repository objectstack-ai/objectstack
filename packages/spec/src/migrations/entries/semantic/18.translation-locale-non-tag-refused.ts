// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry of the `translation-locale-tag-canonicalized` family: the D2
// conversion rewrites the two spellings that have one tag they can have meant
// (an `_` separator, surrounding whitespace) in stored rows and built
// artifacts; this entry is the judgment an author still owes on the rest.
export const entry: SemanticMigration = {
  id: 'translation-locale-non-tag-refused',
  surface:
    'a locale that is not a BCP-47 tag (LocaleSchema): a translation item locale, a translation '
    + 'bundle locale key, i18n.defaultLocale / fallbackLocale / supportedLocales, a seed dataset '
    + 'locale scope, the seed loader locale',
  replacement:
    'the BCP-47 tag the value was written for: a 2-3 letter language subtag, then hyphen-separated '
    + '1-8 letter-or-digit subtags (`en`, `zh-CN`, `zh-Hans-CN`, `es-419`). Write `zh-CN` for '
    + '`zh_CN` and drop surrounding whitespace; the conversion does both for stored rows and built '
    + 'artifacts. A language name or any other text has no single tag it can have meant, so rewrite '
    + 'it by hand. Case is not judged: `zh-cn` is accepted, because the resolvers fold case',
  reason:
    'LocaleSchema was a bare string, so a translator or AI author who wrote `zh_CN`, a padded '
    + 'value or a language name got a green save, and the strings were stored under a locale no '
    + 'session ever asks for. The resolvers fold case and nothing else, so those strings never '
    + 'rendered, with no diagnostic: indistinguishable from a translation nobody had written yet. '
    + 'The schema now refuses any value that is not tag-shaped, at the metadata save door, at '
    + 'defineTranslation / defineTranslationBundle and on the bundle map key. The shape is the one '
    + 'a user locale column already accepts. It is a syntax check only: membership has no registry '
    + 'to check against. Ships at once, no grace window and no dual spelling.',
  acceptanceCriteria:
    'Every translation item locale, translation bundle key, i18n locale and seed dataset locale '
    + 'parses through LocaleSchema. A stored `translation` row under `zh_CN` or a padded locale '
    + 'loads with the tag rewritten and its strings start rendering for that locale. A stored row '
    + 'under any other non-tag value keeps loading as stored, is listed by `os migrate meta --stored` '
    + 'as a TODO, and fails the schema wherever it is parsed until it is rewritten. A bundle whose '
    + 'underscore key would land on a tag it already holds with different strings is reported and '
    + 'left for the author to merge.',
  conversionIds: ['translation-locale-tag-canonicalized'],
};
