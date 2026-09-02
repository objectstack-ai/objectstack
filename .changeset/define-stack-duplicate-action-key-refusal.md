---
'@objectstack/spec': minor
---

`defineStack` now refuses two actions that resolve to the same scope-qualified runtime key — **BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes.

The runtime registers and dispatches every action under one exact-string key: the owning object's name (or `global` for an object-less action), a colon, then the action name — with no wildcard semantics. Two declarations under one key collapse to one handler registration: whichever registers second wins, and the other action stays a live, declared, permission-gated button whose handler is unreachable. Nothing at author, build or boot time said so, and the loser failed only when a user clicked it. Every same-scope shape built clean before: two standalone globals sharing a name, two standalone actions bound to the same object, a bound standalone beside an embedded twin on the same object (the merge into the object's `actions` appends, so both survived), and two embedded twins on one object.

The refusal joins `defineStack`'s cross-reference walk and its existing envelope (`defineStack cross-reference validation failed (N issue(s)):`), one line per colliding key, naming the key and where each declaration was written (`stack.actions[i]`, or `objects['OBJECT'].actions[j]` for an embedded one). It runs in an object-less stack too. The fix is the one the message names: rename one of the two within that scope, or bind one to a different object.

Deliberately unchanged: one global and one object-bound action MAY still share a `name`. They occupy two distinct keys, and the precedence the runtime already implements for by-name readers on the object's route (the object's own `actions` first) is now documented on the `actions` collection rather than altered.

<!-- adr-0087: not-required (no-migration-prescription) the refusal message names the fix (rename one of the colliding declarations within its scope, or rebind it), and nothing is renamed or removed — no authorable key changes spelling and no export moves, so the ledger has no rewrite to carry. -->
