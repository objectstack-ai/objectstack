---
"@objectstack/cli": patch
---

fix(cli): `os generate` gives object names the project's namespace prefix, so `os init -t app` followed by `os g object order_line` passes `os validate`

`os init my-app -t app` writes `manifest.namespace: 'my_app'`. Then `os g object order_line` wrote `name: 'order_line'`, and the next `os validate` exited 1 (`os compile` exited 2) with `Object 'order_line' is missing the package namespace prefix. Rename it to 'my_app_order_line'`. The page's own example, `os g object customer`, failed the same way.

- **Object names are prefixed.** In a project whose manifest declares a `namespace`, every object name a scaffold writes now starts with `<namespace>_`. That covers the `object` scaffold's `name`, a `view`'s `object`, an `action`'s `objectName`, a `flow` start node's `objectName` and an `app` navigation item's `objectName`. Generated scaffolds now also point at each other: `os g view order_line` binds the object `os g object order_line` wrote. The file name and the exported binding still come from the name you typed (`src/objects/order_line.object.ts`, `orderLine`), and the command prints the object name it wrote.
- **No double prefix.** A name that already carries the prefix (`os g object my_app_order_line`) is written as typed. The "already compliant?" check is the namespace-prefix gate's own `validateObjectNamespacePrefix`, so a `sys_*` name, which the gate exempts, is not prefixed either. A name the gate would still refuse after prefixing (the legacy `NS__SHORT` form) is refused before anything is written.
- **One namespace source.** The namespace is `manifest.namespace` of the config as loaded, the value `os validate` checks against. It is never re-derived from the directory or the `package.json` name. With no config, or a manifest without a `namespace`, nothing is prefixed, as before. If a config exists but does not load, a type that names an object is refused and nothing is written, because the namespace is unknown. `dashboard` and `skill` scaffolds name no object and never read the config.
- **Unchanged:** the names the gate does not check against the namespace. A view's, action's, flow's, dashboard's, app's and skill's own `name`, and an action's flow `target`, are written as before.
- `os generate --help` now lists all seven metadata types in the `TYPE` argument. It had omitted `skill`, and the list now comes from the generator table.
