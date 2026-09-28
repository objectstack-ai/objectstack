---
"@objectstack/cli": patch
---

fix(cli): what `os generate` writes now reaches the stack, or the command says it does not

`os init my-app -t app` wrote a config that imported `./src/objects` alone. `os g view`, `action`, `flow`, `dashboard`, `app` and `skill` each wrote a file and a barrel `index.ts` that nothing imported, and `os validate` then exited 0 printing `UI: 0 Apps` and `Logic: 0 Flows`: a green that had judged nothing the command just wrote.

**What `os init` now writes (`app` and `plugin` templates):**

- `objectstack.config.ts` imports every directory `os generate` writes into (`src/objects`, `src/views`, `src/actions`, `src/flows`, `src/dashboards`, `src/apps`, `src/skills`) and hands each barrel's exports to `defineStack` under its key (`objects`, `views`, …). A file `os g` writes there is part of the stack with no edit to the config. The keys read the barrels through a small `exportsOf` helper declared in the config, because `Object.values` on an empty barrel does not type-check against `defineStack`'s collection types.
- An `index.ts` containing only `export {};` for each directory the template puts nothing in. An `index.ts` that already exists is kept as it is and never overwritten.
- `requires: ['automation', 'triggers']`. A flow that starts on a record change is fired by `triggers` and run by `automation`. If either one is missing, `defineStack` refuses the config as soon as it holds such a flow.

**What `os generate` now does:**

- After writing, it loads the project's config again and reports on the new item. Either the stack carries it, or it is **not wired** (the file is written, the config is left untouched, and the command prints the import and `defineStack` key to add). It never edits the config.
- It refuses a write that makes a config that loaded stop loading, for example an action or app bound to an object nobody declared, or a flow in a stack without `triggers` or without `automation`. It removes what it wrote, exits 1, and prints the stack's own reason. Generate the object first (`os g object customer`), then what binds to it. `dashboard` and `skill` now read the config too, so they can report, and they still generate when the config does not load.
- A view's own `name` is now the object it binds to, prefix included (`my_app_order_line`, not `order_line`). The server registers a view under its object and refused, at boot, a scaffold whose `name` disagreed. That never showed while the views barrel was not loaded.
- The barrel step asks the compiler whether the barrel already exports the name, instead of searching the file's text. `os g view order` after `os g view order_line` had found `order` inside `orderLine` and exported nothing.
- The `flow` scaffold's header states the `requires` it needs.

**Projects scaffolded by an earlier release** keep their config. `os g` now tells you when a file it wrote is not wired, and prints the lines to add.
