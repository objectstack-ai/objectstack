---
---

Test-only: a structural wiring guard so the drift #4394 just fixed cannot come
back silently (#4384).

#4394 removed the *instance* — `validateReadonlyFlowWrites` had been hand-wired
into `os validate` and `os compile` and never into `os lint`, so an `error`-level
gate left `os lint` passing stacks `os compile` refuses. It did not remove the
*failure mode*: nothing stops the next rule from being wired into two commands
out of three, and that defect produces no failing assertion anywhere — each
command's tests pass, the rule's unit tests pass, and the only symptom is the
three commands disagreeing about one stack. That is how the last one survived
from #3425 until #4394.

`reference-integrity-wiring.test.ts` asserts each of the three commands calls
`validateReferenceIntegrity`, and that none of them imports a suite member
directly — the import being what a second call site starts with. It scans source
rather than spying, for the reason `lazy-deps.test.ts` does: vitest inlines
imports, so a module-cache probe cannot prove which symbols a command file
actually reaches for. Verified to FAIL on a reintroduced direct import, not
merely to pass today.

Releases nothing.
