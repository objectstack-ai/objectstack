---
'create-objectstack': patch
---

fix(create-objectstack): scaffolding a remote template no longer produces a project that cannot build (#4926)

`npx create-objectstack@latest my-app -t todo` (and `compliance`, `content`,
`contracts`, `procurement`) generated a project that failed `objectstack build`
immediately — 5 of the 6 offered templates. Only the bundled `blank` worked.

The scaffolder read the template's original namespace from
`objectstack.manifest.json`, and that filename names two different documents.
The bundled template's is app-shaped and carries `namespace`; a remote
template's is the template-registry document
(`$schema: …/template-manifest.json`) and carries none — its namespace lives
only in `objectstack.config.ts`. So the value came back `undefined` for every
remote template and the object-name rewrite was skipped, while the config's
`namespace:` was rewritten anyway. The result was `namespace: 'my_app'` sitting
next to `name: 'todo_task'`, which the `${namespace}_${shortName}` rule rejects.
Across the five templates, 74 object names were left unrewritten.

`objectstack.config.ts` is now the authority for the template namespace (it
holds the very literal the scaffolder overwrites, so the two cannot disagree),
with the manifest as fallback. The rewrite also verifies itself: any surviving
stale prefix throws at the scaffold, naming the files and lines, instead of
surfacing as a build failure on the user's first command.
