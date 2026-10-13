---
'@objectstack/service-settings': minor
---

fix(service-settings)!: the settings REST family refuses an anonymous caller with the shared 401

Clause-②: no — it narrows the anonymous accept set to the ADR-0056 D2 floor; no published schema or export moves.

<!-- adr-0087: not-required (no-migration-prescription) A runtime authorization narrowing at the routes registerSettingsRoutes mounts, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and a signed-in caller receives the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which callers the family serves: a caller whose resolved context names no user is now refused with the shared anonymous-deny 401 before any settings logic runs. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`registerSettingsRoutes` mounts the settings REST family. Until now it ran no anonymous floor: a caller with no session was answered by the family's own capability logic, with a status other than `401`. ADR-0056 D2 denies anonymous callers by default, and ADR-0138 D2 says a surface outside its door classes answers `401`.

- **Refused now:** every route of the family answers a caller with no user `401` with code `UNAUTHENTICATED`, in the declared error envelope, before the settings service is consulted. The decision is the platform's shared one (`shouldDenyAnonymous`), mounted once for the whole family.
- **Unchanged:** a signed-in caller is served exactly as before, and the per-namespace read and write capabilities still decide what it may see and change. An authorization-store outage still answers its `503`.

What changes for you. Sign in before calling the settings routes. If you mount `registerSettingsRoutes` yourself with your own `contextFromRequest`, it must put the caller's `userId` on the context it returns: a context without one is anonymous now, whatever capabilities it carries.
