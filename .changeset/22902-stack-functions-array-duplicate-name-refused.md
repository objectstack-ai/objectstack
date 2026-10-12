---
'@objectstack/spec': minor
---

feat(spec)!: `defineStack` refuses two entries of one stack's `functions` array that author the same `name`, naming the name and every index (#22902)

Clause-②: no (narrowing)

<!-- adr-0087: registered stack-functions-array-duplicate-name-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for breaking changes.

Functions are one flat namespace resolved by name: a hook's `handler`, an action's `target` and a flow `script` node's `config.function` all look a function up by its name. The `functions` **array** form could author one name twice, and nothing refused it. Measured on `main` at this change's base with `functions: [{ name: 'kc_a', handler: first }, { name: 'kc_a', handler: second }]`:

- `objectstack validate` exited 0 (`valid: true`);
- `objectstack build` exited 0 and shipped `[{ name: 'kc_a' }, { name: 'kc_a__2' }]`: the second entry went out under a suffixed internal ref the author never wrote and nothing references, and `kc_a` ran `first`;
- a source boot (`objectstack serve`, no build) registered `kc_a` as `second` and dropped `first`, with no notice.

So the same stack ran different code under `kc_a` depending on whether it was built. `composeStacks` already refused one name defined by two stacks (`STACK_COMPOSE_FUNCTION_CONFLICT`); this is the one-stack case.

**What is refused.** `defineStack`'s cross-reference pass refuses the stack with its existing envelope (`STACK_CROSS_REFERENCE_INVALID`, status 422, `defineStack cross-reference validation failed (N issues):`), one finding per colliding name, naming the name and every index:

```text
✗ Function 'kc_a' is declared twice in the `functions` array: stack.functions[0] and stack.functions[1]. …
```

It runs in an object-less stack too, and every entry counts, byte-identical twins included. `objectstack validate`, `objectstack build` and a source boot all load the config through `defineStack`, so all three refuse it at load (`--json`: `code: 'STACK_CROSS_REFERENCE_INVALID'`, exit 1). Like every cross-reference check it is skipped under `defineStack(…, { strict: false })`.

**Unchanged.** The map form, which cannot author one name twice; an array whose names are distinct; the suffixed refs a build emits for an internal slot (`kc_a__2` beside `kc_a` is two names); and the cross-stack refusal in `composeStacks`.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `functions: [{ name: 'sync', handler: a }, { name: 'sync', handler: b }]` | `functions: [{ name: 'sync', handler: a }, { name: 'sync_backup', handler: b }]`, and point each hook, action or script node that meant `b` at `sync_backup` |
| two entries that are the same function under one name | one entry: delete the other |

**The one-line fix: give each `functions` array entry its own `name`, or merge the duplicates into one entry.**

No D2 conversion rewrites it: which entry keeps the name, and what every caller of the other one should name instead, is the author's call. Its D3 record is the semantic entry `stack-functions-array-duplicate-name-refused` (protocol 18).

**Who is affected, measured.** On `main` at this change's base, no example app, fixture or test authors one name twice in a `functions` array: the four example apps author the map form or none, and every array-form fixture under `packages/` names distinct entries. Deployed metadata and other repositories were not measured.
