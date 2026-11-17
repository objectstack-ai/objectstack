---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a `record:chatter` or `record:discussion` whose `feed.types` leaves out `comment` no longer offers a comment composer whose posts it then hides

Clause-②: no
Metadata-protocol: none

`feed.types` is the list of feed item kinds the panel shows, and `comment` is one of them. A panel authored with a list that leaves it out, such as `feed: { types: ['task'] }`, filters every comment out of its feed, including a comment posted on that same panel. It still drew the "Leave a comment" composer and the "Comments only" filter, so a member's comment was saved and then never appeared. `record:activity` already withheld both for the same `types`; the two chatter blocks now follow the same rule.

Such a panel now draws no composer and no "Comments only" option. In development it logs one warning per block that names the block, its `feed.types` and the two fixes:

- to take comments on the panel, add `'comment'` to `feed.types`;
- to keep the panel activity-only, set `feed.showCommentInput: false`.

A panel with no `feed.types`, or with a `feed.types` that includes `'comment'`, is unchanged. `RecordChatterPanel` takes the answer as a new optional `commentsShown` prop and forwards it to its timeline; absent, it means `true`, so a host that composes the panel itself is unchanged.
