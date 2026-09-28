---
'@objectstack/lint': patch
---

`component-props-invalid` no longer hides a wrong `object` prop on a component that also carries a `dataSource` binding

Clause-②: no

A page component whose `dataSource.object` names the object may leave the flat
`properties.object` shorthand out: the binding supplies it, so the rule does not
report the props schema's required `object` as missing. That waiver was matched
on the issue's path alone, so it also swallowed every other issue the props
schema raised at `object`. A present but wrong value, such as `object: 7` or
`object: null`, was reported without a binding and silently passed with one.

The waiver now covers what its contract says: a missing `object`, meaning no
key or an explicit `undefined`. A value the author did write is judged as
written, and it is reported at `properties.object` exactly as it is on the same
component without a binding.

Effect on `os validate`, `os lint` and `os build`: a document that sets both a
`dataSource` binding and a wrong-typed `properties.object` now gets one
`component-props-invalid` warning it did not get before. The rule stays
advisory, so nothing that validated before is refused. A component that binds
through `dataSource` and omits `properties.object` is still clean.
