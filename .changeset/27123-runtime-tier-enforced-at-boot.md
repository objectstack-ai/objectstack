---
'@objectstack/spec': patch
---

docs(spec): the plugin manifest's `runtime` tier is described as enforced at boot for a plugin `os plugin install` installed — only `node` is loaded, `sandbox` and `worker` are refused until ADR-0025 M3 routes them (#27123)

Clause-②: no — no key or accepted value changes; `node`, `sandbox` and `worker` still parse, and an unset tier is still legal
Metadata-protocol: none

The `.describe()` text and TSDoc of `PluginRuntimeSchema` and the manifest's `runtime` field said load-side enforcement was not implemented. The boot-time loader for plugins `os plugin install` installed now dispatches on the tier before importing anything: `node` loads in process (not isolated), `sandbox` and `worker` are refused by name, and an installed plugin that declares no tier is refused. The text says that, both halves still stated (the cloud marketplace publish gate's HTTP 422 for an unverified publisher requesting `node` is unchanged), and the retracted sentence is pinned absent. The field's TSDoc also says that an unset tier, which declares a pure-metadata package, is an omission on an artifact `os plugin build` produced (which carries code), and that the boot-time loader refuses an installed plugin with no tier either way. A plugin a stack's own `plugins` array names is not dispatched on this key. The liveness ledger's `runtime` row moves from `live-elsewhere` to `live` on the local dispatch point, and the ledger README keeps its account as the worked example of `live-elsewhere`, which no row holds now.
