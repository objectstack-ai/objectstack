---
'@objectstack/cli': patch
---

`os dev` over a host config now has ONE registrar for stack-declared security metadata

A HOST config — one whose `plugins[]` holds instantiated plugins — skips
`createStandaloneStack`, so the composition that already declares
`securityMetadataRegistrar: 'artifact-door'` never runs. `os serve` then wrapped the
config module in `new AppPlugin(config)` under the default `'app-plugin'` registrar,
and under `os dev` it ALSO composed the dev-only HMR `MetadataPlugin` over
`dist/objectstack.json` — the compiled twin of that same module, which the `os dev`
supervisor had just produced. Both writers registered `positions`, `permissions`,
`capabilities` and `sharingRules` into the metadata service, from two sources of one
stack, in two different shapes: strict-parsed with schema defaults and ADR-0010
provenance on the door's copy, unparsed on the wrap's (a sharing rule's `condition`
stayed whatever the module held). Measured on a real `os dev` boot: the wrap
registered last, so its unparsed copy won the cold boot — and the door's copy replaced
it on the first artifact reload, so which shape a consumer read changed mid-run
without a restart.

The `os dev` composition now declares `securityMetadataRegistrar: 'artifact-door'` on
that wrap exactly when it composes the HMR door over the compiled twin, so the door is
the single registrar on this boot shape too. Nothing changes when no door composes —
`os serve`, `os migrate`, a host config with no compiled artifact, and every
production boot keep the default `'app-plugin'` registrar and their only writer.
