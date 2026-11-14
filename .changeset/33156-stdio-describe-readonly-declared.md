---
'@objectstack/mcp': patch
---

fix(mcp): stdio `describe_object` and the objects resource judge `readonly` on the declared field

Clause-②: no
Metadata-protocol: none

Over stdio and on the `objectstack://objects/{name}` resource, a stored field that declares an `expression` the caller is not shown (it names a field they cannot read) was described `readonly: false`, so an agent could send a value the engine then replaced. `readonly` is now judged on the field as declared, as the HTTP `/mcp` door judges it, so that field answers `readonly: true` on every transport. The expression itself, and the field it names, are still not served: only the `readonly` answer is read from the declaration.
