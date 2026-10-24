---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint)!: a page or view `visibleWhen` that hands `has()` an argument other than a field selection is refused at publish

Clause-②: no (narrowing)

Metadata-protocol: narrowed

<!-- adr-0087: registered visibility-predicate-has-argument-refused -->

**BREAKING** (what an author can declare narrows), shipped as `minor` under the launch-window convention for breaking changes.

CEL defines `has()` in one form, `has(e.f)`, with `f` a field name after a dot. The engine refuses any other argument as `has() invalid argument` on every evaluation, whatever the record holds. Every other predicate surface already refused it through `validateExpression`. The page and view `visibleWhen` door did not, so `has(status)` and `has(record.items[0])` published clean, and the console, which renders a faulting predicate as visible, drew the guarded element for every user.

- **FROM:** a `visibleWhen` on a page component, a form view section or a section field could hand `has()` a name alone (`has(status)`), an index as the last step (`has(record.items[0])`), or any other argument that is not a field selection (`has(record.?a)`, `has(upper(record.x))`, a literal, an operator), and `os validate`, `os build`, `os lint` and the page and view save doors accepted it.
- **TO:** each is refused as `visibility-predicate-has-argument`, an error, at those doors (the save doors answer `422 INVALID_METADATA`). The finding quotes the argument and the engine's wording, and its hint names the spelling to write. `os explain visibility-predicate-has-argument` says why.
- **Unchanged:** `has(e.f)` for any `e`, including a selection over an indexed or called receiver (`has(record.items[0].name)`); every other predicate, and nothing about the types that flow through one is judged. A `has(status) && status == 'x'` keeps its `visibility-bare-identifier` finding on the unguarded `status`, beside the new one. A stored page or view row in the refused shape still loads and is served; its next save is refused, and `os migrate meta --stored` lists each such predicate under `visibility-predicate-has-argument-refused`.
- **The fix for an author:** write `has(record.status)` or `'status' in record` for a field (`data` instead of `record` on a metadata-editing form), and `size(record.items) > 0` to ask whether a list has a first element (`'k' in e` for a bracketed string key).
