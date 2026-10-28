---
'@objectstack/cli': patch
'@objectstack/runtime': patch
'@objectstack/platform-objects': patch
---

feat(cli, runtime, platform-objects): `os plugin install ./x.osplugin` installs a signed plugin artifact locally, after verifying its signature against the environment's trusted publisher keys and its files against the manifest's `integrity` map (#27123)

Clause-②: no — no key, accepted value or export of `@objectstack/spec` changes; the new object and commands are platform code, not authorable metadata
Metadata-protocol: none

The first slice of ADR-0025's local install loop (§3.5 M1). Before this, a built and signed `.osplugin` had no command that installed it.

- **`os plugin keygen --out PATH`** writes a publisher Ed25519 key pair: `PATH.key.pem` (private, mode `0600`, stays with the publisher) and `PATH.pub.pem`, and prints the key id and the public key's fingerprint (`sha256:` + hex of the SPKI DER bytes). It never overwrites a key file without `--force`.
- **`os plugin trust add PUB.pem --key-id ID`**, **`trust list`**, **`trust revoke ID`** manage the environment's trusted keys in the new deployment-level object `sys_trusted_key` (registered by `PlatformObjectsPlugin`, beside `sys_secret`; no tenant column; `manage_platform_settings`; the API offers reads only). The writes run in system context and are recorded by the audit mirror. Only a public key is accepted: a PEM holding a private key, or a key that is not Ed25519, is refused. One key id names one key and one key carries one key id. A revoked row stays, and neither its key id nor its key is trusted again.
- **`os plugin install ARTIFACT`** reads the archive and refuses, by name and with exit status 1, before anything is written:
  - an entry that could land outside the install directory, two entries that differ only in letter case, or a file that is also the directory of another entry (`artifact_entries_refused`);
  - a file whose digest is not the one the manifest's `integrity` map declares, a declared file that is missing, or a packaged file the map does not name (`integrity_mismatch`);
  - a missing signature (`signature_missing`), one that is there but cannot be read (`signature_unreadable`), a malformed one (`signature_malformed`), a key id the environment does not trust (`signature_key_untrusted`) or has revoked (`signature_key_revoked`), a trusted-key row whose fingerprint is not its key's (`trusted_key_invalid`), and a signature that does not verify over the artifact's bytes (`signature_invalid`);
  - an installations file it cannot read (`record_unreadable`), which a write would clobber, and an install directory that already holds other bytes no installation of this project put there (`install_dir_taken`): two projects sharing one `OS_HOME` and environment share the directory, and one does not overwrite the other's install.

  It then unpacks the artifact to `<OS_HOME>/plugins/<env>/<id>/<version>/`, keeping the original `artifact.osplugin` and `artifact.osplugin.sig` beside the files, and writes an installation record (the version, the key id and fingerprint it verified against) to `<OS_HOME>/plugin-installations/`, keyed by environment and project like the package disable-state store. A swap that fails puts the earlier install of the same version back. `--trust-unsigned` installs an artifact that has no signature, with a warning on stderr; it never makes a present signature that fails verification pass. `--json` prints one document.
- **Not yet.** `os serve` does not load installed plugins: the boot-time loader is the next slice of the same loop.

`@objectstack/runtime` exports the two stores both sides read: `addTrustedKey`, `listTrustedKeys`, `revokeTrustedKey`, `resolveTrustedKey`, `readPublisherPublicKey`, `publicKeyFingerprint`, and `pluginInstallDir`, `loadPluginInstallations`, `recordPluginInstallation`.
