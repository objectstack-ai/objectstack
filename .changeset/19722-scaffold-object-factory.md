---
"@objectstack/cli": patch
---

`os init` (the `app` and `plugin` templates) and `os generate object` now declare the object they scaffold with `ObjectSchema.create({ … })` — the one authorised shape for a `*.object.ts` — instead of a `Data.ServiceObject`-annotated object literal (#19722).

The factory parses the declaration against `ObjectSchema` when the file is evaluated, so a mistake surfaces in the file where it was written; the typed literal deferred every check to a build the author might never run. `create-objectstack`'s starter, the data-modeling docs ("Every object definition follows this pattern") and every object file in this repository already used the factory — the two CLI doors were the outliers, and they now write the same shape as each other and as everything else.

- **What a new scaffold contains**: `import { ObjectSchema } from '@objectstack/spec/data';` (a value import — the factory runs), `const myAppItem = ObjectSchema.create({ … });`, and the unchanged `export default myAppItem;`. The barrel lines both commands write (`export { default as … }`) are unchanged, as are the object's fields, its `sharingModel` and the comment explaining it.
- **Projects you already scaffolded keep working.** Nothing reads the old file differently at runtime, and nothing here renames or rewrites a file you have.
- **Converting an existing file is one mechanical rewrite** — wrap the literal in `ObjectSchema.create( … )`, drop the annotation, and import the factory:

  ```ts
  // before
  import * as Data from '@objectstack/spec/data';
  const myAppItem: Data.ServiceObject = { name: 'my_app_item', /* … */ };
  export default myAppItem;

  // after
  import { ObjectSchema } from '@objectstack/spec/data';
  const myAppItem = ObjectSchema.create({ name: 'my_app_item', /* … */ });
  export default myAppItem;
  ```

  If the converted file now throws when it loads, the factory has found something the literal was carrying unchecked — an unknown top-level key, for example — and the message names it.
