// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #34383 — a feed `types` allow-list that leaves out 'comment' while the comment
// composer is on (`showCommentInput` not false) is refused where it is written.
// The renderer half (#34388) already withholds the composer on such a
// `record:activity`; this is the authoring half. Not converted: whether the
// block should take comments or stay comment-free is the author's call, and
// the two fixes render differently.
export const entry: SemanticMigration = {
  id: 'record-activity-types-without-comment-beside-composer-refused',
  surface:
    'pages[].…components[] of type record:activity (its properties), and the properties.feed of a record:chatter or '
    + 'record:discussion component, loaded by os lint / os validate / os build or saved through the page authoring '
    + 'door: a `types` list that does not contain \'comment\' while `showCommentInput` is not false (absent '
    + 'showCommentInput defaults to true)',
  replacement:
    'Add \'comment\' to `types` when the block should take comments, or set `showCommentInput: false` when it should '
    + 'stay comment-free. Omitting `types` (every feed item kind) is unaffected. Refused at error as '
    + '`component-props-invalid` at properties.showCommentInput (properties.feed.showCommentInput on record:chatter / '
    + 'record:discussion), the composer the list rules out.',
  reason:
    '`types` is the allow-list of feed item kinds the feed shows, and `comment` is one of them; both renderers of '
    + 'this shape filter their rows by it. With \'comment\' left out and the composer on, a comment posted through '
    + 'the composer was stored and then filtered out of the very feed it was posted to, so the member read it as a '
    + 'lost post (measured producer: the HotCRM lead_detail page, `lead_activity` with `types: [\'task\']`). The '
    + 'record:activity renderer now withholds the composer on such a feed; the spec refuses the contradiction where '
    + 'it is written instead of letting the screen quietly correct it. There is no mechanical rewrite: which of '
    + 'the two fixes the author meant is a judgement about the block.',
  acceptanceCriteria:
    'Load every page (`os validate` or `os build`): no `component-props-invalid` finding at '
    + 'components[N].properties.showCommentInput or properties.feed.showCommentInput naming \'comment\'. '
    + 'Each record:activity block and record:chatter / record:discussion feed either omits `types`, lists '
    + '\'comment\' in it, or sets '
    + '`showCommentInput: false`.',
};
