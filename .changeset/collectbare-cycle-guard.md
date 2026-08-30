---
'@objectstack/lint': patch
---

fix(lint): guard `collectBare`'s recursion so a self-referential page terminates instead of killing the stack (#13235)

`page-envelope-audit`'s `collectBare` is a lockstep raw/parsed value walker,
separate from the shared `walkPageComponents` traversal, and it carried no cycle
guard. A page whose component tree contains itself (`A -> B -> A` through
`properties.children`) is input the schema **admits** — `properties` is
`z.record(z.unknown())` and `properties.children` is `z.array(z.unknown())`, so
`PageSchema.safeParse` succeeds — and door 1 then recursed until
`RangeError: Maximum call stack size exceeded`. Door 1 runs over the whole page
before any other door, so this is the first thing that died on such a page.

The guard is an **ancestor set on the authored side**: objects are added on
entry to the descent and removed on exit, so a node is skipped only when it is
its own ancestor. Two consequences are pinned by tests:

- **Report-neutral on acyclic input, by construction.** No node is ever its own
  ancestor on an acyclic page, so the guard never fires and findings are
  unchanged. A visited-set would instead have skipped merely *shared* subtrees —
  the same component literal referenced from two slots is legal authoring — and
  silently dropped their findings.
- **Nothing distinct is lost on a cyclic page.** Every node of a finite graph is
  reachable by a simple path, so each authored position is still visited; only
  the infinite tail of re-reports at ever-longer paths is dropped.

Cycles through arrays are covered as well as cycles through records.

Scope: this is door 1 only. `walkPageComponents` carries its own separate
unguarded recursion, so `auditPageExpressionEnvelopes` end-to-end still dies at
the walk on the same input until that lands (#13217). No published type changes
and no accept/reject behaviour changes on any page that parses today.
