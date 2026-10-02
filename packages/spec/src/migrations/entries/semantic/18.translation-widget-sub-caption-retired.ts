// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry of the `translation-widget-sub-caption-removed` family (#21257):
// the metric sub-caption retired at both ends by ruling C on objectui#11389,
// which reverses #5428 item 4. One D3 entry per retirement family, even when D2
// is lossless (ruling B on #17152). The strip deletes a string nothing reads any
// more; whether that copy still belongs on the card, and where, is the author's
// call and not something the conversion can decide.
export const entry: SemanticMigration = {
  id: 'translation-widget-sub-caption-retired',
  surface: 'translation.dashboards.<dashboard>.widgets.<id>.subCaption — the metric sub-caption '
    + 'overlaid onto a widget\'s options.description',
  replacement: 'The widget\'s one authored description, `widget.description`, rendered as the '
    + 'card-header subtitle and translated by `dashboards.<dashboard>.widgets.<id>.description`.',
  reason: 'The D2 conversion `translation-widget-sub-caption-removed` deletes `subCaption` from every '
    + 'translation bundle and stored translation item, and `translateDashboard` no longer overlays '
    + 'anything onto a widget\'s `options`. The sub-caption was the string under a metric\'s value; '
    + 'the dashboard schema never declared `options.description` and no authored widget wrote it, so '
    + 'a translated sub-caption existed only because this key put it there. What the delete drops is '
    + 'translation WORK: a translator who wrote a caption per locale meant a user to read it. The '
    + 'conversion cannot move those strings to `description`, because `description` already '
    + 'translates the card-header subtitle — a different string a widget may also carry — and only '
    + 'the author can say whether the caption\'s wording belongs in that subtitle or is no longer '
    + 'needed.',
  acceptanceCriteria: 'No translation bundle or translation item carries a widget `subCaption`; the '
    + 'parse refuses it. For each metric widget whose caption a user still needs to read, the copy '
    + 'lives in the widget\'s `description` and its localized values sit under the widget\'s '
    + '`description` entry for every locale the dropped strings covered — or the author has decided '
    + 'the card-header subtitle alone is enough.',
};
