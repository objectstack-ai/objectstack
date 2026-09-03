---
"@objectstack/spec": minor
---

feat(spec): refuse unknown keys inside `manifest:` — `ManifestSchema` goes strict, with its nested `contributes` / `kinds[]` / `engine` / `engines` blocks

**BREAKING** accept-set narrowing on a published spec schema, landing after the
v17.0.0 cut (the lockstep launch-window convention ships it as `minor`).

<!-- adr-0087: not-required (no-migration-prescription) this change retires NO key. The manifest vocabulary is byte-identical except for one ADDITIVE declaration (`main`, a key the `os plugin build` door already honoured), and only the unknown-key POSTURE moves, from strip to reject. Nothing exists for `objectstack migrate meta` to rewrite: an undeclared key was never honoured — it was dropped at parse and so never reached storage, the registry or any reader — so no stored shape carries one and no authored shape that ever WORKED becomes invalid. There is no single rewrite rule a ledger entry could state either, since what is now refused is an open set of author typos rather than a renamed key. The upgrade channel is the schema rejection itself, which names the offending key at the author's own path and carries either the declared spelling or the wrong-layer pointer (`specVersion`). The retired manifest keys keep their existing ledger entries (`kernel/Manifest:loading`, `kernel/Manifest:capabilities`, `kernel/Manifest:configuration`, `kernel/Manifest:extensions`, the `kernel/Manifest:contributes.*` family) and their tombstones. Measured blast radius before the close: 0 undeclared keys across the four example apps, the three `os init` templates, the `create-objectstack` blank template and every other shipped `manifest:` block; the one undeclared key found at a real door (`main`, on `objectstack.plugin.json`) is declared by this change rather than refused. -->

The package manifest — the `manifest:` block of every `objectstack.config.ts`, the
`objectstack.plugin.json` that `os plugin build` reads, the Studio package form —
was a plain open object: an unknown key inside it parsed green and its value was
silently dropped, at every door. A transposed `namesapce` therefore left
`manifest.namespace` undefined with exit 0, and that key decides every object's
table name, REST path and the install-time namespace gate — objects landed under a
name the author never wrote. The same silent drop held one level down: `kind:` for
`kinds:` inside `contributes`, `protocl:` for `protocol:` inside `engines`, which
quietly switched the load-time protocol handshake off.

**What is refused:** any key `ManifestSchema` does not declare — at the manifest
root and inside `contributes`, `contributes.kinds[]`, `engine` and `engines` — with
a message naming the surface and the offending key. A near miss carries the declared
spelling (`namesapce` is answered with `namespace`, `protocl` with `protocol`).
`specVersion` is answered with a wrong-layer pointer: the protocol axis the runtime
checks is `engines.protocol`. The retired keys (`loading`, `capabilities`,
`configuration`, `extensions`, the retired `contributes` members, `kinds[].globs`)
keep answering with their upgrade prescriptions, and a typo is never pointed at one
of them. The refusal reaches every door: `defineStack` / `os validate` /
`os compile`, `devPlugins`, the artifact `packages[]` entry (the assembled body
inherits it), `os plugin build`, and the package request shapes that embed the
manifest.

**What stays accepted:** every declared key, byte-identically — the four example
apps, every `os init` template and every shipped `manifest:` block parse unchanged.
**Newly declared:** `main` (optional), the entry module of a code-bearing plugin.
`os plugin build` has always read it off the source manifest and written it into
the compiled one as `dist/index.mjs`; it is declared now because a closed surface
that did not declare it would have refused every plugin that names its entry.
