// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'notification-list-cursor-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell (see the note on `spec-type-alias-input-suffix-retired`).
  surface:
    'api.listNotifications cursor — the key on BOTH halves of GET /api/v1/notifications '
    + '(ListNotificationsRequestSchema and ListNotificationsResponseSchema) and the cursor '
    + 'argument of the client SDK call client.notifications.list(). The same entry covers '
    + 'the limit default: the request schema no longer declares default(20)',
  replacement:
    'a larger `limit` — the route answers the newest N notifications and has no page 2. '
    + 'There is no replacement for `cursor`, deliberately: nothing ever minted one, so no '
    + 'caller holds a value to carry over. Callers that looped on it were re-reading the '
    + 'first window and should read one window sized to what they display (the Console '
    + 'bell polls exactly this way). For the removed `limit` default, send the number you '
    + 'want explicitly if you were relying on 20 — omitting it takes the server window, '
    + 'which is 50 on the platform inbox and clamped into 1..200, and has been since '
    + 'before the declaration existed',
  reason:
    'One capability, both halves, never half-deleted (maintainer ruling 2026-08-07, '
    + 'Option A, ruled jointly with #6363). `cursor` was declared on the request and on '
    + 'the response and honoured on neither: the dispatcher domain reads `read` / `type` / '
    + '`limit` and nothing else, and no emit site has ever written the response key. It '
    + 'was worse than inert because it had a shipped PRODUCER — the SDK appended it to the '
    + 'query string — so a caller paginating by the published contract looped on page 1 '
    + 'forever, with no error and no 400. Measured over a real boot with 60 unread before '
    + 'the removal: page2 === page1, both parsing green against the response schema, which '
    + 'is why no conformance gate could see it. '
    + 'This is `data.query.cursor` (#4286, `query-cursor-retired`) one layer up, with the '
    + 'same verdict for the same reason, down to deleting the SDK producer alongside the '
    + 'key. A first-class inbox cursor, if one is ever designed, will be a '
    + 'response-minted opaque token — a different API — so keeping this one preserved a '
    + 'wrong design rather than a roadmap. '
    + 'The `limit` default goes with it because the FICTION WAS THE MECHANISM, not the '
    + 'number: no request path parses a query string through this schema (#3899 wired the '
    + "catalog's requestSchema to the real entry for BODIES only), so `.default(20)` never "
    + 'stamped anything onto anything, and the server has always applied its own 50. '
    + 'Re-spelling 20 as 50 — the other arm the ruling allowed — would have kept a '
    + 'declaration that does not execute and merely made it coincide with the '
    + 'implementation until someone moved the clamp; `.optional()` plus prose is true '
    + 'about both the schema and the server. No constraint (`.int()` / `.max(200)`) is '
    + 'declared either, because the service CLAMPS an out-of-range limit rather than '
    + 'refusing it, and declaring a rejection the wire does not perform is the same defect '
    + 'mirrored. '
    + 'Route 2, and the split is worth stating exactly because the two halves of the '
    + 'bookkeeping go different ways. There IS a tombstone: both schemas are non-strict, '
    + 'so a bare deletion would have made Zod SILENTLY STRIP whatever a caller kept '
    + 'sending — a clean parse and a parameter that never takes effect, which is this '
    + "issue's own defect re-created one layer down (#3733, ADR-0104). So `cursor` is "
    + '`retiredKey()` on both halves, typed `never` for tsc and raising the prescription '
    + 'at any parse, and both keys are registered in RETIRED_KEYS_BY_MAJOR[17]. There is '
    + 'NO D2 conversion: a conversion rewrites an authored source or a stored '
    + '`sys_metadata` row, and these two shapes are HTTP-only — nobody authors a '
    + '`ListNotificationsRequest` and nothing persists one. Request AND response shapes: '
    + 'two semantic TODOs for API callers, no stack conversion — the same disposition '
    + '`BatchOptions.validateOnly` (#4052) and the `AnalyticsQueryRequest` envelope keys '
    + 'already take in this major. The `limit` default is declared separately and '
    + 'mechanically, in DEFAULT_CHANGES_BY_MAJOR[17] (#4666), whose `from`/`to` '
    + 'fingerprints are re-derived on every build. ADR-0049 / ADR-0078, #6361.',
  acceptanceCriteria:
    'No caller sends `cursor` to `GET /api/v1/notifications` and no SDK call site passes '
    + 'it: `client.notifications.list({ cursor })` is a `tsc` error (TS2353, excess '
    + 'property), which is the enforced channel — the removal is loud at compile time for '
    + 'every TypeScript consumer. Reading `response.cursor` no longer type-checks either, '
    + 'and always answered `undefined` before. ⚠️ Behaviour on the wire is deliberately '
    + 'UNCHANGED and must be verified as such: a request still carrying `?cursor=…` is '
    + 'IGNORED, not refused — the domain reads three named query keys and no route '
    + 'validates this query against a schema, so an unknown key has never produced a 400 '
    + 'and does not start doing so here. The declaration stopped promising what the wire '
    + 'never did; the wire did not change. `unreadCount` is untouched (#6363) and still '
    + 'reports the total across the whole matching inbox rather than the window. A caller '
    + 'that omitted `limit` receives the same 50 rows it always received.',
};
