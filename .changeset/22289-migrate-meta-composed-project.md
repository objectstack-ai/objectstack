---
'@objectstack/cli': patch
---

fix(cli): `os migrate meta` runs on a project built with `composeStacks`, and converts the retired spellings inside its package bodies (#22289)

Clause-②: no

- **What changed.** On a project whose config exports `composeStacks([defineStack({ … }), …], { manifest: 'preserve' })`, `os migrate meta --from N` used to exit 1 with `STACK_PROVENANCE_MISSING`, telling the author to wrap each input in `defineStack`, as soon as any input carried a spelling the current schema refuses. Every input already was wrapped. The command now loads such a project: an input whose `defineStack` call the current schema refuses is produced again by `defineStack(input, { strict: false })` with the load-time conversions skipped (#22256) before it is handed to `composeStacks`, and composition runs as it does at build time.
- **The package bodies are migrated.** A composed artifact keeps each definition under the package that owns it (`packages[i].manifest`), and the migration chain used to reach only the stack's own top level. It now also runs over each package body, and lists each change under the body's path, such as `packages[0].manifest.objects[0].fields.starts_at.defaultValue`. `--write` writes a change in package i into the file that authored input i only when input i and every input before it in the `composeStacks([…])` list is a stack literal (a `defineStack({ … })` call on an object literal, written in place or reached through a `const` or an import) that writes its own `manifest` and no `packages`. Only then is package i that one input's body. Otherwise `--write` lists the change with the reason, as it does for any site it cannot trace.
- **What did not change.** A one-package project loads, migrates and writes exactly as before. An input that was never built by `defineStack` (a plain object, or a spread of a built stack) is still refused with `STACK_PROVENANCE_MISSING`.
