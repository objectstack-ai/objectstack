---
'@objectstack/cli': patch
---

fix(cli): `objectstack build` ships every `functions` name under its own name, bound to its own code, and every hook and action ref resolves to its own code (#22886)

Clause-②: no

The runtime resolves a hook's `handler`, an action's `target` and a `functions` key against one namespace, filled from the runtime module (`objectstack-runtime.*.mjs`). The build and the module used to name its entries twice, and the two disagreed:

- **A `functions` key that shared its function with a hook or an action was lost.** `functions: { score: tidy }` beside a hook whose handler is `tidy` shipped as `functions: { tidy_hook: 'tidy_hook' }`, and two keys bound to one function shipped as one.
- **A `functions` key equal to a hook's name, or to an action's `<object>_<action>` ref, was re-keyed and its hook ran the wrong code.** The key shipped as `<name>__2`, a bare string with no callable after load, while the hook's ref resolved to the `functions` entry's code.
- **An action's handler never reached the runtime module**, collision or not, so a script action whose handler could not be lowered to a `body` shipped with a ref that resolved to nothing.
- **A `functions` map exported by name** beside the default export shipped as bare strings: the module read the default export only.

Now an authored `functions` name (a map key, or an array entry's `name`) is always its own ref: it ships under that name and runs its own code. A hook or action ref is internal, so on a collision it is the one that takes a numeric suffix (`hooks[i].handler: '<name>__2'`); the hook's `name` is unchanged. A hook or action bound to the same function as a `functions` entry re-uses that entry's name. The runtime module is generated from the build's own ref → callable map, locating each callable in the loaded config by identity, so it serves every ref the artifact names. A stack with no collision ships the same artifact refs as before.

No action is needed: rebuild to pick up the fix. An artifact built before this release keeps the old names until it is rebuilt.
