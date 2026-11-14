---
'@objectstack/runtime': patch
---

fix(runtime)!: the action route answers by who holds the name on the route, and the environment's exact address answers its own item

Clause-②: yes (narrowing) — narrowed: the bare route `/api/v1/actions/lead/NAME`, where a disabled package's action owns `lead` (bound to it, or object-less) and the environment's own action of that name is on `lead` too, answered the environment's action when exactly one enabled package held the name on another object; it now answers no declaration there, as it already did with none or two. With an enabled package on another object and a disabled package's object-less action, the same route answered the environment's action or no declaration by registration order; it now answers no declaration in both orders. Widened: a served package's own route answers its own action beside the environment's or the platform's item on another object, and beside a disabled co-holder (was no declaration, or the environment's object-less item); and `/api/v1/actions/_env/OBJECT/NAME` answers the environment's own action while a package holds the name (was `404`).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answers are the runtime `/actions` route's declaration for a name several holders share, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for one composition only: an action name held by a disabled package on an object (or with no object), by the environment's own action on that object, and by exactly one enabled package on another object. The route `/api/v1/actions/OBJECT/NAME` used to serve the environment's action there. It now answers that the action has no declaration, the answer it already gave when no enabled package, or two, held the name elsewhere. A disabled package that still binds the route is a holder there, so the route does not hand its call to another holder's declaration.

The route now decides from the holders of the name on the route itself: the items bound to the routed object, else the ones with no object. The protocol's by-name read cannot see the routed object, so its answer depended on which holders sat on other objects and on registration order. In order:

1. No enabled package's action is on the route and a disabled package's is: no declaration.
2. The environment's own action is on the route: that action, with no package (ADR-0150 D3: the environment's own declaration answers first on one owner key).
3. Exactly one enabled package's action is on the route and no platform action is there: that package's own action, read at its exact address and served with no package. A disabled co-holder, and the environment's or the platform's action on another object, do not change it.

Every other composition answers as before: one holder alone, two enabled packages on the route (refused naming both), the platform's action on the routed object, and every call that names its package. A store read that fails answers `503`, not a declaration.

The environment's exact address `/api/v1/actions/_env/OBJECT/NAME` answers the environment's own action whatever the other holders. The merged action listing leaves the environment's action out when a package holds the same name, so the address answered `404`. A package-less action with no row in the environment's store is the platform's and still answers `404` there.

Not changed: the registry keeps one package-less action per name, so a platform action and the environment's own action of one name replace each other, and the later registration stays. That rule is the registry's and is tracked separately.

What to do: nothing, unless a call relied on the environment's action answering a route that a disabled package's action still binds. Enable that package, or remove its action, or address the environment's action at `/api/v1/actions/_env/OBJECT/NAME`.
