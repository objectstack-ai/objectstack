---
'@objectstack/cli': patch
'@objectstack/spec': patch
---

fix(cli): `os migrate meta` lists and writes a conversion the load already applies inside a composed project's package body (#22256)

Clause-②: no

- **What was wrong.** In a project whose config exports `composeStacks([defineStack({ … }), …], { manifest: 'preserve' })`, each package body is assembled from the stack its input's `defineStack` call returns. That call runs the load-time ADR-0087 conversions, both when the schema accepts the input and when `os migrate meta` produces a refused input again in `strict: false` mode. So a spelling the load still converts inside a package body, such as `datasources[].driver: 'mongo'`, was never listed in `applied`, and `--write` never wrote it. Every later load kept printing `converted at load … Update the source to the canonical shape`, and the run exited 0.
- **What changed.** `os migrate meta` now produces every input of the composition again from what its author wrote, with the load-time conversions skipped, before the inputs are composed. Composition then assembles each package body from the authored source. The conversion is listed under the body's path (for example `packages[0].manifest.datasources[0].driver`), `--write` writes it into the file that authored that input, and the next load converts nothing. This holds whether the input's `defineStack` call accepted its argument or was refused.
- **`@objectstack/spec`.** `defineStack` reads one internal parameter for this, which only the CLI passes: an undeclared, symbol-keyed entry on its options, honoured only together with `strict: false`, that skips the conversion pass. It is not part of `DefineStackOptions` and nothing new is exported. A strict call ignores it, and every call without it behaves exactly as before.
- **What did not change.** A project with nothing to convert gives the same `--json` summary and the same `--write` result and written bytes as before. This was measured on the four example apps, one of them composed, at `--from 16` and `--from 17`. Every other command still reads the stacks `defineStack` builds and the composition they make.
- **The `--out` snapshot of a composed project.** Each package body in it is now the body as written, with the chain's changes applied. That is what the snapshot of a one-package stack already is. It no longer carries values the schema's parse fills in and the source never wrote, such as default keys.
