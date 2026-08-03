---
---

Docs-only: the `objectstack-data` skill's hook reference taught the pre-17
failure mode for an unevaluable `condition`.

`skills/objectstack-data/references/data-hooks.md` had been updated for #4770
(the condition reads the record, not the payload) and #4784 (`previous` is
bound), but its closing bullet still said an undeclared key leaves the condition
"logged at WARN and treated as false" — the behaviour #4775 replaced. An
unevaluable condition now **aborts the operation**.

This is the AI-authoring reference for hooks, so the stale sentence pointed the
wrong way on the one axis that matters: it told an author a typo is a soft
failure. It also silently downgraded the two bullets above it — `previous` is
unbound on inserts and on `multi: true` writes, and `has()` is not a null guard —
from "this breaks your write" to "this quietly disables your hook".

Replaced with a callout carrying the #4775 rule and the reason the two outcomes
had to split (a `before*` guard swallowed into `false` lets writes through; an
audit hook swallowed into `false` drops records — opposite failures), plus the
practical authoring consequence.

Swept the rest of `skills/` and `.claude/skills/` against the same rc.2 window;
nothing else was stale. `objectstack-automation` already documents #4343's
`script`-node retirements, `objectstack-query` already carries the #4286
`cursor` / `joins` / `windowFunctions` prescriptions, and
`objectstack-formula` already documents #4649 fail-closed predicates and #4763's
build-time `has()` rejection.

Releases nothing.
