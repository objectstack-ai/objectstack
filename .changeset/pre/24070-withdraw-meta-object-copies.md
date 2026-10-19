---
'@objectstack/cloud-connection': patch
---

Clause-②: no

fix(cloud-connection): an install-local uninstall takes the package's objects out of `GET /api/v1/meta/object` and `GET /api/v1/meta/object/NAME` at once, not at the next restart

- **What was wrong.** An install-local install registers the package through the `manifest` service, and that register does two things: it puts the package in the engine's registry, and it copies each of the package's objects into the `metadata` service, stamped with the package's id. `DELETE /api/v1/marketplace/install-local/:manifestId` withdrew the registry half only. The object listing merges the `metadata` service into its answer and the by-name read asks that service first, so both kept serving every object of the uninstalled package, with its `_packageId`, until the runtime restarted, while `GET /api/v1/data/OBJECT` already answered `404`. The console's object pickers and Studio's object list offered objects that no longer existed.
- **What changes.** Right after the registry withdrawal, the DELETE removes from the `metadata` service each object copy stamped with the package's id whose name the registry no longer serves. The object listing and the by-name read stop serving the package's objects in the same process, as its data route, `GET /api/v1/meta/app` and `GET /api/v1/meta/permission` already did.
- **Not touched.** A same-name object the package did not copy there (one without its stamp) stays. The package's tables and rows are untouched, as before. A refused registry withdrawal still leaves the whole package loaded until the next restart, its copies included.
- **A copy the service refuses to remove** is reported on the DELETE answer as a failed `cleanups` entry named `metadata.unregister`, the way a refused registry withdrawal is reported, and the operator log names the objects kept and the remedy: restart the runtime. The uninstall cleanups still run, and the answer is still `200`. When nothing is refused, `cleanups` is unchanged.
