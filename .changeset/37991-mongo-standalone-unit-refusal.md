---
'@objectstack/driver-mongodb': patch
---

fix(driver-mongodb): a standalone server's refusal of a hooked write names the missing replica set, and the driver says so at boot

Clause-②: no
Metadata-protocol: none

On a standalone MongoDB server, a write on an object that carries a metadata `before*` hook (or an `after*` hook whose `onError` is `abort`) runs in a transaction, and a standalone server runs none. The write was refused with the MongoDB client's own hint, "This MongoDB deployment does not support retryable writes. Please add retryWrites=false to your connection string.", and following that hint changed nothing.

- **The refusal.** A command the server refuses because it ran inside the engine's transaction is now refused with `NOT_IMPLEMENTED` (501), saying that the server is a standalone `mongod`, why the write runs in a transaction, and the fix: run MongoDB as a replica set (a single-node one is enough). The client's error is kept as `cause`. Only the text changes: the same writes are refused as before, and a write on an object that opens no transaction is unaffected. Every other error passes through unchanged.
- **At boot.** `connect()` sends one `hello` and, on a standalone server, logs one warning that writes running in a transaction will be refused on this store, and how to fix it. A replica set member or a `mongos` logs nothing, and a probe that fails reports nothing.

Nothing to migrate.
