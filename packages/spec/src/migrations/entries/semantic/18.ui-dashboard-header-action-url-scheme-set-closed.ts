// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-dashboard-header-action-url-scheme-set-closed',
  surface: "a dashboard `header.actions[].actionUrl` whose `actionType` is `'url'` or omitted, "
    + "holding a target the console's action runner does not open: a scheme other than `http:`, "
    + '`https:` or `mailto:` (`javascript:`, `data:`, `tel:` and every other), `http:` or `https:` '
    + 'without the `//`, a protocol-relative `//host`, `/` followed by a backslash, a tab / line feed '
    + '/ carriage return anywhere, or a bare relative target with no leading `/` or `./` (the empty '
    + 'string included)',
  replacement: 'an `http://` or `https://` URL, a `mailto:` address, an in-app path that starts '
    + 'with `/` or `./`, or a template that opens with `${` — or, when the action was meant to run '
    + "a flow, a script, a page, an endpoint or a form, the `actionType` that says so (`'flow'`, "
    + "`'script'`, `'modal'`, `'api'`, `'form'`), which takes `actionUrl` out of the url route. "
    + '⛔ NOT mechanically convertible: a bare `forecast` may mean `/forecast`, `./forecast` or a '
    + 'flow named `forecast` with its `actionType` left out, and a `javascript:` or `tel:` button has '
    + 'no admitted equivalent — the author chooses',
  reason:
    'The key was a free string, so a url header action whose target the runner refuses parsed '
    + 'clean, published, and failed only at the click. The scheme set is stated once '
    + '(`navigation-target.ts`) and every door that hands the runner a navigation target now '
    + 'applies it. An omitted `actionType` is judged as the url route because both readers that '
    + "give it a meaning give it `'url'`. No measured producer writes a refused target: every "
    + 'header action outside tests in this repository and in objectui names an admitted url or '
    + 'declares a non-url `actionType` — so the entry is owed for targets authored outside them.',
  acceptanceCriteria:
    "Every dashboard header action whose `actionType` is `'url'` or omitted carries an `actionUrl` "
    + 'that opens with `http://`, `https://` or `mailto:` (case-insensitive), starts with `/` (not '
    + '`//`, not `/` followed by a backslash) or `./`, or opens with `${`; and none holds a tab, line '
    + 'feed or carriage return. Every admitted `actionUrl` parses byte-identically to before, and '
    + '`actionUrl` on every other `actionType` is untouched. `os validate` reports nothing at '
    + '`header.actions[].actionUrl` for any url header action in the stack.',
};
