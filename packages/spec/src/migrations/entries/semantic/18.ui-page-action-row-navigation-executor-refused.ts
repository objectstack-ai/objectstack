// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-page-action-row-navigation-executor-refused',
  surface: 'the executor key of a page action row holding `\'navigation\'` — `actionType: \'navigation\'` on an '
    + '`action:button` or `action:icon`, `type: \'navigation\'` on an `action:group` / `action:menu` member — the '
    + 'console action runner\'s local alias of `\'url\'`',
  replacement: '`\'url\'` — `actionType: \'url\'` on a node, `type: \'url\'` on a member — with the same `target` '
    + 'and `openIn`. The rename is lossless on a row: the runner sends both spellings to one navigator, and the '
    + 'alias\'s own keys (`to`, `redirect`, `external`, `newTab`, `replace`) are not row keys. The url executor\'s '
    + '`target` is then judged by the url scheme set (`ui-page-action-row-url-target-scheme-set-closed`).',
  reason:
    'The rows judged a url `target` only when the executor key read `\'url\'`, while the runner dispatches '
    + '`\'navigation\'` to the same navigator — so a row spelled with the alias carried a target the click refuses '
    + 'past the parse. The url executor now has one spelling on the rows, and the alias is refused at the executor '
    + 'key with the rename. The key otherwise stays open: a handler a host registers under another name '
    + '(`navigate_create`, `navigate_edit`, …) is still dispatched by name. A page\'s `properties` is not parsed on '
    + 'the metadata save or load path, so a stored row written with the alias keeps working only while the runner '
    + 'keeps it; `os validate`\'s props gate reports the alias as a `component-props-invalid` finding. The rename '
    + 'is lossless, so the D2 conversion `page-action-row-navigation-executor-to-url` performs it — retired from '
    + 'the load path, so an author meets the refusal while stored rows and `os migrate meta --write` are rewritten. '
    + 'What is left to judge is only whether the address the row opens is the one meant: after the rename its '
    + '`target` is judged by the url scheme set, and a refused target has no lossless rewrite '
    + '(`ui-page-action-row-url-target-scheme-set-closed`). The `element:button` inline action keeps its own '
    + 'declared fold of `type: \'navigation\'` onto `\'url\'`, which this entry does not touch.',
  acceptanceCriteria:
    'No `action:button` / `action:icon` `properties.actionType` and no `action:group` / `action:menu` member '
    + '`type` reads `\'navigation\'`; `os validate` reports no `component-props-invalid` finding at '
    + '`properties.actionType` or `properties.actions.N.type`, and each such row navigates to its `target` as '
    + 'before.',
  conversionIds: ['page-action-row-navigation-executor-to-url'],
};
