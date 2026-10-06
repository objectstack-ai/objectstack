---
'@objectstack/spec': patch
---

The datasource read redaction resolves a driver's identity the way its sibling helper does. The per-driver half of `redactableConfigKeys` now looks a driver up through `resolveDriverId`, the resolver `passthroughSecretPaths` and the write door's contract lookup already use. So every spelling the write door accepts as a builtin driver is redacted as that driver.

Clause-②: no

- The still-writable credential key is withheld on the datasource admin read (`GET /api/v1/datasources/:name`) and on the metadata read under every accepted spelling of its driver, and `redactedConfigKeys` names it.
- A crafted driver id that made the read throw now answers as a driver the platform ships no contract for: the canonical credential spellings and the former aliases are withheld, and the read succeeds.
- `restoreRedactedConfig` and the credential migration read the same list, so an untouched Save still restores the stored value under every accepted spelling, and the migration names the still-writable key as residue there too.
- Unchanged: what the write door accepts, every export and its type, and the answer for a canonical spelling.
