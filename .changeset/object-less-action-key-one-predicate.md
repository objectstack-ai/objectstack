---
"@objectstack/runtime": patch
---

fix(runtime): route the flow param seeder through the single object-less predicate (#14864)

`isObjectLessActionKey` (`@objectstack/objectql`) is the canonical answer to
"is this routed object the object-less placeholder": the canonical
`GLOBAL_ACTION_OBJECT_KEY`, the legacy `'*'`, or nothing at all.
`dispatchFlowAction` asks it directly when it decides whether to hand the
automation service an `object` at all — and then, three lines later, handed the
same `objectName` to `seedFlowActionParams`, which answered the same question
with a second, narrower comparison of its own (`objectName !==
GLOBAL_ACTION_OBJECT_KEY`).

The two parted on exactly one input, `'*'`. A request routed at the legacy
wildcard — `POST /actions/*/<action>/<id>`, which resolves today because
`actionHandlerObjectKeys` deliberately probes `'*'` last so a handler user code
registered against it still resolves — was object-less to the automation
envelope (no `object` sent) and object-BOUND to the params bag, which seeded a
nonsense `'*Id'` key beside `recordId`. Same dispatch, two answers.

The empty-string half was never part of the divergence: the `objectName &&`
truthiness leg of the old guard already covered it, and `undefined` with it.
`'*'` was the whole of it.

**Direction.** The guard is widened onto the shared predicate rather than
`isObjectLessActionKey` being narrowed. `'*'` is *unused today*, not *dead*:
nothing first-party registers under it, but it is a deliberately-honoured
legacy read path with its own docblock, reachable through the public
`engine.registerAction(objectName, …)` surface that user code calls. Retiring
it is a compatibility decision about someone else's package, not a tidy-up this
fix is entitled to make.

**Coverage.** Both functions this touches were ablated repo-wide first rather
than grepped, because a grep scoped to the file you expect a pin in cannot see
a pin living elsewhere:

- `seedFlowActionParams` gutted → 5 tests red. It was pinned all along,
  indirectly, through the REST route — but every case there routes at a real
  object, so the object-LESS leg, where the two predicates actually disagreed,
  was the unpinned part. Now pinned, over the whole predicate domain.
- `enforceActionParams` replaced with an unconditional `return null` → 3143
  passed, 0 failed. The ADR-0104 D2 gate could stop existing with nothing in
  the repo noticing. Its validator is well pinned in `@objectstack/spec`; the
  runtime gate around it was not, and that gate is what keeps an AI/MCP
  caller's plausible-but-wrong bag out of an action body. Now pinned.
