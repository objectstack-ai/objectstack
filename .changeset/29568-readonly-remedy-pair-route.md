---
'@objectstack/runtime': patch
---

Clause-②: no (message text only)
Metadata-protocol: none

fix(runtime): the read-only package refusals name the paired `.custom` route, not the closed package-less save (#29568)

- **Before.** Every `422 WRITABLE_PACKAGE_REQUIRED` from the `/packages` doors (delete, disable, publish, revert, adopt-orphans, the manifest edit, an install with `overwrite`) and the `422 DUPLICATE_SOURCE_NOT_A_BASE` from the duplicate door ended with "customise what this package provides beside it, as environment-level state (ADR-0131 D6): save an item under its own name". That save, made with no `?package`, onto an item the package ships, is refused `403 NOT_OVERRIDABLE` since ADR-0146 D11, so the refusal sent the caller into a second refusal.
- **Now.** The sentence names the ADR-0146 route: `POST /api/v1/packages/<id>/ensure-customization`, then save the item into `<id>.custom` (`?package=<id>.custom`), declaring `overrides: { package: '<id>', basedOn }` to replace an item the package ships. It also says that a type that takes no override, or a locked item, is refused naming its route or the lock, and that a package that cannot have a pair (no namespace, for example) is refused at the ensure door with the reason.
- **Unchanged.** The status, the `code`, the `details`, which doors refuse and in what order. Only the message text changed. A client that reads `code` sees no difference.
