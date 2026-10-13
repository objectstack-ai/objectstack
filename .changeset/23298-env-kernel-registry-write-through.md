---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an environment kernel that hydrates its own `sys_metadata` writes a published body through to its engine registry, so a narrowed permission set stops granting its old body without a restart

Clause-②: no

- **What was wrong.** The protocol's registry write-through skipped every type except `object` whenever the protocol had an `environmentId`. A kernel that hydrates its own store at boot (the standalone stack's `env_local`, or a hosted kernel with `hydrateMetadataFromDb`) put every stored body into its registry at boot and then never updated it. A save was accepted and served by `GET /api/v1/meta/:type/:name`, but the engine registry kept the boot-time body until a restart. The security catalog reads that registry first, so a permission set narrowed through `PUT /api/v1/meta/permission/:name` kept resolving its earlier, wider body.
- **What changed.** The write-through now asks whose registry it is, not whether the kernel has an environment. It registers the published body wherever the registry takes this kernel's stored rows: on an unscoped kernel, as before, and on an environment kernel once the boot has hydrated that kernel's own store into it (`loadMetaFromDb`). The delete's heal re-registers a MetadataService baseline on the same kernels, so a save followed by a reset does not leave the deleted body in the registry.
- **Unchanged.** An environment kernel whose store is never hydrated into its registry still writes nothing into it, so a registry shared with unscoped callers never receives a project-scoped row. The `object` branch and the organization-scope refusal are unchanged. What the registry holds after a save is what it holds after a restart.
