---
"@objectstack/skills": minor
---

New published package `@objectstack/skills`: the ObjectStack skills catalog (`skills/**` of the repository), shipped in the changeset `fixed` group so it always carries the version of the `@objectstack/*` packages it teaches. Its build copies the catalog into `dist/skills/<skill>/…` byte for byte (the layout the skills CLI's `experimental_sync` reads from `node_modules`), and `files` lists only that tree. The repository's `skills/**` stays the one source of truth and the documented `next` channel; nothing a consumer writes changes.
