/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

/**
 * Whether the record PAGE draws a `DetailView`'s provenance footer for it
 * (objectui#12307).
 *
 * A record page shows ONE record, so its `RecordMetaFooter` is the page's and
 * is drawn once, by the page host (app-shell's `RecordDetailView`, and the
 * Studio `PagePreview` that mirrors it), whatever the number of
 * `record:details` nodes the page carries. Before this, every `DetailView`
 * mounted its own: a page with two `record:details` nodes printed the same
 * line twice, and a node whose sections were all hidden drew a block holding
 * nothing but that line.
 *
 * `record:details` provides `true` around the one `DetailView` it mounts when
 * the node reads the page's record, i.e. when it carries no `dataSource`
 * binding (`renderers/record-details.tsx`). Everything else reads the default,
 * `false`, and keeps its footer:
 *
 *  - a standalone `DetailView` (the `detail-view` node, the record drawer and
 *    overlay panel, a direct React caller) has no page to draw it for it;
 *  - a BOUND `record:details` shows the first row of its own query, a record
 *    the page does not show, so the page's footer is not that record's.
 *
 * ⛔ Module-internal on purpose: not re-exported from the package barrel, and
 * neither a `DetailView` prop nor a `DetailViewSchema` key. Where the footer
 * sits is the renderer's placement, not something a page authors (the triage
 * on objectui#12307 ruled out a prop and a spec key for it). It lives in its
 * own module, not in `DetailView.tsx`, so that file keeps exporting
 * components only.
 */
export const RecordPageProvenanceContext = React.createContext<boolean>(false);
