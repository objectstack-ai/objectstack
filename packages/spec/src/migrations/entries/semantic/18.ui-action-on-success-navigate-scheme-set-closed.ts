// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-action-on-success-navigate-scheme-set-closed',
  surface: "an action's `onSuccess.navigate` (the post-success hop of a `type: 'api'` or "
    + "`type: 'script'` action) holding a target the console's action runner does not open: a "
    + 'scheme other than `http:`, `https:` or `mailto:` (`javascript:`, `data:`, `tel:` and every '
    + 'other), `http:` or `https:` without the `//`, a protocol-relative `//host`, `/` followed by '
    + 'a backslash, a tab / line feed / carriage return anywhere, or a bare relative template with '
    + 'no leading `/` or `./` (`tasks/${result.id}`, the empty string included)',
  replacement: 'an `http://` or `https://` URL, a `mailto:` address, an in-app route that starts '
    + 'with `/` or `./` (`/apps/crm/tasks/${result.id}`), or a template that opens with `${` '
    + '(`${result.redirectUrl}`), which the runner judges after interpolation. ⛔ NOT mechanically '
    + 'convertible: `tasks/${result.id}` may mean `/tasks/…` or `./tasks/…`, and a `javascript:` '
    + 'hop has no admitted equivalent — the author chooses, or drops `onSuccess`',
  reason:
    'The key was a free string, so a post-success hop the runner refuses parsed clean, published, '
    + 'and failed silently after the action succeeded: the runner classifies the interpolated URL, '
    + 'warns, and navigates nowhere. The scheme set is stated once (`navigation-target.ts`) and '
    + 'every door that hands the runner a navigation target now applies it. No measured producer '
    + 'writes a refused value: the only `onSuccess.navigate` outside tests, in this repository and '
    + 'in objectui, is the documented in-app route template — so the entry is owed for hops '
    + 'authored outside them.',
  acceptanceCriteria:
    "Every action's `onSuccess.navigate` opens with `http://`, `https://` or `mailto:` "
    + '(case-insensitive), starts with `/` (not `//`, not `/` followed by a backslash) or `./`, or '
    + 'opens with `${`; and none holds a tab, line feed or carriage return. Every admitted value '
    + 'parses byte-identically to before. `os validate` reports nothing at `onSuccess.navigate` for '
    + 'any action in the stack.',
};
