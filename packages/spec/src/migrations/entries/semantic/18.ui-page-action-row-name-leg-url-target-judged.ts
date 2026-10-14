// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-page-action-row-name-leg-url-target-judged',
  surface: 'the `target` of a page action row with no executor key (or an empty one) whose `name` is `\'url\'` or '
    + '`\'navigation\'` — an `action:button` or `action:icon` with no `actionType`, or an `action:group` / '
    + '`action:menu` member with no `type` — holding a target the console\'s action runner does not open: a scheme '
    + 'other than `http:`, `https:` or `mailto:` (`javascript:`, `data:`, `tel:` and every other), `http:` or '
    + '`https:` without the `//`, a protocol-relative `//host`, `/` followed by a backslash, a tab / line feed / '
    + 'carriage return anywhere, or a bare relative target with no leading `/` or `./` (the empty string included)',
  replacement: 'an `http://` or `https://` URL, a `mailto:` address, an in-app path that starts with `/` or `./`, or '
    + 'a template that opens with `${` (judged after interpolation, at the click) — the set a url row\'s `target` '
    + 'already takes (`ui-page-action-row-url-target-scheme-set-closed`). Or, for a row whose `name` merely happens '
    + 'to read `url` and that was meant to run something else, declare its executor (`actionType` on a node, '
    + '`type` on a member): a declared executor key outranks the `name` at the runner and here alike. ⛔ NOT '
    + 'mechanically convertible: which address a refused target meant, or which executor the row was meant to '
    + 'run, is the author\'s call.',
  reason:
    'The runner dispatches on `type || actionType || name`, and every row forwards its executor key as `type` '
    + 'beside its `name`, so a row with no executor key runs the handler its `name` names; `url` and `navigation` '
    + 'reach the url navigator. The rows judged `target` only when the executor KEY read `\'url\'`, so such a row '
    + 'carried a target the click refuses past the parse. The rows now judge `target` against the executor the '
    + 'runner runs, whichever key spelled it, with the one url-target grammar. `name` is not refused as an '
    + 'executor spelling: a row whose `name` names any other handler is untouched. A page\'s `properties` is not '
    + 'parsed on the metadata save or load path; `os validate`\'s props gate parses it against these same rows '
    + 'and reports the refusal at the row\'s `target`. No measured producer writes such a row: no page action row '
    + 'in this repository, in objectui or in hotcrm is named `url` or `navigation` — so the entry is owed for rows '
    + 'authored outside them.',
  acceptanceCriteria:
    'Every `action:button` / `action:icon` with no (or an empty) `actionType` and every `action:group` / '
    + '`action:menu` member with no (or an empty) `type` whose `name` is `\'url\'` or `\'navigation\'` carries a '
    + '`target` that opens with `http://`, `https://` or `mailto:` (case-insensitive), starts with `/` (not `//`, '
    + 'not `/` followed by a backslash) or `./`, or opens with `${`, and none holds a tab, line feed or carriage '
    + 'return — or declares its executor key. `os validate`\'s props gate reports nothing at those rows\' `target`, '
    + 'and every row whose `name` names another handler parses as before.',
};
