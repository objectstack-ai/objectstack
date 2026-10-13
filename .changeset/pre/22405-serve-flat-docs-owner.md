---
'@objectstack/cli': patch
---

`os serve <config>`: a multi-package config now serves its flat `src/docs/` pages, under the package that owns the stack's manifest

Clause-②: no

A config boot (`os serve objectstack.config.ts`, with or without `--dev`, and no compiled artifact) of a stack that carries `packages[]`, such as one `composeStacks([…], { manifest: 'preserve' })` returns, did not serve the stack's own `src/docs/*.md` pages. The boot put them on the config's top level, and a config boot registers that config's package bodies, never its top level. `GET /api/v1/meta/doc` did not list them, and nothing warned. `os build` of the same project, booted as an artifact, served them.

- **What changes.** The config boot places the flat pages where `os build` places them: on the body of the one `packages[]` entry whose id is the stack's `manifest.id`, after that package's own `src/<pkg>/docs/` pages. `GET /api/v1/meta/doc` now lists them under that package, as an artifact boot of the same project does.
- **What stays the same.** A single-package config (no `packages[]`) serves its flat pages under its one package, as before. Each package's own `src/<pkg>/docs/` pages are served under that package, as before. Artifact boots (`os dev`, `os start`, `os serve` with `dist/objectstack.json`) do not change.
- **When nothing moves.** If no entry has the manifest id, if several do, or if the stack declares no `manifest.id`, the flat pages stay on the top level, as `os build` keeps them. A config boot of such a stack still does not list them.
- **A name shared by an inline doc and a flat page.** `os build` refuses this (`docs/duplicate-name`); a config boot does not lint docs. On a single-package config the flat page still replaces the inline doc of the same name. On a multi-package config the flat page is now served under the owning package, and an inline doc on that package's body with the same name is served with the flat page's content.
