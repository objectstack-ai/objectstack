// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'packages-list-pagination-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'api.listPackages limit and cursor — the two query parameters of '
    + 'GET /api/v1/packages declared by ListInstalledPackagesRequestSchema. The same entry '
    + 'covers the limit default: the request schema no longer declares default(50)',
  replacement:
    'the `status`, `type` and `enabled` filters — this route answers the whole installed set and has '
    + 'no page 2. There is no replacement for `cursor`, deliberately: nothing ever minted '
    + 'one, so no caller holds a value to carry over, and the response `nextCursor` it '
    + 'would have paired with was never emitted. Callers that looped on it were re-reading '
    + 'the first and only page. For the removed `limit` default, there is nothing to send '
    + 'instead and nothing to restore: the server has never capped this list, so a caller '
    + 'that omitted the key received every installed row before this change and receives '
    + 'every installed row after it. A client that sized a buffer to the declared 50 should '
    + 'size it to the installed set instead',
  reason:
    'One capability, both halves, never half-deleted (director seat, decision batch #126 '
    + 'item 1, maintainer 「同意」 2026-09-13, route 2 of three; routes 1 — build paging — '
    + 'and 3 — refuse unknown names — were considered and refused). `limit` and `cursor` '
    + 'were declared on the request and honoured on neither: the serving door filters on '
    + '`status`, `type` and `enabled` and then returns every remaining row, and no emit site has ever '
    + 'written the response half `nextCursor`. `limit` is the sharper of the two because '
    + "the repo's own ingress rule names it as the parameter whose silent drop is worst, "
    + 'and it is the silent-WIDENING half that was live: a caller asking for one row was '
    + 'handed the whole table alongside a `hasMore: false` that agreed with it. '
    + 'The `.default(50)` goes with the key because the FICTION WAS THE MECHANISM, not the '
    + 'number: nothing parses a query string through this schema, so the default has never '
    + 'stamped anything onto anything, while a reader of the published contract was '
    + 'entitled to believe an unparameterised list is capped. Re-spelling it as the real '
    + 'cap was not available — there is no cap. '
    + 'Pagination was removed rather than implemented because the installed-packages list '
    + 'is a small bounded collection and paging is not part of its meaning: route 1 would '
    + 'have grown a cursor protocol for a table of tens of rows, and the dispatch checked '
    + 'first whether a platform-wide cursor convention already existed that this door could '
    + 'have joined by reuse. It does not — no REST list door in the tree paginates, the one '
    + 'encode/decode cursor pair in the repo belongs to the storage-adapter list contract '
    + 'and is imported by no door, and the travel of this platform is the other way: '
    + '`data.query.cursor` (#4286) and `api/ListNotificationsRequest:cursor` (#6361) were '
    + 'both retired before this one, for the same reason. '
    + 'Route 2, and the bookkeeping splits exactly as #6361 did. There IS a tombstone: the '
    + 'schema is non-strict, so a bare deletion would have made Zod SILENTLY STRIP whatever '
    + "a generated client kept sending — a clean parse and a parameter that never takes "
    + "effect, which is this issue's own defect re-created one layer down (ADR-0104). So "
    + 'both keys are `retiredKey()`, typed `never` for tsc and raising the prescription at '
    + 'any parse, and both are registered in RETIRED_KEYS_BY_MAJOR[18]. There is NO D2 '
    + 'conversion: a conversion rewrites an authored source or a stored `sys_metadata` row, '
    + 'and this shape is HTTP-only — nobody authors a `ListInstalledPackagesRequest` and '
    + 'nothing persists one. There is no `acceptRetiredDefaultResidue` stage either, for '
    + 'the same reason one layer along: nothing ever parsed this schema, so the retired '
    + 'default materialized into no artifact and there is no residue to accept. '
    + 'The same card closes the divergence in the OTHER direction, which is not a migration '
    + 'for anyone and is recorded here only so the two are not read apart: `type` (list), '
    + '`version` (by-id) and `keepData` (uninstall) are query parameters the doors already '
    + 'executed and no request schema declared, and they are now declared where they are '
    + 'executed. No accept set moves — the doors served them before and serve them '
    + 'identically now. ADR-0049 / ADR-0087, #17667.',
  acceptanceCriteria:
    'No caller sends `limit` or `cursor` to `GET /api/v1/packages`: writing either on a '
    + '`ListInstalledPackagesRequest` is a `tsc` error (the input type is `never`), which '
    + 'is the enforced channel, and any value reaching a parse raises the prescription '
    + 'rather than a generic unrecognized-key issue. '
    + '⚠️ Behaviour on the wire is deliberately UNCHANGED and must be verified as such: a '
    + 'request still carrying `?limit=1&cursor=x` is IGNORED, not refused — the door reads '
    + 'named query keys and no route validates this query against a schema, so an unknown '
    + 'key has never produced a 400 and does not start doing so here. The declaration '
    + 'stopped promising what the wire never did; the wire did not change. `hasMore` stays '
    + 'the constant `false` it already was and is now true by construction rather than by '
    + 'coincidence — with no request-side way to ask for a page there can be no next one — '
    + 'and `nextCursor` stays absent. A caller that omitted `limit` receives every '
    + 'installed row, exactly as it did before.',
};
