---
'@objectstack/lint': minor
'@objectstack/cli': patch
'@objectstack/spec': patch
---

feat(lint): ADR-0079 record-title gate — deprecate titleFormat + record-title validator

A record's human title is a structural invariant (ADR-0079): every object
resolves a primary title from a real STORED field via `nameField` (the
canonical pointer; `displayNameField` is the deprecated alias) or a
deterministic derivation. This adds build-time diagnostics so `os build` /
`os lint`, the MCP authoring surface, and hand-authoring all get the coverage
cloud graph-lint already has (the ADR-0078 "not cloud-only" principle):

- `title-format-retired` — flags an object that declares a `titleFormat`. That
  key is a render-only template the server can neither return nor query;
  ADR-0079 retires it in favour of `nameField`. The schema still parses it
  (existing metadata keeps loading), so this is advisory, not an error.
- `title-unresolvable` — flags an object whose title cannot be resolved from any
  stored field (`objectTitleCompleteness` reports `status: 'none'`).

`@objectstack/spec` carries the `titleFormat` `.describe()` deprecation note;
the `@objectstack/cli` `lint` command wires the new validator into its run.
