---
'@objectstack/spec': minor
---

fix(spec)!: a `record:activity` feed whose `types` leaves out `comment` is refused while its comment composer is on

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #34534

<!-- adr-0087: registered record-activity-types-without-comment-beside-composer-refused -->

**BREAKING** for a page whose `record:activity` block (or the `feed` of a `record:chatter` / `record:discussion` block) authors a `types` list without `'comment'` while `showCommentInput` is not `false`. `types` is the allow-list of feed item kinds the feed shows, and `comment` is one of them, so on such a feed a comment posted through the composer was stored and then filtered out of the very feed it was posted to. The `record:activity` renderer already withholds the composer on such a feed; the contradiction is now refused where it is written.

What moves (each line FROM → TO):

- `RecordActivityProps` (`@objectstack/spec/ui`, the `record:activity` row of `ComponentPropsMap`) with `types` present, `'comment'` not in it, and `showCommentInput` absent or `true`: FROM parsed clean TO refused with one `custom` issue at `showCommentInput` (the composer the list rules out; `types` itself is not refused) whose message names both fixes. `os lint`, `os validate`, `os build` and the page authoring door report it at error as `component-props-invalid` at `properties.showCommentInput`.
- `RecordChatterProps.feed` (the same object, on `record:chatter` and `record:discussion`): the same, reported at `properties.feed.showCommentInput`.

The fix: add `'comment'` to `types` when the block should take comments, or set `showCommentInput: false` when it should stay comment-free. Which one is a judgement about the block, so nothing is converted (ADR-0087 D3, entry `record-activity-types-without-comment-beside-composer-refused`).

Unchanged: a feed with no `types` (every kind), a `types` that lists `'comment'`, and any `types` beside `showCommentInput: false`. Entries are still never judged against the built-in kinds. Matching is exact, as the renderers match, so `'Comment'` is not the comment kind. Measured first-party exposure: zero — no example app, platform page, skill or docs sample authors `types` on a feed.
