---
"@objectstack/driver-turso": patch
---

A remote Turso deployment (a `libsql://`, `https://` or `wss://` URL) now reads the objects it synced at boot back in their declared types. A `boolean` field reads `true`/`false` instead of `1`/`0`, and a `json` field reads the parsed value instead of its stored text (#19844).

The engine's boot schema sync (`ObjectQLPlugin`) reaches this driver through `syncSchemasBatch`, because the driver declares `supports.batchSchemaSync`. On the remote transport that method ran the DDL and stopped. It skipped the steps its two sibling doors, `syncSchema` and `initObjects`, run afterwards. On every object a remote app synced at boot, that meant:

- a declared `boolean` read back as `1`/`0`, so a guard such as `field != true` was always true;
- a declared `json` field read back as a string;
- a paged read with no `orderBy` got no `id` tie-breaker, so walking the pages could serve one row twice and skip another, and the driver logged `Paged read of '…' is NOT deterministic`;
- `datetime` / `time` columns were never converged to the canonical storage form, so their filters stayed on the slower read-side repair expression.

`syncSchemasBatch` now finishes the way the other two doors do. It registers each object's field types, keyed by the `object` name it was given, and then runs the canonical temporal backfill once for the whole batch. A DDL failure still rejects before anything is registered.

Nothing to change on your side: the next boot applies it. Values already on disk were stored correctly; what changes is how they read back. The one write this adds is the backfill: on its first run it rewrites legacy `datetime` / `time` text into the canonical spelling of the same instant, which the `syncSchema` and `initObjects` doors already did. Local and embedded-replica deployments are unaffected.
