// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0049 enforce-or-remove; maintainer ruling 2026-10-12 (letter C: retire
// the view-level `api` data source, not align it to the page element's rule).
// The `provider: 'api'` arm of `ViewDataSchema` carried `read` / `write`
// request blocks of any `url` and any `headers`, so a credential or a
// cross-origin call written into a view was stored as metadata, served to
// every client that read the view and sent by the console as written. The
// page element's API binding is the one governed door for a metadata-declared
// API call (same-origin, credential-free, the console's own signed-in fetch);
// one operation with two implementations that behave differently keeps the
// governed one. No D2 conversion: the replacement lives on a different surface
// and the only mechanical edit — deleting the view's `data` — would silently
// change what the view shows, so an author or a stored row still carrying the
// arm is refused at parse with the prescription instead.
export const entry: SemanticMigration = {
  id: 'view-data-api-provider-retired',
  surface: "view.data (`provider: 'api'`, with its `read` / `write` request blocks) — the view-level API data source, "
    + "in a view and in the `data` prop of each page component that takes a view data source (`object-grid`, "
    + '`object-map`, `object-gantt`, `object-tree`, `list-view`)',
  replacement: "A view binds its object (`provider: 'object'`) or static rows (`provider: 'value'`), and so does a "
    + "page component's `data` prop; the API read "
    + "moves onto a page component's `dataSource` binding — `{ provider: 'api', read: { url }, path? }` under a "
    + "page's `regions[].components[]` — which is same-origin, carries no credentials and is read with the "
    + "console's signed-in fetch.",
  reason: 'There is no mechanical rewrite. The replacement is a binding on a different metadata type (a page '
    + "element, not a view), and the one edit a conversion could make — deleting the view's `data` so the "
    + 'view falls back to querying its bound object — would change what the view shows without telling '
    + 'anyone. So the parse refuses the arm by name with the prescription, for an authored source and for a '
    + 'stored row alike, and the author decides for each such view which page composes the endpoint it '
    + "read and what the view itself should now bind. The arm's `headers` block is the part with no "
    + "successor at all: a key an author had written there was a credential in metadata, and the page "
    + 'element binding refuses the key; the console sends its own signed-in fetch instead. A page component '
    + 'whose `data` prop is a view data source took the same arm through the same schema and has no mechanical '
    + 'move either: deleting its `data` would make it query its object instead.',
  acceptanceCriteria: "No view in `stack.views[]`, in any object's `listViews` / `formViews` map or in a stored "
    + "`sys_metadata` view row carries `data.provider: 'api'`, and no page component's `data` prop does; the "
    + 'view parse refuses one in a view, and the component-props gate refuses one in a page component, each with '
    + 'the prescription, at `os validate`, `os build` and `os lint` and at the metadata save door (its 422, '
    + 'nothing stored). '
    + "Every endpoint such a view read is either a page component's API binding on a same-origin path "
    + 'with no credential key, or dropped on purpose; and every converted view binds its object or static '
    + 'rows and loads. `os migrate meta --stored` lists each stored view, and each page component of a stored '
    + 'page, still bound to the API source as a TODO under this entry\'s id, before the upgrade and after it, '
    + 'by row and position, showing the request URL and method and withholding every other request key, and '
    + 'rewrites none of them.',
};
