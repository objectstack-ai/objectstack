---
"@objectstack/cloud-connection": patch
---

An install-local uninstall (`DELETE /api/v1/marketplace/install-local/:manifestId`) now withdraws the package from the running kernel

Clause-②: no

- The DELETE used to remove the ledger entry and run the uninstall cleanups, but it left the package registered in the running kernel until the next restart. So another package's hot install re-ran the declared-permission seeding over the uninstalled package too. Its permission set came back as a package-managed row, and that row survived the restart as an orphan that an administrator could grant.
- After the ledger entry is removed, the door now calls `SchemaRegistry.uninstallPackage`, the same verb the protocol's own uninstall uses, on the same registry. It does this before the cleanups run. The package's objects answer 404 straight away, not only after a restart, and no reader of the registered packages counts it again. A reinstall of the same package in the same process registers it again.
- If the registry refuses the withdrawal, for example because another package extends an object this package owns, the uninstall still succeeds and the cleanups still run. The refusal is reported as a failed `registry.uninstallPackage` entry in `cleanups`. The operator log carries the cause and the remedy.
- The response `note` no longer says the kernel cannot unregister a package in place. The request and response keys are unchanged.
