---
"@objectstack/lint": minor
---

feat(lint): refuse a path-shaped right-hand side in a metadata-form predicate (#7659)

The metadata-editing form renderer supports a declared subset of predicate
expressions in which the RIGHT side of `==` / `!=` is a **literal**, never a
resolved path. Only the left side resolves; the right side goes to a literal
parser whose tail hands back anything it does not recognise verbatim. So
`data.a == data.b` compares `data.a`'s value against the seven-character
**string** `"data.b"` — false however equal the two sides are, and
`data.a != data.b` correspondingly true. An `==` predicate written that way
hides the element on every row, and nothing says why.

Nothing at the publish door could see it. #7010's `predicate-path-unresolved`
asks whether a path RESOLVES; `data.a == data.b` answers yes twice and walks
through. The renderer's own diagnostic (objectui#4049) is dev-mode only and
fires at render time — after the metadata is stored — so an AI author or a CI
pipeline publishing forms never sees it.

**New rule — `predicate-rhs-path-shaped`**, a sibling of the two path-resolution
rules in `validate-predicate-path-refs.ts`, exported from the package root and
run by `os build` / `os lint` / `os validate` and at the runtime `view` publish
gate. It reports a `==` / `!=` right-hand side that is an unquoted identifier
chain, using the same grammar the renderer warns on
(`/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/`) — one grammar,
two enforcement points. The message names both sanctioned spellings: quote the
literal, or restructure so the path is on the left and a literal on the right.

**Two severities, on one id:**

- **`error` for a dotted chain** (`data.a == data.b`, or the same with the sides
  swapped). Nobody writes a dotted identifier chain meaning the literal text of
  it, so there is no reading under which this worked — the same bar
  `predicate-path-unresolved` already gates on.
- **`warning` for a bare single word** (`status == active`). This one *works*
  today: it compares against the literal string `"active"`, which is very likely
  what the author meant, and the renderer's ruling preserved that deliberately.
  It is outside the declared subset all the same and stops working when this
  surface moves to the real CEL evaluator, so it is reported — but refusing a
  `view` write over metadata that renders correctly would be a false build error.

Measured over the shipped `METADATA_FORM_REGISTRY` (17 forms, 46 predicates):
**0** findings at either severity, with reverse verification (rewriting each
`== 'literal'` into `== data.__rhs__` reports all 45 comparisons).

Deliberately unchanged: the two path-resolution rules. A predicate that is both
unresolvable and path-shaped on the right reports twice — both statements are
true and their fixes differ. `in`'s array parse is a distinct defect
(objectui#4266) and is not folded in.
