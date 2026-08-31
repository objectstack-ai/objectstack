---
"@objectstack/lint": patch
---

refactor(lint): derive the runtime gate's name-keyed collection set instead of hand-listing it (#13390)

The set of collections the runtime publish gate carries in a per-write snapshot was
written down in five places, and `NAME_KEYED_STACK_KEYS` was the one with no guard of
any kind — `CONTEXT_STACK_KEYS` carries a `satisfies` clause, which is validity rather
than completeness, and the compiler held nothing else.

That list carries a real invariant: a collection the CONTEXT fills **and** that some
write type maps into must be name-keyed, or a finding's `path` is a positional index
into an in-memory snapshot the caller has never seen and cannot enumerate — the defect
#10064 fixed for `objects` / `permissions` / `books`. Omitting a member did not fail to
build, fail a test, or fail a gate; it produced correct-LOOKING findings with paths the
receiver cannot resolve. Adding the `pages` collection had to touch all five spellings
and only one of them announced itself.

`NAME_KEYED_STACK_KEYS` and the `TOP_LEVEL_INDEX` pattern built from it are now derived
from the two inputs that already state the answer: `CONTEXT_STACK_KEYS` intersected with
the values of `TYPE_TO_STACK_KEY`. The intersection was measured against the list it
replaces before anything changed — same four members (`objects`, `permissions`, `books`,
`pages`) in the same order, and `datasets` excluded on its own because no write type maps
into it, so no member needed a hand-written exception and none is kept.

Constructive preservation, not a tightening or a loosening: the derived pattern's `source`
is byte-identical to the literal it replaces, and the gate returns the same findings for
the same inputs. No published entry point changed — `@objectstack/lint` and
`@objectstack/lint/runtime` export exactly the names they did before.
