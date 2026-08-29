---
"@objectstack/spec": patch
---

The select-option editability refusal no longer prints a bare internal issue id.

Writing `disabled` / `readonly` / `editable` (or their `*When` forms) on a select
option is refused with a prescription explaining that editability is not a
per-option concern. That sentence carried a tracker id an author outside this
repository cannot resolve. It is gone; the citation keeps its durable half —
ADR-0049 and ADR-0068 are named in the same sentence — and the verdict, the
vocabulary and the rest of the wording are unchanged.
