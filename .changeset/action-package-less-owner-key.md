---
'@objectstack/objectql': patch
---

fix(objectql): a package-less action customizes a package's action only on that action's owner key

Clause-②: no
Metadata-protocol: none

An action is identified by its package, its owning object and its name (ADR-0150 D4). The registry's package-scoped reads now follow that identity for a package-less action (one saved with no package, or registered by host or plugin code with no package):

- On the same owner key as exactly one package's action of that name, it is still that package's customization, as before.
- On another object (or object-less beside an action bound to an object), it is the environment's own item. `getPackageScopedItem('action', NAME, PKG)` answers the package's own action, and `getEnvironmentScopedItem('action', NAME)` answers the package-less one.
- On the owner key of two or more packages' actions, it is still no package's item and no environment item, as before.

So `resolveActionByPackage` resolves a package caller's action on its object to that package's own declaration, under that package's coordinate, and an `/actions/:object/:action` route judges the declaration its own package declared there. A package caller on the object of a package-less action is refused naming the environment (ADR-0150 D3), never answered as another package's. A route that names no package answers as before. Other metadata types keep their one-holder reading.
