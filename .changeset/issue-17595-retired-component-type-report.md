---
'@objectstack/lint': patch
---

fix(lint): `component-type-unknown` reports an EXACT retired component type, relaying the spec's own prescription

A retired component type is `isKnownComponentType` on purpose — its
`ComponentPropsMap` row is kept so the props door can dispatch the retirement
prescription — and this rule read that as "accepted". So a caller linting a
**raw stack** got silence on a name `PageComponentSchema.type` refuses at the
parse: the author's earliest feedback channel was the one that stayed quiet,
and the refusal landed later, at the parse door, or in front of an end user.

```
FROM  validateComponentTypes({ pages: [{ … components: [{ type: 'element:filter' }] }] })
      -> []                                   // silence, on a name the parser refuses

TO    -> [{ rule: 'component-type-unknown', severity: 'error',
            path: 'pages[0].regions[0].components[0].type',
            message: '`element:filter` was removed in @objectstack/spec 17 (ADR-0049) …' }]
```

**No new prose.** The finding's `message` is the `RETIRED_PAGE_COMPONENT_TYPES`
entry **verbatim** — the same string the enum error map and the kept props row
already carry — pinned by byte equality in the rule's test, so the three doors
cannot drift and a type retired tomorrow arrives reported on the day it lands.

Two things deliberately unchanged: `isKnownComponentType` still answers `true`
for a retired type (flipping it would MOVE the refusal out of the props door
rather than add a report), and the typo suggester still never proposes a retired
name.

The new arm is judged **before** the reserved-namespace guard, because a
retirement can take its namespace with it: `user:profile` was the `user:`
namespace's only member, so `hasReservedComponentNamespace('user:profile')` is
`false` and a check placed after that guard would have stayed silent on the
member that has been refused longest.

Measured before landing: **zero** authored instances of any retirement-map
member across the in-repo page sources, with live component types as the lit
control in the same query — so no existing authored stack turns red.
