---
'@objectstack/cloud-connection': patch
'@objectstack/cli': patch
---

fix(cloud-connection,cli): an exported `<base>.custom` installed on another environment lands in that environment's writable pair, and its overrides are served (ADR-0146 D2 / D3)

Clause-②: no
Metadata-protocol: none

- **Before.** `os package install <export>/objectstack.json` of a base's paired customization package answered success and printed "Package installed into the running kernel", but the install registered the pair as code. None of its overrides was served, `GET /packages/<base>/customizations` listed none of them, and the pair turned read-only, so `ensure-customization` answered `writable: false` and every further save into it was refused `WRITABLE_PACKAGE_REQUIRED`.
- **Now.** `POST /api/v1/marketplace/install-local` installs a pair as what it is. The target's own pair is answered by its ensure door, which creates it when absent. Every item of the body is then written into it through the save door a Studio edit takes, with `mode: 'publish'` and the installer as actor, in load order. The overrides are served at once, the customization read lists them, and the pair stays editable. Nothing is registered as code or written to the cached-manifest directory. The answer carries `customizationPair` (`basePackageId`, `packageId`, `created`, `writable`), `writtenCount` and `written`, and the CLI prints them.
- **Refusals, nothing written.** A body key with no item form (code, a `translations` bundle, a key the install-key table does not classify), a nameless item, or two items claiming one name: `422`, every problem listed. A pair manifest the ensure door would not write: `400 PLUGIN_MANIFEST_INVALID`. A pair inside a multi-package artifact: `422`. A pair already read-only on the target: `409 RESOURCE_CONFLICT`, asked before the ensure door. If an earlier install registered it as code, the message names the uninstall and the restart that clear it. The ensure door's own refusal is relayed with its status and code.
- **A save refused part-way.** The answer is a failure with the save's code and status, naming the item and where it sits in the body. A pair this install created is deleted again. A pair that existed before is kept, and the answer lists the items written and the ones not written.
- **The CLI.** A runtime that predates this answers a pair as a managed install. The CLI now prints that as an error with the way back (uninstall, upgrade and restart, install again) and exits 1, instead of printing success.
