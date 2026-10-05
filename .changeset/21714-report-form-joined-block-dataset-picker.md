---
"@objectstack/spec": patch
---

`reportForm`: the "Joined blocks" repeater's `dataset` column now declares `widget: 'ref:dataset'` and `required: true`. Studio's report inspector draws a joined report's block `dataset` as the dataset picker, with the required marker, instead of a free-text cell with no marker.

Clause-②: no

- **Why.** A `joined` report refuses a block that binds no `dataset`, at `blocks.N.dataset`. The form offered that column as plain text and did not mark it, so a newly added block failed on save.
- **Which renderer honours it.** The pinned console registers `ref:dataset` in its widget registry. Its repeater takes each column's widget and `required` from the row spec, in both the grid and the card layout.
- ⛔ Only this one form row changes. No schema, parse, export or accept-set change: `JoinedReportBlockSchema.dataset` stays optional on the block shape, and the joined arm's refusal is unchanged.
