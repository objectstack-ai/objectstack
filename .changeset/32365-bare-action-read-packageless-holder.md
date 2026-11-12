---
'@objectstack/metadata': patch
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol, metadata)!: the bare read of an action name weighs its package-less holder, and serves the one enabled holder when a disabled package registered first (ADR-0150 D3)

Clause-②: yes (narrowing) — a by-name read naming no package of an action name (`GET /meta/action/NAME`, its `/layers` and its `/published`) beside a package-less item the environment's store holds no row of (the platform's: host code or a plugin) and one or more enabled package holders goes from 200 (the platform's item) to 409 naming every package and the platform; beside two or more enabled packages, the 409 names the package-less holder too (the environment or the platform), where it named the packages only; `MetadataManager.get('action', NAME)` with no package, of a name two packages hold beside a package-less item, names the environment in its refusal too. Widening besides: the same read where a disabled package registered before the one enabled holder goes from 200 with no item (and the disabled package's body on `/layers`) to the enabled holder's item; `/layers` beside the environment's own item and one package goes from the package's item to the environment's; `MetadataManager.get('action', NAME)` beside the environment's own item and one package goes from the item written last to the environment's, and `MetadataManager.get('action', NAME, P)` from the item written last to P's own.
Metadata-protocol: none
Skills-docs: none — `skills/**` and `content/docs/**` teach no bare read of an action name a package-less item shares with a package; the prescription ships in the refusal text and the FROM → TO below.

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which holder a by-name read naming no package answers, or that it refuses, and the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** accept-set narrowing at the by-name action read naming no package, on both transports (the runtime dispatcher and the REST route manager) and in process. ADR-0150 D3: for a caller with no package, the environment's own item answers first, then the unique package holder, else a refusal naming every candidate.

1. **A package-less item beside one package's.** The environment's own item (a package-less registry entry the environment's store holds an active package-less row of, on the same object or none) answers the plain read and now its `/layers` too, whatever object each binds the name to. `/layers` answered the package's item. The platform's item (a package-less entry with no such row) beside any enabled package holder is refused `409 RESOURCE_CONFLICT` naming the packages and `{ kind: 'platform' }`, the rule #31697 applied to an object-less one, now on any object. It answered the platform's item. In process, `MetadataManager.get('action', NAME)` answers the package-less item; it answered the one written last.
2. **A package-less item beside two or more packages'.** The 409 names the package-less holder beside the packages (`{ kind: 'environment' }`, or `{ kind: 'platform' }` with no stored row), in `details.candidates` and its sentence (which names the object it binds the name to). In process the refusal names the environment, whether the package-less item sits on the packages' own key or on another object.
3. **A disabled package registered before the one enabled holder.** The plain read answers the enabled holder's item; it answered no item, because the registry's first composite was the disabled package's and the disabled-package face withheld it. `/layers` answers the enabled holder's code layer; it answered the disabled package's body.

A read naming a package in process (`MetadataManager.get('action', NAME, P)`) answers P's own slot first; it answered the slot written last, which could be the environment's item on another object.

The `/actions/:object/:name` route's declaration read (the protocol's execution face) keeps main's answer beside a package-less item, so the served read and the route's declaration read do not yet agree there; the owner seat follows that up separately. Where a disabled package registered first, the route of the enabled holder's object now gets its declaration; it got none.

No first-party composition has a package-less action under a package's action name (the example apps ship package actions only, under distinct names, and seed no `sys_metadata` action row), so no answer changes in this repository.

The fix:

- FROM `GET /meta/action/NAME` (and its `/layers` and `/published`) for a name a package-less item shares with packages TO `GET /meta/action/NAME?package=<holder>`, or the holder's qualified path `GET /meta/action/<holder's namespace>/NAME`; the environment's own item answers the bare read beside one package.
- FROM `MetadataManager.get('action', NAME)` for such a name TO `MetadataManager.get('action', NAME, <holder>)`.
