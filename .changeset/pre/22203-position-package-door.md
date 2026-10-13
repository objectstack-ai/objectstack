---
"@objectstack/objectql": patch
---

fix(objectql): a stack-declared position is registered under its package, so the metadata save door refuses a save over it like every other non-overridable security type

Clause-②: no

- **What was wrong.** `PUT /api/v1/meta/position/NAME` naming a position an installed package declares answered `200`, and the saved environment row then won the by-name read (`GET /api/v1/meta/position/NAME`). The type registry declares `position` `allowOrgOverride: false`, as it declares `permission` and `capability`, so the save door should refuse it.
- **Why.** The save door decides "a code package ships this item" from the engine's SchemaRegistry entry that a package registered. `ObjectQL.registerApp()` puts a stack collection into that registry under its package only for the collections it enumerates. That list carried `permissions` and `capabilities`, but still carried the retired `roles` instead of `positions`. So no package-declared position had an entry, and the save took the runtime-create path.
- **What changes.** `registerApp()` (and the nested-plugin seam) now registers a stack's `positions` under the owning package, with the same ADR-0010 provenance as its permission sets. A save over a package-declared position is refused `403 NOT_OVERRIDABLE` on every topology. A save that names the read-only package (`?package=`) is refused `403 ITEM_LOCKED`, which is how a save naming a read-only package is refused for any non-overridable type. The by-name read keeps serving the package's position.
- **What does not change.** A position no package declares still saves (`allowRuntimeCreate`). Permission sets and capabilities are refused as before. The declared-positions seeder in `@objectstack/plugin-security` now reads the stack's positions from the engine registry rather than the metadata service, as it does for permission sets. It seeds the same names, labels and descriptions.
- **To customize a packaged position,** create a position with a different name.
