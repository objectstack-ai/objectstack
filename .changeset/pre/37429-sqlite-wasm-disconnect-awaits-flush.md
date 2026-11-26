---
'@objectstack/driver-sqlite-wasm': patch
---

fix(driver-sqlite-wasm): `disconnect()` returns only after the final flush is on disk

Clause-②: no
Metadata-protocol: none

A file-backed sqlite-wasm datasource wrote its final image from the connection's `close()`, which the Knex pool runs as its destroyer. The pool (tarn) stops waiting for a destroyer after 5 s and resolves anyway. So when that flush (a whole-image write and fsync) took longer, `disconnect()`, a kernel's `stop()` and a refused boot's rollback all returned before the data was on disk. A process that exited right after lost the committed writes, and a reader of the file got the old bytes. `disconnect()` now awaits the flush itself, with no timeout, before it closes the pool, and a flush that fails is thrown from `disconnect()`. A second `disconnect()` that arrives while the first one is still running shares the first one's teardown, instead of waiting for a connection from a pool that is being destroyed.
