---
'@objectstack/core': patch
'@objectstack/metadata': patch
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol, metadata, runtime)!: a bare read of an action name two packages hold answers 409 naming each with its object (ADR-0150 D3)

Clause-②: yes (narrowing) — a by-name read naming no package of an action name two enabled packages hold on any object key (`GET /meta/action/NAME`, its `/layers` and its `/published`) goes from 200 (one package's action picked) to 409 naming every holder with its object; `MetadataManager.get('action', NAME)` with no package goes from the item written last to the D3 refusal; and `POST /actions/:object/NAME` naming no package, where it ran with no declaration (so with no `requiredPermissions` or params gate) whenever the pick landed on another object's action, now gets its own object's holder's declaration and its gates.
Metadata-protocol: none
Skills-docs: none — `skills/**` and `content/docs/**` teach no bare read of an action name two packages hold (the one hit, an eval in `skills/objectstack-platform/evals/config-plugins-ops.json`, is a `PUT` of one package's action); the prescription ships in the refusal text and the FROM → TO below.

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is whether a by-name read naming no package answers or refuses, and the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** accept-set narrowing at the by-name action read, on both transports (the runtime dispatcher and the REST route manager) and in process.

1. Two packages may each bind an action of one name to an object: two different objects (install allows it), or one object (refused at the call doors since #32213). A read naming no package, `GET /meta/action/NAME` (the protocol's `getMetaItem`) and its layered read `GET /meta/action/NAME/layers`, answered `200` with the first registered package's action, and so did its published read `GET /meta/action/NAME/published`. Each is now `409 RESOURCE_CONFLICT` naming every enabled holder in `details.candidates` (the layered and published routes name them in their sentence only), and the sentence names the object each package binds the name to. A disabled package holds nothing here. `?package=X`, the qualified path and a name one package holds answer as before. So does one package binding the name to two objects: it is one holder.
2. `MetadataManager.get('action', NAME)` and `getDiagnosed` with no package, of a name two packages each hold on their own object, answered the item written last. They now throw `PackageScopedNameRefusedError` (`409`, `ambiguous-in-environment`), naming each package with its object, as they already did for two packages on one object. One package holding the name on several objects still answers the item written last.
3. The by-name read's MetadataService step and the layered read's code layer no longer read the store's package-scoped refusal as a miss. They rethrow it, where the registry answered the first registered in its place. An action refusal naming fewer than two enabled packages still falls through as before.

The `/actions/:object/:name` door can see the object. A call naming no package, on a name its object holds once, still gets that holder's declaration when the bare read refuses: each refused package is read at its own address, and the declaration that owns the route answers, the object's own first and then an object-less one. A package its own address says it does not hold (`not-held-by-qualifier`) owns nothing there; if no other package owns the route, the refusal stands. Any other refusal of a package's own address leaves its action unknown, so the refusal stands whatever the others answer. Where the bare read picked another object's action, this door answered no declaration, so the call ran without the action's `requiredPermissions` or params gate; it now answers the route's own declaration, and its gates apply.

Where two object-less packages hold the name and a third binds it to an object, the bare read's 409 names all three (the object-less judge of #31697 named only the two), and the third package's own `/actions` route resolves to it.

`@objectstack/core` exports `packageScopedActionOwnersSentence`, the sentence that names each package's object, which both refusals append.

No first-party composition has two packages holding one action name (the example apps' action names are disjoint and app-prefixed), so no answer changes in this repository.

The fix:

- FROM `GET /meta/action/NAME` (and its `/layers` and `/published`) for a name two packages hold TO `GET /meta/action/NAME?package=<holder>`, or the holder's qualified path `GET /meta/action/<holder's namespace>/NAME`.
- FROM `MetadataManager.get('action', NAME)` for such a name TO `MetadataManager.get('action', NAME, <holder>)`.
