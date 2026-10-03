---
"@objectstack/cli": patch
---

`os secret orphans`, `os storage orphans` and `os migrate files-to-references` no longer create a data key file in the key home. A one-shot command never mints key material (#21471)

Clause-②: no

Each of these commands composes the settings service. Given no crypto provider, the service builds its own default one. In a development posture with no `OS_SECRET_KEY`, no `OS_DEV_CRYPTO_KEY` and no key file, that default writes a new key file into the key home. So a report that promises to write nothing left key material behind, and the next development-posture process on that host adopted the minted key. A minted key opens nothing that is stored, so the run gained nothing from it.

- **What these commands hand the settings service now.** They pass the provider `os secret rewrap` already passed: the one over a data key that already exists, resolved the way every host resolves it, in the strict posture and with the auto-key opt-in withheld, so it never mints. With no key, the service gets a provider that refuses every call and says why. A stored setting that cannot be opened reads as it did with a freshly minted key: empty, with a warning.
- **One composition.** The settings service is composed in one place in `@objectstack/cli` (`utils/one-shot-settings.ts`), shared by `secret orphans`, `secret rewrap` and the storage arm of the data-migration plugins. `os serve` still takes the service's default: persisting a key in a development posture so restarts reuse it is that host's documented behaviour.
- **Visible difference.** On a host whose key lives only in the key file, these commands now print the strict posture's one-line note on stderr ("using the persisted key at …"), as `os secret rewrap` already did. stdout and `--json` output are unchanged.
