// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A translated record-page tab title is judged against the tab list as the
// registry serves it: the paired `.custom` arrangement replaces every entry it
// covers, after the owner's list and every placement. Semantic-only — whether
// a key the arrangement left with no label to translate should be dropped, or
// the arrangement's entry given a label, is the author's call, so no D2
// conversion rewrites it.
export const entry: SemanticMigration = {
  id: 'translation-related-list-key-under-arrangement-refused',
  surface:
    'translation.objects.<object>._relatedLists.<list> — a translated record-page tab title, in a stack\'s '
    + 'translations, over a list the object\'s owner labels but the paired .custom package\'s relatedLists '
    + 're-states as { list, hidden: true }, as a bare name, or as an entry with no label (a bare child name '
    + 'such as event covers every list of that child, event.related_to included, so a labelled { list: event, '
    + 'label } also leaves the owner\'s event.related_to with no label)',
  replacement:
    'nothing, where the tab should stay hidden or keep the child lookup field\'s relatedListTitle: drop the key. '
    + 'Where the tab should keep the owner\'s translated title, re-state the .custom arrangement\'s entry with the '
    + 'owner\'s own label ({ list, label }) and keep the key: an object read translates a label only while it still '
    + 'equals the packaged one.',
  reason:
    'The registry applies the .custom arrangement (ADR-0146 D10) after the owner\'s tab list and every place '
    + 'entry, and each of its entries replaces every entry it covers. A hidden entry leaves no tab, and a bare or '
    + 'unlabelled one leaves the tab titled by the child\'s relatedListTitle, so the served object carries no '
    + 'label on that list and nothing reads the key. translation-target-unknown judged the owner\'s label first '
    + 'and accepted the key before it looked at the arrangement, and never saw the arrangement\'s bare names. It '
    + 'now folds the arrangement as the registry does and reports such a key as an error. No D2 conversion '
    + 'exists: only the author can say whether the tab was meant to lose its title or the arrangement to keep one.',
  acceptanceCriteria:
    'Run objectstack validate: no translation-target-unknown finding names an objects._relatedLists key. For '
    + 'each key the finding named, either the key is gone, or the .custom arrangement\'s entry for that list '
    + 'carries the owner\'s label and the record page shows the translated title in that locale.',
};
