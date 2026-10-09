---
'@objectstack/spec': patch
---

A `{{ }}` hole in a flow text slot — a `notify` node's `title` and `message`, a `screen` node's `title` and `description`, a refusing `end` node's `message` — whose root is a `$` name the flow engine does not bind is refused, at the same doors and by the same judge (`textSlotTemplateRefusal`) as a single-brace token: the node contracts, `registerFlow` and `objectstack validate`. Such a hole compiled and rendered a blank fragment with the run reporting success — `'By {{ $User.Id }}'` sent `'By '` — while its single-brace spelling `'By {$User.Id}'` was already refused with a remedy.

Clause-②: no

**The remedy.** `{{ $User.<path> }}` gets the sentence `{$User.<path>}` gets: compute the value into a variable with an `assignment` node, whose value slot still reads that spelling, then write the variable as a hole. Any other `$` root is named in the refusal beside the variables the engine does bind — `$record`, `$runId`, `$flowName`, `$flowLabel`, `$error`, and a flat-graph `loop`'s `$loopItems` / `$loopIndex` — which stay admitted. The `$` names are reserved for the engine, so a variable a flow binds itself (a declared variable, an `assignment` target, an `outputVariable`, a `try_catch` `errorVariable`) is read in a hole when named without the `$`.

| you wrote | write instead |
|:--|:--|
| `message: 'By {{ $User.Id }}'` | an `assignment` node first — `assignments: { by: '{$User.Id}' }` — then `message: 'By {{ by }}'` |
| `errorVariable: '$caught'` with `message: 'Failed: {{ $caught.message }}'` | `errorVariable: 'caught'` with `'Failed: {{ caught.message }}'`, or keep the default `$error` and write `{{ $error.message }}` |

A single-brace path token over such a root (`'Failed: {$caught.message}'`) is no longer prescribed the `{{ }}` spelling, which would be refused in turn; it gets the same remedy. `{{ $error.message }}`, `{{ record.name }}` and every other hole are unchanged, and the template engine binds no new variable.

**Who is affected, measured.** The acceptance this tightens arrived with the text slots' `{{ }}` delimiter on the same protocol-18 line and has not been released. `git grep` over `examples`, `packages`, `skills`, `apps` and `content` finds no flow text slot outside tests carrying a `{{ $… }}` hole other than `{{ $error.… }}`.
