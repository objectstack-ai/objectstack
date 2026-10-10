---
'@objectstack/spec': minor
'@objectstack/service-storage': minor
---

feat(storage)!: the storage scope `public` is retired — no scope ever made a file publicly readable, and `acl: 'public_read'` stays the one opt-in for anonymous download (#22443)

Clause-②: no (narrowing)

<!-- adr-0087: registered storage-scope-public-retired -->

**BREAKING** — an accept-set narrowing on two published surfaces, shipped as `minor` under the launch-window convention for accept-set narrowings.

`StorageScopeSchema` described `public` as "publicly accessible static assets", and the upload doors stored a caller's `scope: 'public'` on the new file. Neither ever made a file public. The download doors judge a file by its `acl`, the `attachments` scope and field ownership alone, so a file uploaded with scope `public` and the default acl was stored private, needed a signed-in caller, and nobody was told (ADR-0049 enforce-or-remove). ADR-0104 makes `acl: 'public_read'` the one opt-in for anonymous download, so the scope is retired, not enforced: enforcing it would have let any uploader make a file anonymous at upload.

### What now refuses `public`

- **The presigned upload door and the chunked upload door** (`@objectstack/service-storage`) answer an upload naming `scope: 'public'` with `400 INVALID_REQUEST`, before any file row, session row, upload URL or backend upload exists. The message names the remedy. Every other scope, and an omitted one, is taken exactly as before.
- **`StorageScopeSchema`** (`@objectstack/spec`): `public` left the enum. Writing it fails `tsc`, and parsing it, on its own or as `ObjectStorageConfig.scope`, fails with the prescription instead of zod's generic enum message.

### FROM → TO

| before | what to write instead |
| --- | --- |
| an upload with `scope: 'public'` | another scope, or no `scope` for the default `user`; then set `acl: 'public_read'` on the stored file record of each file that must be readable before sign-in |
| `ObjectStorageConfig` with `scope: 'public'` | another scope, or no `scope` for the default `global` |

**The one-line fix: stop naming scope `public`, and mark each file that must render before sign-in `acl: 'public_read'` on its stored file record.** The upload request carries no `acl`: every upload is stored `acl: 'private'`, so adding an `acl` to the upload request changes nothing.

**Files already stored with scope `public`** are not touched. They download exactly as they did: a signed-in caller gets them, an anonymous one gets `401`, unless the file is `acl: 'public_read'`.

### The retirement kit

- **Schema.** `StorageScopeSchema` retires the member with `enumWithRetiredValues`. No D2 conversion: no metadata type carries this schema or the upload request, so `os migrate meta` has no authored source to rewrite.
- **D3 entry `storage-scope-public-retired`** carries the judgement no rewrite can make: whether a file that was uploaded as `public` must really be readable before sign-in.
- **Upload request contract.** The `scope` description on the presigned and chunked request schemas no longer offers `public` as an example, and says what the scope is and is not.
- **Liveness.** No ledger row: the liveness ledger walks metadata types, and no metadata type carries `StorageScope`.

**Measured producers: none.** At origin/main da159f74e6, nothing in `packages/`, `examples/`, `apps/`, `skills/` or `content/docs/` uploads with scope `public` or declares an `ObjectStorageConfig` with it. The one hit was a `@objectstack/spec` request-schema test fixture, changed to `tenant` here. The same search finds 29 `scope: 'attachments'` writes, which is its control. At the `.objectui-sha` pin f0268ad784 and at objectui main 2063f7a, the upload adapter forwards a caller's scope and no caller names `public`: the console passes none, and the record attachments panel passes `attachments` (the control). Deployed callers and stored rows NOT MEASURED.
