---
'create-objectstack': patch
---

fix(create-objectstack): the blank starter wires every directory `os generate` writes into

`npm create objectstack` scaffolded an `objectstack.config.ts` that imported `./src/objects` alone. `os g view`, `action`, `flow`, `dashboard`, `app` and `skill` each wrote a file and a barrel `index.ts` that nothing imported, and `os validate` then exited 0 printing `Logic: 0 Flows`: the generated metadata was never loaded.

**What a new blank project now ships** is the wiring `os init` writes:

- `objectstack.config.ts` imports every directory `os generate` writes into (`src/objects`, `src/views`, `src/actions`, `src/flows`, `src/dashboards`, `src/apps`, `src/skills`) and hands each barrel's exports to `defineStack` under its key (`objects`, `views`, …). A file `os g` writes there is part of the stack with no edit to the config. The keys read the barrels through a small `exportsOf` helper declared in the config, because `Object.values` on an empty barrel does not type-check against `defineStack`'s collection types.
- An `index.ts` containing only `export {};` in each of those directories except `src/objects`, which keeps the sample object.
- `requires: ['automation', 'triggers']`. `automation` was already there for the three connector plugins. `triggers` fires a flow that starts on a record change, the kind `os g flow` writes, and without it the config stops loading as soon as it holds one. A project with no flow boots as before.

**Projects scaffolded by an earlier release** keep their config. `os g` says when a file it wrote is not wired, and prints the lines to add.
