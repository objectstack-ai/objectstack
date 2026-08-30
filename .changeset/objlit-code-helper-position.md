---
"@objectstack/runtime": patch
---

fix(scripts,runtime): the code-helper stamp shape reaches the OBJECT-LITERAL position (#13233)

`check:dispatcher-error-vocabulary`'s `codehelper` shape was anchored on an
assignment — `.code = ident` — so the equally ordinary helper that builds an
object literal was invisible to it:

```ts
function postureError(code: string, message: string) {
  return { severity: 'error', code, message };   // <- nothing matched
}
```

No pattern in that gate or in `check:error-code-casing` fired there. `objlit`
needs a quote, `objlitconst` needs a SCREAMING_SNAKE identifier (the
conventional parameter name is `code`), `objlittemplate` needs backticks. So
there was no site **and** no unresolved entry — the one way the gate's own
"reported, never dropped" bound can fail without anything saying so. The new
`objlithelper` shape closes it, guarded structurally twice over: the innermost
enclosing bracket at the `code` token must be a `{` (which is what separates an
object literal from the argument list `f(a, code, b)` and the array
`[a, code]`), and the identifier must be a parameter of the enclosing
declaration. Together with the class-method declaration form, the live instance
that motivated the enquiry — `Parser#error` in `@objectstack/sdui-parser` — is
now reached.

Measured on `packages/**` non-test source, through the gate's own derivation
rather than a separate instrument: **13 helpers · 117 newly reached in-file call
sites · 29 new verdict rows · 5 helpers that reduce to nothing · 0 unregistered
wire codes hiding**. All 29 rows are one genre — ADR-0114 D2 `FieldErrorCode`
members stamped by four validation helpers whose `code` parameter is *typed* to
that closed enum, landing at `ApiError.details.fields[].code` and never at
`error.code` (ADR-0112 D6). They are declared `foreign-vocabulary`.

`@objectstack/runtime` carries the declaration half. `UNREGISTERED_CODE_SITES`
gains those 29 rows, and a second declared list `UNRESOLVED_CODE_HELPERS`
classifies the five helpers the scan can see but cannot read. That list is the
answer to the blocker this change had to clear: an `unresolved` entry is pushed
unconditionally and no row discharged it, so every one of the five would have
been a **red gate with no verdict available**. A `reason: 'helper'` entry is now
dischargeable by a row carrying a door, a verdict and its evidence, reconciled
in both directions like any site row. The restriction is the argument: every
other unresolved reason names a remedy the author can carry out ("resolve the
constant", "spell it `const`"), and a row there would buy an exemption from
work that is possible — a helper whose callers live in another package, pass a
vocabulary declared out of the gate's population, or pass a genuine runtime
value has no such remedy.

Internal to the package (`dispatcher-error-vocabulary.ts` is not re-exported
from the package index), so no published surface changes and no runtime
behaviour moves — the gate's population does.

⚠️ Recorded rather than smoothed over: this position's precision is measurably
lower than the assignment position's. `.code = ident` needs a property named
`code` on a value being mutated; `{ code }` is how any record carries any field
called `code`. Two of the thirteen helpers reached carry no error code at all —
an SMS one-time password and a YAML fence body — and no sibling-key test
separates them (the obvious candidate, requiring a `message` sibling, drops 25
of the 29 rows with them). Both are classified rather than filtered out.
