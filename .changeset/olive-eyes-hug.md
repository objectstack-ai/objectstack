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
stack.

The two copies did not differ by parsing — `defineStack()` is strict by default and
runs the same schema parse the artifact door runs, so both carry the schema defaults.
They differed by ADR-0010 provenance, and by freshness: the door re-ingests its copy
on every recompile while the module copy never refreshes. Measured on a real `os dev`
boot, the wrap registered last, so its copy won the cold boot — and the door's copy
replaced it on the first artifact reload, so which copy a consumer read changed
mid-run, with no restart and no signal.

The `os dev` composition now declares `securityMetadataRegistrar: 'artifact-door'` on
that wrap exactly when it composes the HMR door over a compiled artifact that is
present on disk, so the door is the single registrar on this boot shape too. Nothing
changes when no door composes — `os serve`, `os migrate`, a host config whose artifact
has not been compiled or was named but is missing, and every production boot keep the
default `'app-plugin'` registrar and their only writer.
