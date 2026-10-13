---
'@objectstack/spec': minor
'@objectstack/service-storage': patch
'@objectstack/client': minor
---

feat(spec,service-storage,client)!: one upload-scope list — the upload requests' `scope` and the SDK's `storage.upload` close to the new `UploadScope` enum, the `sys_file` scope select is built from it, and the upload doors answer any other scope with `400` naming the allowed values instead of `500 INTERNAL` (#22470)

Clause-②: yes (narrowing)

<!-- adr-0087: registered upload-request-scope-closed -->

**BREAKING** — an accept-set narrowing on a published request contract and on the SDK method that sends it, shipped as `minor` under the launch-window convention for accept-set narrowings, plus one new export.

The presigned and chunked upload requests declared `scope` an open string, while the stored file record (`sys_file.scope`, a closed select) only ever took `user`, `tenant`, `private`, `temp` and `attachments`. Any other value reached the `sys_file` insert, the data engine refused it as an invalid option, and the upload door answered that caller error as `500 INTERNAL`, with a message telling the operator to restore the data engine.

### What changes

- **`UploadScopeSchema` / `UploadScope`** (`@objectstack/spec`, new, exported from `@objectstack/spec/api`): the upload-scope vocabulary, declared once — `user`, `tenant`, `private`, `temp`, `attachments`. It is a different list from `StorageScopeSchema`, which classifies a storage configuration and is not read by any upload.
- **`GetPresignedUrlRequestSchema.scope` and `InitiateChunkedUploadRequestSchema.scope`** read it. The default stays `user`. A literal outside the list fails `tsc`, and a parse refuses it on the `scope` key.
- **`client.storage.upload(file, scope)`** (`@objectstack/client`): the `scope` parameter is typed `UploadScope` instead of `string`, default `user` unchanged, so a scope outside the list fails `tsc` at the SDK call. `client.storage.getPresignedUrl` and `client.storage.initChunkedUpload` take the request types above and narrow with them.
- **The `sys_file` scope select** (`@objectstack/service-storage`) takes its options from the enum, in its order, with the same labels. The stored values do not change.
- **The presigned upload door and the chunked upload door** answer a scope outside the list — any string, a case variant, `null`, a number — with `400 INVALID_REQUEST`, naming the allowed values, before a file record, a session record, an upload URL or a backend upload exists. `public` is refused by the same gate and keeps its remedy (`acl: 'public_read'` on the stored file record). An omitted scope is the default `user`, as before. A real data-engine fault still answers `500`.

### FROM → TO

| before | what to write instead |
| --- | --- |
| an upload naming a scope outside the list (a key prefix such as `avatars`, a folder, a record path) | one of `user`, `tenant`, `private`, `temp`, `attachments`, or no `scope` for the default `user` |
| `client.storage.upload(file, scope)` called with a `scope` typed `string` (`@objectstack/client`) | pass one of the five, or type the value `UploadScope` (`import type { UploadScope } from '@objectstack/spec/api'`) |
| a caller passing a scope typed `string` into either upload request | type it `UploadScope` |

**The one-line fix: send one of the five upload scopes, or none.** `attachments` is for a file whose referrers are record attachment rows (it is what orphan tombstoning reads); `temp` for a scratch file; otherwise `user` or `tenant`.

**No stored file record moves**: no upload naming another scope ever succeeded, so no stored record carries one.

### The kit

- **D3 entry `upload-request-scope-closed`** carries the judgement no rewrite can make: which scope a file that was sent under a free name really belongs under. No D2 conversion: no metadata type carries the upload request, so `os migrate meta` has no authored source to rewrite.
- **Liveness.** No ledger row: the liveness ledger walks metadata types, and no metadata type carries the upload request.
