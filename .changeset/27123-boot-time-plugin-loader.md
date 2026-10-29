---
'@objectstack/cli': patch
'@objectstack/runtime': patch
'@objectstack/core': patch
---

feat(cli, runtime, core): `os serve` loads the plugins `os plugin install` installed, re-verifying each before any of its code is imported, and dispatches on the declared `runtime` tier; `os plugin disable | enable | uninstall` (#27123)

Clause-②: no — no key, accepted value or export of `@objectstack/spec` changes; the loader, the commands and the new exports are platform code
Metadata-protocol: none

The second slice of ADR-0025's local install loop (§3.5 M1). Before this, an installed plugin was unpacked and recorded, and nothing loaded it.

- **The boot-time loader** (`@objectstack/runtime`: `loadInstalledPlugins`, `verifyInstalledPlugins`). `os serve` (and `os dev` / `os start` through it) calls it after the config's own `plugins` are registered and before the kernel bootstraps, then `kernel.use`s each plugin that passed, so dependency order and health checks stay the kernel's. For each installation of this project and environment, in this order, the first failing check refuses that plugin by name and nothing of it is imported:
  - the record names the directory the store derives for its id and version (`install_dir_unexpected`); nothing is read from or removed under any other;
  - a disabled id is skipped, before anything of it is read;
  - the kept `artifact.osplugin` hashes to the recorded sha256 (`artifact_changed`, `install_dir_missing`);
  - its detached signature, over the raw kept bytes and before anything is inflated, names the recorded key id, the key is `active` in `sys_trusted_key` with the fingerprint the install verified, and it verifies (`signature_missing`, `signature_malformed`, `signature_key_mismatch`, `signature_key_untrusted`, `signature_key_revoked`, `trusted_key_invalid`, `trusted_key_changed`, `signature_invalid`, `trusted_keys_unreadable`). So a key revoked since install refuses the plugin at its next boot. An install admitted under `--trust-unsigned` loads with a warning on every boot;
  - the unpacked tree is byte-for-byte the artifact, with no other file and no symbolic link, and the artifact's manifest is the recorded id and version (`tree_changed`, `manifest_mismatch`, `artifact_unreadable`);
  - **the tier dispatch point** (`dispatchPluginRuntime`, ADR-0025 §3.6): `runtime: 'node'` imports the entry module in process; `sandbox` and `worker` are refused by name until M3 routes them (`runtime_not_dispatched`), with no in-process fallback; a manifest that declares no tier is refused (`runtime_undeclared`, default-deny);
  - the entry module is a file of the artifact (`entry_missing`), it imports (`import_failed`), and it exports a plugin (`not_a_plugin`) by the rule a stack's `plugins` entry takes (a plain bundle is wrapped in `AppPlugin`).

  The environment's trusted keys are read once per boot, through the same read-only one-shot boot `os plugin install` reads them through, and only when a signed install needs them; with no installations file nothing is read at all. A refused plugin does not stop the boot: it is printed as one `✗` line naming the refusal, and the banner counts the refusals. An installed plugin never replaces a plugin the boot already registered under the same name (`plugin_name_taken`).
- **The kernel's signature check is real.** `PluginLoader` used to pass any well-formed `signature` a plugin carried. The host that verified the artifact now records its verdict against the plugin object (`recordPluginArtifactVerdict`, `@objectstack/core`), and the loader refuses a plugin whose signature no host verified. No plugin in the repo sets `signature`.
- **`os plugin install`** verifies the signature over the raw bytes before it inflates the archive, and the inflate is bounded (`MAX_UNPACKED_ARTIFACT_BYTES`, 256 MiB; the reader moved to `@objectstack/core` as `readTarGz`, re-exported where the CLI read it). The checks, the write and the record now run under the installations lock. An artifact whose tier the boot does not dispatch installs with a warning naming the refusal, and `--json` carries `boot: { loads, error }`.
- **`os plugin disable ID` / `os plugin enable ID`** keep an installed plugin from loading, or load it again, at the next boot (the package disable-state store, keyed by the plugin environment id). **`os plugin uninstall ID`** marks the installation; the next boot loads nothing of it, removes its directory unless another project sharing the home and environment still records it, drops the record and forgets its disable. Each refuses an id this project has not installed by name (`plugin_not_installed`); `--json` on all three.
- **The installations file takes a lock** for every read-modify-write: `<file>.lock`, created exclusively with the writer's pid. A writer waits up to 10 s for a live holder, then refuses naming it. A lock a crashed process left is cleared by the next writer: its pid is not a live process, or it is older than 5 minutes, or it names the writer's own pid while the writer holds nothing, or it cannot be parsed and is older than a second.
