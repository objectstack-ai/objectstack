// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-action-new-tab-url-path-refused',
  surface: '`action` documents (standalone, an object\'s `actions[]`, or a type-level action) '
    + 'whose `newTabUrl` does not start with `/` — an absolute `http(s)://` URL, or a relative '
    + 'path such as `sso-open/{recordId}`',
  replacement: 'for an endpoint on this backend, its path: `newTabUrl: \'/sso-open/{recordId}\'`; '
    + 'for an external page, drop `opensInNewTab` and `newTabUrl` and declare a `type: \'url\'` '
    + 'action instead — `target: \'https://example.com/export/${ctx.recordId}\'`, '
    + '`openIn: \'new-tab\'`. ⛔ NOT mechanically convertible, so this entry is a structured TODO '
    + 'and no conversion rewrites a stored row: an external URL names no path on this backend, '
    + 'and the url-action rewrite is not one spelling of the same action — it changes `type`, '
    + 'drops the action\'s own `target` / `body` (the handler the pre-opened-tab flow falls back '
    + 'to without `newTabUrl`) and replaces the backend endpoint that enforces auth with a page '
    + 'the browser opens directly. Which of the two the author meant is an intent no artifact '
    + 'records; the refusal names both and the author chooses',
  reason:
    'The console\'s zero-roundtrip fast path (`consoleServerAction.ts`) drives the pre-opened '
    + 'tab to the backend origin + `newTabUrl`, so an absolute value opened a tab at '
    + '`https://BACKEND/https://example.com/…`. The JSDoc called the key a path template while '
    + 'its describe and the form help called it a URL template, and nothing refused the absolute '
    + 'value, so AI-written metadata could carry it silently. The key exists for a same-backend '
    + 'endpoint that enforces auth itself (the `/sso-open` shape), so the accepted set is closed '
    + 'to values that start with `/` rather than widened to navigate URLs verbatim — a widening '
    + 'would let metadata open any origin from an action.',
  acceptanceCriteria:
    'Every `action` document\'s `newTabUrl`, when present, starts with `/`. A path template '
    + '(`/sso-open/{recordId}`, `/api/v1/invoice/{recordId}/pdf`) parses byte-identically to '
    + 'before. Any other value is refused at `newTabUrl` with a message naming the backend-path '
    + 'form and the `type: \'url\'` + `openIn: \'new-tab\'` action for an external page. A stored '
    + 'row holding such a value is converted by nothing: it loads unchanged and is still '
    + 'registered, counted `invalid` with a `[metadata_spec_invalid]` boot line, served with '
    + '`_diagnostics` locating `newTabUrl`, and its next save is refused 422 `INVALID_METADATA` '
    + 'until the author writes a path or rewrites it as a url action.',
};
