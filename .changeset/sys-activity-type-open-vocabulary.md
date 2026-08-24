---
'@objectstack/plugin-audit': patch
---

Say out loud that `sys_activity.type` is an open, author-extensible vocabulary
— the declared options are the platform's **built-in** set, not a closed enum

An author reading the declaration learned "writing another value will be
rejected". That was false in three independent ways, and the declaration was
the only place that did not say so.

1. Every field on `sys_activity` is `readonly: true`, and `validateRecord`
   skips readonly fields on both write branches, so the `invalid_option` check
   a `select` normally implies **never runs** on this column.
2. ADR-0052 §5b.2 `activityMilestones[].type` is `z.string().optional()` in
   the spec and is forwarded verbatim by the audit writer
   (`if (milestone.type) activityType = milestone.type`) — a shipped,
   documented, author-facing channel straight into the column.
3. An app's own server-side action writes the column directly
   (`ctx.api.object('sys_activity').insert({ type: … })`); no grep of this
   repository can see those sites.

Maintainer ruling, 2026-08-24 (#11507, direction 4 of four): the column **is**
an open vocabulary, ADR-0052 §5b.2 **stays** a sanctioned write path, and
every closed map over this vocabulary is now the bug. The status quo was the
one option more dangerous than either end state — most of all to an AI writing
metadata, which reads the declaration and believes it.

So the declaration now carries the semantics, in the field's own
`description` — the slot the spec declares for exactly this and, unlike a
source comment, one the contract carries wherever the metadata goes (the
metadata API, the i18n bundles, whatever an author or an AI reads about this
field). No new schema concept was invented: `FieldSchema` has no
open/closed-vocabulary key, and the pin measures that rather than asserting
it, so the day `packages/spec` grows one this declaration is told to move.

Nothing about enforcement changed — that was direction 3 and it was **not**
ruled. `validateRecord` is untouched, the built-in set is unchanged (twelve
values), and both existing vocabulary tests keep every assertion they had.
What changed in them is what a red MEANS: the two cases that used to be filed
as "a defect, characterized — delete these when enforcement lands" now measure
a ruled contract, and say that rejecting an author-contributed value is a
contract change to re-open #11507 over, not a fix to adapt them to.
