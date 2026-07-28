---
"@objectstack/spec": minor
"@objectstack/cli": patch
---

fix(spec,cli): conversion deprecation notices reach the author, not just `os validate` (#3855)

The ADR-0087 D2 conversion layer rewrites an old-shape key to its canonical
spelling at load and emits a structured `ConversionNotice` for each rewrite. The
conversion being silent about *fixing* the shape is the point — zero consumer
action. Being silent about having **had** to is not: the notice is the one signal
that says *this spelling retires in protocol N, and your metadata stops loading
then*.

Two of the three surfaces that run the conversion pass discarded every notice:

| Surface | Before | After |
|---|---|---|
| `os validate` | passed a sink, printed them | unchanged |
| `os build` / `os compile` | **passed no sink — notices discarded** | prints them, and includes a `conversions` array in `--json` under the same key `os validate --json` uses |
| `defineStack` | **passed no sink — notices discarded** | warns on the console, once per distinct conversion site |

This is the #3782 parity class one layer down: not "does this command run the
gate" but "does it listen to what the gate says". Five conversions are live
today (protocol 11 and 15), so an author on any of those shapes was told by one
command and not the other two — and `defineStack` is where that author actually
is, since it runs inside their own config module.

`defineStack` surfaces notices in **both** strict and non-strict mode: the
conversion happens on the shared `normalizeStackInput` call before the strict
branch, and `strict: false` does not make the old shape any less retiring.

A new assertion in `validate-build-gate-parity.test.ts` fails if either command
calls `normalizeStackInput` without a sink, so the gap cannot silently reopen.

No behaviour change for a stack already on canonical shapes: nothing converts,
so nothing warns.
