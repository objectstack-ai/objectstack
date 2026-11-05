---
'@objectstack/cli': patch
---

fix(cli): `os dev` on an `os init -t app` scaffold no longer composes a second `MetadataPlugin` and warns "Plugin superseded: 'com.objectstack.metadata'"

Clause-②: no — boot diagnostics only; nothing accepted or published changes
Metadata-protocol: none

The dev artifact door in `os serve` / `os dev` added its own `MetadataPlugin` unless the stack already held one, but it recognised that plugin only by its class name. The published `@objectstack/metadata` bundle names the class `_MetadataPlugin`, so on an installed CLI the check missed the `MetadataPlugin` the standalone stack had already composed, added a second one, and every dev boot of an untouched scaffold printed a "Plugin superseded" diagnostic blaming a composition the user never wrote. The dev door now asks the same question the host-config door asks: a plugin named `com.objectstack.metadata` (or, as before, a class named `MetadataPlugin`) means the stack has one. A host config with no `MetadataPlugin` of its own still gets the dev door, as before.
