---
"@objectstack/driver-sqlite-wasm": patch
---

fix(driver-sqlite-wasm): a text value now round-trips byte-for-byte, as it does through `SqlDriver` on better-sqlite3 — an embedded U+0000 no longer cuts the stored value short, and a leading U+FEFF is no longer dropped when the value is read (#19978)

Clause-②: no

`SqliteWasmDriver` changed a text value without raising, at two points in sql.js (measured on sql.js 1.14.1, the version the lockfile installs, against better-sqlite3, which round-trips every value below):

- **Write.** sql.js binds a string with a length of `-1`, so SQLite stores it only up to the first U+0000: `'a'` + U+0000 + `'b'` was stored as the single byte `61`, and `'ab'` + U+0000 as `6162`.
- **Read.** sql.js decodes a text cell up to the first NUL byte, through a decoder that drops a leading byte-order mark: a stored `610062` read back as `'a'`, and a stored text beginning with U+FEFF read back without it. A U+FEFF was always stored, because the write keeps it.

What changes:

- Every text cell the driver reads is decoded from its stored bytes, so a U+0000 anywhere in it and a U+FEFF at its start come back as stored. This includes values already on disk: a stored text that begins with U+FEFF now reads back with it.
- A string value holding U+0000 is bound as its UTF-8 bytes, and the parameter that receives it becomes `+CAST(<parameter> AS TEXT)`, so SQLite stores the same TEXT value better-sqlite3 stores, and compares it the same way. Positional `?`, numbered `?NNN` and named parameters are all numbered as SQLite numbers them. A statement that binds no such string runs exactly as before.
- An equality filter on such a value now compares the whole value. Before, the comparand was cut at the same U+0000 as the stored value, so `{ v: 'a' }` also matched a row written as `'a'` + U+0000 + `'b'`. It no longer does.
- The local `Field.json` storage backfill (`SqlDriver.backfillCanonicalJsonEncoding`) now converges a legacy json text cell holding a leading U+FEFF or an embedded U+0000 on this driver too: measured on the next `initObjects`, a stored `EFBBBF78` becomes `22EFBBBF7822` and a stored `610062` becomes `22615C75303030306222`, the same bytes better-sqlite3 writes, where before this change both were left as stored because sql.js did not read them back verbatim.
- If the loaded sql.js has no `Statement.getBlob` (the one sql.js read that carries a byte length), reading a text cell throws instead of decoding through the lossy path. sql.js 1.14.1 has it in its Node, browser and debug builds.

What does not change: a value already stored cut short stays cut short. The bytes after the U+0000 were never written, so nothing can restore them.
