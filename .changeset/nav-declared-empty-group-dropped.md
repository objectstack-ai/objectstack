---
"@objectstack/rest": patch
---

fix(rest): drop a navigation group that was DECLARED empty, not just one the gate emptied (#7380)

`filterAppForUser`'s docblock has promised "Empty groups collapse so the sidebar
doesn't render a label with no children" since #4651, and its `filterNav` branch
carried the matching comment. The guard in front of that branch was
`Array.isArray(e.children) && e.children.length > 0`, so a group authored
`children: []` never reached the rule that owns the promise — it fell through the
`else` and shipped in `GET /meta/app` as a bare label. The one shape the sentence
most obviously covers was the one shape it could not reach.

The judgement is now on what SURVIVES rather than on how the entry got there. A
`type: 'group'` with no surviving children is dropped whether it **became** empty
(children filtered away by `requiredPermissions` / the ADR-0057 D10
`requiresService` gate) or **started** empty (`children: []`). Nesting composes:
an outer group left holding only a dropped inner group collapses in the same
pass. A group carrying no `children` key at all — unreachable through the spec,
where `children` is required on both the input and output `group` branches, but
reachable at runtime because this filter reads untyped documents off the metadata
store — is the same dead label and drops too.

**Contribution slots are the shape this actually shipped.** `setup.app.ts` is
authored entirely out of it: nine `type: 'group'` anchors with `children: []`,
filled on read by `Registry.applyNavContributions` (ADR-0029 D7) from whichever
capability packages are installed. That merge runs in the protocol layer *before*
this filter, so a slot a plugin filled arrives here with children and survives,
while a slot left empty because its capability is disabled arrives `[]` and is
now dropped — exactly the "a disabled capability contributes nothing and its slot
stays empty" case `setup.app.ts` documents. Deployments that ran without the
optional plugins were serving those anchors as empty, unopenable sidebar
headings; they now disappear, and the ones with contributions are untouched.

**The rule is `type: 'group'` and nothing else.** The navigation union nests on
two branches (`object` and `group`). An `object` entry navigates on its own
`objectName`, so `{ type: 'object', objectName: 'lead', children: [] }` is a live
link that nests nothing, and emptiness says nothing about whether to serve it —
non-group entries keep their existing behaviour exactly, including when the gate
empties their children. A group cannot be a target: `GroupNavItemSchema` is a
`strictObject` declaring no `objectName` / `pageName` / `componentRef` / `url`
(it rejects them), and its docblock reads "Does not perform navigation itself."
Measured before the change: 41 `type: 'group'` entries across the shipped apps
(`account`, `setup`, `studio`), the examples (`app-crm`, `app-showcase`,
`app-todo`) and the spec's nav type-assertion fixtures. 16 are childless — the 9
`setup` slots plus 7 spec fixtures, none in the example apps — and zero of the 41
carry `objectName` / `pageName` / `componentRef` / `url` or any other target. The
drop is therefore unconditional; no standalone-group shape needed sparing.

One consequence worth naming: because `areas[].navigation` is filtered through
this same `filterNav`, an area whose entries are all childless groups now empties
and is dropped by the existing area-collapse rule. An area authored
`navigation: []` is still passed through untouched, as before — a group is a
sidebar label and nothing else, while an area is a workspace the shell can select
on its own, and that divergence is documented at `filterAreas`.
