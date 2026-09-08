---
"@objectstack/service-storage": minor
---

feat(storage): `mountStorageRoutes` — mount the storage routes on a host-owned HTTP surface, composed from a kernel that has no `http-server` service (#15169)

`StorageServicePlugin` mounts `/api/v1/storage/*` itself, at `kernel:ready`, on the kernel's `http-server` service. A hosted per-environment tenant kernel registers no such service, so the storage service, `sys_file`, the lifecycle hooks and the reap guards were all present while every `/api/v1/storage/*` request answered 404 — an app with an attachment field could not upload. The settings service already had a working host bridge because `registerSettingsRoutes` and everything it needs are public; storage could not be bridged the same way because `registerStorageRoutes` needs three package-internal seams: the upload session resolver, the ADR-0104 D3 download authorization gate, and the tombstone holder predicate.

**New export: `mountStorageRoutes(http, kernel, options?)`** (with `MountStorageRoutesOptions`, `StorageRouteKernel`, `StorageRoutesMountReport`). One entry point that takes the host's `IHttpServer`-shaped surface and the environment kernel, binds the three seams from that kernel's own `auth` service and data engine, and registers the full route table — the composition the plugin's own mount now calls too, so a host's storage door and the plugin's are one code path. The options carry wire knobs only (`basePath`, `presignedTtl`, `sessionTtl`, `downloadTtl`, `logger`): the three gate seams are not accepted in any form, so a consumer cannot substitute, omit or bypass the download gate, and the platform keeps exactly one definition of it. The return value reports which gates bound, as booleans. A kernel with no `storage` service throws naming the remedy; a kernel with no `auth` service or no data engine mounts with the matching gate off and warns — the plugin's existing bare-kernel behaviour, said out loud.

Deliberately NOT published: `buildAuthSessionResolver`, `buildFileReadAuthorizer` and `findFileHolder` stay package-internal. The narrower surface serves the one consumer that exists (a host mounting the door) and is easier to walk back than three loose functions.

Nothing existing changes shape or behaviour: `registerStorageRoutes` and `StorageRoutesOptions` are untouched, and `StorageServicePlugin` mounts exactly what it mounted before.
