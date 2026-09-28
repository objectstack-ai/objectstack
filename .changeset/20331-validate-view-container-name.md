---
'@objectstack/cli': patch
'@objectstack/objectql': patch
---

fix(cli): `os validate` refuses a `views:` container whose own `name` disagrees with the object it binds to, the stack the server refuses at boot (#20331)

Clause-②: no

A view container is registered under the object it binds to. When its own `name`
is set to something else, for example `{ name: 'order_line', object: 'my_app_order_line', list: { … } }`,
the server refuses the whole stack at boot. `os validate` used to pass that stack
at exit 0, so the first sign of the mistake was a server that would not start.

`os validate` now runs the same check the server runs at boot and prints the same
message. The text form and `--json` both exit `1`. The `--json` failure payload lists
one `errors` entry per refused container, with `path` (for example `views[0]`, or
`packages[1].manifest.views[0]` in a multi-package stack), `code: 'VALIDATION_ERROR'`,
`httpStatus: 400` and `message`. Every other exit, and the success payload, are
unchanged.

**Fix:** remove the container's `name`, or set it to the object name the message names.

`@objectstack/objectql` exports the check as `viewContainerNameRefusal(container, sourceLabel, ownerId)`,
with its type `ViewContainerNameRefusal`. It returns the refusal the boot registrar
throws, or `undefined`. The boot registrar now calls this function. What it refuses,
its message and its `VALIDATION_ERROR` / `400` envelope are unchanged.

Not changed: `os build` does not run this check, so it still writes an artifact
carrying such a container, and the server refuses that artifact when it loads it.
