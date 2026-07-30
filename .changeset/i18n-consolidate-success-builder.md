---
---

Consolidate `service-i18n`'s four inline success builders behind a `sendOk`, and
retire the route-envelope ratchet that pinned them (#3973 option 1). Deliberately
empty frontmatter: **no wire shape changes**, so there is nothing for a consumer to
read in a CHANGELOG.

#3636 put the declared `{ success: true, data }` envelope on all three i18n read
routes, but built it inline in each — four call sites for one envelope half, while
the error half had already been consolidated behind `sendError` (#3675). Those
bodies were never wrong; the problem was the guard.

`scripts/check-route-envelope.mjs` counts response write sites per module, so a
consolidated module sits at a fixed two however many routes it grows. This one sat
at five with a declared ratchet, because a fifth read route could have hand-rolled
a fourth-dialect body and only a driven test would have caught it — and a driven
test only covers the routes that existed when it was written. The four builders now
collapse into one, and the module declares the same `2 / 1 / 1` as the other five.

Guard: **6 conformant / 1 ratcheted / 1 exempt**, down from 5 / 2 / 1. The remaining
ratchet is `share-link-routes.ts` (#3983), which needs its own consumer sweep.

Also corrects a claim #3843 left in six suite headers: it said the repo-wide scan
"found two immediately (#3973, #3983)". #3973 was not one of them — i18n's
unconsolidated builder was already known — the two it actually surfaced were
`share-link-routes.ts` and the dev-only `hmr-routes.ts`.
