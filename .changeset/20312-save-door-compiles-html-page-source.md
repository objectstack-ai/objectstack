---
'@objectstack/metadata-protocol': minor
'@objectstack/cli': minor
---

`os serve` hands the runtime metadata save door the deployment's SDUI component manifest, and the save door compiles an html page's `source` against it: an unknown component or a `requires` that disagrees with the source is refused with a `422`, and `requires` is stamped from the compiled source (ADR-0080 §5).

Clause-②: yes (narrowing — on a host that registers a manifest, the runtime metadata save door newly refuses an html page whose source uses a component the manifest does not declare, or whose `requires` disagrees with its source; the new exported `SDUI_MANIFEST_SERVICE` widens `@objectstack/metadata-protocol`)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling or type: `packages/spec` is untouched, and `page.source` and `page.requires` keep their declared shapes. What changes is that the runtime metadata write door, on a host that registers the deployment's SDUI component manifest, now refuses two authored shapes at publish: an html page whose source uses a component the manifest does not declare, and one whose `requires` disagrees with the namespaces its source uses. `objectstack migrate meta` could not rewrite either even in principle: which component a page meant, and which plugin should provide it, is the author's decision. Rows at rest are not judged or rewritten. -->

**BREAKING** — an accept-set narrowing on the runtime metadata save door, shipped
as `minor` under the launch-window convention (`check-changeset-no-major` refuses
`major` until GA; breaking-ness is carried by this banner and the ADR-0087
disposition above, not by the level). On a server that has a manifest, a
`PUT /api/v1/meta/page/NAME` (and the draft publish) of a `kind: 'html'` page used
to store the source unjudged; it now answers `422 INVALID_METADATA` when the source
uses a component the deployment's console does not provide, naming the component in
each issue's `where` and `message`, or when a hand-written `requires` lists a
namespace the source does not use, omits one it does, or names one no component in
the manifest carries. **One-line fix:** use a component the manifest declares (or
install the plugin that provides it in the console the deployment serves), and omit
`requires` — it is derived from the source.

**The channel.** `@objectstack/metadata-protocol` exports `SDUI_MANIFEST_SERVICE`
(`'sdui-manifest'`), a plain service key. `os serve` resolves the manifest once at
boot through the same resolver `os validate` uses — the project's own
`sdui.manifest.json` beside the served config, then the copy `@objectstack/console`
ships — and registers it under that key. The save door reads the key on every
publish, so a host that registers or replaces it later is seen by the next save.

**The compile.** The save door runs `@objectstack/sdui-parser`'s `compile()`, the
compiler behind `os validate`'s JSX page gate, against the registered manifest. Its
diagnostics carry the same rule ids the CLI reports (`jsx-forbidden-tag`,
`jsx-unknown-component`, …); errors refuse the publish, warnings ride the response's
`advisories`. A disagreeing `requires` is refused under
`page-requires-disagrees-with-source`. A page that compiles is stored with the
`requires` its source yields, on a draft save too; a draft that does not compile, or
whose `requires` disagrees, is stored as written (drafts are not gated) and its
publish refuses it.

**Without a manifest nothing changes.** A host that resolves no manifest registers
nothing and prints one boot line — `Page source and \`requires\` not validated at
save`, naming every place looked — and the save door stores html pages exactly as
before. A registered value with no `components` map is warned about once and never
compiled against.

Measured before the refusal shipped: the three html pages in this repository
(`examples/app-showcase`: `showcase_capability_map`, `showcase_command_center_jsx`,
`showcase_start_here`) all compile against the pinned console's manifest with no
diagnostic and yield `requires: ['ui']`; none authors `requires`.
