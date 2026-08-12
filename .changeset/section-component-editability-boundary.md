---
"@objectstack/spec": patch
---

docs(spec): a form section / page component gates visibility only — say so, and tell `disabled` where it belongs (#7887)

`FormSectionSchema` and `PageComponentSchema` declare no `disabled`, `readonly`
or `readonlyWhen` slot. Writing one has always been a loud parse error, but a
**bare** one: the message named the offending key and offered nothing, because
there is nothing on those shapes to point a rename at. An author — increasingly
an AI one — had no way to tell "this key is mis-spelled" from "this key belongs
somewhere else entirely".

It is the second. Ruled a **boundary, not a gap** (maintainer, 2026-08-12):
sections and page components gate *visibility*; **editability lives on fields**.
Neither shape has read-only semantics of its own for anything to enforce, so a
slot here would be declared-but-unenforced from the day it landed — the ADR-0049
class this repo is retiring elsewhere.

So no key was added and no alias row was registered. What changed is the
sentence the rejection carries. `disabled`, `disabledWhen`, `readonly`,
`readOnly`, `readonlyWhen` and `editable` on either shape now answer with the
boundary and the destination:

> Editability is a FIELD-level concern. This shape gates VISIBILITY only — a
> deliberate boundary, not a missing key (#7887): a section / page component has
> no read-only semantics of its own to enforce. Write `readonly: true` (or the
> conditional `readonlyWhen` predicate) on the form field(s) inside it instead;
> to hide the whole section or component, use `visibleWhen`.

It points at **`readonlyWhen`** and never at `disabledWhen`, which exists on no
field surface: `field.zod.ts` renames `disabled` to `readonly` for exactly that
reason.

**Acceptance is unchanged, in both directions.** Every metadata document that
parsed before parses identically, and every key rejected before is still
rejected — a guidance string is not an accepted key, and the pins assert both.

**The prescription is filed on those two shapes, not on the table they share.**
`VISIBILITY_STRICT_OPTIONS` has a third consumer, `FormFieldSchema`, which is
the one view/page shape that *does* answer `disabled` — through its own
`disabled → readonly` rename. A guidance set consumes a key before the rename
channel is ever consulted, so filing this family in the shared table would have
replaced the family's one correct pointer with a redirect away from it. Section
and component take a new `VISIBILITY_ONLY_STRICT_OPTIONS`; the field shape keeps
the bare options and its message is byte-for-byte what it was.
