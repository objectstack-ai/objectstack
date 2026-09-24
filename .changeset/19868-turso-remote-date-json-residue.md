---
"@objectstack/driver-turso": patch
---

A remote Turso deployment now converges, at its first boot after upgrading, the `date` and `json` cells that the engine's boot schema sync wrote without converting them before #19844, where the cell's original value can be read exactly from its stored text. "Remote" means a `libsql://`, `https://`, `http://`, `wss://` or `ws://` URL with no `syncUrl`, or an explicit `mode: 'remote'` (#19868).

What a first boot now rewrites:

- **A `date` stored as a full timestamp.** A `Date`, or a string such as `2025-07-28T10:00:00Z`, `2025-07-28T01:00:00+08:00` or `2025-07-28 10:00:00`, was stored as written, and a `Date` as its ISO text. Such a cell is rewritten to the calendar day the driver reads it as since the #19844 read fix, which is the day the write path stores today for the same value: the leading `YYYY-MM-DD` of the text, after surrounding whitespace is trimmed. A `Date` gives its UTC day. That is not necessarily the day a caller meant when it built the `Date` at local midnight east of UTC, and no stored cell records which day that was. The rewrite changes no read, because the #19844 read fix already returns that day. An equality filter on the day (`{ day: '2025-07-28' }`), or a bare-day bound such as `$lte: '2025-07-28'`, now matches these rows. The time of day in the stored text is dropped. Since the #19844 read fix, which ships in the same release, no read of a `date` field returns it. Before that fix, an object synced at boot read such a cell back exactly as stored, time of day included.
- **A `json` string stored bare whose text does not parse as JSON** (for example `hello`, or an empty string). It is rewritten as its JSON string (`"hello"`), which is what the write path stores for it today. It reads back as the same string as before.

What it deliberately leaves as stored, because the original value cannot be told from the stored bytes:

- **Any `json` cell whose text parses.** This includes a stored `true`, which reads back as `1`. The column is TEXT, and a boolean `true` became the text `1`. A string `'1'` left the same text, and `1` is also what the write path stores for the number `1` today. A string `'42'` reads back as the number `42`, and its text `42` is also what the write path stores for the number `42`. A string `'true'` reads back as `true`, and its text is what the write path stores for the boolean `true`. These cells keep reading as the #19844 read fix reads them. Before that fix, an object synced at boot read them back as their stored text. Correct the affected records by writing them again through the API.
- **JSON nested deeper than SQLite's JSON depth limit**, which SQLite reports as invalid although it parses. It reads back as the structure it is.
- **Single-value `image` / `file` / `avatar` / `video` / `audio` columns.** Whether their ids are stored quoted or bare depends on the deployment. Both forms read back the same.

The pass runs after every remote schema sync. On an already converged database it costs one read round-trip, and it writes nothing. It works in batches. A large table that does not finish in one boot continues at the next schema sync. A failure is logged at `warn` and never stops a boot. Local and embedded-replica deployments are unaffected. Their schema sync registers the field types before any write, so their write path converts these values, and this pass does not run there.
