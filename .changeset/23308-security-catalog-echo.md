---
'@objectstack/plugin-security': patch
---

fix(plugin-security): an environment kernel's security catalog serves metadata-door permission sets and positions again

Clause-②: no

On an environment kernel (the per-project kernel a hosted tenant runs), a permission set or a position saved, published or deleted through the metadata door is in the security catalog again:

- It resolves from the kernel's metadata service, under the package its stored row is bound to.
- A user granted it is authorized by it.
- An `isDefault: true` set in a runtime package records its pending `everyone` suggestion again (ADR-0090 D5).

After a restart, the stored overlays are served again too.

This regressed in C3 stage 8 (`feat(plugin-security)!: retire the four security-catalog row objects`). That change unwired the permission-set projector. On an environment kernel, the projector's in-memory echo was the only thing that put a stored set into the metadata service, because the metadata door hydrates no project row into the engine registry. Since stage 8, such a set resolved to nothing and granted nothing (fail-closed), and no suggestion was recorded.

Positions never had an echo. On an environment kernel, a metadata-door position was unresolved before stage 8 as well, and it now resolves.

`SecurityPlugin` now registers its own mutation projector for `permission` and `position` on the protocol, plus one pass over the stored environment-wide overlays at `kernel:ready`. Both only register the overlay body in the metadata service. They write no row, and they change nothing a host kernel resolves, since a host kernel reads these from the engine registry first.
