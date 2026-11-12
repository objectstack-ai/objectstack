---
'@objectstack/cli': patch
---

fix(cli): `os init` writes its starter object the way `os g object` does, with `Field.*` builders and a named export

Clause-②: no
Metadata-protocol: none

The `app` and `plugin` templates of `os init` wrote the starter object's fields as raw `{ type: 'text', … }` literals and exported the object as a default export only. `os generate object` and the `npm create objectstack` starter write each field through a `Field.*` builder and export the object by name, so a project created by `os init` mixed two styles as soon as its author ran `os g object`.

- FROM: `const myAppItem = ObjectSchema.create({ fields: { name: { type: 'text', … } } }); export default myAppItem;`, with the barrel line `export { default as myAppItem } from './my_app_item.object';`
- TO: `export const myAppItem = ObjectSchema.create({ fields: { name: Field.text({ … }) } }); export default myAppItem;`, with the barrel line `export { myAppItem } from './my_app_item.object';`, which is the line `os g object` appends.

The compiled object is unchanged: each builder returns the literal it replaces. The default export stays, so the starter app, the list view and any code that default-imports the object keep working. Existing projects need no change.
