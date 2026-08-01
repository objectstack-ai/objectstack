---
"@objectstack/cli": minor
"@objectstack/example-showcase": patch
"@objectstack/example-todo": patch
---

fix(cli): gate the two decision-routing shapes that can never work, and flag the inert `config.condition` (#4414)

Two follow-ups to #4440, both about metadata that reads like a guard and is not
one.

## Two rules promoted to `error`

`flow-branch-label-unmatched` and `flow-default-edge-with-condition` now FAIL the
build instead of warning. The bar for that — restated at the top of
`lint-flow-patterns.ts`, because the old one no longer described the set — is
**no reading of the author's metadata does what it says, deterministically, on
every run**. Both qualify: a branch label no out-edge carries cannot route, and
an edge that is both `isDefault` and conditional always lets the condition win,
so the marker routes nothing. Neither *fails*; both are wrong every time and
silently, which is worse.

The other two stay advisory on purpose, and the policy now says why:
`flow-decision-unconditional-branch` is usually a guard that does not guard, but
one guarded plus one unconditional out-edge is also a legal "maybe notify,
always continue" fan-out, and `flow-multiple-default-edges` can genuinely mean
"when nothing matched, do both". The bar is about *provability*, not severity of
consequence — failing a customer's build on a shape we cannot prove wrong is the
worse trade.

No wiring change was needed: `lintFlowPatterns` is already registered as
`tier: 'gating'` across all three commands (#4409), which is exactly the seam
`authoring-rule-wiring.test.ts` exists to guard.

## New rule: `flow-inert-node-condition`

`config.condition` is the trigger gate on a `start` node and is read by **no
other node type** — the engine parse-validates it everywhere (so a malformed one
is caught) and then ignores it. On a `decision` the name makes it read as the
branch predicate, which is exactly how it got authored.

Three of the three bundled apps had one. `app-todo`'s `check_recurring` and
`app-showcase`'s `needs_exec` both carried a predicate their out-edges were
already enforcing — a third copy doing nothing. The showcase even had a comment
next to it saying the node condition "is not evaluated by the engine", and kept
it anyway; that is the residue this rule exists to stop accumulating. Both are
now plain exclusive gateways.

Advisory, not gating: the surrounding edges usually still route correctly, so
this is dead weight rather than a provable misroute. The node-type list is a
closed set of builtins we have actually read, not "everything that isn't
`start`" — ADR-0018 keeps `node.type` open and a plugin executor may legitimately
declare and read its own `config.condition`.

## Studio

`objectstack-ai/objectui` carries the matching help-text fixes: the branch editor
said a `true` branch **is** the default/else path (it is how you *ask* for one —
the marker goes on the out-edge), and the legacy single `Condition` field said
"prefer Branches above", which reads as "this works, but the other is better".
It does not work at all.
