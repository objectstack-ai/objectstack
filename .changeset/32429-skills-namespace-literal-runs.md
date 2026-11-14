---
'@objectstack/skills': patch
---

docs(skills): the `manifest.namespace` paragraph lists `runs` among the namespaces a package may never declare

Clause-②: no
Metadata-protocol: none

`objectstack-platform` named `actions`, `connectors`, `global`, `hooks`, `oauth` and `trigger` as the route literals a package namespace may never spell, but the address grammar's refused set (`NAMESPACE_REFUSED_LITERALS`, derived from `NAMESPACE_POSITION_LITERALS` in `@objectstack/spec/kernel`) also holds `runs`, the literal in the inbound hook's namespace position. An AI author who picked `runs` met the refusal only at `os validate`, build or the install door. The list now names all seven, in the set's sorted order. No schema or runtime change.
