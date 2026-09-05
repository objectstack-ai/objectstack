---
"@objectstack/cli": patch
---

`os package publish --help` no longer points its local-dev example at a directory this repo does not have.

The last line of the command's `EXAMPLES` block read:

```
$ OS_CLOUD_URL=http://localhost:4000 os package publish    # local dev (apps/cloud)
```

`apps/cloud` was deleted from this repository — the reference cloud host now lives in `objectstack-ai/cloud` — so the parenthetical sent a reader to a path that is not in the tree they cloned. This is help text, not a source comment: it is printed verbatim to anyone who runs the command.

The parenthetical is dropped rather than re-pointed at the other repo. The example is about `OS_CLOUD_URL` overriding the control-plane URL, which the `--server` flag already documents in the same output; which directory happens to serve `localhost:4000` was never part of what the example teaches, and a `--help` reader is not looking for a file in a monorepo. `# local dev` alone carries it, and it now matches how the CLI reference docs have long published the same example.

No behaviour changes: `examples` is a static help string, and no flag, argument, default or exit code moves.
