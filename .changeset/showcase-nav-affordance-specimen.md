---
---

feat(showcase): add nav `separator` + `badge`/`badgeVariant` specimens, and correct the §3 recheck's item-8 verdict (#1878)

The recheck twice claimed these keys were unconsumed, both times from a faulty
search. Settled empirically: `UnifiedSidebar` delegates the app-navigation tree
to `NavigationRenderer`, which implements all three — the specimen renders
against an unmodified objectui checkout. Docs/examples only; releases nothing.
