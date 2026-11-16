---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a `record:activity` whose `types` leaves out `comment` no longer offers a comment composer whose posts it then hides

Clause-②: no
Metadata-protocol: none

`types` is the list of feed item kinds the block shows, and `comment` is one of them. A block authored with a list that leaves it out, such as `types: ['task']`, filters every comment out of its feed, including a comment posted on that same block. It still drew the "Leave a comment" composer and the "Comments only" filter, so a member's comment was saved and then never appeared.

Such a block now draws no composer and no "Comments only" option. In development it logs one warning per block that names the block, its `types` and the two fixes:

- to take comments on the block, add `'comment'` to `types`;
- to keep the block activity-only, set `showCommentInput: false`.

A block with no `types`, or with a `types` that includes `'comment'`, is unchanged.
