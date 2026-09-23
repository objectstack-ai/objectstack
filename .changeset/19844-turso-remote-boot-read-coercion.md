---
"@objectstack/driver-turso": patch
---

A remote Turso deployment now reads, writes and filters the objects it synced at boot by their declared field types. "Remote" means a `libsql://`, `https://`, `http://`, `wss://` or `ws://` URL with no `syncUrl`, or an explicit `mode: 'remote'` (#19844).

The engine's boot schema sync (`ObjectQLPlugin`) reaches this driver through `syncSchemasBatch`, because the driver declares `supports.batchSchemaSync`. On the remote transport that method ran the DDL and stopped. It skipped the field-type registration that its sibling doors, `syncSchema` and `initObjects`, run afterwards. For every object a remote app synced at boot, that meant:

- **Reads came back as stored.** A declared `boolean` read back as `1`/`0`, and a `json` field as its stored text. A `datetime`, `time` or `date` field read back exactly as stored, for example as an offset-bearing string or epoch text rather than the canonical `…Z` form. This held for records read through the driver and through the engine's `find` / `findOne`. A CEL expression or an in-memory `$ne: true` filter evaluated over such a record, such as `field != true`, was therefore true even for a stored `true`. Hook contexts were not affected, because the engine converts declared booleans before building them.
- **Writes were not converted either.** A `datetime` or `time` value in any spelling other than the canonical one (with an offset, a zone-naive wall clock, an epoch number) was stored as sent. A `Date` given to a `datetime` was the exception: it was stored in canonical form. A `date` given as a `Date` or a full timestamp was stored as a full timestamp. An object or array in a `json` field was stored as it would have been anyway. A scalar `json` value (a string, number or boolean) was stored without its JSON encoding.
- **Filters compared text as spelled.** A filter on a `datetime` or `time` field compared the stored text with the comparand exactly as the caller wrote it, converting neither side. Rows whose cell or comparand used another spelling of the same value were missed or matched wrongly. For example, a bare-day upper bound `$lte: '2025-07-28'` left out that day's rows stored as ISO text.
- **Paging was not deterministic.** A paged read with no `orderBy` got no `id` tie-breaker, so walking the pages could serve one row twice and skip another. The driver logged `Paged read of '…' is NOT deterministic`.

`syncSchemasBatch` now finishes the way the other two doors do. It registers each object's field types, keyed by the `object` name it was given, and then runs the canonical temporal backfill once for the whole batch. A DDL failure still rejects before anything is registered. Reads, writes and filters on those objects now convert exactly as they do through `syncSchema` and `initObjects`.

What happens on disk at the first boot after upgrading: the one write this change adds is that backfill, which the `syncSchema` and `initObjects` doors already ran. It rewrites `datetime` and `time` cells stored in a non-canonical spelling, including any this door wrote unconverted, into the canonical spelling of the same value. It leaves alone a cell it cannot safely read as a time. Nothing else on disk is touched, so two kinds of cells this door wrote unconverted stay as they are:

- A `date` stored as a full timestamp reads back as its calendar day, but an equality filter on that day does not match it.
- A scalar `json` value stored without its encoding reads back as whatever its text parses to. A stored `true` reads back as `1`, and a numeric-looking string reads back as a number.

Local and embedded-replica deployments are unaffected.
