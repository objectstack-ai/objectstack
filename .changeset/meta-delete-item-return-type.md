---
"@objectstack/client": minor
"@objectstack/cli": minor
---

fix(client)!: `meta.deleteItem` declares the response the reset door actually sends (#13023)

**BREAKING** for a typed caller, and it breaks nothing that ever worked. Both
`deleteItem` declarations — the unscoped `ObjectStackClient.meta` and the
environment-scoped `ScopedEnvironmentClient.meta` twin — declared
`Promise<{ type: string; name: string; deleted: boolean }>`. That shape is not
merely imprecise, it is **uninhabited**: `DELETE /meta/:type/:name` ends in
`res.json(result)` with `deleteMetaItem`'s return, and not one of that method's
four return branches carries `type`, `name` or `deleted`. Both twins now declare
`DeleteMetaItemResponse` — the type `@objectstack/spec` already exported.

### Migration: FROM → TO

```ts
const r = await client.meta.deleteItem('view', 'shared_grid');

// FROM — compiled, and read `undefined` on EVERY reset, including the ones
//        that really deleted an overlay row. The branch was never taken.
if (r.deleted) { invalidateCache(); }

// TO — the truthful flag, and it tells the two successes apart
if (r.reset) { invalidateCache(); }   // an overlay row was deleted
else { /* none existed — already at the artifact default */ }
```

`r.type` / `r.name` have no replacement: the door never echoed them, and the
caller already holds both — it passed them in.

⛔ Do not write `r.reset ?? r.deleted`. There is one producer shape, and a
consumer accepting two spellings is what contract-first exists to prevent. No
deprecated `deleted?: boolean` transition key ships either: a transition period
is for keys that *worked*, and this one never did.

⚠️ The real work is behavioural, not textual. Every `if (r.deleted)` has been
false since it was written, so re-read what each of those branches was supposed
to do — cache invalidation, registry refreshes and UI reloads guarded that way
have **never run**, and moving to `r.reset` turns them on for the first time.
Note also that `r.reset` and `r.success` are different questions: `success` asks
whether the call was accepted, `reset` whether a row actually went away.

The type name is reachable without a new export from this package —
`import type { DeleteMetaItemResponse } from '@objectstack/spec/api'` — which is
also why no member list is transcribed here. A hand-written local copy of the
schema's members is the very defect this change removes.

### `os meta delete`

The CLI read the phantom key too: its `--format json` / `--format yaml` payload
carried `deleted: result.deleted`, which evaluated to `undefined`, and both
`JSON.stringify` and `yaml.stringify` drop undefined values — so the `deleted`
key this command has always declared **never appeared in a single run**. It now
carries `result.reset`, the door's own verdict. Observable change: `os meta
delete --format json` gains `deleted: true` (YAML likewise) when an overlay row
was removed, and `deleted: false` when the item was already at its artifact
default. The key name stays `deleted` deliberately — it is the CLI's output key,
not the protocol's, and the payload's top-level `success` already means
something different (the CLI envelope's "the command completed"). Same treatment
`os data delete` received one door over.

⛔ The wire is untouched: neither `deleteMetaItem` nor
`DeleteMetaItemResponseSchema` changes. Reality is the contract.

<!-- adr-0087: registered client-meta-reset-result-reset -->
