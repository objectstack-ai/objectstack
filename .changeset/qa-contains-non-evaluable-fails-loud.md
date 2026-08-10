---
"@objectstack/core": minor
---

fix(core): the QA `contains` assertion fails loudly instead of silently passing on a non-array/non-string actual (#7256)

`TestRunner.assert`'s `case 'contains':` handled the two shapes it can evaluate —
an array (membership) and a string (substring) — and had **no `else`**. Every
other shape fell straight out of the switch throwing nothing, so the assertion
reported **PASSED**. A scenario asserting
`{ field: "body.data.items", operator: "contains", expectedValue: "acme" }`
against a response that has no `body.data.items` at all reported ✅. The
overwhelmingly common way to reach that branch is the one that matters most: a
typo'd `field` path, or a response shape that moved under a suite nobody
re-read. The assertion that was supposed to *be* the test is the thing that
silently disappears, and CI believes the green.

`contains` was the only path in this engine that could decide "no comparison
applies here" and report success. Every other unhandled shape already fails
loud — an operator with no branch throws `Unknown assertion operator`, an action
type with no adapter branch throws `Unsupported action type in HttpAdapter`,
and `equals`/`not_equals`/`is_null`/`not_null` all compare unconditionally. This
closes the asymmetry rather than adding a new posture: an assertion the engine
**cannot evaluate** is a **failed** assertion.

The message is written for the author who has to act on it, so it names the
field, the operator and the runtime type of what the path actually resolved to
(`null` and arrays get their own names, not `typeof`'s `object`), and then says
which of the two things is wrong:

```
Assertion failed: body.data.items cannot be evaluated by 'contains' — expected an
array or a string at that path, got undefined. The path resolved to nothing — the
field is absent from the result, or the path is misspelled. Use 'is_null' if
asserting absence is what you meant.
```

`undefined`/`null` point at the **fixture** (the path did not resolve, so the
field path or the response shape it was written against is the suspect);
a number, boolean or object points at the **assertion** (the path resolved
fine and `contains` is the wrong operator for what it found).

**Behaviour change, and its measured blast radius.** Suites that today pass a
`contains` against a non-array/non-string will start failing — which is the
point; each such assertion was asserting nothing. The in-tree radius was
measured on the loud build and is **zero**: `os test` is the runner's only
consumer, and the repository contains no Quality Protocol suite documents at
all (no `qa/*.test.json` anywhere; the three example apps run `vitest`, and
`packages/qa/*` are vitest suites that never touch `TestRunner`). No CI workflow
invokes `os test`. So no in-repo case was passing vacuously and none needed
repair. Downstream suites are the ones that will see red, and every case they
see is a test that was never running.

The two evaluable shapes are untouched in both directions: a matching array or
string still passes, a non-matching one still fails with its existing message.
`not_contains`, `gt`, `gte`, `lt`, `lte` and `error` are declared in
`TestAssertionTypeSchema` and still have no branch in the runner — they were
already refused loudly at `default:` rather than silently passed, so they do not
carry this defect; that gap is recorded separately and is pinned here so a later
implementation is a deliberate change rather than an accident.
