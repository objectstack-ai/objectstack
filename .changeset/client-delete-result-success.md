---
"@objectstack/client": major
"@objectstack/cli": patch
---

fix(client)!: `DeleteDataResult` declares the schema it names — `success`, not `deleted` (#5638)

`DeleteDataResult` — the return type of `client.data.delete()` and of the
project-scoped `client.project(id).data.delete()` — carried the comment
`Spec: DeleteDataResponseSchema` above a declaration that contradicted it:

```ts
/** Spec: DeleteDataResponseSchema */
export interface DeleteDataResult {
  object: string;
  id: string;
  deleted: boolean;   // ← the schema declares `success`
}
```

`DeleteDataResponseSchema` (`packages/spec/src/api/protocol.zod.ts`) declares
`{ object, id, success }`. `deleted` has never been declared by any schema, and
no server path has ever returned it on `/data/:object/:id`.

**The old key was never readable at runtime — this rename reveals a defect, it
does not break working code.** Both `delete` surfaces are pure `unwrapResponse`
/ `_unwrap` passthroughs: the SDK returns the server's body untouched, so this
interface is a *claim* about the wire, never a rewrite of it. The claim was
false in the one direction that matters — the compiler endorsed the wrong
spelling:

```ts
const r = await client.data.delete('task', id);
if (r.deleted) { … }   // compiled; `undefined` at runtime; branch never taken
if (r.success) { … }   // rejected by the compiler; correct on the wire
```

## What to change

`r.deleted` → `r.success`. That is the whole migration. Nothing about the
request, the route, the status codes or the error shapes changes, and no server
needs upgrading: the value you are now allowed to read is the one that was
already arriving.

⛔ **Do not write `r.success ?? r.deleted`.** There is one producer shape, and a
consumer that accepts two spellings is the shape contract-first exists to
prevent — the same ruling #5581 applied on the producer side. No deprecated
`deleted?: boolean` transition key ships for the same reason; a transition
period is for keys that *worked*, and this one never did.

## Why the type was wrong on every deployment, not just some

The protocol path (`deleteData`) has always answered `success`. #5581 / PR
#5641 brought the ObjectQL fallback — the path a slim assembly without
`MetadataPlugin` takes — to the same shape. So before that fix the declaration
was wrong on ordinary deployments and accidentally right on slim ones; after
it, both paths answer `{ object, id, success }` and the declaration was simply
wrong everywhere. The consumer-side correction had to follow the producer, not
lead it.

## `os data delete` was reading the phantom key too

`packages/cli/src/commands/data/delete.ts` built its `--format json` / `--format
yaml` payload with `deleted: result.deleted`. That evaluated to `undefined`, and
`JSON.stringify` drops undefined values — so the `deleted` key the command has
always declared **never appeared in a single run**. It now carries
`result.success`, the server's own verdict.

Observable change: `os data delete --format json` gains `deleted: true` (YAML
likewise) on a successful delete. The key name stays `deleted` deliberately —
it is the CLI's output key, not the protocol's, and the payload's top-level
`success` already means something different (the CLI envelope's "the command
completed"). Conflating the two is the hazard #5641 called out when it noted
that `body.success` and `body.data.success` are different facts. Scripts
reading `.deleted` from this command were reading `undefined` before and get a
boolean now; nothing that worked stops working.

## Downstream

`objectui`'s `ObjectStackDataSource.delete()` is a live victim of the old
declaration — it guards `emitMutation` on `result.deleted`, so the delete
mutation event has never fired against a real server and the method returns
`undefined` where it declares `boolean`. Its own suite stayed green because the
fixture mocks `{ deleted: true }`, a body no server produces. Filed as
objectstack-ai/objectui#3412, which is blocked on this package publishing —
its fix is a type unblock, not a behaviour change, since `success` is already
what arrives.

## Pins

`packages/client/src/data-delete-result-shape.test.ts` asserts mutual
assignability between `DeleteDataResult` and the spec's `DeleteDataResponse`,
so a rename on either side (or a re-added optional `deleted`) fails
`check:test-typecheck`. `client.hono.test.ts` gains the delete case this live
server suite never had: a real DELETE over HTTP whose body is read as
`deleted.success` and whose key set is asserted literally — `z.object` strips
unknown keys, so a passing parse alone cannot prove no stray `deleted` rode
along.

<!-- adr-0087: registered client-delete-result-success -->
