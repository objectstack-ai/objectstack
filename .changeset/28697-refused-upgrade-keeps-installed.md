---
"@objectstack/objectql": patch
---

Clause-②: yes (widening) — the published `SchemaRegistry` gains one public method, `restoringOnRefusal`
Metadata-protocol: none

fix(objectql): a refused upgrade leaves the installed version serving

When `ObjectQL.registerApp` re-registers a package that is already installed and the registry refuses the new version, the installed version keeps serving, whole, whatever point of the registration the refusal came from.

- The package record, every object, app and item, picklist options and extensions, namespaces, permission-set names and default record pages read as they did before the refused upgrade.
- Another package's extension of the installed version's objects and a tenant's overlay of them are untouched and still served. The restore never goes through uninstall.
- What is refused, and every refusal's code, status and words, is unchanged. A clean upgrade and a refused first install behave as before.
- `SchemaRegistry.restoringOnRefusal(register)` runs one synchronous registration and, when it throws, puts back exactly the registry entries it wrote, then throws the same error. The engine runs an upgrade's registration through it.
