// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-page-action-row-url-target-scheme-set-closed',
  surface: "the `target` of a page action row on the url executor — an `action:button` or "
    + "`action:icon` with `actionType: 'url'`, or an `action:group` / `action:menu` member with "
    + "`type: 'url'` — holding a target the console's action runner does not open: a scheme other "
    + 'than `http:`, `https:` or `mailto:` (`javascript:`, `data:`, `tel:` and every other), `http:` '
    + 'or `https:` without the `//`, a protocol-relative `//host`, `/` followed by a backslash, a tab '
    + '/ line feed / carriage return anywhere, or a bare relative target with no leading `/` or `./` '
    + '(the empty string included)',
  replacement: 'an `http://` or `https://` URL, a `mailto:` address, an in-app path that starts '
    + 'with `/` or `./`, or a template that opens with `${` (judged after interpolation, at the '
    + 'click). ⛔ NOT mechanically convertible: a bare `thanks` may mean `/thanks` or `./thanks`, '
    + '`//cdn.example.com/x` may mean `https:` or an in-app path, and a `tel:` or `javascript:` '
    + 'button has no admitted equivalent at all — the author chooses the address they meant, or '
    + "moves the work to a different executor (`actionType: 'script'`, `'flow'`, `'api'`)",
  reason:
    'The row forwards `target` to the runner as a free string, so a url row whose target the '
    + 'runner refuses was stored clean and failed only at the click. The scheme set is stated once '
    + '(`navigation-target.ts`) and every door that hands the runner a navigation target now '
    + "applies it; `os validate`'s props gate parses a page's `properties` against these same rows, "
    + 'so it reports the refusal at the row with the same text. No measured producer writes a '
    + 'refused target: every url-executor row target outside tests in this repository and in '
    + 'objectui is admitted — so the entry is owed for targets authored outside them.',
  acceptanceCriteria:
    "Every `action:button` / `action:icon` with `actionType: 'url'` and every `action:group` / "
    + "`action:menu` member with `type: 'url'` carries a `target` that opens with `http://`, "
    + '`https://` or `mailto:` (case-insensitive), starts with `/` (not `//`, not `/` followed by a '
    + 'backslash) or `./`, or opens with `${`; and none holds a tab, line feed or carriage return. '
    + 'Every admitted target parses byte-identically to before, and `target` on every other '
    + "executor is untouched. `os validate`'s props gate reports nothing at those rows' `target`.",
};
