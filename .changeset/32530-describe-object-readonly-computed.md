---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

fix(mcp,runtime): `describe_object` serves `readonly: true` where a write never sets the value

Clause-②: yes (widening)
Metadata-protocol: none

`describe_object` and the `objectstack://objects/{name}` resource served each field's `readonly` from the declared flag alone, so an agent was told it could write fields whose sent value the engine drops or replaces. Both transports now also answer `readonly: true` for a runtime-owned type (`autonumber`, including a hand-written field literal with no flag), for a `formula` field, and for a stored field that declares an `expression`. On every transport, the resource included, `readonly` is judged on the field as declared, so a stored expression the caller is not shown (it names a field they cannot read) still answers `true`, and the expression itself stays hidden. An ordinary field still answers `readonly: false`, and a declared `readonly` still answers `true`.

`readonly` is the schema's answer, not the caller's field edit permission: a field the caller may read but not edit still answers `readonly: false`, and a write naming it is refused as before. The tool description now says so, and it also says that a `defaultValue` may be a token the server resolves (`NOW()`, `current_user`) or an expression object, so an agent omits the field instead of copying the value.
