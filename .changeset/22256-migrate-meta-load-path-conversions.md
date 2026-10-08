---
'@objectstack/cli': patch
---

fix(cli): `os migrate meta` lists and writes a conversion the load already applies, on a stack the current schema accepts (#22256)

Clause-②: no

- **What was wrong.** When the current schema accepts a stack, `defineStack` runs its load-time ADR-0087 conversions while the config loads. `os migrate meta` then replayed its chain over a stack that was already converted. So a spelling the load still converts, such as `datasources[].driver: 'mongo'`, was never listed in `applied`, and `--write` never wrote it. Every later load kept printing `converted at load … Update the source to the canonical shape`, the notice that sends the author to this command, and the run exited 0.
- **What changed.** The chain now starts from the argument the stack's `defineStack` call was given. It already did this for a stack the schema refuses. The conversion is listed, `--write` writes it into the source, and the next load converts nothing.
- **What did not change.** A stack with nothing to convert gives the same `--json` summary and the same `--write` result as before. This was measured on the four example apps at `--from 16` and `--from 17`. Every other command still reads the stack `defineStack` builds.
- **The `--out` snapshot.** It is now the stack as written, with the chain's changes applied. That is what it already was for a stack the schema refuses. It no longer carries values the schema's parse fills in and the source never wrote, such as default keys and actions merged into their objects.
- **Known limit, unchanged.** Inside a `composeStacks([…])` project, each package body is assembled from the stack its input's `defineStack` call returned, whether that call accepted its input or was produced again in `strict: false` mode. So a conversion the load still applies inside a package body is still not listed, and `--write` still does not write it.
