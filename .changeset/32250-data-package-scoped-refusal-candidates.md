---
'@objectstack/types': patch
'@objectstack/rest': patch
'@objectstack/metadata-protocol': patch
---

feat(types, rest, metadata-protocol): a package-scoped refusal names its candidates on every `/data` write door (`details.candidates`)

Clause-②: yes (widening)
Metadata-protocol: none

A write hook that refuses a by-name value two packages hold (ADR-0150 D5; the `sys_user_permission_set` grant hook's `409 RESOURCE_CONFLICT` when two packages ship a permission set of the name typed) now tells the caller which packages to choose between. The answer carries the refusal's holders as `details.candidates`, `[{ kind: 'package', packageId }, …]`, the shape the `/actions`, `/automation`, `/meta` and activation doors already answer. Status, `code`, `error` and `object` are unchanged; the member is added, nothing narrows.

- **`@objectstack/types`: `packageScopedRefusalCandidates(error)`**, the one recogniser: by shape (`code === 'RESOURCE_CONFLICT'`, a declared 4xx `status` or `statusCode`, and a `refusal` whose `status` is `'refused'` and whose `candidates` is a list), which core's `PackageScopedNameRefusedError` satisfies. `resolveThrownHttpError` puts the candidates in `details.candidates`, so every door that answers from it gains them for such a refusal: the runtime dispatcher's `errorFromThrown` doors, the Hono adapters' declared-envelope answer (the dispatcher's `/data` on `@objectstack/hono`), the endpoint executor, and the storage, print, package and marketplace-install doors. `mapDataError` (`POST`, `PATCH` and `DELETE` on `/data/:object`) answers them beside `error`, `code` and `object`.
- **`@objectstack/rest`**: `createMany` and the cross-object `POST /batch` answer them on a whole-request refusal; the `/meta` door's reader now asks the shared recogniser.
- **`@objectstack/metadata-protocol`**: a batch row's error (`updateMany`, `deleteMany`, `POST /data/:object/batch` create, update, upsert and delete) carries them as `results[i].errors[0].details.candidates`.

**`@objectstack/client` reads this as a change to `err.details`.** On the flat `/data` doors that answer such a refusal whole (`POST`, `PATCH` and `DELETE` on `/data/:object`, and `createMany`), the body now carries a top-level `details`, which the client reads before it falls back to the whole body. So `err.details` for that `409` is now `{ candidates }` where it was the entire body `{ error, code, object }`. `err.code`, `err.message` and `err.httpStatus` are unchanged.

Every other `409` (unique violation, stale version, a `RESOURCE_CONFLICT` thrown with no refusal) answers exactly as before.
