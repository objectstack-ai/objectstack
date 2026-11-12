---
'@objectstack/types': patch
'@objectstack/rest': patch
'@objectstack/metadata-protocol': patch
---

feat(types, rest, metadata-protocol)!: a package-scoped refusal names its candidates on every `/data` write door (`details.candidates`)

Clause-②: yes (narrowing) — widened on the wire: a package-scoped refusal's `409 RESOURCE_CONFLICT` gains `details.candidates` on every door listed below, beside an unchanged status, `code`, `error` and `object`; narrowed through `@objectstack/client`: that `409`'s `err.details` is now `{ candidates }` where it was the whole response body, so its `error`, `code` and `object` keys are no longer under `err.details`.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any packages/spec schema, registered type or stored row is added, removed or re-shaped: the change is the members of one HTTP error answer and the object the client SDK hands its caller for it, which `objectstack migrate meta` has nothing to rewrite -->

**BREAKING** for a caller of `@objectstack/client` that reads `err.details.error`, `err.details.code` or `err.details.object` off this `409`.

- FROM `err.details` = the whole response body (`{ error, code, object }` on the flat bodies, `{ success: false, error }` on the wrapped ones) TO `err.details` = `{ candidates }`, on every door that now answers `details.candidates`: `POST`, `PATCH` and `DELETE` on `/data/:object`, `createMany`, the cross-object `POST /batch`, the public form submit, the record-page route, the data-action field projection and search (flat), and the dispatcher's `/data` on `@objectstack/hono`, `GET /meta/:type/:name/layers` and the bare action `/layers` and `/published` (wrapped).
- The fix: read the code and the sentence from `err.code` and `err.message` (unchanged, as is `err.httpStatus`), and the holders from `err.details.candidates` (`addressCandidatesOf`).

A write hook that refuses a by-name value two packages hold (ADR-0150 D5; the `sys_user_permission_set` grant hook's `409 RESOURCE_CONFLICT` when two packages ship a permission set of the name typed) now tells the caller which packages to choose between. The answer carries the refusal's holders as `details.candidates`, `[{ kind: 'package', packageId }, …]`, the shape the `/actions`, `/automation`, `/meta` and activation doors already answer. Status, `code`, `error` and `object` are unchanged on the wire; the member is added beside them.

- **`@objectstack/types`: `packageScopedRefusalCandidates(error)`**, the one recogniser: by shape (`code === 'RESOURCE_CONFLICT'`, a declared 4xx `status` or `statusCode`, and a `refusal` whose `status` is `'refused'` and whose `candidates` is a list), which core's `PackageScopedNameRefusedError` satisfies. `resolveThrownHttpError` puts the candidates in `details.candidates`, so every door that answers from it gains them for such a refusal: the runtime dispatcher's `errorFromThrown` doors, the Hono adapters' declared-envelope answer (the dispatcher's `/data` on `@objectstack/hono`), the endpoint executor, and the storage, print, package and marketplace-install doors. `mapDataError` (`POST`, `PATCH` and `DELETE` on `/data/:object`) answers them beside `error`, `code` and `object`.
- **`@objectstack/rest`**: `createMany` and the cross-object `POST /batch` answer them on a whole-request refusal; the `/meta` door's reader now asks the shared recogniser.
- **`@objectstack/metadata-protocol`**: a batch row's error (`updateMany`, `deleteMany`, `POST /data/:object/batch` create, update, upsert and delete) carries them as `results[i].errors[0].details.candidates`.

**`@objectstack/client` reads this as a change to `err.details`.** The client sets `err.details` to the body's `details`, else the wrapped `error.details`, else the whole body. Every door that now answers this refusal with `details.candidates` therefore moves `err.details` for that `409` from the whole body to `{ candidates }`: on the flat bodies (`POST`, `PATCH` and `DELETE` on `/data/:object`, `createMany`, the cross-object `POST /batch`, and the doors that send `mapDataError`'s body whole: the public form submit, the record-page route, the data-action field projection and search) it was `{ error, code, object }`; on the wrapped bodies (the dispatcher's `/data` on `@objectstack/hono`, `GET /meta/:type/:name/layers`, and the bare action `/layers` and `/published`) it was `{ success: false, error: { … } }`. So `err.details.error`, `err.details.code` and `err.details.object` are no longer there for that answer; read `err.message`, `err.code` and `err.httpStatus`, which are unchanged, and `err.details.candidates` (`addressCandidatesOf`) for the holders. A batch row's error is part of a `207` answer, which the client returns rather than throws, so it does not move.

Every other `409` (unique violation, stale version, a `RESOURCE_CONFLICT` thrown with no refusal) answers exactly as before.
