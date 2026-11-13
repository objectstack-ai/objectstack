---
'@objectstack/service-automation': patch
---

fix(service-automation): a package installed through install-local keeps its flows registered after a restart, whatever the plugin order

Clause-②: no
Metadata-protocol: none

The engine bound a cold boot's flows once, in its own `kernel:ready` handler. The install-local rehydrate re-registers every installed package in its own `kernel:ready` handler, so the bind saw those packages only when the install-local plugin started first. A host that lists a plugin depending on the automation plugin (any connector plugin) before `MarketplaceInstallLocalPlugin` starts the automation plugin first: after a restart the package was listed and its objects served, but its flows answered 404 on the trigger door and read `registration.state: unregistered` until some later hot install re-synced the engine. The engine now reads the flow view again at `kernel:bootstrapped`, once every `kernel:ready` handler has settled and before the flow holders seal, and binds again when the view changed since the `kernel:ready` bind. A boot whose view did not change binds nothing more.
