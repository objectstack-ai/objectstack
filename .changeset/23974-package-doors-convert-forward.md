---
'@objectstack/service-package': minor
'@objectstack/cloud-connection': minor
---

Clause-②: yes (widening)

fix(service-package,cloud-connection): a stored or installed package body converts forward under ADR-0087 D2 at the `sys_packages` boot hydration and at the marketplace install, and one refused `sys_packages` record no longer stops the hydration of the rest

The registration door (`ObjectQL.convertPackageBodyForward`, `@objectstack/objectql`) already replays the versioned forward conversion for a package body that declares its `engines.protocol` range. Two more doors that load a body at rest now go through that same entry point, before the registry judges the body:

- **`sys_packages` boot hydration** (`PackageServicePlugin.start`). A stored record whose range admits this runtime, built before a retirement (for example a `type: 'home'` page with `isDefault: true`), now hydrates converted, with the engine's named warning, where the registry used to refuse it. The stored row is not rewritten, so it converts again at every boot.
  - A record the registry still refuses is reported **by name** at `error`, with the refusal attached, and the records after it keep hydrating. Before, the first refusal threw out of the whole loop to a `debug` line, and every durable package after it was absent from the registry with nothing saying so.
  - `Hydrated N package(s) from sys_packages into registry` counts the records the registry accepted in that pass.
  - The ADR-0087 D1 handshake still runs first: a record whose declared range excludes this runtime's major is refused by it, named, as before.
- **The marketplace install** (`MarketplaceInstallLocalPlugin`, install and boot rehydrate). The body is converted once per load, and that one converted body is what `manifest.register`, the handler binder, the side effects (translations, seed datasets) and the rehydrate's sample-data heal read. Before, `register` converted its own copy while the side readers read the raw ledger entry. The ledger keeps the body as installed.

Nothing is narrowed. A body with no declared range (a manifest built in code) meets the registry's refusals exactly as before at both doors. The install primitive `protocol.installPackage` (`POST /api/v1/packages`) is authoring-side and stays strict: the registry judges the manifest as handed.
