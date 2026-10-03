---
"@objectstack/metadata-protocol": patch
---

An expanded view of a stored view container is reported as tenant-authored on an unscoped kernel, as it already was on an environment-scoped one: not resettable, and with no `code` layer

Clause-②: no

On an unscoped (control-plane) kernel, registry hydration registers each view a stored environment-wide container expands, under that view's own name. The container was registered with the tenant-authorship marker (`_provenance: 'org'`), and its expansions were not. An expansion of a container bound to a package therefore carried that package's id and no marker, and the registry's artifact lookup took it for a view the package ships. For such a name `getMetaItem` (`GET /api/v1/meta/view/NAME`) answered `resettable: true`, and `getMetaItemLayered` (`/layers`) answered the stored container's expansion as the `code` layer. The `code` layer was also wrong for an expansion of a package-less container. An environment-scoped kernel registers nothing, and answered `resettable: false` and `code: null`.

Each registered expansion now carries its container's marker, applied before the expansion's own artifact envelope, in the same order the container gets it. Where the container's own package ships a view of that name, that artifact's envelope still wins (ADR-0010 §3.3). Both kernels now give the same answer for every expanded name. Studio's reset affordance and its code-versus-overlay diff are drawn from these two values.

The save door is unchanged: it accepts a write by an expanded name on both kernels, as before, and the stored row then answers that name.
