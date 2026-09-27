// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20186, route C-prime (seat answers 5855433719 / 5855548706). A write-time
// re-routing of the flattened view overlays: each member judges only the
// `viewKind` it names. The stored rows it newly refuses are read and served
// exactly as before and fail only on their next save, which is why this is a
// semantic entry and not a conversion — which value a refused key meant is a
// fact only its author holds.
export const entry: SemanticMigration = {
  id: 'view-overlay-judged-by-viewkind-arm',
  surface:
    'A flattened `view` overlay saved through the metadata write door (`PUT /api/v1/meta/view/:name`, the '
    + 'Studio / MCP save) whose `viewKind` names one family while the body was judged by the other: a '
    + 'column-less `viewKind: "list"` body, which only the form overlay member used to accept (its list keys '
    + '`sort`, `searchableFields`, `timeline`, `sharing` and the rest stripped unread), and a `viewKind: "form"` '
    + 'body carrying list `columns`, which only the list overlay member used to accept.',
  replacement:
    'Each overlay is judged by the member its `viewKind` names. A column-less list overlay is a patch on the '
    + 'view it shadows and carries list keys the list view schema accepts: a `sort` array of `{ field, order }` '
    + '(the bare string clause was retired in 17.5.0), no `timeline.metaFields` (the timeline block has no such '
    + 'key), an array `searchableFields`, and the list `sharing` block (`{ type, lockedBy }`), not the form '
    + 'public-link block. A column-less list overlay names no `type`; one that does is a full inline config and '
    + 'lists its `columns`. A form overlay\'s `columns` is its body-column count (an integer); a field list '
    + 'means the body is a list view (`viewKind: "list"`) or belongs in `sections: [{ fields }]`.',
  reason:
    'Both overlay members shared one `viewKind: list | form` enum. The list member required `columns`, so it '
    + 'refused the column-less list patch the console writes on every toolbar save (the ruled patch-only '
    + 'storage shape, maintainer ruling: 「`persistViewPatch` 只存 patch,不存 merged base」); the '
    + 'union then tried the form member, which requires no list key and strips every one, and accepted it — '
    + 'so a retired `sort` string or a `timeline.metaFields` the list schema refuses by name was saved with '
    + '`success: true` and stored as sent. Measured on `origin/main` @ `4df101c3` and again at `ce70876e` '
    + '(after the `options`-bag door landed) through the real save. Ruled route C-prime: each member admits one `viewKind`, the list '
    + 'member judges a column-less patch (`columns` optional there only; the authoring list view keeps it '
    + 'required), and a column-less body that names a `type` stays refused at `columns`. Not convertible: '
    + 'whether a refused value was a typo or a stale capability is the author\'s call.',
  acceptanceCriteria:
    'Every stored flattened `view` overlay saves again unchanged. A row that does not is refused '
    + '`422 INVALID_METADATA` on its next save, with the issue located at the refused key (`sort`, `timeline`, '
    + '`searchableFields`, `sharing`, `columns`) and carrying that key\'s own message — for a column-less list '
    + 'overlay naming a `type`, the prescription at `columns`; for a field list on a form overlay, the '
    + 'body-column-count prescription at `columns`. Nothing is rewritten on read and nothing is refused on '
    + 'read: a row that fails is served exactly as stored until it is saved. Verify by re-saving each stored '
    + 'flattened overlay (a GET then a PUT of the same body) and reading a `200`.',
};
