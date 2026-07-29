---
"@objectstack/spec": patch
---

fix(spec): regenerate the ADR-0087 change manifest the RC version bump left stale

The v17 RC bump moved `PROTOCOL_VERSION` to `17.0.0` but did not re-run
`gen:spec-changes` / `gen:upgrade-guide`, so the published `spec-changes.json`
still declared `protocolVersion: 16.0.0` with no protocol-17 entries — while the
protocol-17 conversions (`execute`→`target`, `conditionalRequired`→`requiredWhen`,
`knowledge.topics`→`sources`, `agent.tools` removal, sharing `full`→`edit`) were
already registered and applied at load. Anything projecting the manifest (the
generated upgrade guide, the `spec_changes` MCP tool) reported a 16-era chain on
a 17 protocol.

`check:spec-changes` caught it, but only on the first PR to touch a
generated-artifacts path after the bump — this regenerates both projections and
turns the gate green again. `docs/protocol-upgrade-guide.md` now carries the
Protocol 16 → 17 section.
