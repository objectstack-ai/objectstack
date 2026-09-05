---
"@objectstack/types": patch
---

`createHostImporter` now loads the `import` build of an ALIASED dual-published package, instead of silently keeping its `require` build.

An alias declaration — `{"dependencies": {"foo": "npm:bar@1"}}` — installs a package whose manifest is named `bar` under the key `foo`. On the path where CommonJS resolution SUCCEEDS, the importer re-decides only the CONDITION (it asks the package which entry an `import()` gets, so the caller's ESM chain and this load share one instance). That re-decision recognised the package root by walking up from the resolved entry until it found a manifest named after the DECLARATION KEY — `foo` — while an aliased install's manifest is named `bar`. The walk therefore never matched, the re-decision produced nothing, and the load fell back to whatever the CommonJS resolver had answered: the `require` condition.

For an aliased dual publish that left the process holding two live copies of one package — the CommonJS build behind the host importer, the `import` build in the caller's own chain — which is exactly the split the condition re-decision exists to remove: a plugin registry, a singleton kernel, a module-level cache, one copy each.

The expectation now comes from the host's own declaration (`npm:name@range`, aliased `workspace:name@range`), the same reading the ESM-only fallback finder has used since it learned about aliases. Nothing about the check's strictness moves: an alias naming one package still does not license a directory holding another, and a non-aliased declaration is still verified against its key. Declarations that name a LOCATION rather than a package (`link:`, `file:`) carry no name to expect, so they keep today's behaviour unchanged.

Measured population for the behaviour change: zero aliased declarations exist across this workspace's 875 dependency declarations, and 867 of 867 installed declarations already match their key — no ordinary, non-aliased install reaches this path.
