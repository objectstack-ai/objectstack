---
'@objectstack/service-storage': minor
---

feat(service-storage)!: the `sys_file` scope option `public` is retired, and rows already stored with it are rewritten to `user` by a one-time operator sweep (#22443)

Clause-②: no (narrowing)

<!-- adr-0087: already-registered storage-scope-public-retired -->

**BREAKING** — an accept-set narrowing on the `sys_file` object's `scope` select, shipped as `minor` under the launch-window convention for accept-set narrowings. It completes the retirement registered as `storage-scope-public-retired`: `StorageScopeSchema` and both upload doors already refuse `public`, and now the stored vocabulary does too.

### What changes

- **`sys_file.scope` no longer lists `public`.** Its options are `user`, `tenant`, `private`, `temp` and `attachments`. The engine refuses a write of `public` to the column as it refuses any undeclared option: `VALIDATION_FAILED`, `invalid_option` on `scope`. No access behaviour changes: the only scope value any code reads is `attachments`, and whether a file can be read before sign-in is decided by `acl: 'public_read'` alone.
- **Rows already stored with scope `public` are rewritten to `user`**, by a one-time sweep the operator runs (below), never at boot. `user` is the scope the upload doors and the field-reference copy path default to, and no reader tells it apart from `public`. One column moves: the storage key keeps its `public/` prefix, the acl and ownership columns are untouched, and no byte moves in the storage backend.

### FROM → TO

| before | write instead |
| --- | --- |
| a `sys_file` row written with `scope: 'public'` | `scope: 'user'`, or no scope; and `acl: 'public_read'` on the row if the file must be readable before sign-in |
| rows already stored with `scope: 'public'` | nothing by hand: the sweep below rewrites them to `user` |

**The one-line fix: stop writing scope `public` on `sys_file`, and run the sweep once on each deployment that stored it.**

### The operator step: run the sweep once after upgrading

Until the sweep has run on a deployment that stored `public` rows, a record write that names a `public` file another field already owns is refused. The field-reference copy path copies the file into a new row with the source row's scope, the engine refuses `public` there, and the write fails with `ERR_FILE_REFERENCE_COPY`. The data REST doors answer that `500 INTERNAL_ERROR` ("Internal server error"); the server log carries the full sentence, which ends `Scope must be one of: user, tenant, private, temp, attachments`. Reads, downloads and updates that do not write `scope` are unaffected.

The sweep is `packages/services/service-storage/src/backfill-sys-file-public-scope.ts`, an operator module in the shape of the `sys_file` organization backfill. Like that module it is not exported from the package index and is not in the published `dist`, so run it from a source checkout of this release, server-side, from a context that holds the engine. It is a dry run first, and by default:

```ts
const plan = await planSysFilePublicScopeBackfill(engine);            // counts, writes nothing
console.log(formatSysFilePublicScopeBackfillReport(plan));
const applied = await applySysFilePublicScopeBackfill(engine, plan);  // one scope write per row
console.log(formatSysFilePublicScopeBackfillReport(applied));         // keep it: it is the rollback list
```

It counts before it writes (`scanned`), writes nothing where the count is zero, and is idempotent: every write moves its row out of `scope = 'public'`, so a second run scans and writes zero. A row whose write fails is reported, never retried, and is picked up by the next run.

### Rollback

The inverse is `user` back to `public` on exactly the ids the applied report lists. This release cannot write it through the engine, which refuses `public` like any undeclared option. So the inverse goes with a code rollback: on the previous release, which still declares the option, write `scope = 'public'` back to those ids, through the engine there or as one raw driver statement against `sys_file` filtered to them.

The earlier note of `storage-scope-public-retired` that files already stored with scope `public` are not touched no longer holds for the `scope` column: after the sweep they read `user`. They still download exactly as before.
