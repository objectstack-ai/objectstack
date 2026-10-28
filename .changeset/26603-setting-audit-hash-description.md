---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the settings audit `old_hash` / `new_hash` columns describe both digest formats they carry

Clause-②: no
Metadata-protocol: none

`sys_setting_audit` described `old_hash` and `new_hash` as "SHA-256 of the … value (canonicalised)", and `sys_platform_setting_audit` named no format. A secret row never carries an unkeyed SHA-256, so an operator or agent checking a row against the declared format read every secret row as malformed. Both objects now state what the settings audit writer records:

- **A non-secret value:** `sha256:` followed by the hex SHA-256 of its canonical JSON.
- **A secret value (`encrypted: true`):** the crypto provider's keyed digest, `hmac-sha256:…`. Never an unkeyed hash, which would let anyone holding the trail confirm a guessed secret.
- **Null:** `old_hash` when the previous value was unset, `new_hash` on reset, and either one for a secret when no keyed digest is available.

Rows written before the `sha256:` digest may carry `fnv32:`; compare only values with the same prefix. Only the description text changes: no column type, length or name, and nothing about what is written.
