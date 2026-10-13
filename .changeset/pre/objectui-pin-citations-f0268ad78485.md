---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `f0268ad78485`.

Clause-②: no

Every anchor was mapped through the objectui diff `a58626c88dc8..f0268ad78485`, 1061 paths over 170 commits. Where a cited line moved with its text byte-identical, the record is re-pointed and its new hop sentence says by how much. Where objectui rewrote a cited line around the same read, the range is re-read and the hop sentence says so.

Three records said something that is false at the new pin, and only those sentences are rewritten:

- `element:repeater` reads the node-level `dataSource` binding first since objectui#11880 (objectui `aaba8655a`), with its flat `object` / `filter` / `sort` / `limit` keys as the fallback. The row's docblock said the binding was not read. It now states the precedence the renderer applies, and that a node naming its object only through `dataSource` renders while this row still requires `object`: that requirement can follow the renderer only by a schema change, which is objectstack#11509's.
- `action:button` now publishes `undoable` and hands the runner the record in scope as its Undo baseline (objectui#11168, objectui `f0496bdf1`). The row's docblock said the input stayed unpublished because the block wrote no row stash.
- `action:icon` reads `label` six times, not five: the tooltip of a predicate-disabled icon takes it as its heading (objectui#11839, objectui `cef0eeec0`).

The `FormField.span` describe changes its sha only: `WIDE_FIELD_TYPES`, the field-type alias table and `spanLadderFor` are byte-identical at the new pin. The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that first reproduced every `a58626c88dc8` number. The corpus is now 8234 tracked files. All 99 checked tokens still read zero, except `Span` / `SpanSchema`, which read 517 / 57: the eight new `Span` hits are each a `colSpan`.

No key, default, enum member or export moves.
