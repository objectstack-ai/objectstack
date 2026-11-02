---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/plugin-security': patch
---

fix: a disabled package's objects are no longer granted by `/auth/me/permissions`, and an action that launches into a disabled package is no longer served

Clause-②: yes (narrowing)
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` describes what `/auth/me/permissions` answers for a disabled package, or which actions a disabled package withholds; every taught use of `current_user.can(object, verb)` and of `type: 'flow'` actions stays true.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is two served answers while a package is disabled, and re-enabling the package restores both with no restart; nobody's code or metadata changes. No exported declaration is removed or narrowed (one optional member and one function are added); every package publishes; no ADR-0087 id is named or touched. -->

**BREAKING** (a served-answer narrowing, only while a package is disabled), shipped as `patch`: a non-protocol narrowing takes `patch` and keeps this banner and its ADR-0087 disposition (no authored value is refused). A disabled package is hidden, and refused on the data plane (#28117 ruling A). Two faces still answered as if it were on.

**FROM.** With a package disabled, on `origin/main`:

- `GET /api/v1/auth/me/permissions` still granted the package's objects in its `objects` map (an explicit grant, a plain `'*'`'s coverage or a super-user seed), while `GET /api/v1/data/<object>` answered `404 OBJECT_PACKAGE_DISABLED`. So `current_user.can(<object>, verb)` stayed `true` in the console and in the server's own formulas (`ISecurityService.getEffectiveObjectPermissions`, the same map), and every action gated on it stayed drawn.
- An action of an ENABLED package that launches into the disabled one was still served: on the object it is bound to (`GET /api/v1/meta/object/<name>`'s `actions`, which the console draws) and in `GET /api/v1/meta/action` (list and by name). That is a `type: 'flow'` action whose flow only the disabled package ships (its launch answered `404` "Flow '…' not found"), and an action with a param whose `objectOverride` object belongs to the disabled package (its dialog could not draw the param).
- `GET /api/v1/meta/action` also still listed an enabled package's action bound by `objectName` to the disabled package's object, while that object's own read answered `404 OBJECT_PACKAGE_DISABLED`.

**TO.** While the package is disabled:

- **`@objectstack/core`**: `buildEffectiveObjectPermissions` takes an optional `isObjectPackageDisabled` accessor and, as its last step, leaves out every object it answers `true` for (the `'*'` entry stays). `registryObjectPackageDisabled(registry)` is that accessor over an engine registry: its `isObjectPackageDisabled`, the predicate the data plane asks before it refuses an object. An object the map does not mention answers `current_user.can()` `false`.
- **`@objectstack/plugin-hono-server`** and **`@objectstack/plugin-security`**: `/auth/me/permissions` and `ISecurityService.getEffectiveObjectPermissions` both hand that accessor over, so the two answers stay byte-for-byte the same map.
- **`@objectstack/objectql`**: `SchemaRegistry.isActionWithheldByDisabledPackage(action)` extends #24400's rule (a disabled package's bound actions are withdrawn) to an action bound by `objectName` to an object of a disabled package, and to an action that launches into one: a `type: 'flow'` target that only disabled packages ship (`isFlowOfDisabledPackage`), or a param `objectOverride` object of a disabled package. The served object read leaves such an action out of `actions`, whether it was attached as a bound action or merged into the object by `defineStack()`. The code layer (`getArtifactItem`) keeps what the package ships.
- **`@objectstack/metadata-protocol`**: `GET /meta/action` (the effective served list) and `GET /meta/action/:name` withhold the same actions, through the registry's predicate. The execution list and the per-package list (the package export) keep them.

An action that only names such an object elsewhere (a URL, a label) is unchanged, and so is a flow some enabled package also ships. Re-enabling the package serves every grant and action again on the next request.
