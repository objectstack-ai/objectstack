---
"@objectstack/verify": patch
---

`bootStack` (and so `os verify`) no longer creates a data key file in the key home, and no longer seals its fixtures under a key the host already holds (#21499)

Clause-②: no

The harness composed the settings service with no crypto provider and bound the engine to a default `LocalCryptoProvider`. `bootStack` forces a development posture. In that posture, with no `OS_SECRET_KEY`, no `OS_DEV_CRYPTO_KEY` and no key file, both providers wrote a new key file into the key home. So `os verify`, a one-shot command over an in-memory database, left key material behind, and the next development-posture process on that host adopted it. On a host that already had a key, the harness sealed its throwaway fixtures under that real key.

- **What the harness uses now.** One `LocalCryptoProvider` over a random key held in this process's memory only. It never reads `OS_SECRET_KEY`, `OS_DEV_CRYPTO_KEY` or the key file, and it never writes anywhere. The settings service and the engine get the same instance, so `secret` fields and encrypted settings still seal and open on a host with no key at all.
- **One key per process, not per boot.** Two `bootStack` calls over one `databaseFile` in the same process (the harness's restart) still open each other's secrets.
- **Unchanged.** `BootOptions` and the rest of the public API, and `os verify`'s stdout and `--json` report. The one stderr line announcing the minted key file is gone.
