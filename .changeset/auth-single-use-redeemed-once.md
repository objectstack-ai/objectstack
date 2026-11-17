---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a single-use auth value is redeemed at most once, even across processes sharing a database

Clause-②: no
Metadata-protocol: none

better-auth redeems its single-use values (email verification, password reset, magic-link and one-time codes, and the other values it keeps in `sys_verification`) through the storage adapter's `consumeOne`. The ObjectQL adapter now hands a redeemed value back only to the call whose own delete removed the stored row, and answers `null` to every other call, as better-auth's `consumeOne` contract requires. This holds for any number of server processes on one database.

A value that was already redeemed answers `null`, which better-auth refuses as an invalid or expired value. A single redemption is unchanged: it receives the value and removes it.

The adapter reads the data engine's delete answer to decide. A data engine whose delete answers neither whether nor how many rows it removed (`IDataEngine.delete` declares `boolean | number`) now fails the redemption with an error naming that answer, rather than handing the value back.
